import {
  BadRequestException, ConflictException, Injectable, Logger, NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createPrivateKey, randomBytes } from 'node:crypto';
import { isEmail } from 'class-validator';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { hashIdempotencyPayload, TransactionService } from '../../common/transactions/transaction.service';
import { OutboxService } from '../../common/outbox/outbox.service';
import { enqueueCheckoutOrderMail } from '../../common/outbox/checkout-order-mail';
import { parseMailRecipients } from '../../common/outbox/mail-recipients';
import {
  CHECKOUT_QUOTE_INCLUDE, CheckoutValidationService, checkoutConflict,
} from '../checkout/checkout-validation.service';
import { boricaGatewayPublicKey, signBoricaPayment, verifyBoricaResponseSignature } from './borica-signature';
import { paymentHold } from '../checkout/payment-hold';

const EVIDENCE_FIELDS = [
  'ACTION', 'RC', 'APPROVAL', 'TERMINAL', 'TRTYPE', 'AMOUNT', 'CURRENCY',
  'ORDER', 'RRN', 'INT_REF', 'PARES_STATUS', 'ECI', 'TIMESTAMP', 'NONCE', 'P_SIGN',
] as const;

function object(value: Prisma.JsonValue): Prisma.JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw checkoutConflict('QUOTE_CHANGED');
  }
  return value;
}

function holdDeadlineViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  const adapter = error.meta?.driverAdapterError;
  if (!adapter || typeof adapter !== 'object' || !('cause' in adapter)) return false;
  const cause = adapter.cause;
  return !!cause && typeof cause === 'object' && 'originalCode' in cause &&
    cause.originalCode === 'PHD01';
}

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionService,
    private readonly validation: CheckoutValidationService,
    private readonly outbox: OutboxService,
  ) { }

  async initiate(guestId: string, orderId: string, key: string | undefined) {
    if (!this.config.get<boolean>('CHECKOUT_ENABLED')) {
      throw new ServiceUnavailableException({ code: 'TEMPORARILY_UNAVAILABLE' });
    }
    if (!key || !/^[A-Za-z0-9._:-]{1,128}$/.test(key)) {
      throw new BadRequestException({ code: 'FIELD_INVALID', message_key: 'errors.validation' });
    }
    let result;
    try {
      result = await this.transactions.serializable((tx) =>
        this.transactions.executeIdempotentAction(tx, {
          scopeKey: `checkout:payment:${guestId}:${orderId}`, requestId: key, payload: {},
        }, async () => {
          const order = await tx.order.findFirst({
            where: { id: orderId, guestId, sandbox: false },
            include: { quoteIdRelation: { include: CHECKOUT_QUOTE_INCLUDE } },
          });
          if (!order) throw new NotFoundException();
          await this.transactions.lockOrders(tx, [order.id]);
          const prior = await tx.bankPaymentAttempt.findUnique({ where: { orderId } });
          if (prior) return { status_code: 200, body: { attemptRef: prior.id } };
          if (order.paymentHoldExpiredAt ||
            (order.paymentHoldExpiresAt && order.paymentHoldExpiresAt.getTime() <= Date.now())) {
            throw checkoutConflict('PAYMENT_HOLD_EXPIRED');
          }
          await this.validation.validateQuote(tx, order.quoteIdRelation, order.id);
          const customer = object(order.customer);
          const cardholder = object(customer.cardholder ?? null);
          if (typeof cardholder.name !== 'string' || typeof cardholder.email !== 'string' ||
            !isEmail(cardholder.email) || typeof cardholder.billingAddress !== 'string') {
            throw checkoutConflict('QUOTE_CHANGED');
          }
          const terminal = this.config.getOrThrow<string>('BORICA_TERMINAL_ID');
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${terminal}))`;
          const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
          let sequence: bigint | undefined;
          let bankOrder: string | undefined;
          for (let count = 0; count < 999999; count++) {
            const rows = await tx.$queryRaw<{ value: bigint }[]>`
              SELECT nextval(pg_get_serial_sequence('"BankPaymentAttempt"', 'gatewaySequence')) AS value
            `;
            sequence = rows[0]?.value;
            if (sequence === undefined) throw new Error('Bank order sequence is unavailable');
            const candidate = (((sequence - 1n) % 999999n) + 1n).toString().padStart(6, '0');
            const used = await tx.bankPaymentAttempt.findFirst({
              where: { terminal, bankOrder: candidate, createdAt: { gt: cutoff } }, select: { id: true },
            });
            const legacyUsed = await tx.sandboxPaymentAttempt.findFirst({
              where: { terminal, gatewaySequence: Number(candidate), createdAt: { gt: cutoff } },
              select: { id: true },
            });
            if (!used && !legacyUsed) { bankOrder = candidate; break; }
          }
          if (!bankOrder || sequence === undefined) {
            throw new ServiceUnavailableException({ code: 'BANK_ORDER_CAPACITY_UNAVAILABLE' });
          }
          const nonce = randomBytes(16).toString('hex').toUpperCase();
          const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
          const privateKey = createPrivateKey(Buffer.from(
            this.config.getOrThrow<string>('BORICA_PRIVATE_KEY_BASE64'), 'base64',
          ));
          const amount = order.total.toFixed(2);
          const formFields: Record<string, string> = {
            TERMINAL: terminal, TRTYPE: '1', AMOUNT: amount, CURRENCY: 'EUR', ORDER: bankOrder,
            DESC: `SSG ${order.number}`,
            MERCHANT: this.config.getOrThrow<string>('BORICA_MERCHANT_ID'),
            MERCH_NAME: this.config.getOrThrow<string>('BORICA_MERCHANT_NAME'),
            COUNTRY: 'BG', LANG: order.locale.toUpperCase(), ADDENDUM: 'AD,TD',
            'AD.CUST_BOR_ORDER_ID': `${bankOrder}${order.id.replace(/-/g, '').slice(0, 16).toUpperCase()}`,
            TIMESTAMP: timestamp, NONCE: nonce,
            M_INFO: Buffer.from(JSON.stringify({
              cardholderName: cardholder.name, email: cardholder.email,
              billAddrLine1: cardholder.billingAddress,
            }), 'utf8').toString('base64'),
            P_SIGN: signBoricaPayment({
              terminal, amount, currency: 'EUR', order: bankOrder, timestamp, nonce,
            }, privateKey),
          };
          if (order.paymentHoldExpiresAt && order.paymentHoldExpiresAt.getTime() <= Date.now()) {
            throw checkoutConflict('PAYMENT_HOLD_EXPIRED');
          }
          const attempt = await tx.bankPaymentAttempt.create({
            data: {
              orderId: order.id, gatewaySequence: sequence, bankOrder, terminal, nonce,
              gatewayUrl: this.config.getOrThrow<string>('BORICA_GATEWAY_URL'),
              requestTimestamp: timestamp, formFields, amount: order.total, currency: 'EUR',
              nextReconcileAt: new Date(Date.now() +
                this.config.getOrThrow<number>('PAYMENT_RECONCILE_INTERVAL_SECONDS') * 1000),
            },
          });
          return { status_code: 201, body: { attemptRef: attempt.id } };
        }),
      );
    } catch (error) {
      if (holdDeadlineViolation(error)) throw checkoutConflict('PAYMENT_HOLD_EXPIRED');
      if (error instanceof ConflictException) {
        const body = error.getResponse();
        if (typeof body === 'object' && body !== null &&
          'code' in body && body.code === 'REQUEST_PAYLOAD_MISMATCH') {
          throw checkoutConflict('IDEMPOTENCY_CONFLICT');
        }
      }
      throw error;
    }
    if (result.replayed || result.status_code !== 201) return this.result(guestId, orderId);
    const attempt = await this.prisma.bankPaymentAttempt.findFirst({
      where: { id: String(result.body.attemptRef), order: { id: orderId, guestId, sandbox: false } },
      include: { order: { select: { paymentHoldExpiresAt: true, paymentHoldExpiredAt: true } } },
    });
    if (!attempt) throw new Error('Committed payment attempt is unavailable');
    if (attempt.outcome !== 'pending') return this.result(guestId, orderId);
    return {
      attemptRef: attempt.id, outcome: 'pending', nextAction: 'submit_bank_form',
      hold: paymentHold(attempt.order.paymentHoldExpiresAt, attempt.order.paymentHoldExpiredAt, attempt),
      form: { method: 'POST', url: attempt.gatewayUrl, fields: object(attempt.formFields) },
    };
  }

  async result(guestId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, guestId, sandbox: false },
      select: { total: true, bankPaymentAttempt: true, paymentHoldExpiresAt: true, paymentHoldExpiredAt: true },
    });
    if (!order) throw new NotFoundException();
    const attempt = order.bankPaymentAttempt;
    return {
      attemptRef: attempt?.id ?? null,
      outcome: attempt?.outcome ?? 'pending',
      bankVerified: attempt?.outcome === 'paid' || attempt?.outcome === 'failed',
      hold: paymentHold(order.paymentHoldExpiresAt, order.paymentHoldExpiredAt, attempt),
      ...(attempt?.customerMessage
        ? { customerMessage: attempt.customerMessage, customerMessageVerified: false } : {}),
      totalMinor: order.total.mul(100).toNumber(), currency: 'EUR',
      ...(attempt?.outcome === 'paid' ? { verifiedPaidMinor: attempt.amount.mul(100).toNumber() } : {}),
      nextAction: attempt?.outcome === 'paid' ? 'view_order'
        : !attempt ? (order.paymentHoldExpiredAt ||
          (order.paymentHoldExpiresAt && order.paymentHoldExpiresAt.getTime() <= Date.now())
          ? 'create_new_order' : 'back_to_review')
          : attempt.outcome === 'failed' || attempt.manualReviewRequired ? 'contact_support' : 'check_result',
    };
  }

  private verifiedFields(body: unknown): Record<string, string> {
    const publicKey = boricaGatewayPublicKey(
      this.config.getOrThrow<string>('BORICA_GATEWAY_PUBLIC_KEY_BASE64'),
    );
    if (!verifyBoricaResponseSignature(body, publicKey) || !body ||
      typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException({ code: 'PAYMENT_UNVERIFIED' });
    }
    const fields: Record<string, string> = {};
    for (const name of EVIDENCE_FIELDS) {
      if (name in body) {
        const value: unknown = Reflect.get(body, name);
        if (typeof value !== 'string' || value.length > 1024) {
          throw new BadRequestException({ code: 'PAYMENT_UNVERIFIED' });
        }
        fields[name] = value;
      }
    }
    if (!/^[0-9A-F]{32}$/.test(fields.NONCE ?? '') ||
      !/^\d{6}$/.test(fields.ORDER ?? '') ||
      !/^\d{14}$/.test(fields.TIMESTAMP ?? '') ||
      !/^[0-3]$/.test(fields.ACTION ?? '') || !/^(?:\d{2}|-\d{1,3})$/.test(fields.RC ?? '')) {
      throw new BadRequestException({ code: 'PAYMENT_UNVERIFIED' });
    }
    return fields;
  }

  async verifyCallback(body: unknown): Promise<void> {
    const fields = this.verifiedFields(body);
    if (fields.TRTYPE !== '1') throw new BadRequestException({ code: 'PAYMENT_UNVERIFIED' });
    const attempt = await this.prisma.bankPaymentAttempt.findUnique({ where: { nonce: fields.NONCE } });
    if (!attempt) throw new BadRequestException({ code: 'PAYMENT_UNVERIFIED' });
    await this.recordOutcome(attempt.id, fields, 'callback', attempt.nonce, this.customerMessage(body));
  }

  async verifyInquiry(attemptId: string, nonce: string, body: unknown): Promise<void> {
    const fields = this.verifiedFields(body);
    if (fields.TRTYPE !== '90') throw new BadRequestException({ code: 'PAYMENT_UNVERIFIED' });
    await this.recordOutcome(attemptId, fields, 'inquiry', nonce, this.customerMessage(body));
  }

  private customerMessage(body: unknown): string | undefined {
    if (!body || typeof body !== 'object' || !('CARDHOLDERINFO' in body) ||
      body.CARDHOLDERINFO === '' || body.CARDHOLDERINFO === undefined) return undefined;
    const text = body.CARDHOLDERINFO;
    if (typeof text !== 'string' || text.length > 1024 || /[\p{C}<>]/u.test(text)) {
      this.logger.warn('Invalid unsigned BORICA customer message omitted; financial verification is unaffected');
      return undefined;
    }
    return text;
  }

  private async recordOutcome(
    attemptId: string, fields: Record<string, string>, source: 'callback' | 'inquiry', nonce: string,
    customerMessage?: string,
  ): Promise<void> {
    const matched = await this.prisma.bankPaymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    await this.transactions.serializable(async (tx) => {
      const lines = await tx.orderLine.findMany({ where: { orderId: matched.orderId } });
      await this.transactions.lockProducts(tx, lines.map((line) => line.productId));
      await this.transactions.lockStockItems(tx, lines.map((line) => line.stockItemId));
      await this.transactions.lockOrders(tx, [matched.orderId]);
      const attempt = await tx.bankPaymentAttempt.findUniqueOrThrow({
        where: { id: attemptId }, include: { order: true },
      });
      if (attempt.order.sandbox || fields.NONCE !== nonce || fields.TERMINAL !== attempt.terminal ||
        fields.ORDER !== attempt.bankOrder ||
        attempt.gatewayUrl !== this.config.getOrThrow<string>('BORICA_GATEWAY_URL')) {
        throw new BadRequestException({ code: 'PAYMENT_UNVERIFIED' });
      }
      const paid = fields.ACTION === '0' && fields.RC === '00';
      const matchingMoney = fields.AMOUNT === attempt.amount.toFixed(2) &&
        fields.CURRENCY === attempt.currency;
      if (paid && !matchingMoney) throw new BadRequestException({ code: 'PAYMENT_UNVERIFIED' });
      const now = new Date();
      const positiveDecline = fields.ACTION === '2' && /^\d{2}$/.test(fields.RC) && fields.RC !== '00';
      // Guide 9.5.1: negative outcomes become final only after a status inquiry beyond GUARDTIME + 1 minute.
      const finalNegative = source === 'inquiry' && fields.RC.startsWith('-') &&
        now.getTime() - attempt.createdAt.getTime() > 16 * 60 * 1000;
      const failed = matchingMoney && (positiveDecline || finalNegative);
      const evidence: Prisma.InputJsonObject = { ...fields };
      await tx.bankPaymentEvent.createMany({
        data: [{ attemptId, source, eventHash: hashIdempotencyPayload(evidence), evidence }],
        skipDuplicates: true,
      });
      if (attempt.outcome === 'paid' || (attempt.outcome === 'failed' && !paid)) return;
      const stocks = await tx.stockItem.findMany({
        where: { id: { in: lines.map((line) => line.stockItemId) } },
      });
      const conflict = lines.some((line) => !stocks.some((stock) =>
        stock.id === line.stockItemId && stock.status === 'reserved' &&
        stock.reservationReference === line.reservationReference &&
        stock.locationCode === line.reservedLocation,
      ));
      const late = paid && (attempt.outcome === 'failed' || conflict);
      await tx.bankPaymentAttempt.update({
        where: { id: attempt.id },
        data: {
          ...(paid ? { outcome: 'paid', paidAt: now } : failed ? { outcome: 'failed' } : {}),
          ...(source === 'inquiry' ? { lastReconciledAt: now } : {}),
          ...(paid || failed ? { nextReconcileAt: null, reconcileLeaseUntil: null } : {}),
          manualReviewRequired: attempt.manualReviewRequired || late || failed,
          ...(!attempt.customerMessage && customerMessage ? { customerMessage } : {}),
        },
      });
      if (paid || failed) {
        await tx.order.update({
          where: { id: attempt.orderId },
          data: {
            version: { increment: 1 }, attentionCodes: [...new Set([
              ...attempt.order.attentionCodes,
              ...(late ? ['paid_stock_conflict_review_required'] : []),
              ...(failed ? ['payment_failed_reservation_retained'] : []),
            ])]
          },
        });
        await tx.auditEvent.createMany({
          data: [{
            systemActor: 'borica', action: paid ? 'payment.verified' : 'payment.failed_verified',
            subjectType: 'Order', subjectId: attempt.orderId,
            eventKey: `bank-outcome:${attempt.id}:${paid ? 'paid' : 'failed'}`,
            after: { bankVerified: true, staffReviewRequired: late || failed },
          }], skipDuplicates: true,
        });
      }
    });
    const current = await this.prisma.bankPaymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    if (current.outcome === 'paid') {
      try {
        await this.queueNotification(attemptId);
      } catch {
        this.logger.error('Verified payment persisted; notification preparation failed and will be retried');
      }
    }
  }

  async queueNotification(attemptId: string): Promise<void> {
    await this.transactions.serializable(async (tx) => {
      const identity = await tx.bankPaymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
      await this.transactions.lockOrders(tx, [identity.orderId]);
      const attempt = await tx.bankPaymentAttempt.findUniqueOrThrow({
        where: { id: attemptId }, include: { order: true },
      });
      if (attempt.outcome !== 'paid' || attempt.notificationQueuedAt) return;
      const customer = object(attempt.order.customer);
      if (typeof customer.email !== 'string' || !isEmail(customer.email)) {
        throw new Error('Payment notification customer snapshot is invalid');
      }
      const dedupeKey = `bank-payment:${attempt.id}`;
      if (!await tx.outboxMessage.findUnique({ where: { dedupeKey } })) {
        await enqueueCheckoutOrderMail(tx, this.outbox, this.config, {
          orderId: attempt.orderId, email: customer.email, locale: attempt.order.locale,
          kind: 'customer_payment_received', dedupeKey, paymentAttemptId: attempt.id,
        });
      }
      const recipients = parseMailRecipients(this.config.get<string>('MAIL_TO') ?? '');
      if (!recipients.length) throw new Error('Payment notification recipients are not configured');
      for (const recipient of recipients) {
        const recipientHash = createHash('sha256').update(recipient.toLowerCase()).digest('hex');
        await this.outbox.enqueue(tx, {
          dedupeKey: `bank-payment-staff:${attempt.id}:${recipientHash}`,
          kind: 'ops_payment_received',
          orderId: attempt.orderId,
          recipientSnapshot: recipient,
          locale: attempt.order.locale,
          templateVersion: 'verified-payment-staff-v1',
          payload: { order_id: attempt.orderId, payment_attempt_id: attempt.id },
        });
      }
      await tx.bankPaymentAttempt.update({
        where: { id: attempt.id }, data: { notificationQueuedAt: new Date() },
      });
    });
  }
}

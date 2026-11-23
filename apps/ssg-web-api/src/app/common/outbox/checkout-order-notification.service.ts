import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isEmail, isUUID } from 'class-validator';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TransactionService } from '../transactions/transaction.service';
import { MailCaptureError } from './local-mail-capture.service';
import { MailDeliveryError, MailDeliveryService } from './mail-delivery.service';
import { OutboxDispatchError } from './outbox-handler';
import type { OutboxDispatchResult } from './outbox-handler';
import type { ClaimedOutboxMessage } from './outbox.service';
import { OutboxService } from './outbox.service';
import { decryptOrderAccessSecret, hashOrderAccessToken } from './order-access-secret';
import { enqueueCheckoutOrderMail } from './checkout-order-mail';

function object(value: Prisma.JsonValue | null): Prisma.JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new OutboxDispatchError('CHECKOUT_SNAPSHOT_INVALID');
  }
  return value;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] ?? character);
}

@Injectable()
export class CheckoutOrderNotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionService,
    private readonly config: ConfigService,
    private readonly outbox: OutboxService,
    private readonly mail: MailDeliveryService,
  ) {}

  async dispatchLookup(message: ClaimedOutboxMessage): Promise<OutboxDispatchResult> {
    const payload = object(message.payload);
    if (
      message.kind !== 'customer_access_lookup' || message.orderId || message.inquiryId ||
      payload.kind !== message.kind || typeof payload.lookup_id !== 'string' ||
      !isUUID(payload.lookup_id) || Object.keys(payload).length !== 2 ||
      message.dedupeKey !== `checkout-access-lookup:${payload.lookup_id}`
    ) throw new OutboxDispatchError('JOB_PAYLOAD_INVALID');
    const lookupId = payload.lookup_id;
    return this.transactions.serializable(async (transaction) => {
      const rows = await transaction.$queryRaw<{ id: string }[]>`
        SELECT id FROM "AccessLookup" WHERE id = ${lookupId}::uuid FOR UPDATE
      `;
      if (!rows.length) throw new OutboxDispatchError('ACCESS_LOOKUP_UNAVAILABLE');
      const lookup = await transaction.accessLookup.findUniqueOrThrow({ where: { id: lookupId } });
      if (lookup.processedAt) return { outcome: 'sent' as const };
      if (lookup.expiresAt <= new Date()) {
        await transaction.accessLookup.update({
          where: { id: lookupId }, data: { processedAt: new Date() },
        });
        return { outcome: 'suppressed' as const, safeError: 'ACCESS_LOOKUP_EXPIRED' };
      }
      let decoded: unknown;
      try {
        decoded = JSON.parse(decryptOrderAccessSecret(
          lookup.encryptedInput,
          Buffer.from(this.config.getOrThrow<string>('ORDER_ACCESS_ENCRYPTION_KEY_BASE64'), 'base64'),
          `lookup:${lookupId}`,
        ));
      } catch {
        throw new OutboxDispatchError('ACCESS_LOOKUP_INVALID');
      }
      if (
        decoded === null || typeof decoded !== 'object' || Array.isArray(decoded) ||
        !('orderNumber' in decoded) || typeof decoded.orderNumber !== 'string' ||
        !('email' in decoded) || typeof decoded.email !== 'string' || !isEmail(decoded.email) ||
        !('locale' in decoded) || (decoded.locale !== 'bg' && decoded.locale !== 'en')
      ) throw new OutboxDispatchError('ACCESS_LOOKUP_INVALID');
      const order = await transaction.order.findUnique({
        where: { number: decoded.orderNumber },
        select: { id: true, sandbox: true, customer: true },
      });
      const customer = order ? object(order.customer) : null;
      const matched = order?.sandbox === false && typeof customer?.email === 'string' &&
        customer.email.toLowerCase() === decoded.email.toLowerCase();
      if (matched && order && customer && typeof customer.email === 'string') {
        await enqueueCheckoutOrderMail(transaction, this.outbox, this.config, {
          orderId: order.id,
          email: customer.email,
          locale: decoded.locale,
          kind: 'customer_order_access',
          dedupeKey: `checkout-order-access:${lookupId}`,
        });
      }
      await transaction.accessLookup.update({
        where: { id: lookupId }, data: { processedAt: new Date() },
      });
      return matched
        ? { outcome: 'sent' as const }
        : { outcome: 'suppressed' as const, safeError: 'ACCESS_LOOKUP_NO_MATCH' };
    });
  }

  async dispatchMail(message: ClaimedOutboxMessage): Promise<OutboxDispatchResult> {
    const payment = message.kind === 'customer_payment_received';
    const payload = object(message.payload);
    if (
      (!payment && message.kind !== 'customer_order_access') ||
      !message.orderId || message.inquiryId ||
      !message.recipientSnapshot || !isEmail(message.recipientSnapshot) ||
      !message.locale || message.templateVersion !== 'checkout-order-v1' ||
      !message.encryptedSecret || payload.kind !== message.kind ||
      payload.order_id !== message.orderId || typeof payload.grant_id !== 'string' ||
      !isUUID(payload.grant_id) ||
      Object.keys(payload).some((key) =>
        !['kind', 'order_id', 'grant_id', 'payment_attempt_id'].includes(key)) ||
      (payment && (typeof payload.payment_attempt_id !== 'string' ||
        !isUUID(payload.payment_attempt_id) ||
        message.dedupeKey !== `bank-payment:${payload.payment_attempt_id}`))
    ) throw new OutboxDispatchError('JOB_PAYLOAD_INVALID');
    try {
      const prior = await this.mail.lookup(message.id);
      if (prior) return { outcome: 'sent', providerMessageId: prior };
      const grant = await this.prisma.accessGrant.findUnique({
        where: { id: payload.grant_id },
        select: {
          orderId: true, scope: true, tokenHash: true, expiresAt: true,
          revokedAt: true, redeemedAt: true,
        },
      });
      if (!grant || grant.orderId !== message.orderId || grant.scope !== 'customer_read' ||
          grant.revokedAt) throw new OutboxDispatchError('ACCESS_GRANT_UNAVAILABLE');
      if (grant.redeemedAt) return { outcome: 'sent' };
      if (grant.expiresAt <= new Date()) throw new OutboxDispatchError('ACCESS_GRANT_EXPIRED');
      let token: string;
      try {
        token = decryptOrderAccessSecret(
          message.encryptedSecret,
          Buffer.from(this.config.getOrThrow<string>('ORDER_ACCESS_ENCRYPTION_KEY_BASE64'), 'base64'),
          `${message.orderId}:${payload.grant_id}`,
        );
      } catch {
        throw new OutboxDispatchError('ACCESS_GRANT_UNAVAILABLE');
      }
      if (!/^[A-Za-z0-9_-]{43}$/.test(token) || hashOrderAccessToken(token) !== grant.tokenHash) {
        throw new OutboxDispatchError('ACCESS_GRANT_UNAVAILABLE');
      }
      const order = await this.prisma.order.findUnique({
        where: { id: message.orderId },
        include: {
          from_OrderLine_orderId: { orderBy: { sortOrder: 'asc' } },
          bankPaymentAttempt: true,
        },
      });
      const attempt = order?.bankPaymentAttempt;
      if (!order || order.sandbox || object(order.customer).email !== message.recipientSnapshot ||
          (payment && (order.locale !== message.locale || !attempt ||
            attempt.id !== payload.payment_attempt_id ||
            attempt.outcome !== 'paid' || !attempt.amount.equals(order.total)))) {
        throw new OutboxDispatchError('CHECKOUT_SNAPSHOT_UNAVAILABLE');
      }
      const accessUrl = new URL(this.config.getOrThrow<string>('ORDER_ACCESS_URL'));
      accessUrl.hash = `grant=${token}`;
      const link = accessUrl.toString();
      const bg = message.locale === 'bg';
      let subject: string;
      let before: string;
      let after: string;
      if (payment) {
        const store = await this.prisma.store.findUnique({
          where: { code: 'sofia' }, select: { publicData: true },
        });
        const storeData = object(store?.publicData ?? null);
        const localized = object(storeData[message.locale] ?? null);
        const storeEmail = Array.isArray(storeData.emails)
          ? storeData.emails[0]
          : storeData.email;
        if (
          typeof localized.address !== 'string' || !localized.address ||
          typeof localized.opening_hours !== 'string' || !localized.opening_hours ||
          typeof storeEmail !== 'string' || !isEmail(storeEmail) ||
          typeof storeData.phone !== 'string' || !storeData.phone
        ) throw new OutboxDispatchError('BOUTIQUE_INFORMATION_UNAVAILABLE');
        const lines = order.from_OrderLine_orderId.map((line) => {
          const item = object(line.snapshot);
          if (typeof item.title !== 'string') throw new OutboxDispatchError('CHECKOUT_SNAPSHOT_INVALID');
          return `${item.title} — ${line.unitPrice.toFixed(2)} EUR`;
        }).join('\n');
        if (!lines) throw new OutboxDispatchError('CHECKOUT_SNAPSHOT_INVALID');
        const receiving = object(order.fulfilment);
        const delivery = receiving.method === 'econt_address' || receiving.method === 'econt_office';
        const receive = delivery
          ? [receiving.recipientName, receiving.phone, receiving.locality,
              receiving.address ?? receiving.office, receiving.officeAddress]
              .filter((value) => typeof value === 'string').join(', ')
          : typeof receiving.method === 'string' && receiving.method === 'store_pickup'
            ? localized.address
            : '';
        if (!receive) throw new OutboxDispatchError('CHECKOUT_SNAPSHOT_INVALID');
        const date = new Intl.DateTimeFormat(bg ? 'bg-BG' : 'en-GB', {
          timeZone: 'Europe/Sofia', dateStyle: 'medium', timeStyle: 'short',
        }).format(order.createdAt);
        subject = bg
          ? `Потвърждение за плащане — поръчка № ${order.number}`
          : `Payment confirmation — order no. ${order.number}`;
        before = bg
          ? `Благодарим ви за поръчката.\n\nПолучихме плащането за поръчка № ${order.number} от ${date}.\n\n${lines}\n\nПлатена сума: ${order.total.toFixed(2)} EUR\nДоставка / получаване: 0,00 €\n\nПолучаване:\n${receive}\n\n${delivery ? 'Екипът на бутика ще се свърже с вас на посочения телефон в работно време, за да уточни нужните детайли за доставката и да потвърди кога ще изпрати пратката.' : `Екипът на бутика ще се свърже с вас на посочения телефон в работно време, за да уговори кога да вземете бижуто.\nБутик SSG София: ${localized.address}`}\n\nРаботно време: ${localized.opening_hours}\n\nВижте поръчката: `
          : `Thank you for your order.\n\nWe have received payment for order no. ${order.number}, placed on ${date}.\n\n${lines}\n\nAmount paid: ${order.total.toFixed(2)} EUR\nDelivery / collection: €0.00\n\nReceiving:\n${receive}\n\n${delivery ? 'Our boutique team will call you during opening hours to clarify any delivery details and confirm when your parcel will be dispatched.' : `Our boutique team will call you during opening hours to arrange when you can collect your jewellery.\nSSG Sofia boutique: ${localized.address}`}\n\nOpening hours: ${localized.opening_hours}\n\nView your order: `;
        after = bg
          ? `\n\nВъпроси? ${storeEmail} · ${storeData.phone}\nSSG · Sea of Silver & Gold`
          : `\n\nQuestions? ${storeEmail} · ${storeData.phone}\nSSG · Sea of Silver & Gold`;
      } else {
        subject = bg
          ? `Връзка за преглед на поръчка № ${order.number}`
          : `Viewing link for order no. ${order.number}`;
        before = bg
          ? `Получихме заявка за преглед на поръчка № ${order.number}.\n\nОтворете връзката и изберете „Виж поръчката“:\n`
          : `We received a request to view order no. ${order.number}.\n\nOpen the link and select “View your order”:\n`;
        after = bg
          ? '\n\nТази връзка дава достъп до вашата поръчка. Не я препращайте.\nАко вече не е валидна, можете да поискате нова от „Проверка на поръчка“ в сайта.\nАко не сте изпратили заявката, можете да пренебрегнете този имейл.\n\nSSG · Sea of Silver & Gold'
          : '\n\nThis link provides access to your order. Please do not forward it.\nIf it is no longer valid, request a new link from “Order lookup” on our website.\nIf you did not make this request, you can ignore this email.\n\nSSG · Sea of Silver & Gold';
      }
      const text = `${before}${link}${after}`;
      const linkLabel = bg ? 'Виж поръчката' : 'View order';
      const html = `<div style="font-family:Arial,sans-serif;white-space:pre-wrap">${escapeHtml(before)}<a href="${escapeHtml(link)}" style="text-decoration:underline">${linkLabel}</a>${escapeHtml(after)}</div>`;
      return {
        outcome: 'sent',
        providerMessageId: await this.mail.deliver(message.id, {
          recipient: message.recipientSnapshot, subject, text, html,
        }),
      };
    } catch (error) {
      if (error instanceof MailCaptureError || error instanceof MailDeliveryError) {
        throw new OutboxDispatchError(error.code);
      }
      throw error;
    }
  }
}

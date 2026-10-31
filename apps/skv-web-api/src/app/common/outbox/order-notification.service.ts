import { Injectable, Logger } from '@nestjs/common';
import { isEmail, isUUID } from 'class-validator';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TransactionService } from '../transactions/transaction.service';
import {
  LocalMailCaptureService,
  MailCaptureError,
} from './local-mail-capture.service';
import {
  OutboxDispatchError,
  renderMail,
} from './outbox-handler';
import type { OutboxDispatchResult, OutboxJobHandler } from './outbox-handler';
import type { ClaimedOutboxMessage } from './outbox.service';

function object(value: Prisma.JsonValue): Prisma.JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new OutboxDispatchError('ORDER_SNAPSHOT_INVALID');
  }
  return value;
}

@Injectable()
export class OrderNotificationService implements OutboxJobHandler {
  private readonly logger = new Logger(OrderNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionService,
    private readonly capture: LocalMailCaptureService,
  ) {}

  async dispatch(message: ClaimedOutboxMessage): Promise<OutboxDispatchResult> {
    const payment = message.kind === 'customer_payment_received';
    const referenceKey = payment ? 'payment_operation_id' : 'acceptance_id';
    const payload = object(message.payload);
    const reference = payload[referenceKey];
    if (
      (!payment && message.kind !== 'customer_order_confirmed') ||
      !message.orderId ||
      message.inquiryId !== null ||
      payload.kind !== message.kind ||
      payload.order_id !== message.orderId ||
      typeof reference !== 'string' ||
      !isUUID(reference) ||
      Object.keys(payload).some(
        (key) => !['kind', 'order_id', referenceKey].includes(key),
      ) ||
      message.dedupeKey !== `${message.kind}:${reference}`
    ) {
      throw new OutboxDispatchError('JOB_PAYLOAD_INVALID');
    }
    if (
      !message.recipientSnapshot ||
      !isEmail(message.recipientSnapshot) ||
      !message.locale ||
      message.encryptedSecret !== null ||
      message.templateVersion !== (payment ? 'payment-v1' : 'acceptance-v1')
    ) {
      throw new OutboxDispatchError('MAIL_CONFIGURATION_UNAVAILABLE');
    }
    const order = await this.prisma.order.findUnique({
      where: { id: message.orderId },
      select: { number: true, customer: true, locale: true, currency: true },
    });
    if (
      !order ||
      order.locale !== message.locale ||
      object(order.customer).email !== message.recipientSnapshot
    ) {
      throw new OutboxDispatchError('ORDER_SNAPSHOT_UNAVAILABLE');
    }
    try {
      // Reconcile external acceptance before looking at state that may have changed.
      const prior = await this.capture.lookup(message.id);
      if (prior) {
        return { outcome: 'sent', providerMessageId: prior };
      }
      const bg = message.locale === 'bg';
      const fields: [string, string][] = [
        [bg ? 'Поръчка' : 'Order', order.number],
      ];
      let subject: string;
      if (payment) {
        const operation = await this.prisma.paymentOperation.findUnique({
          where: { id: reference },
          select: {
            orderId: true, status: true, amount: true, currency: true, occurredAt: true,
          },
        });
        if (
          !operation ||
          operation.orderId !== message.orderId ||
          operation.status !== 'succeeded' ||
          operation.currency !== order.currency
        ) {
          throw new OutboxDispatchError('PAYMENT_FACT_UNAVAILABLE');
        }
        const acceptance = await this.prisma.acceptance.findUnique({
          where: { orderId: message.orderId },
          select: { acceptedAt: true },
        });
        subject = bg ? 'Получено плащане' : 'Payment received';
        fields.push(
          [bg ? 'Получена сума' : 'Received amount',
            `${operation.amount.toFixed(2)} ${operation.currency}`],
          [bg ? 'Дата на плащането' : 'Payment occurred at', operation.occurredAt.toISOString()],
          [bg ? 'Информация' : 'Information', acceptance
            ? (bg ? 'Плащането е записано към поръчката. То не променя приетите артикули.'
              : 'The payment is recorded against your order. It does not change the accepted items.')
            : (bg ? 'Плащането е получено. Поръчката все още се обработва; плащането не означава приемане.'
              : 'Payment has been received. Your order is still being processed; payment does not mean acceptance.')],
        );
      } else {
        const acceptance = await this.prisma.acceptance.findUnique({
          where: { id: reference },
          select: {
            orderId: true, acceptedAt: true, acceptedItemsSubtotal: true,
            financialTermsPending: true,
            from_AcceptanceLine_acceptanceId: {
              select: {
                accepted: true,
                orderLineIdRelation: {
                  select: {
                    id: true, orderId: true, sortOrder: true, stockItemId: true,
                    reservationReference: true, reservedLocation: true,
                    snapshot: true, unitPrice: true,
                  },
                },
              },
            },
          },
        });
        if (
          !acceptance ||
          acceptance.orderId !== message.orderId ||
          acceptance.from_AcceptanceLine_acceptanceId.length === 0
        ) {
          throw new OutboxDispatchError('ACCEPTANCE_SNAPSHOT_UNAVAILABLE');
        }
        const lines = acceptance.from_AcceptanceLine_acceptanceId
          .sort((a, b) => a.orderLineIdRelation.sortOrder - b.orderLineIdRelation.sortOrder);
        const accepted = lines.filter((line) => line.accepted);
        const rejected = lines.filter((line) => !line.accepted);
        if (
          accepted.length === 0 ||
          lines.some((line) => line.orderLineIdRelation.orderId !== message.orderId) ||
          acceptance.financialTermsPending !== (rejected.length > 0) ||
          !accepted.reduce(
            (sum, line) => sum.add(line.orderLineIdRelation.unitPrice),
            new Prisma.Decimal(0),
          ).equals(acceptance.acceptedItemsSubtotal)
        ) {
          throw new OutboxDispatchError('ACCEPTANCE_SNAPSHOT_UNAVAILABLE');
        }
        const safe = await this.transactions.serializable(async (transaction) => {
          await this.transactions.lockStockItems(
            transaction, accepted.map((line) => line.orderLineIdRelation.stockItemId),
          );
          await this.transactions.lockOrders(transaction, [acceptance.orderId]);
          const stocks = await transaction.stockItem.findMany({
            where: { id: { in: accepted.map((line) => line.orderLineIdRelation.stockItemId) } },
            select: { id: true, status: true, reservationReference: true, locationCode: true },
          });
          const stocksById = new Map(stocks.map((stock) => [stock.id, stock]));
          const checks = await transaction.storeCheck.findMany({
            where: { lineId: { in: accepted.map((line) => line.orderLineIdRelation.id) } },
            select: { lineId: true, status: true },
          });
          const checksByLine = new Map(checks.map((check) => [check.lineId, check.status]));
          const unsafe = accepted.some(({ orderLineIdRelation: line }) => {
            const stock = stocksById.get(line.stockItemId);
            return !stock || stock.status !== 'reserved' ||
              stock.reservationReference !== line.reservationReference ||
              stock.locationCode !== line.reservedLocation ||
              checksByLine.get(line.id) !== 'confirmed';
          });
          if (!unsafe) {
            return true;
          }
          const current = await transaction.order.findUniqueOrThrow({
            where: { id: acceptance.orderId },
            select: { attentionCodes: true },
          });
          if (!current.attentionCodes.includes('accepted_stock_conflict')) {
            await transaction.order.update({
              where: { id: acceptance.orderId },
              data: {
                attentionCodes: { push: 'accepted_stock_conflict' },
                version: { increment: 1 },
              },
            });
            await transaction.auditEvent.create({
              data: {
                systemActor: 'outbox',
                action: 'order.acceptance_notification_suppressed',
                subjectType: 'Order',
                subjectId: acceptance.orderId,
                eventKey: `acceptance_notification_conflict:${reference}`,
                after: { attention_code: 'accepted_stock_conflict' },
              },
            });
          }
          return false;
        });
        if (!safe) {
          this.logger.warn('Acceptance notification suppressed for committed stock conflict');
          return { outcome: 'suppressed', safeError: 'ACCEPTED_STOCK_CONFLICT' };
        }
        const describe = (line: typeof lines[number]): string => {
          const snapshot = object(line.orderLineIdRelation.snapshot);
          const name = snapshot[bg ? 'name_bg' : 'name_en'];
          const barcode = snapshot.barcode;
          if (typeof name !== 'string' || typeof barcode !== 'string') {
            throw new OutboxDispatchError('ORDER_SNAPSHOT_INVALID');
          }
          return `${name} (${barcode}) - ${line.orderLineIdRelation.unitPrice.toFixed(2)} ${order.currency}`;
        };
        subject = bg ? 'Поръчката е приета' : 'Order accepted';
        fields.push(
          [bg ? 'Приети артикули' : 'Accepted items', accepted.map(describe).join('\n')],
          [bg ? 'Неприети артикули' : 'Not accepted items',
            rejected.length ? rejected.map(describe).join('\n') : (bg ? 'Няма' : 'None')],
          [bg ? 'Стойност на приетите артикули' : 'Accepted items subtotal',
            `${acceptance.acceptedItemsSubtotal.toFixed(2)} ${order.currency}`],
          [bg ? 'Приета на' : 'Accepted at', acceptance.acceptedAt.toISOString()],
          [bg ? 'Информация' : 'Information', acceptance.financialTermsPending
            ? (bg ? 'Приета е част от поръчката. Финансовите условия изискват допълнително уточнение.'
              : 'Only part of your order was accepted. Financial terms require further clarification.')
            : (bg ? 'Приемането не означава готовност за получаване или изпращане.'
              : 'Acceptance does not mean readiness for pickup or dispatch.')],
        );
      }
      return {
        outcome: 'sent',
        providerMessageId: await this.capture.capture(
          message.id, renderMail(message.recipientSnapshot, subject, fields),
        ),
      };
    } catch (error) {
      if (error instanceof MailCaptureError) {
        throw new OutboxDispatchError(error.code);
      }
      throw error;
    }
  }
}

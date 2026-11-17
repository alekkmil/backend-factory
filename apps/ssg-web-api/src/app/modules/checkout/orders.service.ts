import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { Prisma } from '../../../generated/prisma/client';
import { TransactionService } from '../../common/transactions/transaction.service';
import {
  CHECKOUT_QUOTE_INCLUDE,
  CheckoutValidationService,
  checkoutConflict,
} from './checkout-validation.service';
import type { CommitOrderDto } from './orders.dto';
import { StockPublicationService } from '../../common/stock-facts/stock-publication.service';

function snapshot(value: Prisma.JsonValue): Prisma.InputJsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw checkoutConflict('QUOTE_CHANGED');
  }
  return value;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly config: ConfigService,
    private readonly transactions: TransactionService,
    private readonly validation: CheckoutValidationService,
    private readonly publication: StockPublicationService,
  ) { }

  async commit(
    guestId: string,
    key: string | undefined,
    input: CommitOrderDto,
  ) {
    if (!this.config.get<boolean>('CHECKOUT_ENABLED')) {
      throw new ServiceUnavailableException({
        code: 'TEMPORARILY_UNAVAILABLE', message_key: 'errors.temporary_unavailable',
      });
    }
    if (!key || !/^[A-Za-z0-9._:-]{1,128}$/.test(key)) {
      throw new BadRequestException({
        code: 'FIELD_INVALID', message_key: 'errors.validation',
      });
    }
    try {
      return await this.transactions.serializable(async (transaction) =>
        this.transactions.executeIdempotentAction(
          transaction,
          {
            scopeKey: `checkout:order:${guestId}`,
            requestId: key,
            payload: {
              quoteId: input.quoteId.toLowerCase(),
              quoteVersion: input.quoteVersion,
              acceptedTermsVersion: input.acceptedTermsVersion,
              accepted: input.accepted,
            },
          },
          async () => {
            const rows = await transaction.$queryRaw<{ id: string }[]>`
                SELECT id FROM "Quote"
                WHERE id = ${input.quoteId}::uuid AND "guestId" = ${guestId}::uuid
                FOR UPDATE
              `;
            if (!rows.length) throw checkoutConflict('QUOTE_CHANGED');
            const quote = await transaction.quote.findUniqueOrThrow({
              where: { id: input.quoteId },
              include: CHECKOUT_QUOTE_INCLUDE,
            });
            if (quote.consumedAt !== null) throw checkoutConflict('QUOTE_CHANGED');
            if (!quote.expiresAt || quote.expiresAt.getTime() <= Date.now()) {
              throw checkoutConflict('QUOTE_EXPIRED');
            }
            await transaction.$queryRaw`
                SELECT id FROM "PolicyVersion" WHERE id = ${quote.policyVersionId}::uuid FOR UPDATE
              `;
            const terms = await transaction.policyVersion.findUnique({
              where: { id: quote.policyVersionId },
              select: { current: true, published: true, versionLabel: true },
            });
            if (
              !terms?.current || !terms.published ||
              terms.versionLabel !== input.acceptedTermsVersion
            ) {
              throw checkoutConflict('TERMS_CHANGED');
            }
            await this.validation.validateQuote(transaction, quote);
            const now = new Date();
            if (quote.expiresAt.getTime() <= now.getTime()) {
              throw checkoutConflict('QUOTE_EXPIRED');
            }
            const orderId = randomUUID();
            const productIds = [...new Set(quote.from_QuoteLine_quoteId.map((line) => line.productId))];
            const fingerprints = new Map<string, string>();
            for (const id of productIds) {
              fingerprints.set(id, await this.publication.fingerprint(transaction, id));
            }
            const stocks = await transaction.stockItem.findMany({
              where: { id: { in: quote.from_QuoteLine_quoteId.map((line) => line.stockItemId) } },
              select: { id: true, locationCode: true },
            });
            for (const line of quote.from_QuoteLine_quoteId) {
              const reserved = await transaction.stockItem.updateMany({
                where: {
                  id: line.stockItemId, status: 'available', version: line.stockVersion,
                  reservationReference: null
                },
                data: {
                  status: 'reserved', reservationReference: `${orderId}:${line.stockItemId}`,
                  version: { increment: 1 }
                },
              });
              if (reserved.count !== 1) throw checkoutConflict('ITEM_UNAVAILABLE');
            }
            const order = await transaction.order.create({
              data: {
                id: orderId,
                number: `SSG-${randomBytes(12).toString('hex').toUpperCase()}`,
                sandbox: false,
                guestId,
                quoteId: quote.id,
                policyVersionId: quote.policyVersionId,
                locale: quote.locale,
                customer: snapshot(quote.customer),
                fulfilment: snapshot(quote.fulfilment),
                paymentMethodCode: quote.paymentMethodCode,
                paymentTiming: quote.paymentTiming,
                itemsTotal: quote.itemsTotal,
                deliveryFee: quote.deliveryFee,
                total: quote.total,
                originalTotal: quote.total,
                currency: quote.currency,
                termsAcceptedAt: now,
                termsActorReference: `guest:${guestId}`,
                from_OrderLine_orderId: {
                  create: quote.from_QuoteLine_quoteId.map((line) => {
                    const stock = stocks.find((unit) => unit.id === line.stockItemId);
                    if (!stock) throw checkoutConflict('ITEM_UNAVAILABLE');
                    return {
                      stockItemId: line.stockItemId,
                      productId: line.productId,
                      assetId: line.assetId,
                      sortOrder: line.sortOrder,
                      unitPrice: line.unitPrice,
                      snapshot: snapshot(line.publicSnapshot),
                      reservationReference: `${orderId}:${line.stockItemId}`,
                      reservedLocation: stock.locationCode,
                    };
                  }),
                },
              },
              select: { id: true, number: true, createdAt: true },
            });
            await transaction.quote.update({
              where: { id: quote.id },
              data: { consumedAt: now },
            });
            for (const [id, before] of fingerprints) {
              await this.publication.changed(transaction, id, before, `reserve:${order.id}:${id}`);
            }
            await transaction.auditEvent.create({
              data: {
                guestId, action: 'checkout.committed', subjectType: 'Order',
                subjectId: order.id, eventKey: `checkout-order:${order.id}`,
                after: { reservationPolicy: 'manual_release_only' }
              },
            });
            return {
              status_code: 201,
              body: {
                orderRef: order.id,
                orderNumber: order.number,
                createdAt: order.createdAt.toISOString(),
                nextAction: 'initiate_payment',
              },
            };
          },
        ),
      );
    } catch (error) {
      if (error instanceof ConflictException) {
        const body = error.getResponse();
        if (typeof body === 'object' && body !== null &&
          'code' in body && body.code === 'REQUEST_PAYLOAD_MISMATCH') {
          throw checkoutConflict('IDEMPOTENCY_CONFLICT');
        }
      }
      throw error;
    }
  }
}

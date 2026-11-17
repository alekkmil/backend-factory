import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { CommercialEvaluator } from '../../common/commercial/commercial-evaluator';
import type { FulfilmentContext } from '../../common/commercial/commercial-evaluator';
import { TransactionService } from '../../common/transactions/transaction.service';
import { ProductReadService } from '../products/product-read.service';

export const MAX_CART_MINOR = 200000n;

export const CHECKOUT_QUOTE_INCLUDE = {
  policyVersionIdRelation: true,
  from_QuoteLine_quoteId: { orderBy: { sortOrder: 'asc' } },
} satisfies Prisma.QuoteInclude;

export type CheckoutQuote = Prisma.QuoteGetPayload<{
  include: typeof CHECKOUT_QUOTE_INCLUDE;
}>;

export function checkoutConflict(code: string): ConflictException {
  return new ConflictException({
    code,
    message_key: `errors.${code.toLowerCase()}`,
    ...(code === 'CART_TOTAL_LIMIT_EXCEEDED'
      ? { limitMinor: Number(MAX_CART_MINOR), currency: 'EUR' }
      : {}),
  });
}

export function checkoutMinorUnits(
  value: string | { toString(): string } | null,
): bigint {
  const text = value?.toString();
  if (!text || !/^\d{1,10}(?:\.\d{1,2})?$/.test(text)) {
    throw checkoutConflict('ITEM_NOT_PURCHASABLE');
  }
  const [whole, fraction = ''] = text.split('.');
  const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (amount <= 0n) throw checkoutConflict('ITEM_NOT_PURCHASABLE');
  return amount;
}

function receivingContext(value: Prisma.JsonValue): FulfilmentContext {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw checkoutConflict('QUOTE_CHANGED');
  }
  if (value.country !== 'BG') throw checkoutConflict('FULFILMENT_UNAVAILABLE');
  if (value.method === 'store_pickup') {
    return { method: 'store_pickup', locationCode: 'sofia' };
  }
  if (
    (value.method === 'econt_address' || value.method === 'econt_office') &&
    typeof value.locality === 'string' && value.locality.length > 0
  ) {
    return { method: 'delivery', localityId: value.locality };
  }
  throw checkoutConflict('FULFILMENT_UNAVAILABLE');
}

@Injectable()
export class CheckoutValidationService {
  constructor(
    private readonly transactions: TransactionService,
    private readonly products: ProductReadService,
    private readonly evaluator: CommercialEvaluator,
  ) {}

  async validateQuote(
    transaction: Prisma.TransactionClient,
    quote: CheckoutQuote,
    reservedOrderId?: string,
  ): Promise<void> {
    const lines = quote.from_QuoteLine_quoteId;
    if (
      lines.length === 0 ||
      quote.currency !== 'EUR' ||
      quote.paymentMethodCode !== 'borica' ||
      quote.paymentTiming !== 'prepayment' ||
      !quote.deliveryFee.isZero()
    ) {
      throw checkoutConflict('QUOTE_CHANGED');
    }
    const quotedMinor = lines.reduce(
      (sum, line) => sum + checkoutMinorUnits(line.unitPrice), 0n,
    );
    if (quotedMinor > MAX_CART_MINOR) throw checkoutConflict('CART_TOTAL_LIMIT_EXCEEDED');
    const quotedTotal = new Prisma.Decimal(quotedMinor.toString()).dividedBy(100);
    if (!quote.itemsTotal.equals(quotedTotal) || !quote.total.equals(quotedTotal)) {
      throw checkoutConflict('QUOTE_CHANGED');
    }

    const productIds = [...new Set(lines.map((line) => line.productId))];
    const unitIds = lines.map((line) => line.stockItemId);
    const settings = await this.transactions.lockSettings(transaction);
    const productVersions = await this.transactions.lockProducts(transaction, productIds);
    const stockVersions = await this.transactions.lockStockItems(transaction, unitIds);
    const reservations = reservedOrderId
      ? await transaction.orderLine.findMany({
          where: { orderId: reservedOrderId },
          select: { stockItemId: true, reservationReference: true, reservedLocation: true },
        })
      : [];
    const reservedStocks = reservedOrderId
      ? await transaction.stockItem.findMany({
          where: { id: { in: unitIds }, status: 'reserved' },
          select: { id: true, reservationReference: true, locationCode: true },
        })
      : [];
    const ownedReservations = new Set(reservations.filter((line) => reservedStocks.some(
      (unit) => unit.id === line.stockItemId && line.reservationReference !== null &&
        unit.reservationReference === line.reservationReference &&
        unit.locationCode === line.reservedLocation,
    )).map((line) => line.stockItemId));
    if (!settings) {
      throw new ServiceUnavailableException({
        code: 'TEMPORARILY_UNAVAILABLE', message_key: 'errors.temporary_unavailable',
      });
    }
    const context = receivingContext(quote.fulfilment);
    const candidates = await this.products.catalogCandidates(
      transaction, productIds, quote.locale, context,
    );
    const byProduct = new Map(candidates.map((candidate) => [candidate.summary.id, candidate]));
    const productsById = new Map(productVersions.map((row) => [row.id, row.version]));
    const stocksById = new Map(stockVersions.map((row) => [row.id, row.version]));
    let currentMinor = 0n;
    const selected = lines.map((line) => {
      const candidate = byProduct.get(line.productId);
      const currentUnit = candidate?.units.find((value) => value.id === line.stockItemId);
      const ownsReservation = reservedOrderId !== undefined && ownedReservations.has(line.stockItemId);
      const unit = currentUnit && ownsReservation && currentUnit.status === 'reserved'
        ? { ...currentUnit, status: 'available' as const }
        : currentUnit;
      if (reservedOrderId && !ownsReservation) throw checkoutConflict('ITEM_UNAVAILABLE');
      if (!candidate || !unit || unit.status !== 'available') {
        throw checkoutConflict('ITEM_UNAVAILABLE');
      }
      if (
        candidate.summary.product_type !== 'jewellery' ||
        candidate.settings?.currency !== 'EUR' ||
        unit.currency !== 'EUR'
      ) {
        throw checkoutConflict('ITEM_NOT_PURCHASABLE');
      }
      if (context?.method === 'delivery' && candidate.product.deliveryScope !== 'bulgaria') {
        throw checkoutConflict('FULFILMENT_UNAVAILABLE');
      }
      const price = checkoutMinorUnits(unit.price);
      currentMinor += price;
      return { line, candidate, unit, price };
    });
    if (currentMinor > MAX_CART_MINOR) throw checkoutConflict('CART_TOTAL_LIMIT_EXCEEDED');
    if (settings.version !== quote.settingsVersion) throw checkoutConflict('QUOTE_CHANGED');
    for (const { line, candidate, unit, price } of selected) {
      if (
        productsById.get(line.productId) !== line.productVersion ||
        stocksById.get(line.stockItemId) !== line.stockVersion + (reservedOrderId ? 1 : 0) ||
        checkoutMinorUnits(line.unitPrice) !== price
      ) {
        throw checkoutConflict('QUOTE_CHANGED');
      }
      if (!this.evaluator.evaluateExactUnit(candidate.product, unit, candidate.settings, context)) {
        throw checkoutConflict('ITEM_NOT_PURCHASABLE');
      }
    }
  }
}

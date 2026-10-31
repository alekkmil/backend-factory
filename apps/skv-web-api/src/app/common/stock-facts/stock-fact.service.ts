import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '../../../generated/prisma/client';
import type {
  LocationCode,
  RestrictionReason,
  StockStatus,
} from '../../../generated/prisma/enums';
import { OutboxService } from '../outbox/outbox.service';
import { TransactionService } from '../transactions/transaction.service';
import { PrismaService } from '../../database/prisma.service';

export const STOCK_FACT_HOOK = Symbol('STOCK_FACT_HOOK');

export interface StockFactHook {
  apply(
    transaction: Prisma.TransactionClient,
    input: {
      stockItemId: string;
      priorReservationReference: string | null;
      factEventId: string;
    },
  ): Promise<void>;
}

interface StockFactResult {
  stock_item_id: string;
  version: number;
  status: StockStatus;
  fact_event_id: string;
  replayed: boolean;
}

interface PhysicalAbsenceInput {
  stockItemId: string;
  requestId: string;
  expectedVersion: number;
  sourceEventId: string;
  evidenceRef: string;
  reason: RestrictionReason;
  note: string;
  actorId: string;
}

interface StoreSaleInput {
  stockItemId: string;
  requestId: string;
  expectedVersion: number;
  sourceEventId: string;
  storeCode: LocationCode;
  documentRef: string;
  soldAt: string;
  amount: string;
  currency: string;
  sellerProvenance?: string;
  actorId: string;
}

type FactInput = PhysicalAbsenceInput | StoreSaleInput;

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const MONEY_PATTERN = /^\d{1,10}(?:\.\d{1,2})?$/;
const SOURCE_CODE_PATTERN = /^[A-Za-z0-9._:-]{1,80}$/;

function isStockStatus(value: string): value is StockStatus {
  return (
    value === 'available' ||
    value === 'reserved' ||
    value === 'in_transit' ||
    value === 'blocked' ||
    value === 'sold'
  );
}

function isRecord(
  value: unknown,
): value is Prisma.JsonObject | Prisma.InputJsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readResult(value: unknown): StockFactResult {
  if (
    !isRecord(value) ||
    typeof value.stock_item_id !== 'string' ||
    typeof value.version !== 'number' ||
    !Number.isInteger(value.version) ||
    typeof value.status !== 'string' ||
    !isStockStatus(value.status) ||
    typeof value.fact_event_id !== 'string' ||
    typeof value.replayed !== 'boolean'
  ) {
    throw new Error('Stored stock fact result is malformed');
  }
  return {
    stock_item_id: value.stock_item_id,
    version: value.version,
    status: value.status,
    fact_event_id: value.fact_event_id,
    replayed: value.replayed,
  };
}

function resultJson(result: StockFactResult): Prisma.InputJsonObject {
  return {
    stock_item_id: result.stock_item_id,
    version: result.version,
    status: result.status,
    fact_event_id: result.fact_event_id,
    replayed: result.replayed,
  };
}

function assertRequestId(requestId: string): void {
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    throw new TypeError('Request identifier is invalid');
  }
}

function assertEvidence(value: string, maximumLength: number): void {
  if (
    value.trim().length === 0 ||
    value.length > maximumLength ||
    value !== value.trim()
  ) {
    throw new TypeError('Stock fact evidence is invalid');
  }
}

function conflict(code: string, messageKey: string): ConflictException {
  return new ConflictException({ code, message_key: messageKey });
}

@Injectable()
export class StockFactService {
  private readonly logger = new Logger(StockFactService.name);
  private readonly sourceCode: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly transactions: TransactionService,
    private readonly outbox: OutboxService,
    @Optional() @Inject(STOCK_FACT_HOOK) private readonly hook?: StockFactHook,
  ) {
    this.sourceCode = config.get<string>('STOCK_FACT_SOURCE_CODE') ?? '';
  }

  recordPhysicalAbsence(
    input: PhysicalAbsenceInput,
  ): Promise<StockFactResult> {
    assertRequestId(input.requestId);
    assertEvidence(input.sourceEventId, 128);
    assertEvidence(input.evidenceRef, 2000);
    assertEvidence(input.note, 2000);
    return this.record(input, 'physical_absence');
  }

  recordStoreSale(input: StoreSaleInput): Promise<StockFactResult> {
    assertRequestId(input.requestId);
    assertEvidence(input.sourceEventId, 128);
    assertEvidence(input.documentRef, 255);
    if (
      !MONEY_PATTERN.test(input.amount) ||
      !/^[A-Z]{3}$/.test(input.currency) ||
      (input.sellerProvenance !== undefined &&
        input.sellerProvenance.length > 1000)
    ) {
      throw new TypeError('Store sale facts are invalid');
    }
    const soldAt = new Date(input.soldAt);
    if (Number.isNaN(soldAt.getTime()) || soldAt.toISOString() !== input.soldAt) {
      throw new TypeError('Sale timestamp must be an exact UTC ISO timestamp');
    }
    if (new Prisma.Decimal(input.amount).lte(0)) {
      throw new TypeError('Sale amount must be positive');
    }
    return this.record(input, 'store_sale');
  }

  private async record(
    input: FactInput,
    kind: 'physical_absence' | 'store_sale',
  ): Promise<StockFactResult> {
    if (
      !SOURCE_CODE_PATTERN.test(this.sourceCode) ||
      this.hook === undefined
    ) {
      throw new ServiceUnavailableException({
        code: 'CONFIGURATION_UNAVAILABLE',
        message_key: 'errors.configuration_unavailable',
      });
    }

    return this.transactions.serializable(async (transaction) => {
      const identity = await transaction.stockItem.findUnique({
        where: { id: input.stockItemId },
        select: { productId: true },
      });
      if (!identity) {
        throw new NotFoundException();
      }

      const actor = await transaction.principal.findUnique({
        where: { id: input.actorId },
        select: { enabled: true, kind: true, permissions: true },
      });
      if (
        !actor ||
        !actor.enabled ||
        actor.kind !== 'service' ||
        !actor.permissions.includes('stock_fact_write')
      ) {
        throw new ForbiddenException();
      }

      const sourceFacts =
        'evidenceRef' in input
          ? {
              fact_kind: kind,
              stock_item_id: input.stockItemId,
              evidence_ref: input.evidenceRef,
              reason: input.reason,
              note: input.note,
            }
          : {
              fact_kind: kind,
              stock_item_id: input.stockItemId,
              store_code: input.storeCode,
              document_ref: input.documentRef,
              sold_at: input.soldAt,
              amount: input.amount,
              currency: input.currency,
              seller_provenance: input.sellerProvenance ?? null,
            };
      const sourceScope = `stock-fact-source:${this.sourceCode}:${input.stockItemId}`;
      const actorScope = `stock-fact:${kind}:${input.actorId}:${input.stockItemId}`;
      const actorReplay = await this.transactions.executeIdempotentAction(
        transaction,
        {
          scopeKey: actorScope,
          requestId: input.requestId,
          payload: {
            ...sourceFacts,
            source_event_id: input.sourceEventId,
            expected_version: input.expectedVersion,
          },
        },
        async () => {
          const sourceReplay =
            await this.transactions.executeIdempotentAction(
              transaction,
              {
                scopeKey: sourceScope,
                requestId: input.sourceEventId,
                payload: sourceFacts,
              },
              async () => ({
                status_code: 200,
                body: resultJson(
                  await this.applyFact(
                    transaction,
                    input,
                    identity.productId,
                    kind,
                  ),
                ),
              }),
            );
          const sourceResult = readResult(sourceReplay.body);
          return {
            status_code: sourceReplay.status_code,
            body: resultJson({
              ...sourceResult,
              replayed: sourceReplay.replayed,
            }),
          };
        },
      );
      return {
        ...readResult(actorReplay.body),
        replayed: actorReplay.replayed || readResult(actorReplay.body).replayed,
      };
    });
  }

  private async applyFact(
    transaction: Prisma.TransactionClient,
    input: FactInput,
    expectedProductId: string,
    kind: 'physical_absence' | 'store_sale',
  ): Promise<StockFactResult> {
    await this.transactions.lockSettings(transaction);
    const lockedProducts = await this.transactions.lockProducts(
      transaction,
      [expectedProductId],
    );
    if (lockedProducts.length !== 1) {
      throw new NotFoundException();
    }
    const lockedStockItems = await this.transactions.lockStockItems(
      transaction,
      [input.stockItemId],
    );
    if (lockedStockItems.length !== 1) {
      throw new NotFoundException();
    }

    const stock = await transaction.stockItem.findUnique({
      where: { id: input.stockItemId },
      select: {
        id: true,
        productId: true,
        status: true,
        version: true,
        reservationReference: true,
        transferTo: true,
        locationCode: true,
      },
    });
    if (!stock || stock.productId !== expectedProductId) {
      throw new NotFoundException();
    }
    if (kind === 'physical_absence' && stock.version !== input.expectedVersion) {
      throw conflict('VERSION_CONFLICT', 'errors.version_conflict');
    }

    const existingSale = await transaction.stockSale.findUnique({
      where: { stockItemId: input.stockItemId },
      select: { id: true },
    });
    if (existingSale || stock.status === 'sold') {
      throw conflict(
        'RECONCILIATION_REQUIRED',
        'errors.reconciliation_required',
      );
    }
    if (kind === 'physical_absence' && stock.status === 'blocked') {
      throw conflict(
        'RECONCILIATION_REQUIRED',
        'errors.reconciliation_required',
      );
    }

    const previousReservationReference = stock.reservationReference;
    const nextStatus: StockStatus =
      kind === 'store_sale' ? 'sold' : 'blocked';
    const eventId = randomUUID();
    const sourceEventId = input.sourceEventId;
    const eventKey = `stock-fact:${this.hashSourceEvent(
      `${kind}:${stock.id}:${sourceEventId}`,
    )}`;

    if (kind === 'store_sale') {
      if (!('storeCode' in input)) {
        throw new Error('Store sale input was not discriminated');
      }
      const sale = input;
      await transaction.stockSale.create({
        data: {
          stockItemId: stock.id,
          channel: 'store',
          storeCode: sale.storeCode,
          documentRef: sale.documentRef,
          soldAt: new Date(sale.soldAt),
          amount: new Prisma.Decimal(sale.amount),
          currency: sale.currency,
          recordedById: sale.actorId,
          sellerProvenance: sale.sellerProvenance ?? null,
          sourceCode: this.sourceCode,
          sourceEventId,
        },
      });
    }

    await transaction.stockItem.update({
      where: { id: stock.id },
      data: {
        status: nextStatus,
        reservationReference: null,
        transferTo: null,
        version: { increment: 1 },
      },
    });

    const before: Prisma.InputJsonObject = {
      status: stock.status,
      version: stock.version,
      location_code: stock.locationCode,
      reservation_reference: previousReservationReference,
      transfer_to: stock.transferTo,
    };
    const after: Prisma.InputJsonObject = {
      status: nextStatus,
      version: stock.version + 1,
      location_code: stock.locationCode,
      reservation_reference: null,
      transfer_to: null,
    };
    const auditPayload: Prisma.InputJsonObject =
      'evidenceRef' in input
        ? {
            source_code: this.sourceCode,
            source_event_id: sourceEventId,
            evidence_ref: input.evidenceRef,
            expected_version: input.expectedVersion,
          }
        : {
            source_code: this.sourceCode,
            source_event_id: sourceEventId,
            document_ref: input.documentRef,
            store_code: input.storeCode,
            amount: input.amount,
            currency: input.currency,
            sold_at: input.soldAt,
          };
    const audit = await transaction.auditEvent.create({
      data: {
        id: eventId,
        actorId: input.actorId,
        action: `stock.${kind}`,
        subjectType: 'StockItem',
        subjectId: stock.id,
        reason: 'evidenceRef' in input ? input.reason : null,
        note: 'evidenceRef' in input ? input.note : null,
        before,
        after: { ...after, ...auditPayload },
        eventKey,
      },
      select: { id: true },
    });

    await this.outbox.enqueue(transaction, {
      dedupeKey: `stock_fact_changed:${audit.id}`,
      kind: 'stock_fact_changed',
      payload: {
        kind: 'stock_fact_changed',
        stock_item_id: stock.id,
        event_id: audit.id,
        old_reservation_reference: previousReservationReference,
      },
    });
    await this.outbox.enqueue(transaction, {
      dedupeKey: `cache_invalidate:${audit.id}`,
      kind: 'cache_invalidate',
      payload: {
        kind: 'cache_invalidate',
        product_ids: [stock.productId],
        content_ids: [],
        route_paths: [],
        revision_key: audit.id,
      },
    });
    await this.hook?.apply(transaction, {
      stockItemId: stock.id,
      priorReservationReference: previousReservationReference,
      factEventId: audit.id,
    });

    if (kind === 'store_sale' && stock.version !== input.expectedVersion) {
      this.logger.warn(
        `Recorded trusted store sale for stock item ${stock.id} after a stale observed version`,
      );
    }
    return {
      stock_item_id: stock.id,
      version: stock.version + 1,
      status: nextStatus,
      fact_event_id: audit.id,
      replayed: false,
    };
  }

  private hashSourceEvent(sourceEventId: string): string {
    return createHash('sha256')
      .update(`${this.sourceCode}\u0000${sourceEventId}`)
      .digest('hex');
  }
}

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { isGenuineBarcode } from '../../common/stock-facts/barcode';
import { StockPublicationService } from '../../common/stock-facts/stock-publication.service';
import { TransactionService } from '../../common/transactions/transaction.service';
import {
  PromoteVerifiedUnitDto,
  VerifiedFactsDto,
  VerifiedUnitDetailsDto,
} from './inventory.dto';

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function validateFacts(
  input: VerifiedFactsDto,
  productType: string,
): void {
  if ((input.price === null) !== (input.currency === null))
    throw new BadRequestException();
  for (const value of [
    input.price,
    input.weight_g,
    input.stone_weight_ct,
    ...Object.values(input.dimensions_mm ?? {}),
  ]) {
    if (value !== null && new Prisma.Decimal(value).lte(0))
      throw new BadRequestException();
  }
  if (input.dimensions_mm && Object.keys(input.dimensions_mm).length === 0)
    throw new BadRequestException();
  if (productType === 'jewellery' && input.stone_weight_ct !== null)
    throw new BadRequestException();
  if (new Date(input.verified_at).getTime() > Date.now())
    throw new BadRequestException();
}

function factsData(input: VerifiedFactsDto) {
  return {
    price: input.price === null ? null : new Prisma.Decimal(input.price),
    currency: input.currency,
    weightG:
      input.weight_g === null ? null : new Prisma.Decimal(input.weight_g),
    stoneWeightCt:
      input.stone_weight_ct === null
        ? null
        : new Prisma.Decimal(input.stone_weight_ct),
    dimensions: input.dimensions_mm
      ? { ...input.dimensions_mm }
      : Prisma.DbNull,
    verifiedAt: new Date(input.verified_at),
    sourceRef: input.source_ref,
  };
}

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);
  constructor(
    private readonly db: PrismaService,
    private readonly transactions: TransactionService,
    private readonly publication: StockPublicationService,
  ) {}

  async promote(actorId: string, input: PromoteVerifiedUnitDto) {
    return this.write(async () =>
      this.transactions.serializable((tx) =>
        this.transactions.executeIdempotentAction(
          tx,
          {
            scopeKey: `unit-promote:${actorId}`,
            requestId: input.request_id,
            payload: {
              ...input,
              dimensions_mm: input.dimensions_mm
                ? { ...input.dimensions_mm }
                : null,
              sale: input.sale ? { ...input.sale } : null,
            },
          },
          async () => {
            const staged = await tx.importProductRow.findUnique({
              where: {
                batchId_ssgId: { batchId: input.batch_id, ssgId: input.ssg_id },
              },
            });
            if (!staged || staged.state !== 'committed' || !staged.productId)
              throw new NotFoundException();
            if (
              !record(staged.payload) ||
              !Array.isArray(staged.payload.units) ||
              !staged.payload.units.some(
                (unit) =>
                  record(unit) &&
                  unit.barcode === input.barcode &&
                  unit.ssg_id === input.ssg_id,
              )
            )
              throw new BadRequestException();
            await this.transactions.lockSettings(tx);
            await this.transactions.lockProducts(tx, [staged.productId]);
            const product = await tx.product.findUniqueOrThrow({
              where: { id: staged.productId },
            });
            validateFacts(input, product.productType);
            if (!isGenuineBarcode(input.barcode))
              throw new BadRequestException();
            if (
              (input.stock_status === 'reserved') !==
                (input.reservation_reference !== null) ||
              (input.stock_status === 'in_transit') !==
                (input.transfer_to !== null) ||
              input.transfer_to === input.location_code ||
              (input.stock_status === 'sold') !== (input.sale !== null)
            )
              throw new BadRequestException();
            if (
              input.sale &&
              (new Prisma.Decimal(input.sale.amount).lte(0) ||
                new Date(input.sale.sold_at).getTime() > Date.now() ||
                (input.sale.channel === 'store' &&
                  input.sale.store_location === null) ||
                (input.sale.channel === 'online' &&
                  input.sale.store_location !== null))
            )
              throw new BadRequestException();
            const identity = await tx.barcodeIdentity.findUnique({
              where: { barcode: input.barcode },
            });
            if (
              !identity ||
              identity.productId !== product.id ||
              (await tx.stockItem.findUnique({
                where: { barcode: input.barcode },
              }))
            ) {
              throw new ConflictException({
                code: 'RECONCILIATION_REQUIRED',
                message_key: 'errors.reconciliation_required',
              });
            }
            const stores = await tx.store.count({
              where: {
                code: {
                  in: [
                    ...new Set([
                      input.location_code,
                      ...(input.transfer_to ? [input.transfer_to] : []),
                      ...(input.sale?.store_location
                        ? [input.sale.store_location]
                        : []),
                    ]),
                  ],
                },
              },
            });
            const requestedStores = new Set([
              input.location_code,
              ...(input.transfer_to ? [input.transfer_to] : []),
              ...(input.sale?.store_location
                ? [input.sale.store_location]
                : []),
            ]);
            if (stores !== requestedStores.size)
              throw new ServiceUnavailableException({
                code: 'CONFIGURATION_UNAVAILABLE',
                message_key: 'errors.configuration_unavailable',
              });
            const before = await this.publication.fingerprint(tx, product.id);
            const stock = await tx.stockItem.create({
              data: {
                productId: product.id,
                barcode: input.barcode,
                locationCode: input.location_code,
                status: input.stock_status,
                transferTo: input.transfer_to,
                reservationReference: input.reservation_reference,
                ...factsData(input),
              },
            });
            if (input.sale)
              await tx.stockSale.create({
                data: {
                  stockItemId: stock.id,
                  channel: input.sale.channel,
                  storeCode: input.sale.store_location,
                  documentRef: input.sale.document_ref,
                  soldAt: new Date(input.sale.sold_at),
                  amount: new Prisma.Decimal(input.sale.amount),
                  currency: input.sale.currency,
                  recordedById: actorId,
                  sellerProvenance: input.sale.seller_provenance,
                  sourceCode: 'catalogue-promotion',
                  sourceEventId: stock.id,
                },
              });
            const event = await tx.auditEvent.create({
              data: {
                actorId,
                action: 'stock.promote',
                subjectType: 'StockItem',
                subjectId: stock.id,
                eventKey: `promote:${stock.id}`,
                after: {
                  batch_id: input.batch_id,
                  ssg_id: input.ssg_id,
                  barcode: input.barcode,
                  status: stock.status,
                  source_ref: input.source_ref,
                  verified_at: input.verified_at,
                },
              },
            });
            await tx.product.update({
              where: { id: product.id },
              data: { version: { increment: 1 } },
            });
            if (input.sale)
              await this.publication.archiveIfAllSold(
                tx,
                product.id,
                actorId,
                'Autoarchive after every verified unit was sold; historical sale recorded during verified promotion.',
              );
            await this.publication.changed(tx, product.id, before, event.id);
            return {
              status_code: 201,
              body: {
                stock_item_id: stock.id,
                product_id: product.id,
                barcode: stock.barcode,
                status: stock.status,
                replayed: false,
              },
            };
          },
        ),
      ),
    );
  }

  async details(
    actorId: string,
    stockId: string,
    input: VerifiedUnitDetailsDto,
  ) {
    return this.write(async () =>
      this.transactions.serializable((tx) =>
        this.transactions.executeIdempotentAction(
          tx,
          {
            scopeKey: `unit-details:${actorId}:${stockId}`,
            requestId: input.request_id,
            payload: {
              ...input,
              dimensions_mm: input.dimensions_mm
                ? { ...input.dimensions_mm }
                : null,
            },
          },
          async () => {
            const identity = await tx.stockItem.findUnique({
              where: { id: stockId },
              select: { productId: true },
            });
            if (!identity) throw new NotFoundException();
            await this.transactions.lockSettings(tx);
            await this.transactions.lockProducts(tx, [identity.productId]);
            await this.transactions.lockStockItems(tx, [stockId]);
            const stock = await tx.stockItem.findUniqueOrThrow({
              where: { id: stockId },
              include: { productIdRelation: true },
            });
            if (stock.version !== input.expected_version)
              throw new ConflictException();
            validateFacts(input, stock.productIdRelation.productType);
            const before = await this.publication.fingerprint(
              tx,
              identity.productId,
            );
            const updated = await tx.stockItem.update({
              where: { id: stockId },
              data: { ...factsData(input), version: { increment: 1 } },
            });
            const event = await tx.auditEvent.create({
              data: {
                actorId,
                action: 'stock.details',
                subjectType: 'StockItem',
                subjectId: stockId,
                reason: input.reason,
                note: input.note,
                eventKey: `unit-details:${randomUUID()}`,
                before: {
                  price: stock.price?.toFixed(2) ?? null,
                  currency: stock.currency,
                  weight_g: stock.weightG?.toFixed(3) ?? null,
                  stone_weight_ct: stock.stoneWeightCt?.toFixed(3) ?? null,
                  dimensions_mm: stock.dimensions,
                  verified_at: stock.verifiedAt.toISOString(),
                  source_ref: stock.sourceRef,
                },
                after: {
                  price: input.price,
                  currency: input.currency,
                  weight_g: input.weight_g,
                  stone_weight_ct: input.stone_weight_ct,
                  dimensions_mm: input.dimensions_mm
                    ? { ...input.dimensions_mm }
                    : null,
                  verified_at: input.verified_at,
                  source_ref: input.source_ref,
                },
              },
            });
            await tx.product.update({
              where: { id: identity.productId },
              data: { version: { increment: 1 } },
            });
            await this.publication.changed(
              tx,
              identity.productId,
              before,
              event.id,
            );
            return {
              status_code: 200,
              body: {
                stock_item_id: stockId,
                version: updated.version,
                price: updated.price
                  ? {
                      amount: updated.price.toFixed(2),
                      currency: updated.currency,
                    }
                  : null,
                facts: {
                  dimensions_mm: input.dimensions_mm
                    ? { ...input.dimensions_mm }
                    : null,
                  weight_g: updated.weightG?.toFixed(3) ?? null,
                  stone_weight_ct: updated.stoneWeightCt?.toFixed(3) ?? null,
                },
              },
            };
          },
        ),
      ),
    );
  }

  private async write<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException({
          code: 'RECONCILIATION_REQUIRED',
          message_key: 'errors.reconciliation_required',
        });
      if (
        error instanceof Prisma.PrismaClientKnownRequestError ||
        error instanceof Prisma.PrismaClientUnknownRequestError ||
        error instanceof Prisma.PrismaClientInitializationError
      ) {
        this.logger.warn('Verified inventory database operation failed');
        throw new ServiceUnavailableException();
      }
      throw error;
    }
  }
}

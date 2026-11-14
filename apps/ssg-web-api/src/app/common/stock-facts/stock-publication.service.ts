import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../../generated/prisma/client';
import { CommercialEvaluator } from '../commercial/commercial-evaluator';
import { OutboxService } from '../outbox/outbox.service';

@Injectable()
export class StockPublicationService {
  constructor(
    private readonly evaluator: CommercialEvaluator,
    private readonly outbox: OutboxService,
  ) {}

  async fingerprint(
    tx: Prisma.TransactionClient,
    productId: string,
  ): Promise<string> {
    const product = await tx.product.findUniqueOrThrow({
      where: { id: productId },
      include: {
        currentRevisionIdRelation: {
          include: { jewelleryTypeIdRelation: true },
        },
      },
    });
    const revision = product.currentRevisionIdRelation;
    if (
      product.publicationStatus !== 'published' ||
      revision?.state !== 'published'
    )
      return 'not-public';
    const units = await tx.stockItem.findMany({
      where: { productId },
      orderBy: { id: 'asc' },
    });
    const settings = await tx.shopSettings.findUnique({ where: { id: 1 } });
    const input = {
      ...revision,
      publicationStatus: product.publicationStatus,
      productType: product.productType,
      jewelleryTypeCode: revision.jewelleryTypeIdRelation?.code ?? null,
    };
    return JSON.stringify({
      commercial: this.evaluator.evaluateProduct(input, units, settings),
      units: units
        .map((unit) => {
          const evaluated = this.evaluator.evaluateExactUnit(
            input,
            unit,
            settings,
            null,
          );
          return evaluated
            ? {
                id: unit.id,
                price: evaluated.price,
                facts: evaluated.facts,
                fulfilment: evaluated.fulfilment_options,
              }
            : null;
        })
        .filter((unit) => unit !== null),
    });
  }

  async changed(
    tx: Prisma.TransactionClient,
    productId: string,
    before: string,
    eventId: string,
  ): Promise<void> {
    const after = await this.fingerprint(tx, productId);
    if (after === before) return;
    const product = await tx.product.findUniqueOrThrow({
      where: { id: productId },
    });
    if (
      product.publicationStatus === 'published' &&
      product.currentRevisionId
    ) {
      await tx.productTranslation.updateMany({
        where: { revisionId: product.currentRevisionId },
        data: { publicModifiedAt: new Date() },
      });
    }
    await this.outbox.enqueue(tx, {
      dedupeKey: `inventory-cache:${eventId}`,
      kind: 'cache_invalidate',
      payload: {
        kind: 'cache_invalidate',
        product_ids: [productId],
        content_ids: [],
        route_paths: [],
        revision_key: eventId,
      },
    });
  }

  async archiveIfAllSold(
    tx: Prisma.TransactionClient,
    productId: string,
    actorId: string,
    note: string,
  ): Promise<void> {
    const units = await tx.stockItem.findMany({
      where: { productId },
      select: { status: true },
    });
    if (!units.length || units.some((unit) => unit.status !== 'sold')) return;
    const product = await tx.product.findUniqueOrThrow({
      where: { id: productId },
    });
    const source = product.currentRevisionId
      ? await tx.productRevision.findUniqueOrThrow({
          where: { id: product.currentRevisionId },
        })
      : await tx.productRevision.findFirst({
          where: { productId, state: 'draft' },
        });
    if (
      source?.salesMode === 'archive_catalogue' &&
      source.priceVisibility === 'hidden'
    )
      return;
    const restrictions = {
      salesMode: 'archive_catalogue' as const,
      priceVisibility: 'hidden' as const,
      changeReason: 'other' as const,
      changeNote: note,
    };
    if (!product.currentRevisionId && source) {
      await tx.productRevision.update({
        where: { id: source.id },
        data: restrictions,
      });
    } else {
      const maximum = await tx.productRevision.aggregate({
        where: { productId },
        _max: { revisionNumber: true },
      });
      // Deferred draft exclusivity preserves a separate editorial draft during assembly.
      const revision = await tx.productRevision.create({
        data: {
          productId,
          revisionNumber: (maximum._max.revisionNumber ?? 0) + 1,
          createdById: actorId,
          ...restrictions,
          state: 'draft',
          ...(source && {
            jewelleryTypeId: source.jewelleryTypeId,
            materialsState: source.materialsState,
            gemstonesState: source.gemstonesState,
            fulfilmentMethods: source.fulfilmentMethods,
            deliveryScope: source.deliveryScope,
            deliveryLocalityIds: source.deliveryLocalityIds,
            pickupLocationCodes: source.pickupLocationCodes,
            mediaReleaseId: source.mediaReleaseId,
            publishedAt: source.publishedAt,
          }),
        },
      });
      if (source) {
        const [translations, materials, gemstones, images] = await Promise.all([
          tx.productTranslation.findMany({ where: { revisionId: source.id } }),
          tx.revisionMaterial.findMany({ where: { revisionId: source.id } }),
          tx.revisionGemstone.findMany({ where: { revisionId: source.id } }),
          tx.revisionImage.findMany({ where: { revisionId: source.id } }),
        ]);
        await tx.productTranslation.createMany({
          data: translations.map((row) => ({
            revisionId: revision.id,
            locale: row.locale,
            name: row.name,
            description: row.description,
            slug: row.slug,
            firstPublishedAt: row.firstPublishedAt,
            firstPublishedDate: row.firstPublishedDate,
            publicationEvidence: row.publicationEvidence,
            publicModifiedAt: row.publicModifiedAt,
            seoTitle: row.seoTitle,
            seoDescription: row.seoDescription,
            ogImageId: row.ogImageId,
          })),
        });
        await tx.revisionMaterial.createMany({
          data: materials.map((row) => ({
            revisionId: revision.id,
            materialId: row.materialId,
            finenessId: row.finenessId,
            goldKaratId: row.goldKaratId,
          })),
        });
        await tx.revisionGemstone.createMany({
          data: gemstones.map((row) => ({
            revisionId: revision.id,
            gemstoneId: row.gemstoneId,
          })),
        });
        await tx.revisionImage.createMany({
          data: images.map((row) => ({
            revisionId: revision.id,
            assetId: row.assetId,
            sortOrder: row.sortOrder,
          })),
        });
        await tx.productRevision.update({
          where: { id: source.id },
          data: { state: 'superseded' },
        });
      }
      if (product.currentRevisionId) {
        await tx.productRevision.update({
          where: { id: revision.id },
          data: { state: 'published' },
        });
        await tx.product.update({
          where: { id: productId },
          data: { currentRevisionId: revision.id },
        });
      }
    }
    await tx.auditEvent.create({
      data: {
        actorId,
        action: 'stock.autoarchive',
        subjectType: 'Product',
        subjectId: productId,
        reason: 'other',
        note,
        eventKey: `autoarchive:${randomUUID()}`,
      },
    });
  }
}

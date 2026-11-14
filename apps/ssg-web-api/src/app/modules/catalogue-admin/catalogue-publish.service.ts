import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, Logger,
  NotFoundException, ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../../generated/prisma/client';
import { OutboxService } from '../../common/outbox/outbox.service';
import { hashIdempotencyPayload, TransactionService } from '../../common/transactions/transaction.service';
import { ProductReadService } from '../products/product-read.service';
import { CatalogueAdminService, catalogueSlugPreview } from './catalogue-admin.service';
import { CataloguePublishDto } from './catalogue-admin.dto';

@Injectable()
export class CataloguePublishService {
  private readonly logger = new Logger(CataloguePublishService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly transactions: TransactionService,
    private readonly catalogue: CatalogueAdminService,
    private readonly products: ProductReadService,
    private readonly outbox: OutboxService,
  ) {}

  async publish(actorId: string, id: string, input: CataloguePublishDto) {
    if (
      this.config.get<string>('NODE_ENV') === 'production' ||
      !this.config.get<boolean>('DEV_CATALOGUE_PUBLISH_ENABLED')
    ) {
      throw new ForbiddenException({
        code: 'FORBIDDEN', message_key: 'errors.forbidden',
      });
    }
    try {
      const result = await this.transactions.serializable((transaction) =>
        this.transactions.executeIdempotentAction(transaction, {
          scopeKey: `catalogue-publish:${actorId}:${id}`,
          requestId: input.request_id,
          payload: {
            expected_version: input.expected_version, revision_id: input.revision_id,
            confirm_archive_exit: input.confirm_archive_exit ?? false,
          },
        }, async () => {
          const locks = await this.transactions.lockProducts(transaction, [id]);
          if (!locks.length) throw new NotFoundException();
          if (locks[0].version !== input.expected_version) this.conflict();
          const admin = await this.catalogue.detailInTransaction(transaction, id);
          if (admin.draft_revision_id !== input.revision_id || !admin.draft) this.conflict();
          if (admin.validation_errors.length) {
            if (admin.validation_errors.some((error) => error.code === 'MEDIA_NOT_READY')) {
              throw new ConflictException({
                code: 'MEDIA_NOT_READY', message_key: 'errors.media_not_ready',
              });
            }
            throw new BadRequestException({
              code: 'VALIDATION_ERROR', message_key: 'errors.validation',
            });
          }
          const product = await transaction.product.findUniqueOrThrow({
            where: { id },
            include: { currentRevisionIdRelation: true },
          });
          const revision = await transaction.productRevision.findUniqueOrThrow({
            where: { id: input.revision_id },
            include: { from_ProductTranslation_revisionId: true },
          });
          if (revision.productId !== id || revision.state !== 'draft') this.conflict();
          if (revision.changeReason) {
            const reason = await transaction.dictionaryEntry.findUnique({
              where: { group_code: { group: 'restriction_reason', code: revision.changeReason } },
              select: { active: true },
            });
            if (!reason?.active) throw new BadRequestException({
              code: 'VALIDATION_ERROR', message_key: 'errors.validation',
            });
          }
          const live = product.currentRevisionIdRelation;
          if (live && (
            (live.salesMode === 'direct_purchase' && revision.salesMode !== 'direct_purchase') ||
            (live.priceVisibility === 'visible' && revision.priceVisibility === 'hidden') ||
            live.fulfilmentMethods.some((method) => !revision.fulfilmentMethods.includes(method)) ||
            live.pickupLocationCodes.some((code) => !revision.pickupLocationCodes.includes(code))
          ) && (!revision.changeReason || !revision.changeNote?.trim())) {
            throw new BadRequestException({
              code: 'VALIDATION_ERROR', message_key: 'errors.validation',
            });
          }
          if (
            live?.salesMode === 'archive_catalogue' && revision.salesMode !== 'archive_catalogue' &&
            (!input.confirm_archive_exit || !revision.changeReason || !revision.changeNote?.trim())
          ) this.conflict('ARCHIVE_EXIT_CONFIRMATION_REQUIRED');
          if (revision.deliveryLocalityIds.length) {
            throw new BadRequestException({
              code: 'LOCALITY_DIRECTORY_UNAVAILABLE', message_key: 'errors.validation',
            });
          }
          const now = new Date();
          const oldTranslations = live
            ? await transaction.productTranslation.findMany({ where: { revisionId: live.id } })
            : [];
          const currentRoutes = await transaction.publicRoute.findMany({
            where: { productId: id, state: 'current' },
          });
          const sharedChange = live
            ? await this.changedRevision(transaction, live.id, revision.id) : true;
          for (const locale of ['bg', 'en'] as const) {
            const text = revision.from_ProductTranslation_revisionId.find((row) => row.locale === locale);
            const slug = catalogueSlugPreview(text?.name ?? null, locale);
            if (!text || !slug) throw new BadRequestException();
            const path = product.productType === 'jewellery'
              ? `${locale === 'bg' ? '/бижута' : '/en/jewelry'}/${slug}-${product.publicUrlId}`
              : `${locale === 'bg' ? '/скъпоценни-камъни' : '/en/gemstones'}/${slug}-${product.publicUrlId}`;
            const owner = await transaction.publicRoute.findUnique({ where: { path } });
            if (owner && (owner.productId !== id || owner.locale !== locale || owner.state !== 'current')) {
              this.conflict('ROUTE_CONFLICT');
            }
            const old = oldTranslations.find((row) => row.locale === locale);
            const changed = sharedChange || text.name !== old?.name || text.description !== old?.description ||
              text.seoTitle !== old?.seoTitle || text.seoDescription !== old?.seoDescription ||
              text.ogImageId !== old?.ogImageId;
            await transaction.productTranslation.update({
              where: { id: text.id },
              data: {
                slug,
                firstPublishedAt: old
                  ? old.firstPublishedAt
                  : text.firstPublishedAt ?? (text.firstPublishedDate || product.isLegacyMigration ? null : now),
                firstPublishedDate: old ? old.firstPublishedDate : text.firstPublishedDate,
                publicModifiedAt: changed ? now : old?.publicModifiedAt ?? null,
              },
            });
            for (const route of currentRoutes.filter((row) => row.locale === locale && row.path !== path)) {
              await transaction.publicRoute.update({
                where: { id: route.id }, data: { state: 'redirect', changedAt: now },
              });
            }
            if (!owner) {
              await transaction.publicRoute.create({
                data: { path, locale, productId: id, state: 'current', changedAt: now },
              });
            }
          }
          if (live) {
            await transaction.productRevision.update({
              where: { id: live.id }, data: { state: 'superseded' },
            });
          }
          await transaction.productRevision.update({
            where: { id: revision.id }, data: { state: 'published', publishedAt: now },
          });
          await transaction.product.update({
            where: { id },
            data: {
              currentRevisionId: revision.id, publicationStatus: 'published',
              version: { increment: 1 },
            },
          });
          // Reuse public projection checks; no remote file reads or claimed byte verification.
          try {
            await this.products.assertPublicationMedia(transaction, id);
          } catch (error) {
            if (error instanceof ServiceUnavailableException) {
              const response = error.getResponse();
              if (typeof response === 'object' && 'code' in response && response.code === 'MEDIA_NOT_READY') {
                throw new ConflictException({
                  code: 'MEDIA_NOT_READY', message_key: 'errors.media_not_ready',
                });
              }
            }
            throw error;
          }
          await transaction.auditEvent.create({
            data: {
              actorId, action: 'catalogue_publish', subjectType: 'Product', subjectId: id,
              reason: revision.changeReason, note: revision.changeNote,
              eventKey: `catalogue-publish:${revision.id}`,
              before: { revision_id: live?.id ?? null, version: product.version },
              after: { revision_id: revision.id, version: product.version + 1, media_verification: 'metadata_only_dev' },
            },
          });
          await this.outbox.enqueue(transaction, {
            dedupeKey: `catalogue-publish:${revision.id}`,
            kind: 'cache_invalidate',
            payload: { kind: 'cache_invalidate', product_id: id, revision_id: revision.id },
          });
          const response = await this.catalogue.detailInTransaction(transaction, id);
          return {
            status_code: 200,
            body: JSON.parse(JSON.stringify(response)) as Prisma.InputJsonObject,
          };
        }),
      );
      return result.body;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        this.conflict('ROUTE_CONFLICT');
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError ||
        error instanceof Prisma.PrismaClientUnknownRequestError ||
        error instanceof Prisma.PrismaClientInitializationError
      ) {
        this.logger.warn('Catalogue publication database dependency failed');
        throw new ServiceUnavailableException({
          code: 'TEMPORARY_UNAVAILABLE', message_key: 'errors.temporary_unavailable',
        });
      }
      throw error;
    }
  }

  private async changedRevision(transaction: Prisma.TransactionClient, oldId: string, newId: string): Promise<boolean> {
    const select = {
      jewelleryTypeId: true, materialsState: true, gemstonesState: true, specifications: true,
      salesMode: true, priceVisibility: true, fulfilmentMethods: true,
      deliveryScope: true, deliveryLocalityIds: true, pickupLocationCodes: true,
      mediaReleaseId: true,
      from_RevisionMaterial_revisionId: {
        orderBy: { materialId: 'asc' as const },
        select: { materialId: true, finenessId: true, goldKaratId: true },
      },
      from_RevisionGemstone_revisionId: {
        orderBy: { gemstoneId: 'asc' as const }, select: { gemstoneId: true },
      },
      from_RevisionImage_revisionId: {
        orderBy: { sortOrder: 'asc' as const }, select: { assetId: true, sortOrder: true },
      },
    } satisfies Prisma.ProductRevisionSelect;
    const before = await transaction.productRevision.findUniqueOrThrow({ where: { id: oldId }, select });
    const after = await transaction.productRevision.findUniqueOrThrow({ where: { id: newId }, select });
    return hashIdempotencyPayload(before) !== hashIdempotencyPayload(after);
  }

  private conflict(code = 'VERSION_CONFLICT'): never {
    throw new ConflictException({
      code, message_key: code === 'ROUTE_CONFLICT' ? 'errors.route_unavailable' : 'errors.version_conflict',
    });
  }
}

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import type { RestrictionReason } from '../../../generated/prisma/enums';
import { TransactionService } from '../../common/transactions/transaction.service';
import type { AdminProduct, ProductDraft } from './catalogue-admin.dto';
import { CatalogueSaveDraftDto } from './catalogue-admin.dto';
import { CatalogueAdminService, cloneProductRevisionToDraft } from './catalogue-admin.service';

type NormalizedDraft = ProductDraft;

const RESTRICTION_REASONS: RestrictionReason[] = [
  'damage',
  'data_check',
  'management_decision',
  'other',
];

function normalizedText(value: string | null, maximum: number): string | null {
  if (value === null) return null;
  const result = value.normalize('NFC').trim();
  if (!result || result.length > maximum) throw new BadRequestException();
  return result;
}

function normalizeDraft(input: CatalogueSaveDraftDto['draft']): NormalizedDraft {
  const draft: NormalizedDraft = {
    product_type: input.product_type,
    jewellery_type: input.jewellery_type?.normalize('NFC').trim() || null,
    name_bg: normalizedText(input.name_bg, 250),
    name_en: normalizedText(input.name_en, 250),
    description_bg: normalizedText(input.description_bg, 20000),
    description_en: normalizedText(input.description_en, 20000),
    materials_state: input.materials_state,
    materials: input.materials.map((material) => ({
      material_code: material.material_code.normalize('NFC').trim(),
      fineness_code: material.fineness_code?.normalize('NFC').trim() || null,
      gold_karat_code: material.gold_karat_code?.normalize('NFC').trim() || null,
    })),
    gemstones_state: input.gemstones_state,
    gemstone_codes: input.gemstone_codes.map((code) => code.normalize('NFC').trim()),
    sales_mode: input.sales_mode,
    price_visibility: input.price_visibility,
    fulfilment_methods: input.fulfilment_methods,
    delivery_scope: input.delivery_scope,
    delivery_locality_ids: input.delivery_locality_ids.map((id) => id.normalize('NFC').trim()),
    pickup_location_codes: input.pickup_location_codes,
    media_release_id: input.media_release_id?.toLowerCase() ?? null,
    image_ids: input.image_ids.map((id) => id.toLowerCase()),
    change_reason_code: input.change_reason_code,
    change_reason_note: normalizedText(input.change_reason_note, 2000),
  };
  if (
    new Set(draft.materials.map((material) => material.material_code)).size !== draft.materials.length ||
    new Set(draft.gemstone_codes).size !== draft.gemstone_codes.length ||
    new Set(draft.fulfilment_methods).size !== draft.fulfilment_methods.length ||
    new Set(draft.delivery_locality_ids).size !== draft.delivery_locality_ids.length ||
    new Set(draft.pickup_location_codes).size !== draft.pickup_location_codes.length ||
    new Set(draft.image_ids).size !== draft.image_ids.length
  ) throw new BadRequestException();
  if (
    draft.materials.some((material) => !material.material_code ||
      (material.fineness_code !== null && !material.fineness_code) ||
      (material.gold_karat_code !== null && !material.gold_karat_code)) ||
    draft.gemstone_codes.some((code) => !code) ||
    draft.delivery_locality_ids.some((localityId) => !localityId)
  ) throw new BadRequestException();
  return draft;
}

function isPrismaFailure(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientInitializationError;
}

@Injectable()
export class CatalogueDraftService {
  private readonly logger = new Logger(CatalogueDraftService.name);

  constructor(
    private readonly transactions: TransactionService,
    private readonly catalogue: CatalogueAdminService,
  ) {}

  async save(actorId: string, productId: string, request: CatalogueSaveDraftDto): Promise<AdminProduct> {
    const draft = normalizeDraft(request.draft);
    try {
      const replay = await this.transactions.serializable((transaction) =>
        this.transactions.executeIdempotentAction(transaction, {
          scopeKey: `catalogue-draft:${actorId}:${productId}`,
          requestId: request.request_id,
          payload: {
            expected_version: request.expected_version,
            confirm_archive_exit: request.confirm_archive_exit ?? false,
            draft,
          },
        }, async () => {
          const locks = await this.transactions.lockProducts(transaction, [productId]);
          if (!locks.length) throw new NotFoundException();
          if (locks[0].version !== request.expected_version) this.conflict();

          const product = await transaction.product.findUniqueOrThrow({
            where: { id: productId },
            select: {
              id: true,
              productType: true,
              version: true,
              currentRevisionId: true,
            },
          });
          if (product.productType !== draft.product_type) {
            throw new BadRequestException({
              code: 'PRODUCT_TYPE_IMMUTABLE',
              message_key: 'errors.validation',
            });
          }
          await this.validateDraftReferences(transaction, productId, draft);

          const draftRevisions = await transaction.productRevision.findMany({
            where: { productId, state: 'draft' },
            orderBy: { revisionNumber: 'desc' },
            take: 2,
            select: {
              id: true,
              salesMode: true,
              priceVisibility: true,
              fulfilmentMethods: true,
              pickupLocationCodes: true,
            },
          });
          if (draftRevisions.length > 1) this.conflict();

          const baseRevision = draftRevisions[0] ??
            (product.currentRevisionId
              ? await transaction.productRevision.findUnique({
                  where: { id: product.currentRevisionId },
                  select: {
                    id: true,
                    salesMode: true,
                    priceVisibility: true,
                    fulfilmentMethods: true,
                    pickupLocationCodes: true,
                  },
                })
              : null);
          const exitsArchive = baseRevision?.salesMode === 'archive_catalogue' &&
            draft.sales_mode !== 'archive_catalogue';
          if (exitsArchive && (
            request.confirm_archive_exit !== true ||
            !draft.change_reason_code ||
            !draft.change_reason_note?.trim()
          )) {
            throw new ConflictException({
              code: 'ARCHIVE_EXIT_CONFIRMATION_REQUIRED',
              message_key: 'errors.version_conflict',
            });
          }
          if (this.addsRestriction(baseRevision, draft) &&
            (!draft.change_reason_code || !draft.change_reason_note?.trim())) {
            throw new BadRequestException({
              code: 'RESTRICTION_REASON_REQUIRED',
              message_key: 'errors.validation',
            });
          }

          let revisionId = draftRevisions[0]?.id;
          if (!revisionId && product.currentRevisionId) {
            const cloned = await cloneProductRevisionToDraft(
              transaction,
              productId,
              product.currentRevisionId,
              actorId,
            );
            revisionId = cloned.id;
          }
          if (!revisionId) {
            const latest = await transaction.productRevision.aggregate({
              where: { productId },
              _max: { revisionNumber: true },
            });
            const created = await transaction.productRevision.create({
              data: {
                productId,
                revisionNumber: (latest._max.revisionNumber ?? 0) + 1,
                createdById: actorId,
                salesMode: draft.sales_mode,
                priceVisibility: draft.price_visibility,
              },
              select: { id: true },
            });
            revisionId = created.id;
          }

          const dictionaryEntries = await this.resolveDictionaryEntries(transaction, draft);
          const byCode = new Map(
            dictionaryEntries.map((entry) => [`${entry.group}:${entry.code}`, entry.id]),
          );
          const dictionaryId = (group: string, code: string): string => {
            const id = byCode.get(`${group}:${code}`);
            if (!id) throw new BadRequestException({
              code: 'INVALID_DICTIONARY_CODE',
              message_key: 'errors.validation',
            });
            return id;
          };
          await transaction.productRevision.update({
            where: { id: revisionId },
            data: {
              jewelleryTypeId: draft.jewellery_type
                ? dictionaryId('jewellery_type', draft.jewellery_type)
                : null,
              materialsState: draft.materials_state,
              gemstonesState: draft.gemstones_state,
              salesMode: draft.sales_mode,
              priceVisibility: draft.price_visibility,
              fulfilmentMethods: draft.fulfilment_methods,
              deliveryScope: draft.delivery_scope,
              deliveryLocalityIds: draft.delivery_locality_ids,
              pickupLocationCodes: draft.pickup_location_codes,
              mediaReleaseId: draft.media_release_id,
              changeReason: draft.change_reason_code,
              changeNote: draft.change_reason_note,
            },
          });

          await transaction.productTranslation.upsert({
            where: { revisionId_locale: { revisionId, locale: 'bg' } },
            create: {
              revisionId,
              locale: 'bg',
              name: draft.name_bg,
              description: draft.description_bg,
            },
            update: { name: draft.name_bg, description: draft.description_bg },
          });
          await transaction.productTranslation.upsert({
            where: { revisionId_locale: { revisionId, locale: 'en' } },
            create: {
              revisionId,
              locale: 'en',
              name: draft.name_en,
              description: draft.description_en,
            },
            update: { name: draft.name_en, description: draft.description_en },
          });
          await transaction.revisionMaterial.deleteMany({ where: { revisionId } });
          if (draft.materials.length) {
            await transaction.revisionMaterial.createMany({
              data: draft.materials.map((material) => ({
                revisionId,
                materialId: dictionaryId('material', material.material_code),
                finenessId: material.fineness_code
                  ? dictionaryId('fineness', material.fineness_code)
                  : null,
                goldKaratId: material.gold_karat_code
                  ? dictionaryId('gold_karat', material.gold_karat_code)
                  : null,
              })),
            });
          }
          await transaction.revisionGemstone.deleteMany({ where: { revisionId } });
          if (draft.gemstone_codes.length) {
            await transaction.revisionGemstone.createMany({
              data: draft.gemstone_codes.map((code) => ({
                revisionId,
                gemstoneId: dictionaryId('gemstone', code),
              })),
            });
          }
          await transaction.revisionImage.deleteMany({ where: { revisionId } });
          if (draft.image_ids.length) {
            await transaction.revisionImage.createMany({
              data: draft.image_ids.map((assetId, index) => ({
                revisionId,
                assetId,
                sortOrder: index + 1,
              })),
            });
          }
          const updated = await transaction.product.update({
            where: { id: productId },
            data: { version: { increment: 1 } },
            select: { version: true },
          });
          await transaction.auditEvent.create({
            data: {
              actorId,
              action: 'catalogue_draft_save',
              subjectType: 'Product',
              subjectId: productId,
              reason: draft.change_reason_code,
              note: draft.change_reason_note,
              eventKey: `catalogue-draft:${productId}:${request.request_id}`,
              before: { version: product.version, draft_revision_id: draftRevisions[0]?.id ?? null },
              after: { version: updated.version, draft_revision_id: revisionId },
            },
          });
          const response = await this.catalogue.detailInTransaction(transaction, productId);
          return {
            status_code: 200,
            body: JSON.parse(JSON.stringify(response)) as Prisma.InputJsonObject,
          };
        }),
      );
      return this.readAdminProduct(replay.body);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        this.conflict();
      }
      if (isPrismaFailure(error)) {
        this.logger.warn('Catalogue draft storage dependency failed');
        throw new ServiceUnavailableException({
          code: 'TEMPORARY_UNAVAILABLE',
          message_key: 'errors.temporary_unavailable',
        });
      }
      throw error;
    }
  }

  private async validateDraftReferences(
    transaction: Prisma.TransactionClient,
    productId: string,
    draft: NormalizedDraft,
  ): Promise<void> {
    if (
      draft.sales_mode === 'archive_catalogue' &&
      draft.price_visibility !== 'hidden'
    ) throw new BadRequestException();
    if (
      draft.materials_state === 'known' !== (draft.materials.length > 0) ||
      draft.gemstones_state === 'known' !== (draft.gemstone_codes.length > 0)
    ) throw new BadRequestException();
    if (
      draft.fulfilment_methods.includes('delivery')
        ? !draft.delivery_scope ||
          (draft.delivery_scope === 'bulgaria' && draft.delivery_locality_ids.length > 0)
        : draft.delivery_scope !== null || draft.delivery_locality_ids.length > 0
    ) throw new BadRequestException();
    if (
      draft.fulfilment_methods.includes('store_pickup')
        ? draft.pickup_location_codes.length === 0
        : draft.pickup_location_codes.length > 0
    ) throw new BadRequestException();
    if (draft.delivery_locality_ids.length > 0) {
      throw new BadRequestException({
        code: 'LOCALITY_DIRECTORY_UNAVAILABLE',
        message_key: 'errors.validation',
      });
    }
    if (draft.product_type === 'loose_stone' && draft.jewellery_type) {
      throw new BadRequestException();
    }
    if (draft.change_reason_code && !draft.change_reason_note?.trim()) {
      throw new BadRequestException();
    }
    if (draft.change_reason_note && !draft.change_reason_code) {
      throw new BadRequestException();
    }
    if (draft.media_release_id) {
      const release = await transaction.mediaRelease.findUnique({
        where: { id: draft.media_release_id },
        select: { productId: true },
      });
      if (!release || release.productId !== productId) throw new BadRequestException();
      if (draft.image_ids.length) {
        const assets = await transaction.mediaAsset.findMany({
          where: {
            id: { in: draft.image_ids },
            releaseId: draft.media_release_id,
          },
          select: { id: true },
        });
        if (assets.length !== draft.image_ids.length) throw new BadRequestException();
      }
    } else if (draft.image_ids.length) {
      throw new BadRequestException();
    }
  }

  private async resolveDictionaryEntries(
    transaction: Prisma.TransactionClient,
    draft: NormalizedDraft,
  ): Promise<{ id: string; group: string; code: string; active: boolean; appliesTo: string[] }[]> {
    const requested: { group: string; code: string; applicableTo?: string }[] = [];
    if (draft.jewellery_type) {
      requested.push({
        group: 'jewellery_type',
        code: draft.jewellery_type,
        applicableTo: draft.product_type,
      });
    }
    for (const material of draft.materials) {
      requested.push({ group: 'material', code: material.material_code });
      if (material.fineness_code) {
        requested.push({
          group: 'fineness',
          code: material.fineness_code,
          applicableTo: `material.${material.material_code}`,
        });
      }
      if (material.gold_karat_code) {
        requested.push({
          group: 'gold_karat',
          code: material.gold_karat_code,
          applicableTo: 'material.gold',
        });
      }
    }
    for (const code of draft.gemstone_codes) {
      requested.push({ group: 'gemstone', code });
    }
    if (draft.change_reason_code) {
      requested.push({ group: 'restriction_reason', code: draft.change_reason_code });
    }
    const entries = requested.length
      ? await transaction.dictionaryEntry.findMany({
          where: {
            OR: requested.map(({ group, code }) => ({ group, code })),
          },
          select: { id: true, group: true, code: true, active: true, appliesTo: true },
        })
      : [];
    const byKey = new Map(entries.map((entry) => [`${entry.group}:${entry.code}`, entry]));
    for (const request of requested) {
      const entry = byKey.get(`${request.group}:${request.code}`);
      if (!entry || !entry.active || (
        request.applicableTo &&
        entry.appliesTo.length > 0 &&
        !entry.appliesTo.includes(request.applicableTo)
      )) throw new BadRequestException({
        code: 'INVALID_DICTIONARY_CODE',
        message_key: 'errors.validation',
      });
    }
    if (RESTRICTION_REASONS.includes(draft.change_reason_code as RestrictionReason) &&
      !byKey.get(`restriction_reason:${draft.change_reason_code}`)) {
      throw new BadRequestException({
        code: 'INVALID_DICTIONARY_CODE',
        message_key: 'errors.validation',
      });
    }
    return entries;
  }

  private addsRestriction(
    base: {
      salesMode: string;
      priceVisibility: string;
      fulfilmentMethods: string[];
      pickupLocationCodes: string[];
    } | null,
    draft: NormalizedDraft,
  ): boolean {
    if (!base) return false;
    return (
      (base.salesMode !== 'archive_catalogue' && draft.sales_mode === 'archive_catalogue') ||
      (base.priceVisibility === 'visible' && draft.price_visibility === 'hidden') ||
      base.fulfilmentMethods.some((method) => !draft.fulfilment_methods.includes(method as ProductDraft['fulfilment_methods'][number])) ||
      base.pickupLocationCodes.some((code) => !draft.pickup_location_codes.includes(code as ProductDraft['pickup_location_codes'][number]))
    );
  }

  private readAdminProduct(value: Prisma.JsonObject | Prisma.InputJsonObject): AdminProduct {
    if (
      value === null ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      typeof value.id !== 'string' ||
      typeof value.ssg_id !== 'string' ||
      !Array.isArray(value.validation_errors)
    ) throw new ServiceUnavailableException({
      code: 'TEMPORARY_UNAVAILABLE',
      message_key: 'errors.temporary_unavailable',
    });
    return value as unknown as AdminProduct;
  }

  private conflict(): never {
    throw new ConflictException({
      code: 'VERSION_CONFLICT',
      message_key: 'errors.version_conflict',
    });
  }
}

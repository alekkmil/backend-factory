import {
  BadRequestException, ConflictException, Injectable, Logger, NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { Prisma } from '../../../generated/prisma/client';
import type { Locale } from '../../../generated/prisma/enums';
import { PrismaService } from '../../database/prisma.service';
import { isGenuineBarcode } from '../../common/stock-facts/barcode';
import { parseSpecifications, specificationDictionary } from '../../common/jewellery-specifications';
import type {
  AdminCatalogueList, AdminProduct, CatalogueFieldError, CatalogueListQueryDto, ProductDraft,
} from './catalogue-admin.dto';

const DICTIONARY_SELECT = {
  code: true, group: true, active: true, appliesTo: true,
} satisfies Prisma.DictionaryEntrySelect;
const TRANSLATIONS_SELECT = {
  locale: true, name: true, description: true,
  seoTitle: true, seoDescription: true, ogImageId: true,
} satisfies Prisma.ProductTranslationSelect;
const REVISION_SELECT = {
  specifications: true,
  id: true, state: true, jewelleryTypeIdRelation: { select: DICTIONARY_SELECT },
  materialsState: true, gemstonesState: true, salesMode: true, priceVisibility: true,
  fulfilmentMethods: true, deliveryScope: true, deliveryLocalityIds: true,
  pickupLocationCodes: true, mediaReleaseId: true, changeReason: true, changeNote: true,
  mediaReleaseIdRelation: { select: { productId: true, approved: true } },
  from_ProductTranslation_revisionId: { select: TRANSLATIONS_SELECT },
  from_RevisionMaterial_revisionId: {
    orderBy: { id: 'asc' },
    select: {
      materialIdRelation: { select: DICTIONARY_SELECT },
      finenessIdRelation: { select: DICTIONARY_SELECT },
      goldKaratIdRelation: { select: DICTIONARY_SELECT },
    },
  },
  from_RevisionGemstone_revisionId: {
    orderBy: { id: 'asc' },
    select: { gemstoneIdRelation: { select: DICTIONARY_SELECT } },
  },
  from_RevisionImage_revisionId: {
    orderBy: { sortOrder: 'asc' },
    select: {
      assetId: true, sortOrder: true,
      assetIdRelation: {
        select: { releaseId: true, reviewStatus: true, role: true, derivatives: true },
      },
    },
  },
} satisfies Prisma.ProductRevisionSelect;
type Revision = Prisma.ProductRevisionGetPayload<{ select: typeof REVISION_SELECT }>;

export async function cloneProductRevisionToDraft(
  transaction: Prisma.TransactionClient,
  productId: string,
  sourceRevisionId: string,
  actorId: string,
): Promise<Prisma.ProductRevisionGetPayload<object>> {
  const source = await transaction.productRevision.findUnique({
    where: { id: sourceRevisionId },
    include: {
      from_ProductTranslation_revisionId: true,
      from_RevisionMaterial_revisionId: true,
      from_RevisionGemstone_revisionId: true,
      from_RevisionImage_revisionId: true,
    },
  });
  if (!source || source.productId !== productId || source.state !== 'published') {
    throw new ConflictException({
      code: 'VERSION_CONFLICT', message_key: 'errors.version_conflict',
    });
  }
  const latest = await transaction.productRevision.aggregate({
    where: { productId },
    _max: { revisionNumber: true },
  });
  const created = await transaction.productRevision.create({
    data: {
      productId,
      revisionNumber: (latest._max.revisionNumber ?? 0) + 1,
      createdById: actorId,
      jewelleryTypeId: source.jewelleryTypeId,
      materialsState: source.materialsState,
      gemstonesState: source.gemstonesState,
      salesMode: source.salesMode,
      priceVisibility: source.priceVisibility,
      fulfilmentMethods: source.fulfilmentMethods,
      deliveryScope: source.deliveryScope,
      deliveryLocalityIds: source.deliveryLocalityIds,
      pickupLocationCodes: source.pickupLocationCodes,
      mediaReleaseId: source.mediaReleaseId,
      changeReason: source.changeReason,
      changeNote: source.changeNote,
      specifications: source.specifications ?? Prisma.DbNull,
    },
  });
  for (const text of source.from_ProductTranslation_revisionId) {
    const { id, revisionId, ...data } = text;
    void id;
    void revisionId;
    await transaction.productTranslation.create({
      data: { ...data, revisionId: created.id },
    });
  }
  for (const material of source.from_RevisionMaterial_revisionId) {
    await transaction.revisionMaterial.create({
      data: {
        revisionId: created.id,
        materialId: material.materialId,
        finenessId: material.finenessId,
        goldKaratId: material.goldKaratId,
      },
    });
  }
  for (const gemstone of source.from_RevisionGemstone_revisionId) {
    await transaction.revisionGemstone.create({
      data: { revisionId: created.id, gemstoneId: gemstone.gemstoneId },
    });
  }
  for (const image of source.from_RevisionImage_revisionId) {
    await transaction.revisionImage.create({
      data: {
        revisionId: created.id,
        assetId: image.assetId,
        sortOrder: image.sortOrder,
      },
    });
  }
  return created;
}

export function catalogueSlugPreview(title: string | null, locale: Locale): string | null {
  if (!title) return null;
  const slug = title.trim().normalize('NFC').toLowerCase()
    .replace(locale === 'bg' ? /[^а-яѝ0-9]+/g : /[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || null;
}

@Injectable()
export class CatalogueAdminService {
  private readonly logger = new Logger(CatalogueAdminService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(query: CatalogueListQueryDto): Promise<AdminCatalogueList> {
    const skip = (query.page - 1) * query.page_size;
    if (!Number.isSafeInteger(skip) || skip > 2147483647) throw new BadRequestException();
    const where: Prisma.ProductWhereInput = {
      publicationStatus: query.publication_status,
    };
    if (query.q) {
      where.OR = [
        { ssgId: { contains: query.q, mode: 'insensitive' } },
        {
          from_ProductRevision_productId: {
            some: {
              OR: [
                { state: 'draft' },
                { state: 'published', from_Product_currentRevisionId: { isNot: null } },
              ],
              from_ProductTranslation_revisionId: {
                some: { name: { contains: query.q, mode: 'insensitive' } },
              },
            },
          },
        },
      ];
      if (isUUID(query.q)) where.OR.push({ id: query.q });
      if (/^[0-9]{1,19}$/.test(query.q) && BigInt(query.q) <= 9223372036854775807n) {
        where.OR.push({ publicUrlId: BigInt(query.q) });
      }
    }
    return this.read(async (transaction) => {
      const total = await transaction.product.count({ where });
      const rows = await transaction.product.findMany({
        where, skip, take: query.page_size, orderBy: [{ publicUrlId: 'asc' }, { id: 'asc' }],
        select: {
          id: true, ssgId: true, publicationStatus: true, version: true,
          currentRevisionIdRelation: {
            select: { from_ProductTranslation_revisionId: { select: TRANSLATIONS_SELECT } },
          },
          from_ProductRevision_productId: {
            where: { state: 'draft' }, take: 2, orderBy: { revisionNumber: 'desc' },
            select: { from_ProductTranslation_revisionId: { select: TRANSLATIONS_SELECT } },
          },
        },
      });
      return {
        items: rows.map((row) => {
          if (row.from_ProductRevision_productId.length > 1) this.inconsistent();
          const draft = row.from_ProductRevision_productId[0];
          const translations = (draft ?? row.currentRevisionIdRelation)?.from_ProductTranslation_revisionId;
          return {
            id: row.id, ssg_id: row.ssgId, publication_status: row.publicationStatus,
            version: row.version, has_draft: !!draft,
            name_bg: translations?.find((text) => text.locale === 'bg')?.name ?? null,
            name_en: translations?.find((text) => text.locale === 'en')?.name ?? null,
          };
        }),
        total, page: query.page, page_size: query.page_size,
      };
    });
  }

  async detail(id: string): Promise<AdminProduct> {
    return this.read((transaction) => this.detailInTransaction(transaction, id));
  }

  async detailInTransaction(transaction: Prisma.TransactionClient, id: string): Promise<AdminProduct> {
      const product = await transaction.product.findUnique({
        where: { id },
        select: {
          id: true, ssgId: true, publicUrlId: true, productType: true,
          publicationStatus: true, version: true, currentRevisionId: true,
          currentRevisionIdRelation: {
            select: {
              state: true,
              from_ProductTranslation_revisionId: { select: TRANSLATIONS_SELECT },
            },
          },
          from_ProductRevision_productId: {
            where: { state: 'draft' }, orderBy: { revisionNumber: 'desc' }, take: 2,
            select: REVISION_SELECT,
          },
          from_StockItem_productId: {
            orderBy: [{ barcode: 'asc' }, { id: 'asc' }],
            select: {
              id: true, barcode: true, locationCode: true, status: true,
              price: true, currency: true, version: true,
            },
          },
          from_BarcodeIdentity_productId: { select: { barcode: true } },
        },
      });
      if (!product) throw new NotFoundException();
      if (
        product.from_ProductRevision_productId.length > 1 ||
        (product.currentRevisionId && product.currentRevisionIdRelation?.state !== 'published')
      ) this.inconsistent();
      const revision = product.from_ProductRevision_productId[0];
      const errors: CatalogueFieldError[] = [];
      const draft = revision ? this.draft(product.productType, revision) : null;
      const currentTexts = product.currentRevisionIdRelation?.from_ProductTranslation_revisionId;
      const slug = {
        bg: catalogueSlugPreview(
          draft ? draft.name_bg : currentTexts?.find((text) => text.locale === 'bg')?.name ?? null, 'bg',
        ),
        en: catalogueSlugPreview(
          draft ? draft.name_en : currentTexts?.find((text) => text.locale === 'en')?.name ?? null, 'en',
        ),
      };
      if (revision && draft) this.validateDraft(product.id, draft, revision, slug, errors);
      if (draft?.specifications) {
        try {
          await specificationDictionary(transaction, [draft.specifications]);
        } catch (error) {
          if (!(error instanceof BadRequestException)) throw error;
          this.fieldError(errors, 'specifications', 'SPECIFICATION_DICTIONARY_INVALID');
        }
      }
      const claimed = new Set(product.from_BarcodeIdentity_productId.map((identity) => identity.barcode));
      const verified = new Set(product.from_StockItem_productId.map((stock) => stock.barcode));
      const staged = await this.stagedCount(transaction, product.id, product.ssgId, claimed, verified, errors);
      return {
        id: product.id, ssg_id: product.ssgId, public_url_id: product.publicUrlId.toString(),
        version: product.version, publication_status: product.publicationStatus,
        draft, draft_revision_id: revision?.id ?? null,
        published_revision_id: product.currentRevisionId, slug_preview: slug,
        units: product.from_StockItem_productId.map((stock) => {
          if ((stock.price === null) !== (stock.currency === null)) this.inconsistent();
          return {
            id: stock.id, barcode: stock.barcode, location_code: stock.locationCode,
            status: stock.status, version: stock.version,
            price: stock.price !== null && stock.currency !== null
              ? { amount: stock.price.toFixed(2), currency: stock.currency } : null,
          };
        }),
        staged_unit_count: staged, validation_errors: errors,
      };
  }

  private draft(productType: ProductDraft['product_type'], revision: Revision): ProductDraft {
    const bg = revision.from_ProductTranslation_revisionId.find((text) => text.locale === 'bg');
    const en = revision.from_ProductTranslation_revisionId.find((text) => text.locale === 'en');
    return {
      seo_translations: revision.from_ProductTranslation_revisionId.map((text) => ({
        locale: text.locale,
        seo_title: text.seoTitle,
        seo_description: text.seoDescription,
        og_image_id: text.ogImageId,
      })),
      product_type: productType, jewellery_type: revision.jewelleryTypeIdRelation?.code ?? null,
      name_bg: bg?.name ?? null, name_en: en?.name ?? null,
      description_bg: bg?.description ?? null, description_en: en?.description ?? null,
      specifications: parseSpecifications(revision.specifications),
      materials_state: revision.materialsState,
      materials: revision.from_RevisionMaterial_revisionId.map((material) => ({
        material_code: material.materialIdRelation.code,
        fineness_code: material.finenessIdRelation?.code ?? null,
        gold_karat_code: material.goldKaratIdRelation?.code ?? null,
      })),
      gemstones_state: revision.gemstonesState,
      gemstone_codes: revision.from_RevisionGemstone_revisionId.map((stone) => stone.gemstoneIdRelation.code),
      sales_mode: revision.salesMode, price_visibility: revision.priceVisibility,
      fulfilment_methods: revision.fulfilmentMethods, delivery_scope: revision.deliveryScope,
      delivery_locality_ids: revision.deliveryLocalityIds, pickup_location_codes: revision.pickupLocationCodes,
      media_release_id: revision.mediaReleaseId,
      image_ids: revision.from_RevisionImage_revisionId.map((image) => image.assetId),
      change_reason_code: revision.changeReason, change_reason_note: revision.changeNote,
    };
  }

  private validateDraft(
    productId: string, draft: ProductDraft, revision: Revision,
    slug: AdminProduct['slug_preview'], errors: CatalogueFieldError[],
  ): void {
    const add = (field: string, code = 'VALIDATION_ERROR') =>
      this.fieldError(errors, field, code);
    for (const locale of ['bg', 'en'] as const) {
      for (const field of [`name_${locale}`, `description_${locale}`] as const) {
        const text = draft[field];
        if (!text?.trim() || text.length > (field.startsWith('name') ? 250 : 20000)) add(field);
      }
      if (!slug[locale] || slug[locale].length > 180) add(`slug_preview.${locale}`);
    }
    const dictionary = (
      entry: { code: string; group: string; active: boolean; appliesTo: string[] } | null,
      group: string, field: string, applicability?: string,
    ) => {
      if (entry && (!entry.active || entry.group !== group ||
        (applicability && entry.appliesTo.length > 0 && !entry.appliesTo.includes(applicability)))) add(field);
    };
    dictionary(revision.jewelleryTypeIdRelation, 'jewellery_type', 'jewellery_type', draft.product_type);
    if (draft.product_type === 'jewellery' && !draft.jewellery_type) add('jewellery_type');
    if (draft.product_type === 'loose_stone' && draft.jewellery_type) add('jewellery_type');
    for (const [index, material] of revision.from_RevisionMaterial_revisionId.entries()) {
      dictionary(material.materialIdRelation, 'material', `materials.${index}.material_code`);
      const applicability = `material.${material.materialIdRelation.code}`;
      dictionary(material.finenessIdRelation, 'fineness', `materials.${index}.fineness_code`, applicability);
      dictionary(material.goldKaratIdRelation, 'gold_karat', `materials.${index}.gold_karat_code`, applicability);
    }
    for (const [index, stone] of revision.from_RevisionGemstone_revisionId.entries()) {
      dictionary(stone.gemstoneIdRelation, 'gemstone', `gemstone_codes.${index}`);
    }
    if ((draft.materials_state === 'known') !== (draft.materials.length > 0)) add('materials');
    if ((draft.gemstones_state === 'known') !== (draft.gemstone_codes.length > 0)) add('gemstone_codes');
    if (draft.product_type === 'loose_stone' && draft.gemstones_state !== 'known') add('gemstones_state');
    if (draft.sales_mode === 'archive_catalogue' && draft.price_visibility !== 'hidden') add('price_visibility');
    if (draft.change_reason_code && !draft.change_reason_note?.trim()) add('change_reason_note');
    if (draft.fulfilment_methods.includes('delivery')) {
      if (!draft.delivery_scope) add('delivery_scope');
      if (draft.delivery_scope === 'selected_localities' && !draft.delivery_locality_ids.length) add('delivery_locality_ids');
      if (draft.delivery_scope === 'bulgaria' && draft.delivery_locality_ids.length) add('delivery_locality_ids');
    } else if (draft.delivery_scope || draft.delivery_locality_ids.length) add('delivery_scope');
    if (draft.fulfilment_methods.includes('store_pickup')) {
      if (!draft.pickup_location_codes.length) add('pickup_location_codes');
    } else if (draft.pickup_location_codes.length) add('pickup_location_codes');
    const release = revision.mediaReleaseIdRelation;
    if (!release || release.productId !== productId || !release.approved) add('media_release_id', 'MEDIA_NOT_READY');
    const images = revision.from_RevisionImage_revisionId;
    for (const text of draft.seo_translations ?? []) {
      if (text.og_image_id && !draft.image_ids.includes(text.og_image_id)) {
        add(`seo_translations.${text.locale}.og_image_id`, 'MEDIA_NOT_READY');
      }
    }
    if (!images.length || images[0]?.sortOrder !== 1 || images[0]?.assetIdRelation.role !== 'main' ||
      images.filter((image) => image.assetIdRelation.role === 'main').length !== 1) add('image_ids', 'MEDIA_NOT_READY');
    for (const [index, image] of images.entries()) {
      const asset = image.assetIdRelation;
      if (asset.releaseId !== revision.mediaReleaseId || asset.reviewStatus !== 'approved') {
        add(`image_ids.${index}`, 'MEDIA_NOT_READY');
      }
      if (
        !Array.isArray(asset.derivatives) || asset.derivatives.length !== 4 ||
        [200, 400, 800, 1600].some((size) => !Array.isArray(asset.derivatives) ||
          !asset.derivatives.some((item) => item !== null && typeof item === 'object' &&
            !Array.isArray(item) && item.size === size && item.mime === 'image/webp' &&
            item.width === size && item.height === size && item.colour_space === 'sRGB' &&
            typeof item.object_key === 'string' && item.object_key.length > 0 &&
            typeof item.bytes === 'number' && Number.isInteger(item.bytes) && item.bytes > 0 &&
            typeof item.sha256 === 'string' && /^[a-f0-9]{64}$/.test(item.sha256)))
      ) add(`image_ids.${index}`, 'MEDIA_NOT_READY');
    }
  }

  private async stagedCount(
    transaction: Prisma.TransactionClient, productId: string, ssgId: string,
    claimed: Set<string>, verified: Set<string>, errors: CatalogueFieldError[],
  ): Promise<number> {
    const staged = new Set<string>();
    let cursor: string | undefined;
    while (true) {
      const rows = await transaction.importProductRow.findMany({
        where: {
          productId, state: 'committed',
          batchIdRelation: { state: { in: ['committed', 'partially_committed'] } },
        },
        orderBy: { id: 'asc' }, take: 100,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, ssgId: true, payload: true },
      });
      for (const row of rows) {
        const payload = row.payload;
        if (row.ssgId !== ssgId || !payload || typeof payload !== 'object' ||
          Array.isArray(payload) || !Array.isArray(payload.units) ||
          !Array.isArray(payload.products) || payload.products.length !== 1) {
          this.fieldError(errors, 'staged_units', 'RECONCILIATION_REQUIRED');
          continue;
        }
        const sourceProduct = payload.products[0];
        if (!sourceProduct || typeof sourceProduct !== 'object' ||
          Array.isArray(sourceProduct) || sourceProduct.ssg_id !== ssgId) {
          this.fieldError(errors, 'staged_units', 'RECONCILIATION_REQUIRED');
          continue;
        }
        for (const unit of payload.units) {
          if (!unit || typeof unit !== 'object' || Array.isArray(unit) ||
            unit.ssg_id !== ssgId || typeof unit.barcode !== 'string') {
            this.fieldError(errors, 'staged_units', 'RECONCILIATION_REQUIRED');
            continue;
          }
          const barcode = unit.barcode.trim();
          if (!isGenuineBarcode(barcode) || barcode.length > 128 || !claimed.has(barcode)) {
            this.fieldError(errors, 'staged_units', 'RECONCILIATION_REQUIRED');
            continue;
          }
          if (!verified.has(barcode)) staged.add(barcode);
        }
      }
      if (rows.length < 100) break;
      cursor = rows[rows.length - 1].id;
    }
    return staged.size;
  }

  private fieldError(errors: CatalogueFieldError[], field: string, code: string): void {
    if (!errors.some((error) => error.field === field && error.code === code)) {
      errors.push({
        field, code, message_key: code === 'MEDIA_NOT_READY' ? 'errors.media_not_ready'
          : code === 'RECONCILIATION_REQUIRED' ? 'errors.reconciliation_required' : 'errors.validation',
      });
    }
  }

  private inconsistent(): never {
    this.logger.error('Catalogue read found inconsistent persisted product data');
    throw new ServiceUnavailableException({
      code: 'RECONCILIATION_REQUIRED', message_key: 'errors.reconciliation_required',
    });
  }

  private async read<T>(work: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError ||
        error instanceof Prisma.PrismaClientUnknownRequestError ||
        error instanceof Prisma.PrismaClientInitializationError ||
        error instanceof Prisma.PrismaClientRustPanicError
      ) {
        this.logger.error('Catalogue read database dependency failed');
        throw new ServiceUnavailableException({
          code: 'TEMPORARY_UNAVAILABLE', message_key: 'errors.temporary_unavailable',
        });
      }
      throw error;
    }
  }
}

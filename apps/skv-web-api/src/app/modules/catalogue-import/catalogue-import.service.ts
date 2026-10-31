import {
  ConflictException,
  Injectable,
  Logger,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '../../../generated/prisma/client';
import type {
  ImportRowState,
  ImportState,
} from '../../../generated/prisma/enums';
import { PrismaService } from '../../database/prisma.service';
import { isGenuineBarcode } from '../../common/stock-facts/barcode';
import {
  ImportImageRowDto,
  ImportLegacyLinkRowDto,
  ImportMaterialRowDto,
  ImportPreflightRequestDto,
  ImportProductPayloadDto,
  ImportProductRowDto,
  ImportUnitRowDto,
} from './import.dto';

const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024;
const PRODUCT_TYPES = ['jewellery', 'loose_stone'];
const COMPOSITION_STATES = ['unknown', 'none', 'known'];
const SALES_MODES = [
  'direct_purchase',
  'enquiry_only',
  'archive_catalogue',
];
const PRICE_VISIBILITIES = ['visible', 'hidden'];
const FULFILMENT_METHODS = ['delivery', 'store_pickup'];
const LOCATIONS = ['sofia', 'nessebar'];
const STOCK_STATUSES = [
  'available',
  'reserved',
  'in_transit',
  'blocked',
  'sold',
];
const IMAGE_ROLES = [
  'main',
  'angle',
  'back_profile',
  'detail',
  'on_body',
  'original',
];
interface ImportFieldError {
  sheet: string;
  row: number;
  field: string;
  code: string;
  message_key: string;
}

interface ImportDiff {
  ssg_id: string;
  operation: 'create_draft' | 'update_draft' | 'unchanged';
  changed_fields: string[];
}

interface ImportReport {
  products_total: number;
  ready: number;
  invalid: number;
  errors: ImportFieldError[];
  diff: ImportDiff[];
}

interface ImportProductResult {
  ssg_id: string;
  state: ImportRowState;
  product_id: string | null;
}

export interface ImportResult {
  batch_id: string;
  state: ImportState;
  report: ImportReport;
  products: ImportProductResult[];
}

interface ImportPreflightOutcome {
  result: ImportResult;
  statusCode: 200 | 201;
}

interface ImportGroup {
  ssgId: string;
  products: ImportProductRowDto[];
  units: ImportUnitRowDto[];
  materials: ImportMaterialRowDto[];
  images: ImportImageRowDto[];
  legacyLinks: ImportLegacyLinkRowDto[];
  sourcePayload: {
    products: ImportProductRowDto[];
    units: ImportUnitRowDto[];
    materials: ImportMaterialRowDto[];
    images: ImportImageRowDto[];
    legacy_links: ImportLegacyLinkRowDto[];
  };
}

const EXISTING_PRODUCT_SELECT = {
  id: true,
  ssgId: true,
  productType: true,
  currentRevisionIdRelation: {
    select: {
      jewelleryTypeIdRelation: { select: { code: true } },
      materialsState: true,
      gemstonesState: true,
      salesMode: true,
      priceVisibility: true,
      fulfilmentMethods: true,
      deliveryScope: true,
      deliveryLocalityIds: true,
      pickupLocationCodes: true,
      from_ProductTranslation_revisionId: {
        select: { locale: true, name: true, description: true },
      },
      from_RevisionMaterial_revisionId: {
        select: {
          materialIdRelation: { select: { code: true } },
          finenessIdRelation: { select: { code: true } },
          goldKaratIdRelation: { select: { code: true } },
        },
      },
      from_RevisionGemstone_revisionId: {
        select: { gemstoneIdRelation: { select: { code: true } } },
      },
    },
  },
} satisfies Prisma.ProductSelect;

type ExistingProduct = Prisma.ProductGetPayload<{
  select: typeof EXISTING_PRODUCT_SELECT;
}>;

@Injectable()
export class CatalogueImportService {
  private readonly logger = new Logger(CatalogueImportService.name);

  constructor(private readonly prisma: PrismaService) {}

  async preflight(
    actorId: string,
    request: ImportPreflightRequestDto,
  ): Promise<ImportPreflightOutcome> {
    const data = normalizePayload(request.data);
    const serialized = canonicalJson(data);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_PAYLOAD_BYTES) {
      throw new PayloadTooLargeException({
        code: 'VALIDATION_ERROR',
        message_key: 'errors.payload_too_large',
      });
    }

    const payloadHash = createHash('sha256')
      .update(serialized)
      .digest('hex');
    const lockKey = `catalogue-import:${actorId}:${request.request_id}`;

    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await this.prisma.$transaction(
            async (transaction) => {
              await transaction.$queryRaw<{ locked: number }[]>`
                WITH lock_result AS MATERIALIZED (
                  SELECT pg_advisory_xact_lock(
                    hashtextextended(${lockKey}, 0)
                  )
                )
                SELECT 1::int AS locked FROM lock_result
              `;

              const prior = await transaction.importBatch.findUnique({
                where: {
                  actorId_requestId: {
                    actorId,
                    requestId: request.request_id,
                  },
                },
                select: {
                  id: true,
                  payloadHash: true,
                  state: true,
                  report: true,
                  from_ImportProductRow_batchId: {
                    orderBy: { ssgId: 'asc' },
                    select: { ssgId: true, state: true, productId: true },
                  },
                },
              });
              if (prior) {
                if (prior.payloadHash !== payloadHash) {
                  throw new ConflictException({
                    code: 'REQUEST_PAYLOAD_MISMATCH',
                    message_key: 'errors.request_payload_mismatch',
                  });
                }
                return { result: this.toResult(prior), statusCode: 200 };
              }

              const evaluation = await this.evaluate(
                transaction,
                data,
                request.data,
              );
              const state: ImportState =
                evaluation.report.errors.length === 0
                  ? 'validated'
                  : 'invalid';
              const batch = await transaction.importBatch.create({
                data: {
                  actorId,
                  requestId: request.request_id,
                  payloadHash,
                  state,
                  report: toJsonValue(evaluation.report),
                  from_ImportProductRow_batchId: {
                    create: evaluation.groups.map((group) => ({
                      ssgId: group.ssgId,
                      productId: evaluation.productIds.get(group.ssgId) ?? null,
                      state: evaluation.invalidGroups.has(group.ssgId)
                        ? 'invalid'
                        : 'ready',
                      payload: toJsonValue(groupPayload(group)),
                      errors: toJsonValue(
                        evaluation.errorsBySsgId.get(group.ssgId) ?? [],
                      ),
                    })),
                  },
                },
                select: {
                  id: true,
                  state: true,
                  report: true,
                  from_ImportProductRow_batchId: {
                    orderBy: { ssgId: 'asc' },
                    select: { ssgId: true, state: true, productId: true },
                  },
                },
              });
              return { result: this.toResult(batch), statusCode: 201 };
            },
            {
              isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
              timeout: 15000,
            },
          );
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2034' &&
            attempt < 2
          ) {
            continue;
          }
          throw error;
        }
      }
      throw new Error('Import preflight retry limit exceeded');
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof PayloadTooLargeException
      ) {
        throw error;
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError ||
        error instanceof Prisma.PrismaClientUnknownRequestError ||
        error instanceof Prisma.PrismaClientInitializationError
      ) {
        const diagnostic =
          error instanceof Prisma.PrismaClientKnownRequestError
            ? ` (Prisma ${error.code})`
            : '';
        this.logger.warn(
          `Catalogue import preflight storage is unavailable${diagnostic}`,
        );
        throw new ServiceUnavailableException({
          code: 'TEMPORARY_UNAVAILABLE',
          message_key: 'errors.temporary_unavailable',
        });
      }
      throw error;
    }
  }

  private async evaluate(
    transaction: Prisma.TransactionClient,
    data: ImportProductPayloadDto,
    sourceData: ImportProductPayloadDto,
  ): Promise<{
    groups: ImportGroup[];
    invalidGroups: Set<string>;
    productIds: Map<string, string>;
    errorsBySsgId: Map<string, ImportFieldError[]>;
    report: ImportReport;
  }> {
    const errors: (ImportFieldError & { ssg_id: string })[] = [];
    const addError = (
      sheet: string,
      row: number,
      field: string,
      code: string,
      ssgId: string | null | undefined,
    ): void => {
      errors.push({
        sheet,
        row,
        field,
        code,
        message_key: 'import.invalid',
        ssg_id: ssgId ?? '',
      });
    };

    const productIdsInFile = new Set<string>();
    const productRowsById = new Map<string, ImportProductRowDto[]>();
    data.products.forEach((product, index) => {
      const ssgId = value(product.ssg_id);
      if (!isSsgId(ssgId)) {
        addError('Products', index + 1, 'ssg_id', 'INVALID_SSG_ID', ssgId);
      }
      if (productIdsInFile.has(ssgId)) {
        addError(
          'Products',
          index + 1,
          'ssg_id',
          'DUPLICATE_SSG_ID',
          ssgId,
        );
      }
      if (typeof product.ssg_id === 'string') {
        productIdsInFile.add(ssgId);
        const rows = productRowsById.get(ssgId) ?? [];
        rows.push(product);
        productRowsById.set(ssgId, rows);
      }
      this.validateProductRow(product, index + 1, addError);
    });
    for (const [sheet, rows] of [
      ['Products', data.products],
      ['Units', data.units],
      ['Materials', data.materials],
      ['Images', data.images],
      ['Legacy links', data.legacy_links],
    ] as const) {
      rows.forEach((row, index) => {
        for (const [field, cell] of Object.entries(row)) {
          if (typeof cell === 'string' && cell.startsWith('=')) {
            addError(sheet, index + 1, field, 'FORMULA_NOT_ALLOWED', row.ssg_id);
          }
        }
      });
    }

    const productTypes = new Map(
      data.products.map((product) => [
        value(product.ssg_id),
        value(product.product_type),
      ]),
    );
    const validProductIds = new Set(productTypes.keys());
    this.validateUnitRows(data.units, validProductIds, productTypes, addError);
    this.validateMaterialRows(data.materials, validProductIds, addError);
    this.validateImageRows(data.images, validProductIds, addError);
    this.validateLegacyRows(data.legacy_links, validProductIds, addError);

    const allSsgIds = new Set<string>();
    for (const sheet of [
      data.products,
      data.units,
      data.materials,
      data.images,
      data.legacy_links,
    ]) {
      for (const row of sheet) {
        const ssgId = value(row.ssg_id);
        allSsgIds.add(ssgId);
      }
    }
    if (allSsgIds.size === 0) {
      addError('Products', 0, 'ssg_id', 'EMPTY_BATCH', '');
    }
    for (const ssgId of allSsgIds) {
      if (!productRowsById.has(ssgId)) {
        addError('Products', 0, 'ssg_id', 'PRODUCT_ROW_MISSING', ssgId);
      }
    }
    for (const [ssgId, rows] of productRowsById) {
      const product = rows[0];
      const linkedMaterials = data.materials.filter(
        (row) => value(row.ssg_id) === ssgId,
      );
      if (
        product.materials_state === 'known' &&
        linkedMaterials.length === 0
      ) {
        addError(
          'Products',
          0,
          'materials_state',
          'MATERIAL_ROWS_REQUIRED',
          ssgId,
        );
      }
      if (
        product.materials_state !== 'known' &&
        linkedMaterials.length > 0
      ) {
        addError(
          'Products',
          0,
          'materials_state',
          'MATERIAL_ROWS_NOT_ALLOWED',
          ssgId,
        );
      }
      const gemstoneCodes = product.gemstone_codes ?? [];
      if (
        product.gemstones_state === 'known' &&
        gemstoneCodes.length === 0
      ) {
        addError(
          'Products',
          0,
          'gemstone_codes',
          'GEMSTONE_CODES_REQUIRED',
          ssgId,
        );
      }
      if (
        product.gemstones_state !== 'known' &&
        gemstoneCodes.length > 0
      ) {
        addError(
          'Products',
          0,
          'gemstone_codes',
          'GEMSTONE_CODES_NOT_ALLOWED',
          ssgId,
        );
      }
    }

    const dictionaryEntries = await transaction.dictionaryEntry.findMany({
      where: { active: true },
      select: { group: true, code: true, appliesTo: true },
    });
    const dictionaryCodes = new Map(
      dictionaryEntries.map((entry) => [
        `${entry.group}:${entry.code}`,
        entry.appliesTo,
      ]),
    );
    this.validateDictionaries(data, dictionaryCodes, addError);

    const ids = [...allSsgIds].filter(isSsgId);
    const products = ids.length
      ? await transaction.product.findMany({
          where: { ssgId: { in: ids } },
          select: EXISTING_PRODUCT_SELECT,
        })
      : [];
    const pricedUnits = data.units.filter(
      (unit) => unit.price !== undefined && unit.price !== null,
    );
    if (pricedUnits.length > 0) {
      const settings = await transaction.shopSettings.findUnique({
        where: { id: 1 },
        select: { currency: true },
      });
      data.units.forEach((unit, index) => {
        if (
          unit.price !== undefined &&
          unit.price !== null &&
          (!settings || unit.currency !== settings.currency)
        ) {
          addError(
            'Units',
            index + 1,
            'currency',
            settings ? 'SHOP_CURRENCY_MISMATCH' : 'SHOP_CURRENCY_UNAVAILABLE',
            value(unit.ssg_id),
          );
        }
      });
    }
    const existingProducts = new Map(
      products.map((product) => [product.ssgId, product]),
    );
    data.products.forEach((product, index) => {
      const ssgId = value(product.ssg_id);
      const existing = existingProducts.get(ssgId);
      if (existing && product.product_type !== existing.productType) {
        addError(
          'Products',
          index + 1,
          'product_type',
          'PRODUCT_TYPE_IMMUTABLE',
          ssgId,
        );
      }
    });
    const productIds = new Map(
      products.map((product) => [product.ssgId, product.id]),
    );

    const barcodes = uniqueStrings(
      data.units.map((unit) => value(unit.barcode)),
    );
    const identities = barcodes.length
      ? await transaction.barcodeIdentity.findMany({
          where: { barcode: { in: barcodes } },
          select: {
            barcode: true,
            productIdRelation: { select: { ssgId: true } },
          },
        })
      : [];
    const stockItems = barcodes.length
      ? await transaction.stockItem.findMany({
          where: { barcode: { in: barcodes } },
          select: {
            barcode: true,
            productIdRelation: { select: { ssgId: true } },
          },
        })
      : [];
    const identityOwners = new Map(
      identities.map((identity) => [
        identity.barcode,
        identity.productIdRelation.ssgId,
      ]),
    );
    const stockOwners = new Map(
      stockItems.map((stockItem) => [
        stockItem.barcode,
        stockItem.productIdRelation.ssgId,
      ]),
    );
    data.units.forEach((unit, index) => {
      const barcode = value(unit.barcode);
      const ssgId = value(unit.ssg_id);
      if (!barcode) {
        return;
      }
      const hasConflictingOwner = [
        identityOwners.get(barcode),
        stockOwners.get(barcode),
      ].some((ownerSsgId) => ownerSsgId && ownerSsgId !== ssgId);
      if (hasConflictingOwner) {
        addError(
          'Units',
          index + 1,
          'barcode',
          'BARCODE_ALREADY_LINKED',
          ssgId,
        );
      }
    });

    const legacyIds = uniqueStrings(
      data.legacy_links.map((link) => value(link.legacy_id)),
    );
    const existingLegacy = legacyIds.length
      ? await transaction.legacyReference.findMany({
          where: { sourceSystem: 'legacy_site', legacyId: { in: legacyIds } },
          select: {
            legacyId: true,
            productIdRelation: { select: { ssgId: true } },
          },
        })
      : [];
    const legacyOwners = new Map(
      existingLegacy.map((legacy) => [
        legacy.legacyId,
        legacy.productIdRelation.ssgId,
      ]),
    );
    const legacyIdsInFile = new Set<string>();
    const linksBySsgId = new Map<string, number>();
    data.legacy_links.forEach((link, index) => {
      const legacyId = value(link.legacy_id);
      const ssgId = value(link.ssg_id);
      linksBySsgId.set(ssgId, (linksBySsgId.get(ssgId) ?? 0) + 1);
      if (!legacyId) {
        return;
      }
      if (legacyIdsInFile.has(legacyId)) {
        addError(
          'Legacy links',
          index + 1,
          'legacy_id',
          'DUPLICATE_LEGACY_ID',
          ssgId,
        );
      }
      legacyIdsInFile.add(legacyId);
      const owner = legacyOwners.get(legacyId);
      if (owner && owner !== ssgId) {
        addError(
          'Legacy links',
          index + 1,
          'legacy_id',
          'LEGACY_ID_ALREADY_LINKED',
          ssgId,
        );
      }
    });
    for (const [ssgId, linkCount] of linksBySsgId) {
      if (linkCount > 1) {
        addError(
          'Legacy links',
          0,
          'legacy_id',
          'EQUIVALENCE_REVIEW_REQUIRED',
          ssgId,
        );
      }
    }

    const groupsById = new Map<string, ImportGroup>();
    const sourceProductsById = groupRowsBySsgId(sourceData.products);
    const sourceUnitsById = groupRowsBySsgId(sourceData.units);
    const sourceMaterialsById = groupRowsBySsgId(sourceData.materials);
    const sourceImagesById = groupRowsBySsgId(sourceData.images);
    const sourceLegacyLinksById = groupRowsBySsgId(sourceData.legacy_links);
    for (const ssgId of allSsgIds) {
      groupsById.set(ssgId, {
        ssgId,
        products: productRowsById.get(ssgId) ?? [],
        units: [],
        materials: [],
        images: [],
        legacyLinks: [],
        sourcePayload: {
          products: sourceProductsById.get(ssgId) ?? [],
          units: sourceUnitsById.get(ssgId) ?? [],
          materials: sourceMaterialsById.get(ssgId) ?? [],
          images: sourceImagesById.get(ssgId) ?? [],
          legacy_links: sourceLegacyLinksById.get(ssgId) ?? [],
        },
      });
    }
    for (const unit of data.units) {
      groupsById.get(value(unit.ssg_id))?.units.push(unit);
    }
    for (const material of data.materials) {
      groupsById.get(value(material.ssg_id))?.materials.push(material);
    }
    for (const image of data.images) {
      groupsById.get(value(image.ssg_id))?.images.push(image);
    }
    for (const link of data.legacy_links) {
      groupsById.get(value(link.ssg_id))?.legacyLinks.push(link);
    }
    const groups = [...groupsById.values()].sort((a, b) =>
      a.ssgId.localeCompare(b.ssgId),
    );
    const invalidGroups = new Set(
      errors
        .map((error) => error.ssg_id)
        .filter((ssgId) => groupsById.has(ssgId)),
    );
    const diffs = groups
      .filter((group) => group.products.length > 0 && isSsgId(group.ssgId))
      .map((group) =>
        buildDiff(group, existingProducts.get(group.ssgId)),
      );
    const errorsBySsgId = new Map<string, ImportFieldError[]>();
    for (const error of errors) {
      const current = errorsBySsgId.get(error.ssg_id) ?? [];
      current.push({
        sheet: error.sheet,
        row: error.row,
        field: error.field,
        code: error.code,
        message_key: error.message_key,
      });
      errorsBySsgId.set(error.ssg_id, current);
    }
    const report: ImportReport = {
      products_total: groups.length,
      ready: groups.filter((group) => !invalidGroups.has(group.ssgId)).length,
      invalid: invalidGroups.size,
      errors: errors.map((error) => ({
        sheet: error.sheet,
        row: error.row,
        field: error.field,
        code: error.code,
        message_key: error.message_key,
      })),
      diff: diffs,
    };
    return { groups, invalidGroups, productIds, errorsBySsgId, report };
  }

  private validateProductRow(
    product: ImportProductRowDto,
    row: number,
    addError: (
      sheet: string,
      row: number,
      field: string,
      code: string,
      ssgId: string | null | undefined,
    ) => void,
  ): void {
    const ssgId = value(product.ssg_id);
    if (!isOneOf(product.product_type, PRODUCT_TYPES)) {
      addError('Products', row, 'product_type', 'INVALID_PRODUCT_TYPE', ssgId);
    }
    if (!isOneOf(product.materials_state, COMPOSITION_STATES)) {
      addError(
        'Products',
        row,
        'materials_state',
        'INVALID_COMPOSITION_STATE',
        ssgId,
      );
    }
    if (!isOneOf(product.gemstones_state, COMPOSITION_STATES)) {
      addError(
        'Products',
        row,
        'gemstones_state',
        'INVALID_COMPOSITION_STATE',
        ssgId,
      );
    }
    if (
      product.product_type === 'loose_stone' &&
      nonBlank(product.jewellery_type)
    ) {
      addError(
        'Products',
        row,
        'jewellery_type',
        'FIELD_NOT_APPLICABLE',
        ssgId,
      );
    }
    if (
      product.requested_sales_mode !== undefined &&
      product.requested_sales_mode !== null &&
      !isOneOf(product.requested_sales_mode, SALES_MODES)
    ) {
      addError(
        'Products',
        row,
        'requested_sales_mode',
        'INVALID_SALES_MODE',
        ssgId,
      );
    }
    if (
      product.requested_price_visibility !== undefined &&
      product.requested_price_visibility !== null &&
      !isOneOf(product.requested_price_visibility, PRICE_VISIBILITIES)
    ) {
      addError(
        'Products',
        row,
        'requested_price_visibility',
        'INVALID_PRICE_VISIBILITY',
        ssgId,
      );
    }
    for (const [field, values] of [
      ['gemstone_codes', product.gemstone_codes],
      ['fulfilment_methods', product.fulfilment_methods],
      ['pickup_location_codes', product.pickup_location_codes],
    ] as const) {
      if (values && new Set(values).size !== values.length) {
        addError('Products', row, field, 'DUPLICATE_LIST_VALUE', ssgId);
      }
    }
    if (
      product.fulfilment_methods?.some(
        (method) => !isOneOf(method, FULFILMENT_METHODS),
      )
    ) {
      addError(
        'Products',
        row,
        'fulfilment_methods',
        'INVALID_FULFILMENT_METHOD',
        ssgId,
      );
    }
    if (
      product.delivery_scope &&
      !isOneOf(product.delivery_scope, ['bulgaria', 'selected_localities'])
    ) {
      addError(
        'Products',
        row,
        'delivery_scope',
        'INVALID_DELIVERY_SCOPE',
        ssgId,
      );
    }
    if (
      product.pickup_location_codes?.some(
        (location) => !isOneOf(location, LOCATIONS),
      )
    ) {
      addError(
        'Products',
        row,
        'pickup_location_codes',
        'INVALID_LOCATION',
        ssgId,
      );
    }
    if (
      product.delivery_scope === 'selected_localities' &&
      !product.delivery_locality_ids?.length
    ) {
      addError(
        'Products',
        row,
        'delivery_locality_ids',
        'LOCALITIES_REQUIRED',
        ssgId,
      );
    }
    if (
      product.delivery_scope !== 'selected_localities' &&
      product.delivery_locality_ids?.length
    ) {
      addError(
        'Products',
        row,
        'delivery_locality_ids',
        'FIELD_NOT_APPLICABLE',
        ssgId,
      );
    }
    if (
      product.delivery_scope &&
      !product.fulfilment_methods?.includes('delivery')
    ) {
      addError(
        'Products',
        row,
        'delivery_scope',
        'FIELD_NOT_APPLICABLE',
        ssgId,
      );
    }
    if (product.delivery_locality_ids?.length) {
      addError(
        'Products',
        row,
        'delivery_locality_ids',
        'LOCALITY_DIRECTORY_UNAVAILABLE',
        ssgId,
      );
    }
    if (
      product.fulfilment_methods?.includes('delivery') &&
      !product.delivery_scope
    ) {
      addError(
        'Products',
        row,
        'delivery_scope',
        'DELIVERY_SCOPE_REQUIRED',
        ssgId,
      );
    }
    if (
      product.fulfilment_methods?.includes('store_pickup') &&
      !product.pickup_location_codes?.length
    ) {
      addError(
        'Products',
        row,
        'pickup_location_codes',
        'PICKUP_LOCATIONS_REQUIRED',
        ssgId,
      );
    }
    if (
      !product.fulfilment_methods?.includes('store_pickup') &&
      product.pickup_location_codes?.length
    ) {
      addError(
        'Products',
        row,
        'pickup_location_codes',
        'FIELD_NOT_APPLICABLE',
        ssgId,
      );
    }
    if (
      product.legacy_published_at &&
      (!isPublicationDate(product.legacy_published_at) ||
        !nonBlank(product.legacy_published_source))
    ) {
      addError(
        'Products',
        row,
        'legacy_published_at',
        'PUBLICATION_EVIDENCE_REQUIRED',
        ssgId,
      );
    }
    if (
      !product.legacy_published_at &&
      nonBlank(product.legacy_published_source)
    ) {
      addError(
        'Products',
        row,
        'legacy_published_source',
        'PUBLICATION_DATE_REQUIRED',
        ssgId,
      );
    }
    for (const [field, text] of [
      ['name_bg', product.name_bg],
      ['name_en', product.name_en],
      ['description_bg', product.description_bg],
      ['description_en', product.description_en],
      ['change_reason_note', product.change_reason_note],
    ] as const) {
      if (text && /<\/?[a-z][^>]*>/i.test(text)) {
        addError('Products', row, field, 'HTML_NOT_ALLOWED', ssgId);
      }
    }
    if (
      product.change_reason_code &&
      !isOneOf(product.change_reason_code, [
        'damage',
        'data_check',
        'management_decision',
        'other',
      ])
    ) {
      addError(
        'Products',
        row,
        'change_reason_code',
        'INVALID_RESTRICTION_REASON',
        ssgId,
      );
    }
  }

  private validateUnitRows(
    units: ImportUnitRowDto[],
    products: Set<string>,
    productTypes: Map<string, string>,
    addError: (
      sheet: string,
      row: number,
      field: string,
      code: string,
      ssgId: string | null | undefined,
    ) => void,
  ): void {
    const seenBarcodes = new Set<string>();
    units.forEach((unit, index) => {
      const row = index + 1;
      const ssgId = value(unit.ssg_id);
      if (!products.has(ssgId)) {
        addError('Units', row, 'ssg_id', 'PRODUCT_NOT_IN_IMPORT', ssgId);
      }
      const barcode = value(unit.barcode);
      if (!isGenuineBarcode(barcode)) {
        addError('Units', row, 'barcode', 'INVALID_BARCODE', ssgId);
      }
      if (barcode && seenBarcodes.has(barcode)) {
        addError('Units', row, 'barcode', 'DUPLICATE_BARCODE', ssgId);
      }
      if (barcode) {
        seenBarcodes.add(barcode);
      }
      if (!nonBlank(unit.source_ref)) {
        addError('Units', row, 'source_ref', 'SOURCE_REQUIRED', ssgId);
      }
      if (unit.location_code && !isOneOf(unit.location_code, LOCATIONS)) {
        addError('Units', row, 'location_code', 'INVALID_LOCATION', ssgId);
      }
      if (unit.stock_status && !isOneOf(unit.stock_status, STOCK_STATUSES)) {
        addError('Units', row, 'stock_status', 'INVALID_STOCK_STATUS', ssgId);
      }
      if (
        unit.stock_status === 'reserved' &&
        !nonBlank(unit.reservation_reference)
      ) {
        addError(
          'Units',
          row,
          'reservation_reference',
          'RESERVATION_EVIDENCE_REQUIRED',
          ssgId,
        );
      }
      if (
        unit.stock_status === 'in_transit' &&
        (!nonBlank(unit.transfer_to) ||
          unit.transfer_to === unit.location_code ||
          !isOneOf(unit.transfer_to, LOCATIONS))
      ) {
        addError('Units', row, 'transfer_to', 'TRANSFER_EVIDENCE_REQUIRED', ssgId);
      }
      if (unit.stock_status !== 'in_transit' && nonBlank(unit.transfer_to)) {
        addError('Units', row, 'transfer_to', 'FIELD_NOT_APPLICABLE', ssgId);
      }
      if (unit.stock_status !== 'reserved' && nonBlank(unit.reservation_reference)) {
        addError(
          'Units',
          row,
          'reservation_reference',
          'FIELD_NOT_APPLICABLE',
          ssgId,
        );
      }
      if (unit.price !== undefined && unit.price !== null) {
        if (!isDecimal(unit.price, 2) || isZero(unit.price)) {
          addError('Units', row, 'price', 'INVALID_CURRENT_PRICE', ssgId);
        }
        if (!/^[A-Z]{3}$/.test(value(unit.currency))) {
          addError('Units', row, 'currency', 'CURRENCY_REQUIRED', ssgId);
        }
        if (!isPublicationDate(value(unit.verified_at))) {
          addError('Units', row, 'verified_at', 'VERIFICATION_REQUIRED', ssgId);
        }
      } else if (nonBlank(unit.currency)) {
        addError('Units', row, 'currency', 'PRICE_REQUIRED', ssgId);
      }
      for (const field of [
        'weight_g',
        'stone_weight_ct',
        'length_mm',
        'width_mm',
        'height_mm',
        'inner_diameter_mm',
        'circumference_mm',
      ] as const) {
        const amount = unit[field];
        if (
          amount !== undefined &&
          amount !== null &&
          (!isDecimal(amount, 3) || isZero(amount))
        ) {
          addError('Units', row, field, 'INVALID_MEASUREMENT', ssgId);
        }
      }
      if (
        nonBlank(unit.stone_weight_ct) &&
        productTypes.get(ssgId) !== 'loose_stone'
      ) {
        addError(
          'Units',
          row,
          'stone_weight_ct',
          'FIELD_NOT_APPLICABLE',
          ssgId,
        );
      }
      if (unit.verified_at && !isPublicationDate(unit.verified_at)) {
        addError('Units', row, 'verified_at', 'INVALID_DATE', ssgId);
      }
      if (unit.sale_json) {
        try {
          const sale = JSON.parse(unit.sale_json) as unknown;
          if (
            sale === null ||
            typeof sale !== 'object' ||
            Array.isArray(sale)
          ) {
            addError('Units', row, 'sale_json', 'INVALID_SALE_EVIDENCE', ssgId);
          }
        } catch {
          addError('Units', row, 'sale_json', 'INVALID_SALE_EVIDENCE', ssgId);
        }
      }
    });
  }

  private validateMaterialRows(
    materials: ImportMaterialRowDto[],
    products: Set<string>,
    addError: (
      sheet: string,
      row: number,
      field: string,
      code: string,
      ssgId: string | null | undefined,
    ) => void,
  ): void {
    const combinations = new Set<string>();
    materials.forEach((material, index) => {
      const ssgId = value(material.ssg_id);
      if (!products.has(ssgId)) {
        addError('Materials', index + 1, 'ssg_id', 'PRODUCT_NOT_IN_IMPORT', ssgId);
      }
      if (!nonBlank(material.material_code)) {
        addError('Materials', index + 1, 'material_code', 'FIELD_REQUIRED', ssgId);
      }
      const combination = [
        ssgId,
        value(material.material_code),
        value(material.fineness_code),
        value(material.gold_karat_code),
      ].join(':');
      if (combinations.has(combination)) {
        addError(
          'Materials',
          index + 1,
          'material_code',
          'DUPLICATE_MATERIAL',
          ssgId,
        );
      }
      combinations.add(combination);
      if (
        material.gold_karat_code &&
        material.material_code !== 'gold'
      ) {
        addError(
          'Materials',
          index + 1,
          'gold_karat_code',
          'FIELD_NOT_APPLICABLE',
          ssgId,
        );
      }
    });
  }

  private validateImageRows(
    images: ImportImageRowDto[],
    products: Set<string>,
    addError: (
      sheet: string,
      row: number,
      field: string,
      code: string,
      ssgId: string | null | undefined,
    ) => void,
  ): void {
    const releases = new Map<
      string,
      { mains: number; orders: Set<number> }
    >();
    images.forEach((image, index) => {
      const row = index + 1;
      const ssgId = value(image.ssg_id);
      if (!products.has(ssgId)) {
        addError('Images', row, 'ssg_id', 'PRODUCT_NOT_IN_IMPORT', ssgId);
      }
      if (!nonBlank(image.image_id) || !nonBlank(image.version)) {
        addError('Images', row, 'image_id', 'FIELD_REQUIRED', ssgId);
      }
      if (!isOneOf(image.role, IMAGE_ROLES)) {
        addError('Images', row, 'role', 'INVALID_IMAGE_ROLE', ssgId);
      }
      if (!image.sort_order || image.sort_order < 1) {
        addError('Images', row, 'sort_order', 'INVALID_SORT_ORDER', ssgId);
      }
      for (const field of [
        'original_relative_path',
        'webp_1600_path',
        'webp_800_path',
        'webp_400_path',
        'webp_200_path',
      ] as const) {
        const path = image[field];
        if (path && !isSafeRelativePath(path)) {
          addError('Images', row, field, 'UNSAFE_PATH', ssgId);
        }
      }
      if (
        image.processed_with_ai &&
        !isOneOf(image.processed_with_ai, ['yes', 'no'])
      ) {
        addError('Images', row, 'processed_with_ai', 'INVALID_BOOLEAN', ssgId);
      }
      if (
        image.on_model_illustrative &&
        !isOneOf(image.on_model_illustrative, ['yes', 'no'])
      ) {
        addError(
          'Images',
          row,
          'on_model_illustrative',
          'INVALID_BOOLEAN',
          ssgId,
        );
      }
      if (
        image.review_status &&
        !isOneOf(image.review_status, ['draft', 'rework', 'approved'])
      ) {
        addError('Images', row, 'review_status', 'INVALID_REVIEW_STATUS', ssgId);
      }
      const releaseKey = `${ssgId}:${value(image.version)}`;
      const release = releases.get(releaseKey) ?? {
        mains: 0,
        orders: new Set<number>(),
      };
      if (image.role === 'main') {
        release.mains += 1;
        if (image.sort_order !== 1) {
          addError('Images', row, 'sort_order', 'MAIN_MUST_BE_FIRST', ssgId);
        }
      }
      if (image.sort_order && release.orders.has(image.sort_order)) {
        addError('Images', row, 'sort_order', 'DUPLICATE_SORT_ORDER', ssgId);
      }
      if (image.sort_order) {
        release.orders.add(image.sort_order);
      }
      releases.set(releaseKey, release);
    });
    for (const [key, release] of releases) {
      if (release.mains !== 1) {
        const [ssgId] = key.split(':');
        addError('Images', 0, 'role', 'ONE_MAIN_IMAGE_REQUIRED', ssgId);
      }
    }
  }

  private validateLegacyRows(
    links: ImportLegacyLinkRowDto[],
    products: Set<string>,
    addError: (
      sheet: string,
      row: number,
      field: string,
      code: string,
      ssgId: string | null | undefined,
    ) => void,
  ): void {
    links.forEach((link, index) => {
      const row = index + 1;
      const ssgId = value(link.ssg_id);
      if (!products.has(ssgId)) {
        addError(
          'Legacy links',
          row,
          'ssg_id',
          'PRODUCT_NOT_IN_IMPORT',
          ssgId,
        );
      }
      if (!nonBlank(link.legacy_id) || !nonBlank(link.source_ref)) {
        addError('Legacy links', row, 'legacy_id', 'FIELD_REQUIRED', ssgId);
      }
      for (const field of ['legacy_url_bg', 'legacy_url_en'] as const) {
        const url = link[field];
        if (url && !isHttpUrl(url)) {
          addError('Legacy links', row, field, 'INVALID_URL', ssgId);
        }
      }
      if (
        link.historical_price !== undefined &&
        link.historical_price !== null &&
        !isDecimal(link.historical_price, 2)
      ) {
        addError(
          'Legacy links',
          row,
          'historical_price',
          'INVALID_HISTORICAL_PRICE',
          ssgId,
        );
      }
      if (
        link.historical_price !== undefined &&
        link.historical_price !== null &&
        !/^[A-Z]{3}$/.test(value(link.historical_currency))
      ) {
        addError(
          'Legacy links',
          row,
          'historical_currency',
          'CURRENCY_REQUIRED',
          ssgId,
        );
      }
    });
  }

  private validateDictionaries(
    data: ImportProductPayloadDto,
    dictionaryCodes: Map<string, string[]>,
    addError: (
      sheet: string,
      row: number,
      field: string,
      code: string,
      ssgId: string | null | undefined,
    ) => void,
  ): void {
    const check = (
      group: string,
      code: string | null | undefined,
      sheet: string,
      row: number,
      field: string,
      ssgId: string | null | undefined,
      appliesTo?: string,
    ): void => {
      if (!nonBlank(code)) {
        return;
      }
      const applies = dictionaryCodes.get(`${group}:${code}`);
      if (!applies || (appliesTo && applies.length > 0 && !applies.includes(appliesTo))) {
        addError(sheet, row, field, 'UNKNOWN_OR_INAPPLICABLE_CODE', ssgId);
      }
    };

    data.products.forEach((product, index) => {
      const row = index + 1;
      const ssgId = value(product.ssg_id);
      check('product_type', product.product_type, 'Products', row, 'product_type', ssgId);
      check(
        'jewellery_type',
        product.jewellery_type,
        'Products',
        row,
        'jewellery_type',
        ssgId,
        product.product_type ?? undefined,
      );
      check(
        'restriction_reason',
        product.change_reason_code,
        'Products',
        row,
        'change_reason_code',
        ssgId,
      );
      for (const [offset, code] of (product.gemstone_codes ?? []).entries()) {
        check('gemstone', code, 'Products', row, `gemstone_codes.${offset}`, ssgId);
      }
    });
    data.materials.forEach((material, index) => {
      const row = index + 1;
      const ssgId = value(material.ssg_id);
      check('material', material.material_code, 'Materials', row, 'material_code', ssgId);
      check(
        'fineness',
        material.fineness_code,
        'Materials',
        row,
        'fineness_code',
        ssgId,
        material.material_code
          ? `material.${material.material_code}`
          : undefined,
      );
      check(
        'gold_karat',
        material.gold_karat_code,
        'Materials',
        row,
        'gold_karat_code',
        ssgId,
        'material.gold',
      );
    });
  }

  private toResult(batch: {
    id: string;
    state: ImportState;
    report: Prisma.JsonValue;
    from_ImportProductRow_batchId: {
      ssgId: string;
      state: ImportRowState;
      productId: string | null;
    }[];
  }): ImportResult {
    return {
      batch_id: batch.id,
      state: batch.state,
      report: parseReport(batch.report),
      products: batch.from_ImportProductRow_batchId.map((row) => ({
        ssg_id: row.ssgId,
        state: row.state,
        product_id: row.productId,
      })),
    };
  }
}

function normalizePayload(
  payload: ImportProductPayloadDto,
): ImportProductPayloadDto {
  const normalizeRow = <T extends object>(row: T): T => {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(row)) {
      if (typeof item === 'string') {
        result[key] = item.normalize('NFC').trim();
      } else if (Array.isArray(item)) {
        result[key] = item.map((value) =>
          typeof value === 'string' ? value.normalize('NFC').trim() : value,
        );
      } else {
        result[key] = item;
      }
    }
    return result as T;
  };
  return {
    products: payload.products.map(normalizeRow),
    units: payload.units.map(normalizeRow),
    materials: payload.materials.map(normalizeRow),
    images: payload.images.map(normalizeRow),
    legacy_links: payload.legacy_links.map(normalizeRow),
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const serialized = JSON.stringify(value);
    return serialized ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .filter((key) => object[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(',')}}`;
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  if (value === null) {
    throw new Error('Top-level JSON value cannot be null');
  }
  if (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => toJsonNestedValue(item));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, toJsonNestedValue(item)]),
    );
  }
  throw new Error('Import data is not JSON serializable');
}

function toJsonNestedValue(
  value: unknown,
): Prisma.InputJsonValue | null {
  return value === null ? null : toJsonValue(value);
}

function groupPayload(group: ImportGroup): object {
  return group.sourcePayload;
}

function groupRowsBySsgId<T extends { ssg_id: string }>(
  rows: T[],
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const ssgId = row.ssg_id.normalize('NFC').trim();
    const current = grouped.get(ssgId) ?? [];
    current.push(row);
    grouped.set(ssgId, current);
  }
  return grouped;
}

function parseReport(value: Prisma.JsonValue): ImportReport {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('Stored import report is invalid');
  }
  const report = value as { [key: string]: Prisma.JsonValue };
  if (
    typeof report.products_total !== 'number' ||
    typeof report.ready !== 'number' ||
    typeof report.invalid !== 'number' ||
    !Array.isArray(report.errors) ||
    !Array.isArray(report.diff)
  ) {
    throw new Error('Stored import report is invalid');
  }
  const errors = report.errors.map((item) => {
    if (item === null || Array.isArray(item) || typeof item !== 'object') {
      throw new Error('Stored import report is invalid');
    }
    const error = item as { [key: string]: Prisma.JsonValue };
    if (
      typeof error.sheet !== 'string' ||
      typeof error.row !== 'number' ||
      typeof error.field !== 'string' ||
      typeof error.code !== 'string' ||
      typeof error.message_key !== 'string'
    ) {
      throw new Error('Stored import report is invalid');
    }
    return {
      sheet: error.sheet,
      row: error.row,
      field: error.field,
      code: error.code,
      message_key: error.message_key,
    };
  });
  const diff = report.diff.map((item) => {
    if (item === null || Array.isArray(item) || typeof item !== 'object') {
      throw new Error('Stored import report is invalid');
    }
    const entry = item as { [key: string]: Prisma.JsonValue };
    if (
      typeof entry.ssg_id !== 'string' ||
      !isOneOf(entry.operation, ['create_draft', 'update_draft', 'unchanged']) ||
      !Array.isArray(entry.changed_fields) ||
      !entry.changed_fields.every((field) => typeof field === 'string')
    ) {
      throw new Error('Stored import report is invalid');
    }
    return {
      ssg_id: entry.ssg_id,
      operation: entry.operation,
      changed_fields: entry.changed_fields,
    };
  });
  return {
    products_total: report.products_total,
    ready: report.ready,
    invalid: report.invalid,
    errors,
    diff,
  };
}

function buildDiff(
  group: ImportGroup,
  existing: ExistingProduct | undefined,
): ImportDiff {
  const ssgId = group.ssgId;
  const input = group.products[0];
  if (!input) {
    return { ssg_id: ssgId, operation: 'unchanged', changed_fields: [] };
  }
  const hasGenuineBarcode = group.units.some((unit) =>
    isGenuineBarcode(value(unit.barcode)),
  );
  const proposedSalesMode = hasGenuineBarcode
    ? input.requested_sales_mode ?? 'enquiry_only'
    : 'archive_catalogue';
  const proposedPriceVisibility =
    proposedSalesMode === 'archive_catalogue'
      ? 'hidden'
      : (input.requested_price_visibility ?? 'hidden');
  if (!existing) {
    return {
      ssg_id: ssgId,
      operation: 'create_draft',
      changed_fields: [
        ...Object.keys(input).filter((key) => key !== 'ssg_id'),
        'materials',
        'sales_mode',
        'price_visibility',
      ],
    };
  }
  const revision = existing.currentRevisionIdRelation;
  const translations = new Map(
    revision?.from_ProductTranslation_revisionId.map((row) => [
      row.locale,
      row,
    ]) ?? [],
  );
  const actual: Record<string, unknown> = {
    product_type: existing.productType,
    jewellery_type: revision?.jewelleryTypeIdRelation?.code ?? null,
    name_bg: translations.get('bg')?.name ?? null,
    name_en: translations.get('en')?.name ?? null,
    description_bg: translations.get('bg')?.description ?? null,
    description_en: translations.get('en')?.description ?? null,
    materials_state: revision?.materialsState ?? null,
    gemstones_state: revision?.gemstonesState ?? null,
    requested_sales_mode: revision?.salesMode ?? null,
    requested_price_visibility: revision?.priceVisibility ?? null,
    fulfilment_methods: revision?.fulfilmentMethods ?? [],
    delivery_scope: revision?.deliveryScope ?? null,
    delivery_locality_ids: revision?.deliveryLocalityIds ?? [],
    pickup_location_codes: revision?.pickupLocationCodes ?? [],
    gemstone_codes:
      revision?.from_RevisionGemstone_revisionId
        .map((row) => row.gemstoneIdRelation.code)
        .sort() ?? [],
    materials:
      revision?.from_RevisionMaterial_revisionId
        .map((row) => ({
          material_code: row.materialIdRelation.code,
          fineness_code: row.finenessIdRelation?.code ?? null,
          gold_karat_code: row.goldKaratIdRelation?.code ?? null,
        }))
        .sort((left, right) =>
          canonicalJson(left).localeCompare(canonicalJson(right)),
        ) ?? [],
  };
  const desired: Record<string, unknown> = {
    product_type: input.product_type,
    jewellery_type: input.jewellery_type,
    name_bg: input.name_bg,
    name_en: input.name_en,
    description_bg: input.description_bg,
    description_en: input.description_en,
    materials_state: input.materials_state,
    gemstones_state: input.gemstones_state,
    requested_sales_mode: proposedSalesMode,
    requested_price_visibility: proposedPriceVisibility,
    fulfilment_methods: input.fulfilment_methods,
    delivery_scope: input.delivery_scope,
    delivery_locality_ids: input.delivery_locality_ids,
    pickup_location_codes: input.pickup_location_codes,
    gemstone_codes: input.gemstone_codes,
    materials: group.materials.map((material) => ({
      material_code: material.material_code,
      fineness_code: material.fineness_code ?? null,
      gold_karat_code: material.gold_karat_code ?? null,
    })),
  };
  const changedFields = Object.keys(desired).filter((field) => {
    const incoming = desired[field];
    if (incoming === undefined) {
      return false;
    }
    const actualValue = actual[field];
    if (Array.isArray(incoming) && Array.isArray(actualValue)) {
      const sortedIncoming = [...incoming].sort((left, right) =>
        canonicalJson(left).localeCompare(canonicalJson(right)),
      );
      const sortedActual = [...actualValue].sort((left, right) =>
        canonicalJson(left).localeCompare(canonicalJson(right)),
      );
      return canonicalJson(sortedIncoming) !== canonicalJson(sortedActual);
    }
    return canonicalJson(incoming) !== canonicalJson(actualValue);
  });
  return {
    ssg_id: ssgId,
    operation: changedFields.length ? 'update_draft' : 'unchanged',
    changed_fields: changedFields,
  };
}

function isSsgId(value: string): boolean {
  return /^SSG-\d{6,}$/.test(value);
}

function value(value: string | null | undefined): string {
  return value ?? '';
}

function nonBlank(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function isOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T {
  return typeof value === 'string' && allowed.includes(value as T);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function isDecimal(value: string, scale: 2 | 3): boolean {
  const pattern =
    scale === 2 ? /^\d{1,10}(?:\.\d{1,2})?$/ : /^\d{1,9}(?:\.\d{1,3})?$/;
  return pattern.test(value);
}

function isZero(value: string): boolean {
  return /^0(?:\.0+)?$/.test(value);
}

function isPublicationDate(value: string): boolean {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return isValidCalendarDate(value);
  }
  if (!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    return false;
  }
  return isValidCalendarDate(value.slice(0, 10)) && !Number.isNaN(Date.parse(value));
}

function isValidCalendarDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) {
    return false;
  }
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function isSafeRelativePath(value: string): boolean {
  const hasControlCharacter = Array.from(value).some(
  (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
  );
  if (
  !value ||
  value.startsWith('/') ||
  value.includes('\\') ||
  /[%?#]/.test(value) ||
  hasControlCharacter ||
    /^[a-z][a-z\d+.-]*:/i.test(value)
  ) {
    return false;
  }
  return value.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      ['http:', 'https:'].includes(parsed.protocol) &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { createHash, randomUUID } from 'node:crypto';
import { validateSync } from 'class-validator';
import { Prisma } from '../../../generated/prisma/client';
import type {
  CompositionState,
  DeliveryScope,
  FulfilmentMethod,
  ImportRowState,
  ImportState,
  LocationCode,
  PriceVisibility,
  ProductType,
  RestrictionReason,
  SalesMode,
} from '../../../generated/prisma/enums';
import { PrismaService } from '../../database/prisma.service';
import { isGenuineBarcode } from '../../common/stock-facts/barcode';
import type {
  ImportCommitRequestDto,
  ImportProductPayloadDto,
} from './import.dto';
import type { ImportResult } from './catalogue-import.service';
import { ImportProductPayloadDto as ImportProductPayloadClass } from './import.dto';

interface ImportError {
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
  errors: ImportError[];
  diff: ImportDiff[];
}

interface StagedProduct {
  id: string;
  ssgId: string;
  state: ImportRowState;
  productId: string | null;
  payload: Prisma.JsonValue;
  errors: Prisma.JsonValue;
}

interface CommitGroupOutcome {
  ssg_id: string;
  state: ImportRowState;
  product_id: string | null;
}

interface CommitResult {
  result: ImportResult;
  statusCode: 200 | 409;
}

interface ActionClaim {
  id: string;
  payloadHash: string;
  state: string;
  result: Prisma.JsonValue | null;
  created: boolean;
}

interface MaterialMapping {
  materialId: string;
  finenessId: string | null;
  goldKaratId: string | null;
}

interface CommitPayload {
  request_id: string;
  ssg_ids: string[];
  expected_product_versions: { ssg_id: string; version: number | null }[];
}

class CommitFailure extends Error {
  constructor(
    readonly field: string,
    readonly code: string,
    readonly messageKey = 'errors.version_conflict',
  ) {
    super(code);
  }
}

const PRODUCT_TYPES = ['jewellery', 'loose_stone'];
const COMPOSITION_STATES = ['unknown', 'none', 'known'];
const SALES_MODES = [
  'direct_purchase',
  'enquiry_only',
  'archive_catalogue',
];
const PRICE_VISIBILITIES = ['visible', 'hidden'];
const FULFILMENT_METHODS = ['delivery', 'store_pickup'];
const DELIVERY_SCOPES = ['bulgaria', 'selected_localities'];
const LOCATION_CODES = ['sofia', 'nessebar'];
const RESTRICTION_REASONS = [
  'damage',
  'data_check',
  'management_decision',
  'other',
];
@Injectable()
export class CatalogueImportCommitService {
  private readonly logger = new Logger(CatalogueImportCommitService.name);

  constructor(private readonly prisma: PrismaService) {}

  async commit(
    actorId: string,
    batchId: string,
    request: ImportCommitRequestDto,
  ): Promise<CommitResult> {
    const payload = this.normalizeCommitPayload(request);
    const payloadHash = createHash('sha256')
      .update(canonicalJson(payload))
      .digest('hex');
    const scopeKey = `catalogue-import-commit:${actorId}:${batchId}`;

    try {
      const claim = await this.claimAction(
        scopeKey,
        request.request_id,
        payloadHash,
      );
      if (claim.state === 'committed' || claim.state === 'rejected') {
        return this.readStoredResult(claim.result);
      }

      await this.assertSelection(actorId, batchId, payload, !claim.created);
      for (const ssgId of payload.ssg_ids) {
        await this.commitProduct(
          actorId,
          batchId,
          ssgId,
          payload,
          !claim.created,
        );
      }

      const result = await this.readImportResult(actorId, batchId);
      const statusCode = result.report.errors.some(
        (error) => error.sheet === 'Commit',
      )
        ? 409
        : 200;
      await this.finishAction(claim.id, statusCode, result);
      return { result, statusCode };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException ||
        error instanceof NotFoundException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError ||
        error instanceof Prisma.PrismaClientUnknownRequestError ||
        error instanceof Prisma.PrismaClientInitializationError
      ) {
        const code =
          error instanceof Prisma.PrismaClientKnownRequestError
            ? ` (Prisma ${error.code})`
            : '';
        this.logger.warn(`Catalogue import commit storage is unavailable${code}`);
        throw new ServiceUnavailableException({
          code: 'TEMPORARY_UNAVAILABLE',
          message_key: 'errors.temporary_unavailable',
        });
      }
      throw error;
    }
  }

  private normalizeCommitPayload(
    request: ImportCommitRequestDto,
  ): CommitPayload {
    const ssgIds = request.ssg_ids.map((value) =>
      value.normalize('NFC').trim(),
    );
    if (new Set(ssgIds).size !== ssgIds.length) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message_key: 'errors.validation',
      });
    }
    const expectedVersions = request.expected_product_versions.map(
      (entry) => ({
        ssg_id: entry.ssg_id.normalize('NFC').trim(),
        version: entry.version ?? null,
      }),
    );
    const expectedIds = expectedVersions.map((entry) => entry.ssg_id);
    if (
      new Set(expectedIds).size !== expectedIds.length ||
      canonicalJson([...ssgIds].sort()) !==
        canonicalJson([...expectedIds].sort())
    ) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message_key: 'errors.validation',
      });
    }
    return {
      request_id: request.request_id,
      ssg_ids: [...ssgIds].sort(),
      expected_product_versions: expectedVersions.sort((left, right) =>
        left.ssg_id.localeCompare(right.ssg_id),
      ),
    };
  }

  private async claimAction(
    scopeKey: string,
    requestId: string,
    payloadHash: string,
  ): Promise<ActionClaim> {
    return this.prisma.$transaction(
      async (transaction) => {
        const inserted = await transaction.actionRequest.createMany({
          data: [
            {
              id: randomUUID(),
              scopeKey,
              requestId,
              payloadHash,
            },
          ],
          skipDuplicates: true,
        });
        const claims = await transaction.$queryRaw<
          Omit<ActionClaim, 'created'>[]
        >`
          SELECT id, "payloadHash", state::text, result
          FROM "ActionRequest"
          WHERE "scopeKey" = ${scopeKey} AND "requestId" = ${requestId}
          FOR UPDATE
        `;
        const claim = claims[0];
        if (!claim) {
          throw new Error('Import commit action claim is unavailable');
        }
        if (claim.payloadHash !== payloadHash) {
          throw new ConflictException({
            code: 'REQUEST_PAYLOAD_MISMATCH',
            message_key: 'errors.request_payload_mismatch',
          });
        }
        return { ...claim, created: inserted.count === 1 };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 10000,
      },
    );
  }

  private async assertSelection(
    actorId: string,
    batchId: string,
    payload: CommitPayload,
    allowResumedGroups: boolean,
  ): Promise<void> {
    const batch = await this.prisma.importBatch.findFirst({
      where: { id: batchId, actorId },
      select: {
        id: true,
        state: true,
        from_ImportProductRow_batchId: {
          where: { ssgId: { in: payload.ssg_ids } },
          select: { ssgId: true, state: true },
        },
      },
    });
    if (!batch) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message_key: 'errors.not_found',
      });
    }
    const rowsById = new Map(
      batch.from_ImportProductRow_batchId.map((row) => [row.ssgId, row]),
    );
    if (
      payload.ssg_ids.some((ssgId) => {
        const row = rowsById.get(ssgId);
        return (
          !row ||
          (row.state !== 'ready' &&
            !(allowResumedGroups && ['committed', 'invalid'].includes(row.state)))
        );
      })
    ) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message_key: 'errors.validation',
      });
    }
  }

  private async commitProduct(
    actorId: string,
    batchId: string,
    ssgId: string,
    payload: CommitPayload,
    allowResumedGroups: boolean,
  ): Promise<void> {
    try {
      await this.prisma.$transaction(
        async (transaction) => {
          await transaction.$queryRaw<{ id: string }[]>`
            SELECT id FROM "ImportBatch"
            WHERE id = ${batchId}::uuid AND "actorId" = ${actorId}::uuid
            FOR UPDATE
          `;
          const rows = await transaction.$queryRaw<StagedProduct[]>`
            SELECT id, "ssgId", state::text, "productId", payload, errors
            FROM "ImportProductRow"
            WHERE "batchId" = ${batchId}::uuid AND "ssgId" = ${ssgId}
            FOR UPDATE
          `;
          const row = rows[0];
          if (!row) {
            throw new NotFoundException({
              code: 'NOT_FOUND',
              message_key: 'errors.not_found',
            });
          }
          if (row.state === 'committed' || row.state === 'invalid') {
            if (allowResumedGroups) {
              return;
            }
            throw new ConflictException({
              code: 'PRODUCT_NOT_READY',
              message_key: 'errors.validation',
            });
          }
          if (row.state !== 'ready') {
            throw new CommitFailure('ssg_id', 'PRODUCT_NOT_READY');
          }

          const stagedPayload = this.readStagedPayload(row.payload, row.ssgId);
          const productRow = stagedPayload.products[0];
          if (!productRow) {
            throw new CommitFailure('ssg_id', 'PRODUCT_ROW_MISSING');
          }
          const expectedVersion = payload.expected_product_versions.find(
            (entry) => entry.ssg_id === ssgId,
          )?.version;
          const productId = await this.persistProduct(
            transaction,
            actorId,
            batchId,
            row,
            productRow,
            stagedPayload,
            expectedVersion ?? null,
          );
          await transaction.importProductRow.update({
            where: { id: row.id },
            data: {
              state: 'committed',
              productId,
              errors: [],
            },
          });
          await this.updateBatchSummary(transaction, batchId);
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 15000,
        },
      );
    } catch (error) {
      if (error instanceof CommitFailure) {
        await this.recordFailure(batchId, ssgId, error);
        return;
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        await this.recordFailure(
          batchId,
          ssgId,
          new CommitFailure('ssg_id', 'IDENTITY_OR_MAPPING_CONFLICT'),
        );
        return;
      }
      throw error;
    }
  }

  private readStagedPayload(
    value: Prisma.JsonValue,
    ssgId: string,
  ): ImportProductPayloadDto {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new CommitFailure('payload', 'STAGED_PAYLOAD_INVALID');
    }
    const raw = value as Record<string, unknown>;
    if (
      !Array.isArray(raw.products) ||
      !Array.isArray(raw.units) ||
      !Array.isArray(raw.materials) ||
      !Array.isArray(raw.images) ||
      !Array.isArray(raw.legacy_links)
    ) {
      throw new CommitFailure('payload', 'STAGED_PAYLOAD_INVALID');
    }
    const payload = plainToInstance(ImportProductPayloadClass, raw);
    const validationErrors = validateSync(payload, {
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
    });
    if (
      validationErrors.length > 0 ||
      payload.products.length !== 1 ||
      payload.products[0]?.ssg_id !== ssgId ||
      [...payload.products, ...payload.units, ...payload.materials,
        ...payload.images, ...payload.legacy_links]
        .some((row) => row.ssg_id !== ssgId)
    ) {
      throw new CommitFailure('payload', 'STAGED_PAYLOAD_INVALID');
    }
    return payload;
  }

  private async persistProduct(
    transaction: Prisma.TransactionClient,
    actorId: string,
    batchId: string,
    stagedRow: StagedProduct,
    input: ImportProductPayloadDto['products'][number],
    stagedPayload: ImportProductPayloadDto,
    expectedVersion: number | null,
  ): Promise<string> {
    if (!isProductType(input.product_type)) {
      throw new CommitFailure('product_type', 'INVALID_PRODUCT_TYPE');
    }
    if (!isCompositionState(input.materials_state)) {
      throw new CommitFailure('materials_state', 'INVALID_COMPOSITION_STATE');
    }
    if (!isCompositionState(input.gemstones_state)) {
      throw new CommitFailure('gemstones_state', 'INVALID_COMPOSITION_STATE');
    }

    const product = await transaction.product.findUnique({
      where: { ssgId: stagedRow.ssgId },
      select: {
        id: true,
        version: true,
        productType: true,
        publicationStatus: true,
        currentRevisionId: true,
      },
    });
    if (
      (product === null && expectedVersion !== null) ||
      (product !== null && expectedVersion !== product.version)
    ) {
      throw new CommitFailure('version', 'VERSION_CONFLICT');
    }
    if (product && product.productType !== input.product_type) {
      throw new CommitFailure('product_type', 'PRODUCT_TYPE_IMMUTABLE');
    }

    const dictionaries = await this.resolveDictionaries(
      transaction,
      input,
      stagedPayload,
    );
    const stagedBarcodes = stagedPayload.units.map(
      (unit) => unit.barcode?.trim() ?? '',
    );
    if (
      stagedPayload.units.some(
        (unit) => !isGenuineBarcode(unit.barcode?.trim() ?? '') ||
          !unit.source_ref?.trim(),
      ) ||
      new Set(stagedBarcodes).size !== stagedBarcodes.length
    ) {
      throw new CommitFailure('barcode', 'STAGED_UNIT_INVALID');
    }
    const existingBarcodeCount = product
      ? await transaction.barcodeIdentity.count({
          where: { productId: product.id },
        })
      : 0;
    const hasBarcode = stagedBarcodes.length > 0 || existingBarcodeCount > 0;

    const revisionDefaultsSelect = {
      id: true,
      revisionNumber: true,
      jewelleryTypeId: true,
      salesMode: true,
      priceVisibility: true,
      fulfilmentMethods: true,
      deliveryScope: true,
      deliveryLocalityIds: true,
      pickupLocationCodes: true,
      changeReason: true,
      changeNote: true,
    } satisfies Prisma.ProductRevisionSelect;
    const revisionDraft = product
      ? await transaction.productRevision.findFirst({
          where: { productId: product.id, state: 'draft' },
          select: revisionDefaultsSelect,
        })
      : null;
    const currentRevision = product?.currentRevisionId
      ? await transaction.productRevision.findUnique({
          where: { id: product.currentRevisionId },
          select: revisionDefaultsSelect,
        })
      : null;
    const latestRevision = product
      ? await transaction.productRevision.findFirst({
          where: { productId: product.id },
          orderBy: { revisionNumber: 'desc' },
          select: { revisionNumber: true },
        })
      : null;
    const baseRevision = revisionDraft ?? currentRevision;
    const salesMode = hasBarcode
      ? parseSalesMode(input.requested_sales_mode ?? baseRevision?.salesMode)
      : 'archive_catalogue';
    const priceVisibility =
      salesMode === 'archive_catalogue'
        ? 'hidden'
        : parsePriceVisibility(
            input.requested_price_visibility ??
              baseRevision?.priceVisibility,
          );
    const restrictionReason: RestrictionReason | null = hasBarcode
      ? input.change_reason_code === undefined
        ? baseRevision?.changeReason ?? null
        : parseRestrictionReason(input.change_reason_code)
      : 'data_check';

    const productRecord = product
      ? await transaction.product.update({
          where: { id: product.id },
          data: { version: { increment: 1 } },
          select: { id: true },
        })
      : await transaction.product.create({
          data: {
            ssgId: stagedRow.ssgId,
            productType: input.product_type,
            publicationStatus: 'draft',
            isLegacyMigration: true,
          },
          select: { id: true },
        });

    const revisionData = {
      jewelleryTypeId:
        input.jewellery_type === undefined
          ? baseRevision?.jewelleryTypeId ?? null
          : dictionaries.jewelleryTypeId,
      materialsState: input.materials_state,
      gemstonesState: input.gemstones_state,
      salesMode,
      priceVisibility,
      fulfilmentMethods:
        input.fulfilment_methods === undefined
          ? baseRevision?.fulfilmentMethods ?? []
          : parseFulfilmentMethods(input.fulfilment_methods),
      deliveryScope:
        input.delivery_scope === undefined
          ? baseRevision?.deliveryScope ?? null
          : parseDeliveryScope(input.delivery_scope),
      deliveryLocalityIds:
        input.delivery_locality_ids === undefined
          ? baseRevision?.deliveryLocalityIds ?? []
          : input.delivery_locality_ids,
      pickupLocationCodes:
        input.pickup_location_codes === undefined
          ? baseRevision?.pickupLocationCodes ?? []
          : parseLocationCodes(input.pickup_location_codes),
      changeReason: hasBarcode
        ? input.change_reason_code === undefined
          ? baseRevision?.changeReason ?? null
          : restrictionReason
        : 'data_check',
      changeNote:
        input.change_reason_note === undefined
          ? baseRevision?.changeNote ?? null
          : input.change_reason_note,
      createdById: actorId,
      state: 'draft' as const,
    };

    const revision = revisionDraft
      ? await transaction.productRevision.update({
          where: { id: revisionDraft.id },
          data: revisionData,
          select: { id: true },
        })
      : await transaction.productRevision.create({
          data: {
            productId: productRecord.id,
            revisionNumber: (latestRevision?.revisionNumber ?? 0) + 1,
            ...revisionData,
          },
          select: { id: true },
        });

    if (!revisionDraft && product?.currentRevisionId) {
      const currentChildren = await transaction.productRevision.findUnique({
        where: { id: product.currentRevisionId },
        select: {
          from_RevisionMaterial_revisionId: {
            select: { materialId: true, finenessId: true, goldKaratId: true },
          },
          from_ProductTranslation_revisionId: {
            select: {
              locale: true,
              name: true,
              description: true,
              slug: true,
              firstPublishedAt: true,
              firstPublishedDate: true,
              publicationEvidence: true,
              publicModifiedAt: true,
            },
          },
          from_RevisionGemstone_revisionId: {
            select: { gemstoneId: true },
          },
        },
      });
      for (const material of currentChildren?.from_RevisionMaterial_revisionId ?? []) {
        await transaction.revisionMaterial.create({
          data: { revisionId: revision.id, ...material },
        });
      }
      for (const translation of currentChildren?.from_ProductTranslation_revisionId ?? []) {
        await transaction.productTranslation.create({
          data: { revisionId: revision.id, ...translation },
        });
      }
      for (const gemstone of currentChildren?.from_RevisionGemstone_revisionId ?? []) {
        await transaction.revisionGemstone.create({
          data: { revisionId: revision.id, ...gemstone },
        });
      }
    }

    await this.persistTranslations(
      transaction,
      revision.id,
      input,
      product !== null,
    );
    await this.persistMaterials(
      transaction,
      revision.id,
      dictionaries.materialMappings,
      input.materials_state,
    );
    await this.persistGemstones(
      transaction,
      revision.id,
      input.gemstone_codes ?? [],
      dictionaries.gemstoneIds,
      input.gemstones_state,
    );
    await this.persistImages(
      transaction,
      productRecord.id,
      revision.id,
      stagedPayload,
      revisionDraft !== null,
    );
    await this.persistLegacyReferences(
      transaction,
      productRecord.id,
      stagedPayload,
    );
    await this.claimBarcodes(
      transaction,
      productRecord.id,
      stagedBarcodes,
    );

    await transaction.auditEvent.create({
      data: {
        actorId,
        action: 'catalogue_import_commit',
        subjectType: 'Product',
        subjectId: productRecord.id,
        reason: restrictionReason,
        note: input.change_reason_note ?? null,
        after: {
          batch_id: batchId,
          ssg_id: stagedRow.ssgId,
          revision_id: revision.id,
          publication_status: product?.publicationStatus ?? 'draft',
          sales_mode: salesMode,
        },
        eventKey: `catalogue-import-commit:${batchId}:${stagedRow.ssgId}`,
      },
    });
    return productRecord.id;
  }

  private async resolveDictionaries(
    transaction: Prisma.TransactionClient,
    input: ImportProductPayloadDto['products'][number],
    payload: ImportProductPayloadDto,
  ): Promise<{
    jewelleryTypeId: string | null;
    materialMappings: MaterialMapping[];
    gemstoneIds: Map<string, string>;
  }> {
    const entries = await transaction.dictionaryEntry.findMany({
      where: { active: true },
      select: { id: true, group: true, code: true, appliesTo: true },
    });
    const dictionary = new Map(
      entries.map((entry) => [`${entry.group}:${entry.code}`, entry]),
    );
    const lookup = (group: string, code: string | null | undefined) => {
      if (!code) {
        return null;
      }
      const entry = dictionary.get(`${group}:${code}`);
      if (!entry) {
        throw new CommitFailure('dictionary', 'DICTIONARY_ENTRY_UNAVAILABLE');
      }
      return entry;
    };
    lookup('product_type', input.product_type);
    if (input.change_reason_code) {
      lookup('restriction_reason', input.change_reason_code);
    }
    const requireApplicable = (
      group: string,
      code: string | null | undefined,
      appliesTo?: string,
    ) => {
      const entry = lookup(group, code);
      if (
        entry &&
        appliesTo &&
        entry.appliesTo.length > 0 &&
        !entry.appliesTo.includes(appliesTo)
      ) {
        throw new CommitFailure('dictionary', 'DICTIONARY_ENTRY_UNAVAILABLE');
      }
      return entry;
    };

    const jewelleryType = requireApplicable(
      'jewellery_type',
      input.jewellery_type,
      input.product_type ?? undefined,
    );
    const materialMappings: MaterialMapping[] = [];
    for (const material of payload.materials) {
      const materialEntry = lookup('material', material.material_code);
      if (!materialEntry) {
        throw new CommitFailure('material_code', 'DICTIONARY_ENTRY_UNAVAILABLE');
      }
      const fineness = requireApplicable(
        'fineness',
        material.fineness_code,
        material.material_code
          ? `material.${material.material_code}`
          : undefined,
      );
      const goldKarat = requireApplicable(
        'gold_karat',
        material.gold_karat_code,
        'material.gold',
      );
      materialMappings.push({
        materialId: materialEntry.id,
        finenessId: fineness?.id ?? null,
        goldKaratId: goldKarat?.id ?? null,
      });
    }
    const gemstoneIds = new Map<string, string>();
    for (const code of input.gemstone_codes ?? []) {
      const entry = lookup('gemstone', code);
      if (!entry) {
        throw new CommitFailure('gemstone_codes', 'DICTIONARY_ENTRY_UNAVAILABLE');
      }
      gemstoneIds.set(code, entry.id);
    }
    return {
      jewelleryTypeId: jewelleryType?.id ?? null,
      materialMappings,
      gemstoneIds,
    };
  }

  private async persistTranslations(
    transaction: Prisma.TransactionClient,
    revisionId: string,
    input: ImportProductPayloadDto['products'][number],
    preserveOmitted: boolean,
  ): Promise<void> {
    for (const locale of ['bg', 'en'] as const) {
      const name = locale === 'bg' ? input.name_bg : input.name_en;
      const description =
        locale === 'bg' ? input.description_bg : input.description_en;
      const existing = preserveOmitted
        ? await transaction.productTranslation.findUnique({
            where: { revisionId_locale: { revisionId, locale } },
            select: { name: true, description: true },
          })
        : null;
      await transaction.productTranslation.upsert({
        where: { revisionId_locale: { revisionId, locale } },
        create: {
          revisionId,
          locale,
          name: name ?? null,
          description: description ?? null,
        },
        update: {
          name: name === undefined ? existing?.name ?? null : name,
          description:
            description === undefined
              ? existing?.description ?? null
              : description,
        },
      });
    }
  }

  private async persistMaterials(
    transaction: Prisma.TransactionClient,
    revisionId: string,
    mappings: MaterialMapping[],
    state: string | null | undefined,
  ): Promise<void> {
    const existing = await transaction.revisionMaterial.findMany({
      where: { revisionId },
      select: { materialId: true, finenessId: true, goldKaratId: true },
    });
    if (state !== 'known' && existing.length > 0) {
      throw new CommitFailure(
        'materials_state',
        'DRAFT_CHILDREN_REQUIRE_REPLACEMENT',
      );
    }
    const existingKeys = new Set(
      existing.map(
        (material) =>
          `${material.materialId}:${material.finenessId ?? ''}:${material.goldKaratId ?? ''}`,
      ),
    );
    for (const mapping of mappings) {
      const key =
        `${mapping.materialId}:${mapping.finenessId ?? ''}:${mapping.goldKaratId ?? ''}`;
      if (existingKeys.has(key)) {
        continue;
      }
      await transaction.revisionMaterial.create({
        data: {
          revisionId,
          materialId: mapping.materialId,
          finenessId: mapping.finenessId,
          goldKaratId: mapping.goldKaratId,
        },
      });
      existingKeys.add(key);
    }
  }

  private async persistGemstones(
    transaction: Prisma.TransactionClient,
    revisionId: string,
    codes: string[],
    gemstoneIds: Map<string, string>,
    state: string | null | undefined,
  ): Promise<void> {
    const existing = await transaction.revisionGemstone.findMany({
      where: { revisionId },
      select: { gemstoneId: true },
    });
    if (state !== 'known' && existing.length > 0) {
      throw new CommitFailure(
        'gemstones_state',
        'DRAFT_CHILDREN_REQUIRE_REPLACEMENT',
      );
    }
    const existingIds = new Set(existing.map((gemstone) => gemstone.gemstoneId));
    for (const code of codes) {
      const gemstoneId = gemstoneIds.get(code);
      if (!gemstoneId) {
        throw new CommitFailure('gemstone_codes', 'DICTIONARY_ENTRY_UNAVAILABLE');
      }
      if (existingIds.has(gemstoneId)) {
        continue;
      }
      await transaction.revisionGemstone.create({
        data: { revisionId, gemstoneId },
      });
      existingIds.add(gemstoneId);
    }
  }

  private async persistImages(
    transaction: Prisma.TransactionClient,
    productId: string,
    revisionId: string,
    payload: ImportProductPayloadDto,
    hasExistingDraft: boolean,
  ): Promise<void> {
    const rows = payload.images;
    if (!hasExistingDraft) {
      const currentRevision = await transaction.product.findUnique({
        where: { id: productId },
        select: {
          currentRevisionIdRelation: {
            select: {
              from_RevisionImage_revisionId: {
                select: { assetId: true, sortOrder: true },
              },
            },
          },
        },
      });
      const currentImages =
        currentRevision?.currentRevisionIdRelation
          ?.from_RevisionImage_revisionId ?? [];
      for (const image of currentImages) {
        await transaction.revisionImage.create({
          data: {
            revisionId,
            assetId: image.assetId,
            sortOrder: image.sortOrder,
          },
        });
      }
    }
    if (rows.length === 0) {
      return;
    }

    for (const image of rows) {
      if (!image.image_id || !image.sort_order) {
        throw new CommitFailure('image_id', 'MEDIA_NOT_READY');
      }
      const asset = await transaction.mediaAsset.findFirst({
        where: {
          logicalImageId: image.image_id,
          reviewStatus: 'approved',
          releaseIdRelation: {
            productId,
            approved: true,
          },
        },
        select: { id: true },
      });
      if (!asset) {
        throw new CommitFailure('image_id', 'MEDIA_NOT_READY');
      }
      await transaction.revisionImage.create({
        data: {
          revisionId,
          assetId: asset.id,
          sortOrder: image.sort_order,
        },
      });
    }
  }

  private async persistLegacyReferences(
    transaction: Prisma.TransactionClient,
    productId: string,
    payload: ImportProductPayloadDto,
  ): Promise<void> {
    for (const link of payload.legacy_links) {
      if (!link.legacy_id) {
        continue;
      }
      if (!link.source_ref) {
        throw new CommitFailure('source_ref', 'SOURCE_REQUIRED');
      }
      const existing = await transaction.legacyReference.findUnique({
        where: {
          sourceSystem_legacyId: {
            sourceSystem: 'legacy_site',
            legacyId: link.legacy_id,
          },
        },
        select: { id: true, productId: true },
      });
      if (existing && existing.productId !== productId) {
        throw new CommitFailure('legacy_id', 'LEGACY_REFERENCE_ALREADY_LINKED');
      }
      const data = {
        urlBg: link.legacy_url_bg ?? null,
        urlEn: link.legacy_url_en ?? null,
        historicalPrice:
          link.historical_price === undefined || link.historical_price === null
            ? null
            : new Prisma.Decimal(link.historical_price),
        historicalCurrency: link.historical_currency ?? null,
        sourceRef: link.source_ref,
      };
      if (existing) {
        await transaction.legacyReference.update({
          where: { id: existing.id },
          data,
        });
      } else {
        await transaction.legacyReference.create({
          data: {
            productId,
            sourceSystem: 'legacy_site',
            legacyId: link.legacy_id,
            ...data,
          },
        });
      }
    }
  }

  private async claimBarcodes(
    transaction: Prisma.TransactionClient,
    productId: string,
    barcodes: string[],
  ): Promise<void> {
    for (const barcode of barcodes) {
      const existing = await transaction.barcodeIdentity.findUnique({
        where: { barcode },
        select: { productId: true },
      });
      if (existing && existing.productId !== productId) {
        throw new CommitFailure('barcode', 'BARCODE_ALREADY_LINKED');
      }
      const stockItem = await transaction.stockItem.findUnique({
        where: { barcode },
        select: { productId: true },
      });
      if (stockItem && stockItem.productId !== productId) {
        throw new CommitFailure('barcode', 'BARCODE_ALREADY_LINKED');
      }
      if (!existing) {
        await transaction.barcodeIdentity.create({
          data: { barcode, productId },
        });
      }
    }
  }

  private async recordFailure(
    batchId: string,
    ssgId: string,
    failure: CommitFailure,
  ): Promise<void> {
    await this.prisma.$transaction(
      async (transaction) => {
        await transaction.$queryRaw<{ id: string }[]>`
          SELECT id FROM "ImportBatch" WHERE id = ${batchId}::uuid FOR UPDATE
        `;
        const row = await transaction.importProductRow.findUnique({
          where: { batchId_ssgId: { batchId, ssgId } },
          select: { id: true, state: true, errors: true },
        });
        if (!row || row.state === 'committed') {
          return;
        }
        const error: ImportError = {
          sheet: 'Commit',
          row: 0,
          field: failure.field,
          code: failure.code,
          message_key: failure.messageKey,
        };
        const errors: unknown[] = Array.isArray(row.errors)
          ? [...row.errors]
          : [];
        errors.push(error);
        await transaction.importProductRow.update({
          where: { id: row.id },
          data: { state: 'invalid', errors: toJsonValue(errors) },
        });
        const batch = await transaction.importBatch.findUnique({
          where: { id: batchId },
          select: { report: true },
        });
        if (!batch) {
          throw new Error('Import batch disappeared while recording a conflict');
        }
        const report = parseReport(batch.report);
        report.errors.push(error);
        report.invalid += 1;
        report.ready = Math.max(0, report.ready - 1);
        await transaction.importBatch.update({
          where: { id: batchId },
          data: {
            report: toJsonValue(report),
            state: 'partially_committed',
          },
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 10000,
      },
    );
  }

  private async updateBatchSummary(
    transaction: Prisma.TransactionClient,
    batchId: string,
  ): Promise<void> {
    const rows = await transaction.importProductRow.findMany({
      where: { batchId },
      select: { state: true },
    });
    const allCommitted =
      rows.length > 0 && rows.every((row) => row.state === 'committed');
    const someCommitted = rows.some((row) => row.state === 'committed');
    const anyInvalid = rows.some((row) => row.state === 'invalid');
    await transaction.importBatch.update({
      where: { id: batchId },
      data: {
        state: allCommitted
          ? 'committed'
          : someCommitted || anyInvalid
            ? 'partially_committed'
            : 'validated',
        committedAt: allCommitted ? new Date() : null,
      },
    });
  }

  private async readImportResult(
    actorId: string,
    batchId: string,
  ): Promise<ImportResult> {
    const batch = await this.prisma.importBatch.findFirst({
      where: { id: batchId, actorId },
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
    if (!batch) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message_key: 'errors.not_found',
      });
    }
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

  private async finishAction(
    actionId: string,
    statusCode: number,
    result: ImportResult,
  ): Promise<void> {
    await this.prisma.actionRequest.update({
      where: { id: actionId },
      data: {
        state: statusCode >= 400 ? 'rejected' : 'committed',
        result: toJsonValue({
          status_code: statusCode,
          body: { kind: 'import', value: result },
        }),
      },
    });
  }

  private readStoredResult(value: Prisma.JsonValue | null): CommitResult {
    if (
      value === null ||
      Array.isArray(value) ||
      typeof value !== 'object' ||
      typeof value.status_code !== 'number' ||
      value.body === null ||
      typeof value.body !== 'object' ||
      Array.isArray(value.body) ||
      value.body.kind !== 'import' ||
      value.body.value === null ||
      typeof value.body.value !== 'object' ||
      Array.isArray(value.body.value)
    ) {
      throw new ServiceUnavailableException({
        code: 'TEMPORARY_UNAVAILABLE',
        message_key: 'errors.temporary_unavailable',
      });
    }
    const result = parseImportResult(value.body.value);
    if (value.status_code !== 200 && value.status_code !== 409) {
      throw new ServiceUnavailableException({
        code: 'TEMPORARY_UNAVAILABLE',
        message_key: 'errors.temporary_unavailable',
      });
    }
    return {
      result,
      statusCode: value.status_code,
    };
  }
}

function isOneOf<T extends string>(
  value: unknown,
  values: readonly string[],
): value is T {
  return typeof value === 'string' && values.includes(value);
}

function isProductType(value: unknown): value is ProductType {
  return isOneOf<ProductType>(value, PRODUCT_TYPES);
}

function isCompositionState(value: unknown): value is CompositionState {
  return isOneOf<CompositionState>(value, COMPOSITION_STATES);
}

function parseSalesMode(value: string | null | undefined): SalesMode {
  if (value === undefined || value === null || value === '') {
    return 'enquiry_only';
  }
  if (!isOneOf<SalesMode>(value, SALES_MODES)) {
    throw new CommitFailure('requested_sales_mode', 'INVALID_SALES_MODE');
  }
  return value;
}

function parsePriceVisibility(
  value: string | null | undefined,
): PriceVisibility {
  if (value === undefined || value === null || value === '') {
    return 'hidden';
  }
  if (!isOneOf<PriceVisibility>(value, PRICE_VISIBILITIES)) {
    throw new CommitFailure(
      'requested_price_visibility',
      'INVALID_PRICE_VISIBILITY',
    );
  }
  return value;
}

function parseRestrictionReason(
  value: string | null | undefined,
): RestrictionReason | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (!isOneOf<RestrictionReason>(value, RESTRICTION_REASONS)) {
    throw new CommitFailure('change_reason_code', 'INVALID_RESTRICTION_REASON');
  }
  return value;
}

function parseFulfilmentMethods(
  values: string[] | undefined,
): FulfilmentMethod[] {
  return (values ?? []).map((value) => {
    if (!isOneOf<FulfilmentMethod>(value, FULFILMENT_METHODS)) {
      throw new CommitFailure('fulfilment_methods', 'INVALID_FULFILMENT_METHOD');
    }
    return value;
  });
}

function parseDeliveryScope(
  value: string | null | undefined,
): DeliveryScope | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (!isOneOf<DeliveryScope>(value, DELIVERY_SCOPES)) {
    throw new CommitFailure('delivery_scope', 'INVALID_DELIVERY_SCOPE');
  }
  return value;
}

function parseLocationCodes(
  values: string[] | undefined,
): LocationCode[] {
  return (values ?? []).map((value) => {
    if (!isOneOf<LocationCode>(value, LOCATION_CODES)) {
      throw new CommitFailure('pickup_location_codes', 'INVALID_LOCATION');
    }
    return value;
  });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  if (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    return value;
  }
  if (value === null) {
    throw new Error('Top-level JSON value cannot be null');
  }
  if (Array.isArray(value)) {
    return value.map((item) => item === null ? null : toJsonValue(item));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [
          key,
          item === null ? null : toJsonValue(item),
        ]),
    );
  }
  throw new Error('Value cannot be stored as JSON');
}

function parseReport(value: Prisma.JsonValue): ImportReport {
  if (
    value === null ||
    Array.isArray(value) ||
    typeof value !== 'object' ||
    typeof value.products_total !== 'number' ||
    typeof value.ready !== 'number' ||
    typeof value.invalid !== 'number' ||
    !Array.isArray(value.errors) ||
    !Array.isArray(value.diff)
  ) {
    throw new ServiceUnavailableException({
      code: 'TEMPORARY_UNAVAILABLE',
      message_key: 'errors.temporary_unavailable',
    });
  }
  const errors = value.errors.map((item) => {
    if (
      item === null ||
      Array.isArray(item) ||
      typeof item !== 'object' ||
      typeof item.sheet !== 'string' ||
      typeof item.row !== 'number' ||
      typeof item.field !== 'string' ||
      typeof item.code !== 'string' ||
      typeof item.message_key !== 'string'
    ) {
      throw new ServiceUnavailableException({
        code: 'TEMPORARY_UNAVAILABLE',
        message_key: 'errors.temporary_unavailable',
      });
    }
    return {
      sheet: item.sheet,
      row: item.row,
      field: item.field,
      code: item.code,
      message_key: item.message_key,
    };
  });
  const diff = value.diff.map((item) => {
    const operation =
      item !== null && typeof item === 'object' && !Array.isArray(item)
        ? item.operation
        : undefined;
    if (
      item === null ||
      Array.isArray(item) ||
      typeof item !== 'object' ||
      typeof item.ssg_id !== 'string' ||
      !isOneOf<ImportDiff['operation']>(operation, [
        'create_draft',
        'update_draft',
        'unchanged',
      ]) ||
      !Array.isArray(item.changed_fields) ||
      !item.changed_fields.every((field) => typeof field === 'string')
    ) {
      throw new ServiceUnavailableException({
        code: 'TEMPORARY_UNAVAILABLE',
        message_key: 'errors.temporary_unavailable',
      });
    }
    return {
      ssg_id: item.ssg_id,
      operation,
      changed_fields: item.changed_fields,
    };
  });
  return {
    products_total: value.products_total,
    ready: value.ready,
    invalid: value.invalid,
    errors,
    diff,
  };
}

function parseImportResult(value: Prisma.JsonValue): ImportResult {
  if (
    value === null ||
    Array.isArray(value) ||
    typeof value !== 'object' ||
    typeof value.batch_id !== 'string' ||
    value.report === undefined ||
    !isOneOf<ImportState>(value.state, [
      'validated',
      'invalid',
      'committed',
      'partially_committed',
    ]) ||
    !Array.isArray(value.products)
  ) {
    throw new ServiceUnavailableException({
      code: 'TEMPORARY_UNAVAILABLE',
      message_key: 'errors.temporary_unavailable',
    });
  }
  const products: CommitGroupOutcome[] = value.products.map((item) => {
    if (
      item === null ||
      Array.isArray(item) ||
      typeof item !== 'object' ||
      typeof item.ssg_id !== 'string' ||
      !isOneOf<ImportRowState>(item.state, ['ready', 'invalid', 'committed']) ||
      (item.product_id !== null && typeof item.product_id !== 'string')
    ) {
      throw new ServiceUnavailableException({
        code: 'TEMPORARY_UNAVAILABLE',
        message_key: 'errors.temporary_unavailable',
      });
    }
    return {
      ssg_id: item.ssg_id,
      state: item.state,
      product_id: item.product_id,
    };
  });
  return {
    batch_id: value.batch_id,
    state: value.state,
    report: parseReport(value.report),
    products,
  };
}

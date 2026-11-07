import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import type {} from "multer";
import { Prisma } from "../../../generated/prisma/client";
import { PrismaService } from "../../database/prisma.service";
import {
  hashIdempotencyPayload,
  TransactionService,
} from "../../common/transactions/transaction.service";
import {
  configurationUrl,
  projectMedia,
} from "../products/product-read.service";
import { CatalogueAdminService } from "./catalogue-admin.service";
import {
  CatalogueMediaRequestDto,
  CatalogueImageMetadataDto,
} from "./catalogue-media.dto";
import { CatalogueMediaStorageService } from "./catalogue-media-storage.service";

type Derivative = {
  size: number;
  width: number;
  height: number;
  object_key: string;
  mime: string;
  colour_space: string;
  bytes: number;
  sha256: string;
};
type PreparedImage = {
  metadata: CatalogueImageMetadataDto;
  original: Buffer;
  mime: string;
  originalKey: string;
  derivatives: { metadata: Derivative; buffer: Buffer }[];
};
const digest = (buffer: Buffer) =>
  createHash("sha256").update(buffer).digest("hex");

@Injectable()
export class CatalogueMediaService {
  private readonly logger = new Logger(CatalogueMediaService.name);
  private processing = false;

  constructor(
    private readonly config: ConfigService,
    private readonly db: PrismaService,
    private readonly transactions: TransactionService,
    private readonly catalogue: CatalogueAdminService,
    private readonly storage: CatalogueMediaStorageService,
  ) {}

  async attach(
    actorId: string,
    productId: string,
    input: CatalogueMediaRequestDto,
    files: Express.Multer.File[],
  ) {
    if (
      this.config.get<string>("NODE_ENV") === "production" ||
      !this.config.get<boolean>("DEV_CATALOGUE_PUBLISH_ENABLED")
    )
      throw new ForbiddenException();
    const byKey = new Map(files.map((file) => [file.fieldname, file]));
    if (
      byKey.size !== files.length ||
      files.length !== input.images.length ||
      new Set(input.images.map((image) => image.client_key)).size !==
        input.images.length ||
      input.images.some((image) => !byKey.has(`image_${image.client_key}`))
    )
      throw new BadRequestException();
    const payload = {
      expected_version: input.expected_version,
      images: input.images
        .map((image) => {
          const file = byKey.get(`image_${image.client_key}`);
          if (!file) throw new BadRequestException();
          return { ...image, source_sha256: digest(file.buffer) };
        })
        .sort((a, b) => a.sort_order - b.sort_order),
    };
    const scopeKey = `catalogue-media:${actorId}:${productId}`;
    const stored = await this.db.actionRequest.findUnique({
      where: { scopeKey_requestId: { scopeKey, requestId: input.request_id } },
      select: { payloadHash: true, state: true },
    });
    if (stored) {
      if (stored.payloadHash !== hashIdempotencyPayload(payload))
        throw new ConflictException({
          code: "REQUEST_PAYLOAD_MISMATCH",
          message_key: "errors.request_payload_mismatch",
        });
      if (stored.state === "committed") {
        const replay = await this.transactions.serializable((tx) =>
          this.transactions.executeIdempotentAction(
            tx,
            {
              scopeKey,
              requestId: input.request_id,
              payload,
            },
            async () => {
              throw new Error("Completed media action lost its stored result");
            },
          ),
        );
        return replay.body;
      }
    }
    const product = await this.db.product.findUnique({
      where: { id: productId },
      select: { version: true },
    });
    if (!product) throw new NotFoundException();
    if (product.version !== input.expected_version)
      throw new ConflictException();
    if (this.processing)
      throw new ServiceUnavailableException({
        code: "MEDIA_PROCESSING_BUSY",
        message_key: "errors.temporary_unavailable",
      });
    this.processing = true;
    const releaseId = randomUUID();
    const keys: string[] = [];
    try {
      const prepared: PreparedImage[] = [];
      for (const metadata of input.images) {
        const file = byKey.get(`image_${metadata.client_key}`);
        if (!file) throw new BadRequestException();
        prepared.push(
          await this.prepare(productId, releaseId, metadata, file.buffer),
        );
      }
      const cdn = configurationUrl(this.config, "MEDIA_CDN_BASE_URL", false);
      for (const image of prepared) {
        await this.storage.put(
          image.originalKey,
          image.original,
          image.mime,
          true,
        );
        keys.push(image.originalKey);
        for (const derivative of image.derivatives) {
          await this.storage.put(
            derivative.metadata.object_key,
            derivative.buffer,
            "image/webp",
            false,
          );
          keys.push(derivative.metadata.object_key);
        }
      }
      const result = await this.transactions.serializable((tx) =>
        this.transactions.executeIdempotentAction(
          tx,
          {
            scopeKey,
            requestId: input.request_id,
            payload,
          },
          async () => {
            const lock = await this.transactions.lockProducts(tx, [productId]);
            if (!lock.length) throw new NotFoundException();
            if (lock[0].version !== input.expected_version)
              throw new ConflictException();
            const draft = await this.draft(tx, productId, actorId);
            const existing = await tx.revisionImage.findMany({
              where: { revisionId: draft.id },
              orderBy: { sortOrder: "asc" },
              include: { assetIdRelation: true },
            });
            if (
              existing.length + prepared.length > 50 ||
              new Set([
                ...existing.map((image) => image.sortOrder),
                ...input.images.map((image) => image.sort_order),
              ]).size !==
                existing.length + prepared.length ||
              existing.some(
                (image) =>
                  image.sortOrder >=
                  Math.min(...input.images.map((row) => row.sort_order)),
              )
            )
              throw new BadRequestException();
            const mains =
              existing.filter((image) => image.assetIdRelation.role === "main")
                .length +
              input.images.filter((image) => image.role === "main").length;
            const first = existing[0]
              ? {
                  role: existing[0].assetIdRelation.role,
                  order: existing[0].sortOrder,
                }
              : {
                  role: [...input.images].sort(
                    (a, b) => a.sort_order - b.sort_order,
                  )[0].role,
                  order: Math.min(
                    ...input.images.map((image) => image.sort_order),
                  ),
                };
            if (mains !== 1 || first.role !== "main" || first.order !== 1)
              throw new BadRequestException();
            await tx.revisionImage.deleteMany({
              where: { revisionId: draft.id },
            });
            await tx.mediaRelease.create({
              data: {
                id: releaseId,
                productId,
                versionLabel: releaseId.replace(/-/g, "").slice(0, 30),
              },
            });
            await tx.productRevision.update({
              where: { id: draft.id },
              data: { mediaReleaseId: releaseId },
            });
            for (const image of existing) {
              const asset = image.assetIdRelation;
              projectMedia(asset, "bg", cdn, draft.mediaReleaseId);
              projectMedia(asset, "en", cdn, draft.mediaReleaseId);
              const copy = await tx.mediaAsset.create({
                data: {
                  releaseId,
                  logicalImageId: asset.logicalImageId,
                  role: asset.role,
                  originalPrivatePath: asset.originalPrivatePath,
                  derivatives: asset.derivatives ?? Prisma.JsonNull,
                  altBg: asset.altBg,
                  altEn: asset.altEn,
                  processedWithAi: asset.processedWithAi,
                  onModelIllustrative: asset.onModelIllustrative,
                  reviewStatus: "approved",
                },
              });
              await tx.revisionImage.create({
                data: {
                  revisionId: draft.id,
                  assetId: copy.id,
                  sortOrder: image.sortOrder,
                },
              });
            }
            const logicalIds = new Set(
              existing.map((image) => image.assetIdRelation.logicalImageId),
            );
            for (const image of prepared) {
              if (logicalIds.has(image.metadata.client_key))
                throw new BadRequestException();
              const asset = await tx.mediaAsset.create({
                data: {
                  releaseId,
                  logicalImageId: image.metadata.client_key,
                  role: image.metadata.role,
                  originalPrivatePath: image.originalKey,
                  derivatives: image.derivatives.map((item) => ({
                    ...item.metadata,
                  })),
                  altBg: image.metadata.alt_bg,
                  altEn: image.metadata.alt_en,
                  processedWithAi: image.metadata.processed_with_ai,
                  onModelIllustrative: image.metadata.on_model_illustrative,
                  reviewStatus: "approved",
                },
              });
              for (const locale of ["bg", "en"] as const)
                projectMedia(asset, locale, cdn, releaseId);
              await tx.revisionImage.create({
                data: {
                  revisionId: draft.id,
                  assetId: asset.id,
                  sortOrder: image.metadata.sort_order,
                },
              });
            }
            await tx.mediaRelease.update({
              where: { id: releaseId },
              data: { approved: true },
            });
            await tx.product.update({
              where: { id: productId },
              data: { version: { increment: 1 } },
            });
            await tx.auditEvent.create({
              data: {
                actorId,
                action: "catalogue_media_attach",
                subjectType: "Product",
                subjectId: productId,
                eventKey: `catalogue-media:${releaseId}`,
                after: {
                  release_id: releaseId,
                  draft_revision_id: draft.id,
                  source_bytes_processed: true,
                  approval: "development_only",
                },
              },
            });
            const admin = await this.catalogue.detailInTransaction(
              tx,
              productId,
            );
            return {
              status_code: 200,
              body: JSON.parse(JSON.stringify(admin)) as Prisma.InputJsonObject,
            };
          },
        ),
      );
      if (result.replayed) await this.storage.remove(keys);
      return result.body;
    } catch (error) {
      this.logger.warn(
        `Media attachment failed for release ${releaseId}; ambiguous uploads may require reconciliation`,
      );
      // A connection can fail after COMMIT; never delete objects referenced by a committed release.
      try {
        if (
          !(await this.db.mediaRelease.findUnique({
            where: { id: releaseId },
            select: { id: true },
          }))
        )
          await this.storage.remove(keys);
      } catch {
        this.logger.error(
          `Media cleanup requires reconciliation for release ${releaseId}`,
        );
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError ||
        error instanceof Prisma.PrismaClientUnknownRequestError ||
        error instanceof Prisma.PrismaClientInitializationError
      )
        throw new ServiceUnavailableException();
      throw error;
    } finally {
      this.processing = false;
    }
  }

  private async prepare(
    productId: string,
    releaseId: string,
    metadata: CatalogueImageMetadataDto,
    original: Buffer,
  ): Promise<PreparedImage> {
    let info: sharp.Metadata;
    try {
      info = await sharp(original, {
        limitInputPixels: 40000000,
        failOn: "warning",
      }).metadata();
    } catch {
      throw new BadRequestException({
        code: "INVALID_IMAGE",
        message_key: "errors.validation",
      });
    }
    if (
      !info.width ||
      !info.height ||
      (info.pages ?? 1) !== 1 ||
      !["jpeg", "png", "webp"].includes(info.format ?? "") ||
      Math.max(info.width, info.height) < 1600
    )
      throw new BadRequestException({
        code: "INVALID_IMAGE",
        message_key: "errors.validation",
      });
    const derivatives: PreparedImage["derivatives"] = [];
    for (const size of [200, 400, 800, 1600]) {
      let buffer: Buffer;
      try {
        buffer = await sharp(original, {
          limitInputPixels: 40000000,
          failOn: "warning",
        })
          .rotate()
          .flatten({ background: "#ffffff" })
          .toColourspace("srgb")
          .resize(size, size, {
            fit: "contain",
            background: "#ffffff",
            withoutEnlargement: true,
          })
          .webp({ quality: 85 })
          .toBuffer();
      } catch {
        throw new BadRequestException({
          code: "INVALID_IMAGE",
          message_key: "errors.validation",
        });
      }
      const output = await sharp(buffer).metadata();
      if (
        output.width !== size ||
        output.height !== size ||
        output.format !== "webp"
      )
        throw new Error("Invalid generated derivative dimensions");
      derivatives.push({
        buffer,
        metadata: {
          size,
          width: size,
          height: size,
          object_key: `products/${productId}/${releaseId}/${metadata.client_key}-${size}.webp`,
          mime: "image/webp",
          colour_space: "sRGB",
          bytes: buffer.length,
          sha256: digest(buffer),
        },
      });
    }
    return {
      metadata,
      original,
      mime: `image/${info.format}`,
      originalKey: `private/products/${productId}/${releaseId}/${metadata.client_key}.${info.format}`,
      derivatives,
    };
  }

  private async draft(
    tx: Prisma.TransactionClient,
    productId: string,
    actorId: string,
  ) {
    const draft = await tx.productRevision.findFirst({
      where: { productId, state: "draft" },
    });
    if (draft) return draft;
    const product = await tx.product.findUniqueOrThrow({
      where: { id: productId },
    });
    if (!product.currentRevisionId) throw new ConflictException();
    const live = await tx.productRevision.findUniqueOrThrow({
      where: { id: product.currentRevisionId },
      include: {
        from_ProductTranslation_revisionId: true,
        from_RevisionMaterial_revisionId: true,
        from_RevisionGemstone_revisionId: true,
        from_RevisionImage_revisionId: true,
      },
    });
    const latest = await tx.productRevision.aggregate({
      where: { productId },
      _max: { revisionNumber: true },
    });
    const created = await tx.productRevision.create({
      data: {
        productId,
        revisionNumber: (latest._max.revisionNumber ?? 0) + 1,
        createdById: actorId,
        jewelleryTypeId: live.jewelleryTypeId,
        materialsState: live.materialsState,
        gemstonesState: live.gemstonesState,
        salesMode: live.salesMode,
        priceVisibility: live.priceVisibility,
        fulfilmentMethods: live.fulfilmentMethods,
        deliveryScope: live.deliveryScope,
        deliveryLocalityIds: live.deliveryLocalityIds,
        pickupLocationCodes: live.pickupLocationCodes,
        mediaReleaseId: live.mediaReleaseId,
        changeReason: live.changeReason,
        changeNote: live.changeNote,
      },
    });
    for (const text of live.from_ProductTranslation_revisionId) {
      const { id, revisionId, ...data } = text;
      void id;
      void revisionId;
      await tx.productTranslation.create({
        data: { ...data, revisionId: created.id },
      });
    }
    for (const material of live.from_RevisionMaterial_revisionId)
      await tx.revisionMaterial.create({
        data: {
          revisionId: created.id,
          materialId: material.materialId,
          finenessId: material.finenessId,
          goldKaratId: material.goldKaratId,
        },
      });
    for (const gemstone of live.from_RevisionGemstone_revisionId)
      await tx.revisionGemstone.create({
        data: { revisionId: created.id, gemstoneId: gemstone.gemstoneId },
      });
    for (const image of live.from_RevisionImage_revisionId)
      await tx.revisionImage.create({
        data: {
          revisionId: created.id,
          assetId: image.assetId,
          sortOrder: image.sortOrder,
        },
      });
    return created;
  }
}

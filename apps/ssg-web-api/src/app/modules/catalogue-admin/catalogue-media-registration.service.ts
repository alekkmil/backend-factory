import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../../generated/prisma/client';
import { TransactionService } from '../../common/transactions/transaction.service';
import type { CatalogueMediaReleaseDto } from './catalogue-media.dto';

export interface MediaReleaseResult {
  release_id: string;
  approved: true;
  assets: { id: string; logical_image_id: string }[];
}

export interface MediaReleaseOutcome {
  result: MediaReleaseResult;
  statusCode: 200 | 201;
}

function isPrismaFailure(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientInitializationError;
}

function validRelativePath(path: string, root: string): boolean {
  if (
    !path.startsWith(`${root}/`) ||
    path.startsWith('/') ||
    path.includes('\\') ||
    /[%?#\s]/.test(path)
  ) return false;
  return path.split('/').every((part) =>
    part.length > 0 && part !== '.' && part !== '..' && /^[A-Za-z0-9._-]+$/.test(part),
  );
}

function validOriginalPath(path: string, ssgId: string, logicalImageId: string): boolean {
  if (!validRelativePath(path, `${ssgId}_org`)) return false;
  const filename = path.slice(`${ssgId}_org/`.length);
  return filename === `${logicalImageId}.${filename.split('.').at(-1)}` &&
    /\.(?:jpe?g|png|webp)$/i.test(filename);
}

@Injectable()
export class CatalogueMediaRegistrationService {
  private readonly logger = new Logger(CatalogueMediaRegistrationService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly transactions: TransactionService,
  ) {}

  async register(
    actorId: string,
    productId: string,
    request: CatalogueMediaReleaseDto,
  ): Promise<MediaReleaseOutcome> {
    if (
      this.config.get<string>('NODE_ENV') === 'production' ||
      !this.config.get<boolean>('DEV_CATALOGUE_PUBLISH_ENABLED')
    ) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message_key: 'errors.forbidden',
      });
    }

    const images = request.images.map((image) => ({
      logical_image_id: image.logical_image_id,
      role: image.role,
      original_relative_path: image.original_relative_path,
      alt_bg: image.alt_bg.normalize('NFC').trim(),
      alt_en: image.alt_en.normalize('NFC').trim(),
      processed_with_ai: image.processed_with_ai,
      on_model_illustrative: image.on_model_illustrative,
      derivatives: image.derivatives.map((derivative) => ({
        size: derivative.size,
        width: derivative.width,
        height: derivative.height,
        object_key: derivative.object_key,
        mime: derivative.mime,
        colour_space: derivative.colour_space,
        bytes: derivative.bytes,
        sha256: derivative.sha256,
      })),
    }));
    try {
      const replay = await this.transactions.serializable((transaction) =>
        this.transactions.executeIdempotentAction(transaction, {
          scopeKey: `catalogue-media-release:${actorId}:${productId}`,
          requestId: request.request_id,
          payload: {
            version: request.version,
            receipt_sha256: request.receipt_sha256,
            images,
          },
        }, async () => {
          const locks = await this.transactions.lockProducts(transaction, [productId]);
          if (!locks.length) throw new NotFoundException();
          const product = await transaction.product.findUniqueOrThrow({
            where: { id: productId },
            select: { ssgId: true },
          });
          const logicalIds = images.map((image) => image.logical_image_id);
          if (new Set(logicalIds).size !== logicalIds.length) throw new BadRequestException();

          const releaseId = randomUUID();
          const reviewedAt = new Date();
          const assets: MediaReleaseResult['assets'] = [];
          for (const image of images) {
            if (
              !validOriginalPath(
                image.original_relative_path,
                product.ssgId,
                image.logical_image_id,
              ) ||
              !image.alt_bg.normalize('NFC').trim() ||
              !image.alt_en.normalize('NFC').trim()
            ) {
              throw new BadRequestException({
                code: 'INVALID_MEDIA_METADATA',
                message_key: 'errors.validation',
              });
            }
            const derivativeSizes = image.derivatives.map((derivative) => derivative.size);
            if (
              new Set(derivativeSizes).size !== 4 ||
              [200, 400, 800, 1600].some((size) => !derivativeSizes.includes(size)) ||
              image.derivatives.some((derivative) =>
                derivative.width !== derivative.size ||
                derivative.height !== derivative.size ||
                derivative.object_key !==
                  `products/${product.ssgId}/${request.version}/${image.logical_image_id}-${derivative.size}.webp` ||
                !validRelativePath(derivative.object_key, `products/${product.ssgId}/${request.version}`) ||
                !derivative.sha256 ||
                derivative.bytes < 1,
              )
            ) {
              throw new BadRequestException({
                code: 'INVALID_MEDIA_METADATA',
                message_key: 'errors.validation',
              });
            }
          }

          const existing = await transaction.mediaRelease.findUnique({
            where: {
              productId_versionLabel: {
                productId,
                versionLabel: request.version,
              },
            },
            select: { id: true },
          });
          if (existing) {
            throw new ConflictException({
              code: 'MEDIA_VERSION_CONFLICT',
              message_key: 'errors.version_conflict',
            });
          }
          await transaction.mediaRelease.create({
            data: {
              id: releaseId,
              productId,
              versionLabel: request.version,
              approved: false,
              receiptSha256: null,
            },
          });
          for (const image of images) {
            const assetId = randomUUID();
            await transaction.mediaAsset.create({
              data: {
                id: assetId,
                releaseId,
                logicalImageId: image.logical_image_id,
                role: image.role,
                originalPrivatePath: image.original_relative_path,
                derivatives: JSON.parse(JSON.stringify(image.derivatives)) as Prisma.InputJsonValue,
                altBg: image.alt_bg.normalize('NFC').trim() || null,
                altEn: image.alt_en.normalize('NFC').trim() || null,
                processedWithAi: image.processed_with_ai,
                onModelIllustrative: image.on_model_illustrative,
                reviewStatus: 'approved',
                reviewedById: actorId,
                reviewedAt,
              },
            });
            assets.push({ id: assetId, logical_image_id: image.logical_image_id });
          }
          await transaction.mediaRelease.update({
            where: { id: releaseId },
            data: {
              approved: true,
              reviewedById: actorId,
              reviewedAt,
              receiptSha256: request.receipt_sha256,
            },
          });
          await transaction.auditEvent.create({
            data: {
              actorId,
              action: 'catalogue_media_register',
              subjectType: 'Product',
              subjectId: productId,
              eventKey: `catalogue-media-release:${releaseId}`,
              after: {
                release_id: releaseId,
                approved: true,
                approval_mode: 'development_metadata_only',
                reviewer_id: actorId,
                reviewed_at: reviewedAt.toISOString(),
                receipt_sha256_recorded: request.receipt_sha256,
                storage_verified: false,
                derivative_bytes_verified: false,
                human_approval_verified: false,
              },
            },
          });
          const response: MediaReleaseResult = {
            release_id: releaseId,
            approved: true,
            assets,
          };
          return {
            status_code: 201,
            body: JSON.parse(JSON.stringify(response)) as Prisma.InputJsonObject,
          };
        }),
      );
      return {
        result: this.readResult(replay.body),
        statusCode: replay.replayed ? 200 : 201,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({
          code: 'MEDIA_VERSION_CONFLICT',
          message_key: 'errors.version_conflict',
        });
      }
      if (isPrismaFailure(error)) {
        this.logger.warn('Catalogue media registration database dependency failed');
        throw new ServiceUnavailableException({
          code: 'TEMPORARY_UNAVAILABLE',
          message_key: 'errors.temporary_unavailable',
        });
      }
      throw error;
    }
  }

  private readResult(value: Prisma.JsonObject | Prisma.InputJsonObject): MediaReleaseResult {
    if (
      value === null ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      typeof value.release_id !== 'string' ||
      value.approved !== true ||
      !Array.isArray(value.assets) ||
      value.assets.some((asset) =>
        asset === null || typeof asset !== 'object' || Array.isArray(asset) ||
        typeof asset.id !== 'string' || typeof asset.logical_image_id !== 'string',
      )
    ) {
      throw new ServiceUnavailableException({
        code: 'TEMPORARY_UNAVAILABLE',
        message_key: 'errors.temporary_unavailable',
      });
    }
    return value as unknown as MediaReleaseResult;
  }
}

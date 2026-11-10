import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { Prisma } from '../../../generated/prisma/client';
import { MediaStorageService } from '../../common/media-storage.service';
import {
  TransactionService,
  hashIdempotencyPayload,
} from '../../common/transactions/transaction.service';
import { PrismaService } from '../../database/prisma.service';
import {
  configurationUrl,
  projectMedia,
} from '../products/product-read.service';
import type { WebsiteMediaUploadDto } from './website-media.dto';

type PreparedImage = {
  input: WebsiteMediaUploadDto['images'][number];
  original: Buffer;
  originalKey: string;
  mime: string;
  derivatives: {
    buffer: Buffer;
    metadata: {
      size: number;
      width: number;
      height: number;
      object_key: string;
      mime: string;
      colour_space: string;
      bytes: number;
      sha256: string;
    };
  }[];
};

const digest = (buffer: Buffer) =>
  createHash('sha256').update(buffer).digest('hex');

@Injectable()
export class WebsiteMediaService {
  private readonly logger = new Logger(WebsiteMediaService.name);
  private processing = false;

  constructor(
    private readonly config: ConfigService,
    private readonly db: PrismaService,
    private readonly transactions: TransactionService,
    private readonly storage: MediaStorageService,
  ) {}

  async upload(
    actorId: string,
    input: WebsiteMediaUploadDto,
    files: Express.Multer.File[],
  ) {
    if (
      this.config.get<string>('NODE_ENV') === 'production' ||
      !this.config.get<boolean>('DEV_CATALOGUE_PUBLISH_ENABLED')
    ) {
      throw new ForbiddenException();
    }
    const byKey = new Map(files.map((file) => [file.fieldname, file]));
    if (
      byKey.size !== files.length ||
      files.length !== input.images.length ||
      new Set(input.images.map((image) => image.client_key)).size !==
        input.images.length ||
      input.images.some((image) => !byKey.has(`image_${image.client_key}`))
    ) {
      throw new BadRequestException();
    }

    const payload = {
      images: input.images
        .map((image) => {
          const file = byKey.get(`image_${image.client_key}`);
          if (!file) throw new BadRequestException();
          return { ...image, source_sha256: digest(file.buffer) };
        })
        .sort((a, b) => a.client_key.localeCompare(b.client_key)),
    };
    const payloadHash = hashIdempotencyPayload(payload);
    const scopeKey = `website-media:${actorId}`;
    const existing = await this.db.actionRequest.findUnique({
      where: { scopeKey_requestId: { scopeKey, requestId: input.request_id } },
      select: { payloadHash: true, state: true },
    });
    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        throw new ConflictException({
          code: 'REQUEST_PAYLOAD_MISMATCH',
          message_key: 'errors.request_payload_mismatch',
        });
      }
      if (existing.state === 'committed') {
        const replay = await this.transactions.serializable((tx) =>
          this.transactions.executeIdempotentAction(
            tx,
            {
              scopeKey,
              requestId: input.request_id,
              payload,
            },
            async () => {
              throw new Error(
                'Completed website media upload lost its stored result',
              );
            },
          ),
        );
        return replay.body;
      }
    }
    if (this.processing) {
      throw new ServiceUnavailableException({
        code: 'MEDIA_PROCESSING_BUSY',
        message_key: 'errors.temporary_unavailable',
      });
    }

    this.processing = true;
    const releaseId = randomUUID();
    const objectKeys: string[] = [];
    try {
      const prepared: PreparedImage[] = [];
      for (const metadata of input.images) {
        const file = byKey.get(`image_${metadata.client_key}`);
        if (!file) throw new BadRequestException();
        prepared.push(await this.prepare(releaseId, metadata, file.buffer));
      }
      const cdn = configurationUrl(this.config, 'MEDIA_CDN_BASE_URL', false);
      for (const image of prepared) {
        objectKeys.push(image.originalKey);
        await this.storage.put(
          image.originalKey,
          image.original,
          image.mime,
          true,
        );
        for (const derivative of image.derivatives) {
          objectKeys.push(derivative.metadata.object_key);
          await this.storage.put(
            derivative.metadata.object_key,
            derivative.buffer,
            'image/webp',
            false,
          );
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
            const reviewedAt = new Date();
            const release = await tx.websiteMediaRelease.create({
              data: {
                id: releaseId,
                versionLabel: releaseId.replace(/-/g, '').slice(0, 30),
              },
            });
            const assets = [];
            for (const image of prepared) {
              const asset = await tx.websiteMediaAsset.create({
                data: {
                  releaseId,
                  logicalImageId: image.input.client_key,
                  role: 'editorial',
                  originalPrivatePath: image.originalKey,
                  derivatives: image.derivatives.map(
                    ({ metadata }) => metadata,
                  ),
                  altBg: image.input.alt_bg.trim().normalize('NFC'),
                  altEn: image.input.alt_en.trim().normalize('NFC'),
                  processedWithAi: image.input.processed_with_ai,
                  reviewStatus: 'approved',
                  reviewedById: actorId,
                  reviewedAt,
                },
              });
              assets.push({
                id: asset.id,
                logical_image_id: asset.logicalImageId,
                media: {
                  bg: projectMedia(asset, 'bg', cdn, release.id),
                  en: projectMedia(asset, 'en', cdn, release.id),
                },
              });
            }
            await tx.websiteMediaRelease.update({
              where: { id: release.id },
              data: {
                approved: true,
                reviewedById: actorId,
                reviewedAt,
                receiptSha256: payloadHash,
              },
            });
            await tx.auditEvent.create({
              data: {
                actorId,
                action: 'website_media_publish',
                subjectType: 'WebsiteMediaRelease',
                subjectId: release.id,
                eventKey: `website-media:${actorId}:${input.request_id}`,
                after: {
                  release_id: release.id,
                  asset_count: assets.length,
                  approved: true,
                },
              },
            });
            return {
              status_code: 200,
              body: JSON.parse(
                JSON.stringify({ release_id: release.id, assets }),
              ) as Prisma.InputJsonObject,
            };
          },
        ),
      );
      if (result.replayed) await this.storage.remove(objectKeys);
      return result.body;
    } catch (error) {
      this.logger.warn(`Website media upload failed for release ${releaseId}`);
      try {
        if (
          !(await this.db.websiteMediaRelease.findUnique({
            where: { id: releaseId },
            select: { id: true },
          }))
        ) {
          await this.storage.remove(objectKeys);
        }
      } catch {
        this.logger.error(
          `Website media cleanup requires reconciliation for release ${releaseId}`,
        );
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError ||
        error instanceof Prisma.PrismaClientUnknownRequestError ||
        error instanceof Prisma.PrismaClientInitializationError
      ) {
        throw new ServiceUnavailableException({
          code: 'TEMPORARY_UNAVAILABLE',
          message_key: 'errors.temporary_unavailable',
        });
      }
      throw error;
    } finally {
      this.processing = false;
    }
  }

  private async prepare(
    releaseId: string,
    input: WebsiteMediaUploadDto['images'][number],
    original: Buffer,
  ): Promise<PreparedImage> {
    let info: sharp.Metadata;
    try {
      info = await sharp(original, {
        limitInputPixels: 40000000,
        failOn: 'warning',
      }).metadata();
    } catch {
      throw new BadRequestException({
        code: 'INVALID_IMAGE',
        message_key: 'errors.validation',
      });
    }
    if (
      !info.width ||
      !info.height ||
      (info.pages ?? 1) !== 1 ||
      !['jpeg', 'png', 'webp'].includes(info.format ?? '') ||
      Math.max(info.width, info.height) < 1600
    ) {
      throw new BadRequestException({
        code: 'INVALID_IMAGE',
        message_key: 'errors.validation',
      });
    }
    const extension = info.format === 'jpeg' ? 'jpg' : info.format;
    const derivatives: PreparedImage['derivatives'] = [];
    for (const size of [200, 400, 800, 1600]) {
      let output: { data: Buffer; info: sharp.OutputInfo };
      try {
        output = await sharp(original, {
          limitInputPixels: 40000000,
          failOn: 'warning',
        })
          .rotate()
          .toColourspace('srgb')
          .resize(size, size, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 85 })
          .toBuffer({ resolveWithObject: true });
      } catch {
        throw new BadRequestException({
          code: 'INVALID_IMAGE',
          message_key: 'errors.validation',
        });
      }
      if (
        Math.max(output.info.width, output.info.height) !== size ||
        output.info.format !== 'webp'
      ) {
        throw new Error('Invalid generated website media derivative');
      }
      const objectKey = `website/${releaseId}/${input.client_key}-${size}.webp`;
      derivatives.push({
        buffer: output.data,
        metadata: {
          size,
          width: output.info.width,
          height: output.info.height,
          object_key: objectKey,
          mime: 'image/webp',
          colour_space: 'sRGB',
          bytes: output.data.length,
          sha256: digest(output.data),
        },
      });
    }
    return {
      input,
      original,
      originalKey: `private/website/${releaseId}/${input.client_key}.${extension}`,
      mime: `image/${info.format}`,
      derivatives,
    };
  }
}

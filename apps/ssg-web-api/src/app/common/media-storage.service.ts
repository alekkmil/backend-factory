import {
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import sharp from 'sharp';

type StoredDerivative = {
  object_key: string;
  bytes: number;
  sha256: string;
  width: number;
  height: number;
};

function storageErrorDetails(error: unknown): string {
  if (!error || typeof error !== 'object') return 'code=Unknown';
  const identifier = (value: unknown): string =>
    typeof value === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(value)
      ? value
      : 'Unknown';
  const name = 'name' in error ? identifier(error.name) : 'Unknown';
  const code = 'code' in error ? identifier(error.code) : name;
  const metadata = '$metadata' in error ? error.$metadata : null;
  const status =
    metadata &&
    typeof metadata === 'object' &&
    'httpStatusCode' in metadata &&
    typeof metadata.httpStatusCode === 'number'
      ? metadata.httpStatusCode
      : 'unknown';
  const cause = 'cause' in error ? error.cause : null;
  const networkCode =
    cause && typeof cause === 'object' && 'code' in cause
      ? identifier(cause.code)
      : 'Unknown';
  return `code=${code} name=${name} http_status=${status} network_code=${networkCode} region=eu-central-1`;
}

export function s3Bucket(config: ConfigService): string {
  const value = config.get<string>('AWS_S3_BUCKET_URL');
  if (!value) throw new Error('AWS_S3_BUCKET_URL is required for media upload');
  const url = new URL(value);
  const virtual =
    /^([a-z0-9][a-z0-9.-]+)\.s3(?:\.eu-central-1|-eu-central-1)?\.amazonaws\.com$/;
  const match = url.hostname.match(virtual);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  )
    throw new Error('Invalid AWS_S3_BUCKET_URL');
  if (match && (url.pathname === '/' || url.pathname === '')) return match[1];
  if (
    ['s3.eu-central-1.amazonaws.com', 's3.amazonaws.com'].includes(
      url.hostname,
    ) &&
    /^\/[a-z0-9][a-z0-9.-]+\/?$/.test(url.pathname)
  ) {
    return url.pathname.replace(/^\/|\/$/g, '');
  }
  throw new Error(
    'AWS_S3_BUCKET_URL must be an AWS S3 bucket URL without a prefix',
  );
}

@Injectable()
export class MediaStorageService {
  private readonly logger = new Logger(MediaStorageService.name);

  constructor(private readonly config: ConfigService) {}

  private client(): { client: S3Client; bucket: string } {
    try {
      const bucket = s3Bucket(this.config);
      const accessKeyId = this.config.get<string>('AWS_S3_ACCESS_KEY_ID');
      const secretAccessKey = this.config.get<string>(
        'AWS_S3_SECRET_ACCESS_KEY',
      );
      if (!accessKeyId || !secretAccessKey)
        throw new Error('S3 credentials missing');
      return {
        bucket,
        client: new S3Client({
          region: 'eu-central-1',
          credentials: { accessKeyId, secretAccessKey },
          maxAttempts: 2,
          requestHandler: { connectionTimeout: 5000, requestTimeout: 30000 },
        }),
      };
    } catch {
      throw new ServiceUnavailableException({
        code: 'CONFIGURATION_UNAVAILABLE',
        message_key: 'errors.configuration_unavailable',
      });
    }
  }

  async put(
    key: string,
    bytes: Buffer,
    mime: string,
    original: boolean,
  ): Promise<void> {
    const { client, bucket } = this.client();
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: bytes,
          ContentType: mime,
          CacheControl: original
            ? 'private, no-store'
            : 'public, max-age=31536000, immutable',
          ChecksumSHA256: createHash('sha256').update(bytes).digest('base64'),
          IfNoneMatch: '*',
        }),
      );
    } catch (error) {
      this.logger.warn(
        `Media S3 upload failed (${storageErrorDetails(error)})`,
      );
      throw new ServiceUnavailableException({
        code: 'STORAGE_UNAVAILABLE',
        message_key: 'errors.temporary_unavailable',
      });
    } finally {
      client.destroy();
    }
  }

  async verifyImages(prefix: string, derivatives: StoredDerivative[]): Promise<void> {
    if (!derivatives.length) {
      throw new ConflictException({ code: 'MEDIA_NOT_READY', message_key: 'errors.media_not_ready' });
    }
    const { client, bucket } = this.client();
    try {
      for (const entry of derivatives) {
        if (!entry.object_key.startsWith(prefix) ||
            !Number.isSafeInteger(entry.bytes) || entry.bytes < 1 ||
            entry.bytes > 20 * 1024 * 1024) {
          throw new ConflictException({ code: 'MEDIA_NOT_READY', message_key: 'errors.media_not_ready' });
        }
        let response;
        try {
          response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: entry.object_key }));
        } catch (error) {
          const status = error && typeof error === 'object' && '$metadata' in error &&
            error.$metadata && typeof error.$metadata === 'object' && 'httpStatusCode' in error.$metadata
            ? error.$metadata.httpStatusCode : undefined;
          if (status === 404) {
            throw new ConflictException({ code: 'MEDIA_NOT_READY', message_key: 'errors.media_not_ready' });
          }
          this.logger.warn(`Media verification failed (${storageErrorDetails(error)})`);
          throw new ServiceUnavailableException({ code: 'STORAGE_UNAVAILABLE', message_key: 'errors.temporary_unavailable' });
        }
        if (!response.Body || response.ContentLength !== entry.bytes || response.ContentType !== 'image/webp') {
          if (response.Body) await response.Body.transformToWebStream().cancel();
          throw new ConflictException({ code: 'MEDIA_NOT_READY', message_key: 'errors.media_not_ready' });
        }
        const reader = response.Body.transformToWebStream().getReader();
        const chunks: Buffer[] = [];
        let length = 0;
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            length += part.value.byteLength;
            if (length > entry.bytes) {
              await reader.cancel();
              throw new ConflictException({ code: 'MEDIA_NOT_READY', message_key: 'errors.media_not_ready' });
            }
            chunks.push(Buffer.from(part.value));
          }
        } catch (error) {
          if (error instanceof ConflictException) throw error;
          this.logger.warn(`Media verification stream failed (${storageErrorDetails(error)})`);
          throw new ServiceUnavailableException({ code: 'STORAGE_UNAVAILABLE', message_key: 'errors.temporary_unavailable' });
        } finally {
          reader.releaseLock();
        }
        const bytes = Buffer.concat(chunks, length);
        if (bytes.length !== entry.bytes || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
          throw new ConflictException({ code: 'MEDIA_NOT_READY', message_key: 'errors.media_not_ready' });
        }
        let image: sharp.Metadata;
        try {
          const decoder = sharp(bytes, { limitInputPixels: 40000000, failOn: 'warning' });
          image = await decoder.metadata();
          await decoder.stats();
        } catch {
          throw new ConflictException({ code: 'MEDIA_NOT_READY', message_key: 'errors.media_not_ready' });
        }
        if (image.format !== 'webp' || image.width !== entry.width || image.height !== entry.height ||
            (image.pages ?? 1) !== 1) {
          throw new ConflictException({ code: 'MEDIA_NOT_READY', message_key: 'errors.media_not_ready' });
        }
      }
    } finally {
      client.destroy();
    }
  }

  async remove(keys: string[]): Promise<void> {
    if (!keys.length) return;
    const { client, bucket } = this.client();
    try {
      for (const key of keys)
        await client.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: key }),
        );
    } catch (error) {
      this.logger.error(
        `Media cleanup failed; orphaned S3 objects need reconciliation (${storageErrorDetails(error)})`,
      );
      throw new ServiceUnavailableException({
        code: 'STORAGE_CLEANUP_FAILED',
        message_key: 'errors.temporary_unavailable',
      });
    } finally {
      client.destroy();
    }
  }
}

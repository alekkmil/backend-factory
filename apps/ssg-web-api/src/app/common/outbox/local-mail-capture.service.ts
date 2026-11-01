import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isEmail } from 'class-validator';
import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, open, readFile, stat, unlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { hashIdempotencyPayload } from '../transactions/transaction.service';

export interface CapturedMail {
  recipient: string;
  subject: string;
  html: string;
  text: string;
}

export class MailCaptureError extends Error {
  constructor(
    readonly code:
      | 'CAPTURE_NOT_CONFIGURED'
      | 'CAPTURE_STORAGE_UNAVAILABLE'
      | 'CAPTURE_RECORD_INVALID'
      | 'CAPTURE_PAYLOAD_MISMATCH'
      | 'MAIL_INVALID',
  ) {
    super(code);
  }
}

function isFileError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

@Injectable()
export class LocalMailCaptureService {
  private readonly logger = new Logger(LocalMailCaptureService.name);

  constructor(private readonly config: ConfigService) {}

  async capture(key: string, mail: CapturedMail): Promise<string> {
    if (
      key.length < 1 ||
      key.length > 255 ||
      !isEmail(mail.recipient) ||
      /[\r\n]/.test(mail.recipient) ||
      !mail.subject ||
      /[\r\n]/.test(mail.subject) ||
      Buffer.byteLength(JSON.stringify(mail), 'utf8') > 1024 * 1024
    ) {
      throw new MailCaptureError('MAIL_INVALID');
    }
    const directory = this.directory();
    const id = createHash('sha256').update(key).digest('hex');
    const payloadHash = hashIdempotencyPayload(mail);
    const prior = await this.lookup(key, payloadHash);
    if (prior) {
      return prior;
    }

    const temporaryPath = join(directory, `.${id}.${randomUUID()}.tmp`);
    const destination = join(directory, `${id}.json`);
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const directoryInfo = await stat(directory);
      if (!directoryInfo.isDirectory() || (directoryInfo.mode & 0o077) !== 0) {
        throw new MailCaptureError('CAPTURE_NOT_CONFIGURED');
      }
      const temporaryFile = await open(temporaryPath, 'wx', 0o600);
      try {
        await temporaryFile.writeFile(
          JSON.stringify({
            provider_message_id: id,
            payload_hash: payloadHash,
            captured_at: new Date().toISOString(),
            mail,
          }),
        );
        await temporaryFile.sync();
      } finally {
        await temporaryFile.close();
      }
      try {
        await link(temporaryPath, destination);
        const directoryHandle = await open(directory, 'r');
        try {
          await directoryHandle.sync();
        } finally {
          await directoryHandle.close();
        }
      } catch (error) {
        if (!isFileError(error, 'EEXIST')) {
          throw error;
        }
      }
      const stored = await this.lookup(key, payloadHash);
      if (!stored) {
        throw new MailCaptureError('CAPTURE_RECORD_INVALID');
      }
      return stored;
    } catch (error) {
      if (error instanceof MailCaptureError) {
        throw error;
      }
      throw new MailCaptureError('CAPTURE_STORAGE_UNAVAILABLE');
    } finally {
      await this.removeTemporary(temporaryPath);
    }
  }

  async lookup(key: string, expectedPayloadHash?: string): Promise<string | null> {
    if (key.length < 1 || key.length > 255) {
      throw new MailCaptureError('MAIL_INVALID');
    }
    const directory = this.directory();
    const id = createHash('sha256').update(key).digest('hex');
    let content: string;
    try {
      const directoryInfo = await stat(directory);
      if (!directoryInfo.isDirectory() || (directoryInfo.mode & 0o077) !== 0) {
        throw new MailCaptureError('CAPTURE_NOT_CONFIGURED');
      }
      const file = join(directory, `${id}.json`);
      const fileInfo = await stat(file);
      if (
        !fileInfo.isFile() ||
        (fileInfo.mode & 0o077) !== 0 ||
        fileInfo.size > 2 * 1024 * 1024
      ) {
        throw new MailCaptureError('CAPTURE_RECORD_INVALID');
      }
      content = await readFile(file, 'utf8');
    } catch (error) {
      if (error instanceof MailCaptureError) {
        throw error;
      }
      if (isFileError(error, 'ENOENT')) {
        return null;
      }
      throw new MailCaptureError('CAPTURE_STORAGE_UNAVAILABLE');
    }
    let record: unknown;
    try {
      record = JSON.parse(content);
    } catch {
      throw new MailCaptureError('CAPTURE_RECORD_INVALID');
    }
    if (
      record === null ||
      typeof record !== 'object' ||
      !('provider_message_id' in record) ||
      record.provider_message_id !== id ||
      !('payload_hash' in record) ||
      typeof record.payload_hash !== 'string' ||
      !('mail' in record) ||
      record.mail === null ||
      typeof record.mail !== 'object' ||
      Array.isArray(record.mail) ||
      !('recipient' in record.mail) ||
      typeof record.mail.recipient !== 'string' ||
      !('subject' in record.mail) ||
      typeof record.mail.subject !== 'string' ||
      !('html' in record.mail) ||
      typeof record.mail.html !== 'string' ||
      !('text' in record.mail) ||
      typeof record.mail.text !== 'string' ||
      hashIdempotencyPayload(record.mail) !== record.payload_hash
    ) {
      throw new MailCaptureError('CAPTURE_RECORD_INVALID');
    }
    if (expectedPayloadHash && record.payload_hash !== expectedPayloadHash) {
      throw new MailCaptureError('CAPTURE_PAYLOAD_MISMATCH');
    }
    return id;
  }

  private directory(): string {
    const directory = this.config.get<string>('OUTBOX_CAPTURE_DIRECTORY');
    if (
      this.config.get<string>('NODE_ENV') === 'production' ||
      !directory ||
      !isAbsolute(directory)
    ) {
      throw new MailCaptureError('CAPTURE_NOT_CONFIGURED');
    }
    return directory;
  }

  private async removeTemporary(path: string): Promise<void> {
    try {
      await unlink(path);
    } catch (error) {
      if (!isFileError(error, 'ENOENT')) {
        this.logger.warn('Mail capture temporary-file cleanup failed; operational attention required');
      }
    }
  }
}

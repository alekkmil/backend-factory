import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Injectable } from '@nestjs/common';
import { EnquiryFields, isEnquiryFields } from './enquiry-fields';

interface EncryptedValue {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
}

@Injectable()
export class EnquiryCryptoService {
  private readonly encryptionKey: Buffer;
  private readonly hashKey: Buffer;

  constructor(config: ConfigService) {
    const encodedKey = config.getOrThrow<string>('ENQUIRY_ENCRYPTION_KEY');
    const key = Buffer.from(encodedKey, 'base64');
    if (
      key.length !== 32 ||
      key.toString('base64').replace(/=+$/, '') !== encodedKey.replace(/=+$/, '')
    ) {
      throw new Error('ENQUIRY_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
    }

    this.encryptionKey = key;
    this.hashKey = createHmac('sha256', key)
      .update('skv-enquiry-hmac-v1')
      .digest();
  }

  encrypt(fields: EnquiryFields, requestId: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    cipher.setAAD(Buffer.from(requestId));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(fields), 'utf8'),
      cipher.final(),
    ]);
    const value: EncryptedValue = {
      version: 1,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
    return Buffer.from(JSON.stringify(value)).toString('base64');
  }

  decrypt(value: string, requestId: string): EnquiryFields {
    const serialized: unknown = JSON.parse(
      Buffer.from(value, 'base64').toString('utf8'),
    );
    if (
      typeof serialized !== 'object' ||
      serialized === null ||
      !('version' in serialized) ||
      serialized.version !== 1 ||
      !('iv' in serialized) ||
      typeof serialized.iv !== 'string' ||
      !('tag' in serialized) ||
      typeof serialized.tag !== 'string' ||
      !('ciphertext' in serialized) ||
      typeof serialized.ciphertext !== 'string'
    ) {
      throw new Error('Stored enquiry payload has an unsupported format');
    }

    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey,
      Buffer.from(serialized.iv, 'base64'),
    );
    decipher.setAAD(Buffer.from(requestId));
    decipher.setAuthTag(Buffer.from(serialized.tag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(serialized.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
    const fields: unknown = JSON.parse(plaintext);

    if (!isEnquiryFields(fields)) {
      throw new Error('Stored enquiry payload is invalid');
    }

    return fields;
  }

  hash(value: string): string {
    return createHmac('sha256', this.hashKey).update(value).digest('hex');
  }

  hashesMatch(first: string, second: string): boolean {
    const firstBuffer = Buffer.from(first, 'hex');
    const secondBuffer = Buffer.from(second, 'hex');
    return (
      firstBuffer.length === secondBuffer.length &&
      timingSafeEqual(firstBuffer, secondBuffer)
    );
  }
}

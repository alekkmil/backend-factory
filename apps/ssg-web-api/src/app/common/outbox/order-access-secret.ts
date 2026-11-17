import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export function hashOrderAccessToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function encryptOrderAccessSecret(
  value: string,
  key: Buffer,
  context: string,
): string {
  if (key.length !== 32) throw new TypeError('Order access encryption key must be 32 bytes');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url')].join('.');
}

export function decryptOrderAccessSecret(
  envelope: string,
  key: Buffer,
  context: string,
): string {
  if (key.length !== 32) throw new TypeError('Order access encryption key must be 32 bytes');
  const parts = envelope.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1' ||
      parts.slice(1).some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) {
    throw new TypeError('Invalid order access envelope');
  }
  const iv = Buffer.from(parts[1], 'base64url');
  const tag = Buffer.from(parts[2], 'base64url');
  if (iv.length !== 12 || tag.length !== 16) {
    throw new TypeError('Invalid order access envelope');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(context, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(Buffer.from(parts[3], 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

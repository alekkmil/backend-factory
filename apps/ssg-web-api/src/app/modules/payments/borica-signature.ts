import { constants, createPublicKey, KeyObject, sign, verify } from 'node:crypto';

export function boricaGatewayPublicKey(value: string): KeyObject {
  if (!value || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new TypeError('BORICA_GATEWAY_PUBLIC_KEY_BASE64 must encode the complete PEM public key');
  }
  const pem = Buffer.from(value, 'base64').toString('utf8').trim();
  if (!/^-----BEGIN (?:RSA )?PUBLIC KEY-----\r?\n/.test(pem) ||
    !/-----END (?:RSA )?PUBLIC KEY-----$/.test(pem)) {
    throw new TypeError('BORICA gateway verification requires a PEM public key, not a private key');
  }
  const key = createPublicKey(pem);
  assertRsa2048(key, 'public');
  return key;
}

export function signBoricaInquiry(
  terminal: string, order: string, nonce: string, privateKey: KeyObject,
): string {
  assertRsa2048(privateKey, 'private');
  if (!/^[A-Za-z0-9]{8}$/.test(terminal) || !/^\d{6}$/.test(order) ||
    !/^[0-9A-F]{32}$/.test(nonce)) throw new TypeError('Invalid BORICA inquiry fields');
  return sign('sha256', signingPayload([terminal, '90', order, nonce]), {
    key: privateKey, padding: constants.RSA_PKCS1_PADDING,
  }).toString('hex').toUpperCase();
}

export interface BoricaPaymentSigningFields {
  terminal: string;
  amount: string;
  currency: string;
  order: string;
  timestamp: string;
  nonce: string;
}

const RESPONSE_FIELDS = [
  'ACTION',
  'RC',
  'APPROVAL',
  'TERMINAL',
  'TRTYPE',
  'AMOUNT',
  'CURRENCY',
  'ORDER',
  'RRN',
  'INT_REF',
  'PARES_STATUS',
  'ECI',
  'TIMESTAMP',
  'NONCE',
] as const;

const REQUIRED_RESPONSE_FIELDS = new Set<string>([
  'ACTION',
  'RC',
  'TERMINAL',
  'TRTYPE',
  'ORDER',
  'TIMESTAMP',
  'NONCE',
]);

function signingPayload(fields: (string | undefined)[]): Buffer {
  const parts: Buffer[] = [];
  for (const value of fields) {
    if (value === undefined || value.length === 0) {
      parts.push(Buffer.from('-'));
    } else {
      const bytes = Buffer.from(value, 'utf8');
      parts.push(Buffer.from(String(bytes.length)), bytes);
    }
  }
  return Buffer.concat(parts);
}

function assertRsa2048(key: KeyObject, type: 'private' | 'public'): void {
  if (
    key.type !== type ||
    key.asymmetricKeyType !== 'rsa' ||
    key.asymmetricKeyDetails?.modulusLength !== 2048
  ) {
    throw new TypeError(`BORICA requires a 2048-bit RSA ${type} key`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function signBoricaPayment(
  fields: BoricaPaymentSigningFields,
  privateKey: KeyObject,
): string {
  assertRsa2048(privateKey, 'private');
  if (
    !/^[A-Za-z0-9]{8}$/.test(fields.terminal) ||
    !/^(?:0|[1-9]\d{0,8})\.\d{2}$/.test(fields.amount) ||
    fields.amount === '0.00' ||
    BigInt(fields.amount.replace('.', '')) > 200000n ||
    fields.currency !== 'EUR' ||
    !/^\d{6}$/.test(fields.order) ||
    !/^\d{14}$/.test(fields.timestamp) ||
    !/^[0-9A-F]{32}$/.test(fields.nonce)
  ) {
    throw new TypeError('Invalid BORICA payment signing fields');
  }
  const payload = signingPayload([
    fields.terminal,
    '1',
    fields.amount,
    fields.currency,
    fields.order,
    fields.timestamp,
    fields.nonce,
    undefined,
  ]);
  return sign('sha256', payload, {
    key: privateKey,
    padding: constants.RSA_PKCS1_PADDING,
  }).toString('hex').toUpperCase();
}

export function verifyBoricaResponseSignature(
  response: unknown,
  publicKey: KeyObject,
): boolean {
  assertRsa2048(publicKey, 'public');
  if (!isRecord(response)) {
    return false;
  }
  const fields = response;
  if (
    typeof fields.P_SIGN !== 'string' ||
    !/^[0-9a-fA-F]{512}$/.test(fields.P_SIGN) ||
    (fields.MERCH_TOKEN_ID !== undefined && fields.MERCH_TOKEN_ID !== '') ||
    (fields.RFU !== undefined && fields.RFU !== '')
  ) {
    return false;
  }

  const values: (string | undefined)[] = [];
  for (const name of RESPONSE_FIELDS) {
    const value = fields[name];
    if (
      (value !== undefined && typeof value !== 'string') ||
      (REQUIRED_RESPONSE_FIELDS.has(name) && (!value || typeof value !== 'string'))
    ) {
      return false;
    }
    values.push(value);
  }
  values.push(undefined);

  return verify(
    'sha256',
    signingPayload(values),
    { key: publicKey, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(fields.P_SIGN, 'hex'),
  );
}

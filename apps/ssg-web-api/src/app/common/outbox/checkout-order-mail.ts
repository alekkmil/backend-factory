import { ConfigService } from '@nestjs/config';
import { isEmail } from 'class-validator';
import { randomBytes, randomUUID } from 'node:crypto';
import { Prisma } from '../../../generated/prisma/client';
import type { Locale } from '../../../generated/prisma/enums';
import { OutboxService } from './outbox.service';
import { encryptOrderAccessSecret, hashOrderAccessToken } from './order-access-secret';

export async function enqueueCheckoutOrderMail(
  transaction: Prisma.TransactionClient,
  outbox: OutboxService,
  config: ConfigService,
  input: {
    orderId: string;
    email: string;
    locale: Locale;
    kind: 'customer_payment_received' | 'customer_order_access';
    dedupeKey: string;
    paymentAttemptId?: string;
  },
): Promise<void> {
  if (!isEmail(input.email) ||
      (input.kind === 'customer_payment_received' &&
        !input.paymentAttemptId) ||
      (input.kind === 'customer_order_access' &&
        input.paymentAttemptId !== undefined)) {
    throw new TypeError('Invalid checkout order mail intent');
  }
  const token = randomBytes(32).toString('base64url');
  const grantId = randomUUID();
  const ttl = config.getOrThrow<number>('ORDER_ACCESS_GRANT_TTL_SECONDS');
  const encryptionKey = Buffer.from(
    config.getOrThrow<string>('ORDER_ACCESS_ENCRYPTION_KEY_BASE64'), 'base64',
  );
  await transaction.accessGrant.create({
    data: {
      id: grantId,
      orderId: input.orderId,
      scope: 'customer_read',
      tokenHash: hashOrderAccessToken(token),
      expiresAt: new Date(Date.now() + ttl * 1000),
    },
  });
  await outbox.enqueue(transaction, {
    kind: input.kind,
    dedupeKey: input.dedupeKey,
    orderId: input.orderId,
    recipientSnapshot: input.email,
    locale: input.locale,
    templateVersion: 'checkout-order-v1',
    encryptedSecret: encryptOrderAccessSecret(token, encryptionKey, `${input.orderId}:${grantId}`),
    payload: {
      kind: input.kind,
      order_id: input.orderId,
      grant_id: grantId,
      ...(input.paymentAttemptId ? { payment_attempt_id: input.paymentAttemptId } : {}),
    },
  });
}

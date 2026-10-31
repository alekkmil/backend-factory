import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../../generated/prisma/client';
import type {
  JobKind,
  Locale,
} from '../../../generated/prisma/enums';
import { hashIdempotencyPayload } from '../transactions/transaction.service';

export interface OutboxIntent {
  dedupeKey: string;
  kind: JobKind;
  payload: Prisma.InputJsonObject;
  orderId?: string | null;
  inquiryId?: string | null;
  recipientSnapshot?: string | null;
  locale?: Locale | null;
  templateVersion?: string | null;
  encryptedSecret?: string | null;
}

export interface ClaimedOutboxMessage {
  id: string;
  dedupeKey: string;
  kind: JobKind;
  payload: Prisma.JsonValue;
  orderId: string | null;
  inquiryId: string | null;
  recipientSnapshot: string | null;
  locale: Locale | null;
  templateVersion: string | null;
  encryptedSecret: string | null;
  attemptNumber: number;
}

@Injectable()
export class OutboxService {
  async enqueue(
    transaction: Prisma.TransactionClient,
    intent: OutboxIntent,
  ): Promise<{ id: string; created: boolean }> {
    if (intent.dedupeKey.length < 1 || intent.dedupeKey.length > 255) {
      throw new TypeError('Outbox deduplication key is invalid');
    }

    const now = new Date();
    const insertion = await transaction.outboxMessage.createMany({
      data: [
        {
          id: randomUUID(),
          dedupeKey: intent.dedupeKey,
          kind: intent.kind,
          payload: intent.payload,
          orderId: intent.orderId ?? null,
          inquiryId: intent.inquiryId ?? null,
          recipientSnapshot: intent.recipientSnapshot ?? null,
          locale: intent.locale ?? null,
          templateVersion: intent.templateVersion ?? null,
          encryptedSecret: intent.encryptedSecret ?? null,
          createdAt: now,
          updatedAt: now,
        },
      ],
      skipDuplicates: true,
    });

    const message = await transaction.outboxMessage.findUnique({
      where: { dedupeKey: intent.dedupeKey },
      select: {
        id: true,
        kind: true,
        payload: true,
        orderId: true,
        inquiryId: true,
        recipientSnapshot: true,
        locale: true,
        templateVersion: true,
        encryptedSecret: true,
      },
    });
    if (!message) {
      throw new Error('Outbox message was not readable after enqueue');
    }

    const matches =
      message.kind === intent.kind &&
      hashIdempotencyPayload(message.payload) ===
        hashIdempotencyPayload(intent.payload) &&
      message.orderId === (intent.orderId ?? null) &&
      message.inquiryId === (intent.inquiryId ?? null) &&
      message.recipientSnapshot === (intent.recipientSnapshot ?? null) &&
      message.locale === (intent.locale ?? null) &&
      message.templateVersion === (intent.templateVersion ?? null) &&
      message.encryptedSecret === (intent.encryptedSecret ?? null);
    if (!matches) {
      throw new ConflictException({
        code: 'REQUEST_PAYLOAD_MISMATCH',
        message_key: 'errors.request_payload_mismatch',
      });
    }

    return {
      id: message.id,
      created: insertion.count === 1,
    };
  }

  async claimNext(
    transaction: Prisma.TransactionClient,
    leaseOwner: string,
    now: Date,
    leaseMilliseconds: number,
    maximumAttempts: number,
  ): Promise<ClaimedOutboxMessage | null> {
    if (
      leaseOwner.length < 1 ||
      leaseOwner.length > 128 ||
      !Number.isInteger(leaseMilliseconds) ||
      leaseMilliseconds < 1000 ||
      !Number.isInteger(maximumAttempts) ||
      maximumAttempts < 1
    ) {
      throw new TypeError('Outbox lease configuration is invalid');
    }

    const leaseUntil = new Date(now.getTime() + leaseMilliseconds);
    const messages = await transaction.$queryRaw<ClaimedOutboxMessage[]>`
      WITH candidate AS (
        SELECT id
        FROM "OutboxMessage"
        WHERE status IN ('pending', 'failed')
          AND (
            attempts < ${maximumAttempts}
            OR (
              status = 'pending'
              AND "leaseUntil" IS NOT NULL
              AND "leaseUntil" <= ${now}
            )
          )
          AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= ${now})
          AND ("leaseUntil" IS NULL OR "leaseUntil" <= ${now})
        ORDER BY "createdAt", id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE "OutboxMessage" AS message
      SET status = 'pending',
          attempts = message.attempts + 1,
          "leaseUntil" = ${leaseUntil},
          "leaseOwner" = ${leaseOwner},
          "updatedAt" = ${now}
      FROM candidate
      WHERE message.id = candidate.id
      RETURNING message.id, message."dedupeKey", message.kind, message.payload, message."orderId",
        message."inquiryId", message."recipientSnapshot", message.locale,
        message."templateVersion", message."encryptedSecret",
        message.attempts AS "attemptNumber"
    `;
    const message = messages[0];
    if (!message) {
      return null;
    }

    await transaction.deliveryAttempt.updateMany({
      where: {
        messageId: message.id,
        attemptNumber: message.attemptNumber - 1,
        finishedAt: null,
      },
      data: {
        finishedAt: now,
        outcome: 'lease_expired',
        safeError: 'The previous worker lease expired.',
      },
    });
    await transaction.deliveryAttempt.create({
      data: {
        messageId: message.id,
        attemptNumber: message.attemptNumber,
        startedAt: now,
      },
    });
    return message;
  }

  async finishClaim(
    transaction: Prisma.TransactionClient,
    input: {
      messageId: string;
      leaseOwner: string;
      attemptNumber: number;
      outcome: 'sent' | 'failed' | 'suppressed';
      safeError?: string | null;
      providerMessageId?: string | null;
      nextAttemptAt?: Date | null;
      finishedAt: Date;
    },
  ): Promise<void> {
    const changed = await transaction.outboxMessage.updateMany({
      where: {
        id: input.messageId,
        status: 'pending',
        leaseOwner: input.leaseOwner,
        leaseUntil: { gt: input.finishedAt },
        attempts: input.attemptNumber,
      },
      data: {
        status: input.outcome,
        leaseOwner: null,
        leaseUntil: null,
        nextAttemptAt: input.nextAttemptAt ?? null,
        lastError: input.safeError ?? null,
        providerMessageId: input.providerMessageId ?? null,
        sentAt: input.outcome === 'sent' ? input.finishedAt : null,
        updatedAt: input.finishedAt,
      },
    });
    if (changed.count !== 1) {
      throw new ServiceUnavailableException({
        code: 'TEMPORARY_UNAVAILABLE',
        message_key: 'errors.temporary_unavailable',
      });
    }
    await transaction.deliveryAttempt.update({
      where: {
        messageId_attemptNumber: {
          messageId: input.messageId,
          attemptNumber: input.attemptNumber,
        },
      },
      data: {
        finishedAt: input.finishedAt,
        outcome: input.outcome,
        safeError: input.safeError ?? null,
      },
    });
  }
}

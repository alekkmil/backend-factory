import {
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';

const MAX_SERIALIZABLE_ATTEMPTS = 3;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRetryableTransactionError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2034'
  );
}

function canonicalValue(value: unknown): string {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Idempotency payload contains a non-finite number');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalValue).join(',')}]`;
  }
  if (typeof value === 'object') {
    if (
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    ) {
      throw new TypeError('Idempotency payload must contain plain objects');
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonicalValue(record[key])}`)
      .join(',')}}`;
  }
  throw new TypeError('Idempotency payload is not JSON-compatible');
}

export function hashIdempotencyPayload(payload: unknown): string {
  return createHash('sha256').update(canonicalValue(payload)).digest('hex');
}

export interface StoredActionResponse {
  status_code: number;
  body: Prisma.InputJsonObject;
}

export interface ActionReplay {
  status_code: number;
  body: Prisma.JsonObject | Prisma.InputJsonObject;
  replayed: boolean;
}

function normalizedIds(ids: string[]): string[] {
  if (ids.some((id) => !UUID_PATTERN.test(id))) {
    throw new TypeError('Lock identifiers must be UUIDs');
  }
  return [...new Set(ids)].sort();
}

@Injectable()
export class TransactionService {
  private readonly logger = new Logger(TransactionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async serializable<T>(
    work: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(work, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5000,
          timeout: 10000,
        });
      } catch (error) {
        if (!isRetryableTransactionError(error)) {
          throw error;
        }
        if (attempt === MAX_SERIALIZABLE_ATTEMPTS) {
          this.logger.warn('Serializable transaction retry limit reached');
          throw new ServiceUnavailableException({
            statusCode: 503,
          });
        }
        this.logger.warn(`Retrying serializable transaction (${attempt})`);
      }
    }
    throw new ServiceUnavailableException({ statusCode: 503 });
  }

  async lockSettings(
    transaction: Prisma.TransactionClient,
  ): Promise<{ id: number; version: number } | null> {
    const rows = await transaction.$queryRaw<
      { id: number; version: number }[]
    >`SELECT id, version FROM "ShopSettings" WHERE id = 1 FOR UPDATE`;
    return rows[0] ?? null;
  }

  async lockProducts(
    transaction: Prisma.TransactionClient,
    ids: string[],
  ): Promise<{ id: string; version: number }[]> {
    const sortedIds = normalizedIds(ids);
    if (sortedIds.length === 0) {
      return [];
    }
    return transaction.$queryRaw<
      { id: string; version: number }[]
    >`SELECT id, version FROM "Product" WHERE id = ANY(${sortedIds}::uuid[]) ORDER BY id FOR UPDATE`;
  }

  async lockStockItems(
    transaction: Prisma.TransactionClient,
    ids: string[],
  ): Promise<{ id: string; version: number }[]> {
    const sortedIds = normalizedIds(ids);
    if (sortedIds.length === 0) {
      return [];
    }
    return transaction.$queryRaw<
      { id: string; version: number }[]
    >`SELECT id, version FROM "StockItem" WHERE id = ANY(${sortedIds}::uuid[]) ORDER BY id FOR UPDATE`;
  }

  async lockOrders(
    transaction: Prisma.TransactionClient,
    ids: string[],
  ): Promise<{ id: string; version: number }[]> {
    const sortedIds = normalizedIds(ids);
    if (sortedIds.length === 0) {
      return [];
    }
    return transaction.$queryRaw<
      { id: string; version: number }[]
    >`SELECT id, version FROM "Order" WHERE id = ANY(${sortedIds}::uuid[]) ORDER BY id FOR UPDATE`;
  }

  async executeIdempotentAction(
    transaction: Prisma.TransactionClient,
    input: {
      scopeKey: string;
      requestId: string;
      payload: unknown;
    },
    work: () => Promise<StoredActionResponse>,
  ): Promise<ActionReplay> {
    if (
      input.scopeKey.length < 1 ||
      input.scopeKey.length > 255 ||
      !REQUEST_ID_PATTERN.test(input.requestId)
    ) {
      throw new TypeError('Idempotency scope or request identifier is invalid');
    }

    const payloadHash = hashIdempotencyPayload(input.payload);
    const now = new Date();
    await transaction.actionRequest.createMany({
      data: [
        {
          id: randomUUID(),
          scopeKey: input.scopeKey,
          requestId: input.requestId,
          payloadHash,
          createdAt: now,
          updatedAt: now,
        },
      ],
      skipDuplicates: true,
    });

    const rows = await transaction.$queryRaw<
      {
        id: string;
        payloadHash: string;
        state: string;
        result: Prisma.JsonValue | null;
      }[]
    >`SELECT id, "payloadHash", state::text, result FROM "ActionRequest" WHERE "scopeKey" = ${input.scopeKey} AND "requestId" = ${input.requestId} FOR UPDATE`;
    const action = rows[0];
    if (!action) {
      throw new Error('Idempotency claim could not be read after insertion');
    }
    if (action.payloadHash !== payloadHash) {
      throw new ConflictException({
        code: 'REQUEST_PAYLOAD_MISMATCH',
        message_key: 'errors.request_payload_mismatch',
      });
    }
    if (action.state === 'committed' || action.state === 'rejected') {
      return this.readStoredAction(action.result);
    }

    const response = await work();
    const state = response.status_code >= 400 ? 'rejected' : 'committed';
    const result: Prisma.InputJsonObject = {
      status_code: response.status_code,
      body: response.body,
    };
    await transaction.actionRequest.update({
      where: { id: action.id },
      data: { state, result },
    });
    return {
      status_code: response.status_code,
      body: response.body,
      replayed: false,
    };
  }

  private readStoredAction(value: Prisma.JsonValue | null): ActionReplay {
    if (
      value === null ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      typeof value.status_code !== 'number' ||
      value.body === undefined ||
      value.body === null ||
      typeof value.body !== 'object' ||
      Array.isArray(value.body)
    ) {
      throw new Error('Stored idempotency result is malformed');
    }
    return {
      status_code: value.status_code,
      body: value.body,
      replayed: true,
    };
  }
}

import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import {
  EnquiryKind,
  EnquiryLocale,
  EnquiryRouteContextDto,
  SubmitEnquiryDto,
} from './dto/submit-enquiry.dto';
import { EnquiryContextRegistryService } from './enquiry-context-registry.service';
import { EnquiryCryptoService } from './enquiry-crypto.service';
import { EnquiryFields, normalizeEnquiryFields } from './enquiry-fields';
import { EnquiryException } from './enquiry-exception';
import { EnquiryRateLimiterService } from './enquiry-rate-limiter.service';

export interface AcceptedEnquiry {
  requestId: string;
  status: 'accepted';
}

interface EnquiryEnvelope {
  kind: EnquiryKind;
  locale: EnquiryLocale;
  sourcePath: string;
  routeContext?: EnquiryRouteContextDto;
  fields: EnquiryFields;
}

@Injectable()
export class EnquiriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: EnquiryCryptoService,
    private readonly contexts: EnquiryContextRegistryService,
    private readonly rateLimiter: EnquiryRateLimiterService,
  ) {}

  async submit(
    dto: SubmitEnquiryDto,
    idempotencyKey: string,
    ipAddress: string,
  ): Promise<AcceptedEnquiry> {
    if (dto.antiSpamToken !== undefined) {
      throw new EnquiryException(403, 'spam_rejected');
    }
    if (!isUuid(idempotencyKey)) {
      throw new EnquiryException(400, 'invalid_request');
    }

    const fields = normalizeEnquiryFields(dto.kind, dto.fields);
    this.contexts.assertAllowed(dto.sourcePath, dto.routeContext);
    const routeContext = normalizeRouteContext(dto.routeContext);
    const envelope: EnquiryEnvelope = {
      kind: dto.kind,
      locale: dto.locale,
      sourcePath: dto.sourcePath,
      ...(routeContext === undefined ? {} : { routeContext }),
      fields,
    };
    const payloadHash = this.crypto.hash(JSON.stringify(envelope));
    const idempotencyKeyHash = this.crypto.hash(idempotencyKey);
    const now = new Date();
    const existing = await this.findActiveIdempotencyKey(
      idempotencyKeyHash,
      now,
    );
    if (existing) {
      return this.replayOrConflict(existing, payloadHash);
    }

    await this.rateLimiter.assertWithinLimits(
      ipAddress,
      typeof fields.email === 'string' ? fields.email : '',
    );

    const requestId = randomUUID();
    try {
      await this.prisma.$transaction(async (transaction) => {
        await transaction.enquiry.create({
          data: {
            requestId,
            kind: dto.kind,
            locale: dto.locale,
            sourcePath: dto.sourcePath,
            routeContext:
              routeContext === undefined
                ? Prisma.DbNull
                : {
                    ...(routeContext.pageId === undefined
                      ? {}
                      : { pageId: routeContext.pageId }),
                    ...(routeContext.routeId === undefined
                      ? {}
                      : { routeId: routeContext.routeId }),
                    ...(routeContext.tunnelId === undefined
                      ? {}
                      : { tunnelId: routeContext.tunnelId }),
                  } satisfies Prisma.InputJsonObject,
            encryptedFields: this.crypto.encrypt(fields, requestId),
            payloadHash,
            idempotencyKeyHash,
            idempotencyExpiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          },
        });
        await transaction.notificationOutbox.create({
          data: {
            requestId,
            status: 'pending',
          },
        });
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const racedRequest = await this.findActiveIdempotencyKey(
          idempotencyKeyHash,
          new Date(),
        );
        if (racedRequest) {
          return this.replayOrConflict(racedRequest, payloadHash);
        }
      }
      throw error;
    }

    return { requestId, status: 'accepted' };
  }

  private async findActiveIdempotencyKey(
    idempotencyKeyHash: string,
    now: Date,
  ): Promise<{ requestId: string; payloadHash: string } | null> {
    await this.prisma.enquiry.updateMany({
      where: {
        idempotencyKeyHash,
        idempotencyExpiresAt: { lte: now },
      },
      data: {
        idempotencyKeyHash: null,
        idempotencyExpiresAt: null,
      },
    });
    return this.prisma.enquiry.findFirst({
      where: {
        idempotencyKeyHash,
        idempotencyExpiresAt: { gt: now },
      },
      select: {
        requestId: true,
        payloadHash: true,
      },
    });
  }

  private replayOrConflict(
    existing: { requestId: string; payloadHash: string },
    payloadHash: string,
  ): AcceptedEnquiry {
    if (!this.crypto.hashesMatch(existing.payloadHash, payloadHash)) {
      throw new EnquiryException(409, 'idempotency_conflict');
    }

    return { requestId: existing.requestId, status: 'accepted' };
  }
}

export function normalizeRouteContext(
  routeContext?: EnquiryRouteContextDto,
): EnquiryRouteContextDto | undefined {
  if (!routeContext) {
    return undefined;
  }

  const normalized = {
    ...(routeContext.pageId === undefined
      ? {}
      : { pageId: routeContext.pageId }),
    ...(routeContext.routeId === undefined
      ? {}
      : { routeId: routeContext.routeId }),
    ...(routeContext.tunnelId === undefined
      ? {}
      : { tunnelId: routeContext.tunnelId }),
  };

  return Object.keys(normalized).length === 0 ? undefined : normalized;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function isUniqueConstraintError(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

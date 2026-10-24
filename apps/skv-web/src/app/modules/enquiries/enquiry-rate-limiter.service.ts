import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { EnquiryCryptoService } from './enquiry-crypto.service';
import { EnquiryException } from './enquiry-exception';

interface BucketCount {
  count: number;
}

@Injectable()
export class EnquiryRateLimiterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: EnquiryCryptoService,
  ) {}

  async assertWithinLimits(ipAddress: string, email: string): Promise<void> {
    const now = new Date();
    const ipLimit = await this.incrementBucket(
      'ip',
      this.crypto.hash(`ip:${ipAddress}`),
      now,
      60_000,
      5,
    );
    if (ipLimit) {
      throw new EnquiryException(
        429,
        'rate_limited',
        undefined,
        ipLimit,
      );
    }

    const emailLimit = await this.incrementBucket(
      'email',
      this.crypto.hash(`email:${email.trim().toLowerCase()}`),
      now,
      3_600_000,
      20,
    );
    if (emailLimit) {
      throw new EnquiryException(
        429,
        'rate_limited',
        undefined,
        emailLimit,
      );
    }
  }

  private async incrementBucket(
    bucketType: 'ip' | 'email',
    keyHash: string,
    now: Date,
    windowMs: number,
    limit: number,
  ): Promise<number | undefined> {
    const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
    const expiresAt = new Date(windowStart.getTime() + windowMs * 2);
    const rows = await this.prisma.$queryRaw<BucketCount[]>(
      Prisma.sql`
        INSERT INTO "EnquiryRateLimitBucket"
          ("keyHash", "bucketType", "windowStart", "count", "expiresAt")
        VALUES (${keyHash}, ${bucketType}, ${windowStart}, 1, ${expiresAt})
        ON CONFLICT ("keyHash", "bucketType", "windowStart")
        DO UPDATE SET "count" = "EnquiryRateLimitBucket"."count" + 1
        RETURNING "count"
      `,
    );
    const count = rows[0]?.count;
    if (count === undefined || count <= limit) {
      return undefined;
    }

    return Math.max(
      1,
      Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000),
    );
  }
}

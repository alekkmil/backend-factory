import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { Prisma } from '../../../generated/prisma/client';
import { OutboxService } from '../../common/outbox/outbox.service';
import {
  encryptOrderAccessSecret,
  hashOrderAccessToken,
} from '../../common/outbox/order-access-secret';
import { TransactionService } from '../../common/transactions/transaction.service';
import { PrismaService } from '../../database/prisma.service';
import type { OrderAccessRequestDto } from './order-access.dto';
import { paymentHold } from './payment-hold';

const ACCESS_COOKIE = 'ssg_order_access';
const ORDER_VIEW_INCLUDE = {
  from_OrderLine_orderId: { orderBy: { sortOrder: 'asc' } },
  bankPaymentAttempt: true,
} satisfies Prisma.OrderInclude;

function jsonObject(value: Prisma.JsonValue): Prisma.JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ServiceUnavailableException({
      code: 'TEMPORARILY_UNAVAILABLE', message_key: 'errors.temporary_unavailable',
    });
  }
  return value;
}

@Injectable()
export class OrderAccessService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionService,
    private readonly outbox: OutboxService,
  ) {}

  private assertEnabled(): void {
    if (!this.config.get<string>('ORDER_ACCESS_ENCRYPTION_KEY_BASE64')) {
      throw new ServiceUnavailableException({
        code: 'TEMPORARILY_UNAVAILABLE', message_key: 'errors.temporary_unavailable',
      });
    }
  }

  async requestAccess(guestId: string, input: OrderAccessRequestDto): Promise<void> {
    this.assertEnabled();
    const scopeKey = `checkout:access:${guestId}`;
    await this.transactions.serializable(async (transaction) =>
      this.transactions.executeIdempotentAction(transaction, {
        scopeKey, requestId: input.requestId,
        payload: { orderNumber: input.orderNumber, email: input.email, locale: input.locale },
      }, async () => {
        const action = await transaction.actionRequest.findUniqueOrThrow({
          where: { scopeKey_requestId: { scopeKey, requestId: input.requestId } },
          select: { id: true },
        });
        const id = randomUUID();
        const key = Buffer.from(
          this.config.getOrThrow<string>('ORDER_ACCESS_ENCRYPTION_KEY_BASE64'), 'base64',
        );
        const ttl = this.config.getOrThrow<number>('ORDER_ACCESS_LOOKUP_TTL_SECONDS');
        await transaction.accessLookup.create({
          data: {
            id,
            actionRequestId: action.id,
            guestId,
            encryptedInput: encryptOrderAccessSecret(JSON.stringify({
              orderNumber: input.orderNumber, email: input.email, locale: input.locale,
            }), key, `lookup:${id}`),
            expiresAt: new Date(Date.now() + ttl * 1000),
          },
        });
        await this.outbox.enqueue(transaction, {
          kind: 'customer_access_lookup',
          dedupeKey: `checkout-access-lookup:${id}`,
          payload: { kind: 'customer_access_lookup', lookup_id: id },
        });
        return { status_code: 202, body: { accepted: true } };
      }),
    );
  }

  async exchange(guestId: string, grantToken: string): Promise<{ cookie: string; expiresAt: string }> {
    this.assertEnabled();
    const result = await this.transactions.serializable(async (transaction) => {
      const grant = await transaction.accessGrant.findUnique({
        where: { tokenHash: hashOrderAccessToken(grantToken) },
        select: { id: true },
      });
      if (!grant) throw new UnauthorizedException({ code: 'ACCESS_INVALID' });
      await transaction.$queryRaw`SELECT id FROM "AccessGrant" WHERE id = ${grant.id}::uuid FOR UPDATE`;
      const current = await transaction.accessGrant.findUniqueOrThrow({
        where: { id: grant.id },
        include: { orderIdRelation: { select: { sandbox: true } } },
      });
      const guest = await transaction.guestSession.findUnique({
        where: { id: guestId }, select: { expiresAt: true, revokedAt: true },
      });
      const now = new Date();
      if (
        current.scope !== 'customer_read' || current.orderIdRelation.sandbox ||
        current.revokedAt || current.redeemedAt || current.expiresAt <= now ||
        !guest || guest.revokedAt || guest.expiresAt <= now
      ) throw new UnauthorizedException({ code: 'ACCESS_INVALID' });
      const ttl = this.config.getOrThrow<number>('ORDER_ACCESS_SESSION_TTL_SECONDS');
      const expiry = new Date(Math.min(
        now.getTime() + ttl * 1000, current.expiresAt.getTime(), guest.expiresAt.getTime(),
      ));
      const token = randomBytes(32).toString('base64url');
      await transaction.accessGrant.update({
        where: { id: current.id },
        data: { redeemedAt: now, redeemedGuestId: guestId },
      });
      await transaction.accessSession.create({
        data: {
          grantId: current.id,
          guestId,
          tokenHash: hashOrderAccessToken(token),
          expiresAt: expiry,
        },
      });
      return { token, expiry, now };
    });
    const sameSite = this.config.getOrThrow<'lax' | 'none'>('SESSION_COOKIE_SAME_SITE');
    const maxAge = Math.floor((result.expiry.getTime() - result.now.getTime()) / 1000);
    return {
      cookie: `${ACCESS_COOKIE}=${result.token}; Path=/api/customer-order; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=${sameSite === 'none' ? 'None' : 'Lax'}`,
      expiresAt: result.expiry.toISOString(),
    };
  }

  async view(guestId: string, cookieHeader: string | undefined) {
    this.assertEnabled();
    const cookies = (cookieHeader ?? '').split(';').map((part) => part.trim())
      .filter((part) => part.startsWith(`${ACCESS_COOKIE}=`));
    const token = cookies.length === 1 ? cookies[0].slice(ACCESS_COOKIE.length + 1) : '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new UnauthorizedException({ code: 'ACCESS_INVALID' });
    }
    const now = new Date();
    const session = await this.prisma.accessSession.findFirst({
      where: {
        tokenHash: hashOrderAccessToken(token), guestId, revokedAt: null, expiresAt: { gt: now },
        grantIdRelation: {
          is: {
            scope: 'customer_read', revokedAt: null, expiresAt: { gt: now },
            redeemedGuestId: guestId, orderIdRelation: { is: { sandbox: false } },
          },
        },
      },
      include: {
        grantIdRelation: {
          include: {
            orderIdRelation: {
              include: ORDER_VIEW_INCLUDE,
            },
          },
        },
      },
    });
    if (!session) throw new UnauthorizedException({ code: 'ACCESS_INVALID' });
    return this.project(session.grantIdRelation.orderIdRelation);
  }

  async viewOwned(guestId: string, orderId: string) {
    this.assertEnabled();
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, guestId, sandbox: false },
      include: ORDER_VIEW_INCLUDE,
    });
    if (!order) throw new NotFoundException();
    return this.project(order);
  }

  private async project(order: Prisma.OrderGetPayload<{ include: typeof ORDER_VIEW_INCLUDE }>) {
    const receiving = jsonObject(order.fulfilment);
    const items = order.from_OrderLine_orderId.map((line) => {
      const item = jsonObject(line.snapshot);
      if (
        typeof item.title !== 'string' || typeof item.imageUrl !== 'string' ||
        item.quantity !== 1 || typeof item.unitPriceMinor !== 'number'
      ) {
        throw new ServiceUnavailableException({
          code: 'TEMPORARILY_UNAVAILABLE', message_key: 'errors.temporary_unavailable',
        });
      }
      return {
        title: item.title,
        imageUrl: item.imageUrl,
        variant: item.variant ?? null,
        quantity: 1,
        unitPriceMinor: item.unitPriceMinor,
      };
    });
    const paid = order.bankPaymentAttempt?.outcome === 'paid';
    return {
      orderNumber: order.number,
      createdAt: order.createdAt.toISOString(),
      locale: order.locale,
      hold: paymentHold(order.paymentHoldExpiresAt, order.paymentHoldExpiredAt, order.bankPaymentAttempt),
      items,
      money: {
        currency: order.currency,
        subtotalMinor: order.itemsTotal.mul(100).toNumber(),
        deliveryMinor: order.deliveryFee.mul(100).toNumber(),
        totalMinor: order.total.mul(100).toNumber(),
      },
      payment: paid
        ? { outcome: 'paid', bankVerified: true,
            verifiedPaidMinor: order.bankPaymentAttempt?.amount.mul(100).toNumber() }
        : { outcome: order.bankPaymentAttempt?.outcome ?? 'pending',
            bankVerified: order.bankPaymentAttempt?.outcome === 'failed' },
      receiving: {
        method: receiving.method,
        country: receiving.country,
        ...(typeof receiving.recipientName === 'string' ? { recipientName: receiving.recipientName } : {}),
        ...(typeof receiving.phone === 'string' ? { phone: receiving.phone } : {}),
        ...(typeof receiving.locality === 'string' ? { locality: receiving.locality } : {}),
        ...(typeof receiving.address === 'string' ? { address: receiving.address } : {}),
        ...(typeof receiving.office === 'string' ? { office: receiving.office } : {}),
        ...(typeof receiving.officeAddress === 'string' ? { officeAddress: receiving.officeAddress } : {}),
        ...(typeof receiving.cityId === 'string' ? { cityId: receiving.cityId } : {}),
        ...(typeof receiving.officeId === 'string' ? { officeId: receiving.officeId } : {}),
        ...(typeof receiving.officeCode === 'string' ? { officeCode: receiving.officeCode } : {}),
      },
      nextAction: 'view_order',
    };
  }
}

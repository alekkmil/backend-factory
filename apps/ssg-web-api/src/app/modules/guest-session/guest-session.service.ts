import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';

const SESSION_COOKIE = 'skv_guest_session';
const SESSION_LIFETIME_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 20;

interface RateLimitWindow {
  startedAt: number;
  count: number;
}

@Injectable()
export class GuestSessionService {
  private readonly logger = new Logger(GuestSessionService.name);
  private readonly requestsByIp = new Map<string, RateLimitWindow>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async bootstrap(
    origin: string | undefined,
    clientIp: string,
    cookieHeader: string | undefined,
    setCookie: (value: string) => void,
    setCacheControl: (value: string) => void,
  ): Promise<{ csrf_token: string; expires_at: string }> {
    const approvedOrigins = this.config
      .getOrThrow<string>('CORS_ORIGINS')
      .split(',')
      .map((value) => value.trim());
    if (!origin || !approvedOrigins.includes(origin)) {
      throw new ForbiddenException();
    }
    this.enforceRateLimit(clientIp);

    const existingToken = this.readCookie(cookieHeader);
    const existingHash = existingToken ? this.hashToken(existingToken) : null;
    const now = new Date();
    try {
      const existingSession =
        existingHash === null
          ? null
          : await this.prisma.guestSession.findFirst({
              where: {
                tokenHash: existingHash,
                revokedAt: null,
                expiresAt: { gt: now },
              },
              select: { id: true, expiresAt: true },
            });
      if (existingSession && existingToken) {
        setCacheControl('private, no-store');
        return {
          csrf_token: this.createCsrfToken(
            existingToken,
            existingSession.id,
            origin,
          ),
          expires_at: existingSession.expiresAt.toISOString(),
        };
      }

      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS);
      const session = await this.prisma.guestSession.create({
        data: {
          tokenHash: this.hashToken(token),
          expiresAt,
        },
        select: { id: true, expiresAt: true },
      });
      setCookie(
        `${SESSION_COOKIE}=${token}; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Lax`,
      );
      setCacheControl('private, no-store');
      return {
        csrf_token: this.createCsrfToken(token, session.id, origin),
        expires_at: session.expiresAt.toISOString(),
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError ||
        error instanceof Prisma.PrismaClientUnknownRequestError ||
        error instanceof Prisma.PrismaClientInitializationError
      ) {
        this.logger.warn('Guest session storage is unavailable');
        throw new ServiceUnavailableException({
          code: 'TEMPORARY_UNAVAILABLE',
          message_key: 'errors.temporary_unavailable',
        });
      }
      throw error;
    }
  }

  async assertValidCsrf(
    cookieHeader: string | undefined,
    csrfToken: string | undefined,
    origin: string | undefined,
  ): Promise<void> {
    const approvedOrigins = this.config
      .getOrThrow<string>('CORS_ORIGINS')
      .split(',')
      .map((value) => value.trim());
    const token = this.readCookie(cookieHeader);
    if (
      !token ||
      !csrfToken ||
      !origin ||
      !approvedOrigins.includes(origin)
    ) {
      throw new ForbiddenException();
    }
    try {
      const session = await this.prisma.guestSession.findFirst({
        where: {
          tokenHash: this.hashToken(token),
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: { id: true },
      });
      if (!session) {
        throw new ForbiddenException();
      }
      const expected = Buffer.from(
        this.createCsrfToken(token, session.id, origin),
      );
      const provided = Buffer.from(csrfToken);
      if (
        expected.length !== provided.length ||
        !timingSafeEqual(expected, provided)
      ) {
        throw new ForbiddenException();
      }
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError ||
        error instanceof Prisma.PrismaClientUnknownRequestError ||
        error instanceof Prisma.PrismaClientInitializationError
      ) {
        this.logger.warn('Guest session validation is unavailable');
        throw new ServiceUnavailableException({
          code: 'TEMPORARY_UNAVAILABLE',
          message_key: 'errors.temporary_unavailable',
        });
      }
      throw error;
    }
  }

  private enforceRateLimit(clientIp: string): void {
    const now = Date.now();
    const current = this.requestsByIp.get(clientIp);
    if (!current || now - current.startedAt >= RATE_LIMIT_WINDOW_MS) {
      this.requestsByIp.set(clientIp, { startedAt: now, count: 1 });
    } else if (current.count >= RATE_LIMIT_MAX_REQUESTS) {
      throw new HttpException(
        {
          code: 'TEMPORARY_UNAVAILABLE',
          message_key: 'errors.temporary_unavailable',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    } else {
      current.count += 1;
    }
    if (this.requestsByIp.size > 2048) {
      for (const [ip, window] of this.requestsByIp) {
        if (now - window.startedAt >= RATE_LIMIT_WINDOW_MS) {
          this.requestsByIp.delete(ip);
        }
      }
      while (this.requestsByIp.size > 2048) {
        const oldestIp = this.requestsByIp.keys().next().value;
        if (oldestIp === undefined) {
          break;
        }
        this.requestsByIp.delete(oldestIp);
      }
    }
  }

  private readCookie(header: string | undefined): string | null {
    if (!header) {
      return null;
    }
    const cookie = header
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${SESSION_COOKIE}=`));
    const token = cookie?.slice(SESSION_COOKIE.length + 1);
    return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private createCsrfToken(
    token: string,
    sessionId: string,
    origin: string,
  ): string {
    return createHmac('sha256', token)
      .update(`${sessionId}:${origin}`)
      .digest('base64url');
  }
}

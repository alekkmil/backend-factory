import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';

export interface StockAdapterRequest extends Request {
  stockActorId?: string;
}

@Injectable()
export class StockAdapterGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly db: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<StockAdapterRequest>();
    context
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('Cache-Control', 'private, no-store');
    if (
      this.config.get<string>('NODE_ENV') === 'production' ||
      !this.config.get<boolean>('DEV_STOCK_FACT_AUTH_ENABLED')
    )
      throw new UnauthorizedException();
    const matches = (header: string, key: string) => {
      const provided = request.get(header);
      const expected = this.config.get<string>(key);
      return (
        !!provided &&
        !!expected &&
        timingSafeEqual(
          createHash('sha256').update(provided).digest(),
          createHash('sha256').update(expected).digest(),
        )
      );
    };
    if (!matches('X-Dev-Stock-Token', 'DEV_STOCK_FACT_AUTH_TOKEN'))
      throw new UnauthorizedException();
    const origin = request.get('origin');
    if (
      !origin ||
      !this.config
        .getOrThrow<string>('CORS_ORIGINS')
        .split(',')
        .includes(origin) ||
      !matches('X-CSRF-Token', 'DEV_STOCK_FACT_CSRF_TOKEN')
    )
      throw new ForbiddenException();
    const id = this.config.getOrThrow<string>('DEV_STOCK_FACT_PRINCIPAL_ID');
    try {
      const principal = await this.db.principal.findUnique({
        where: { id },
        select: { kind: true, enabled: true, permissions: true },
      });
      if (
        !principal ||
        !principal.enabled ||
        principal.kind !== 'service' ||
        !principal.permissions.includes('stock_fact_write')
      )
        throw new ForbiddenException();
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError ||
        error instanceof Prisma.PrismaClientUnknownRequestError ||
        error instanceof Prisma.PrismaClientInitializationError
      )
        throw new ServiceUnavailableException();
      throw error;
    }
    request.stockActorId = id;
    return true;
  }
}

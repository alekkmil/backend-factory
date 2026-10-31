import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Prisma } from '../../../generated/prisma/client';
import type { Permission } from '../../../generated/prisma/enums';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { PrismaService } from '../../database/prisma.service';

const STAFF_PERMISSION = 'staffPermission';
const DEV_STAFF_SUBJECT = 'local-dev:catalogue-import';

export interface StaffAuthContext {
  principalId: string;
  csrfValidated: boolean;
}

export interface StaffAuthenticatedRequest extends Request {
  staffAuth?: StaffAuthContext;
}

export const RequireStaffPermission = (permission: Permission) =>
  SetMetadata(STAFF_PERMISSION, permission);

@Injectable()
export class StaffPermissionGuard implements CanActivate {
  private devPrincipalId: string | null = null;

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<StaffAuthenticatedRequest>();
    const response = http.getResponse<Response>();
    response.setHeader('Cache-Control', 'private, no-store');

    const auth = await this.resolveStaffAuth(request);
    request.staffAuth = auth;

    const permission = this.reflector.getAllAndOverride<Permission>(
      STAFF_PERMISSION,
      [context.getHandler(), context.getClass()],
    );
    if (!permission) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message_key: 'errors.forbidden',
      });
    }

    try {
      const principal = await this.prisma.principal.findUnique({
        where: { id: auth.principalId },
        select: { kind: true, enabled: true, permissions: true },
      });
      if (!principal || principal.kind !== 'staff' || !principal.enabled) {
        throw new UnauthorizedException({
          code: 'ACCESS_UNAVAILABLE',
          message_key: 'errors.access_unavailable',
        });
      }
      if (!principal.permissions.includes(permission)) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message_key: 'errors.forbidden',
        });
      }
      return true;
    } catch (error) {
      if (
        error instanceof UnauthorizedException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError ||
        error instanceof Prisma.PrismaClientUnknownRequestError ||
        error instanceof Prisma.PrismaClientInitializationError
      ) {
        throw new ServiceUnavailableException({
          code: 'TEMPORARY_UNAVAILABLE',
          message_key: 'errors.temporary_unavailable',
        });
      }
      throw error;
    }
  }

  private async resolveStaffAuth(
    request: StaffAuthenticatedRequest,
  ): Promise<StaffAuthContext> {
    if (request.staffAuth) {
      if (!request.staffAuth.principalId) {
        throw this.unauthorized();
      }
      if (!request.staffAuth.csrfValidated) {
        throw this.forbidden();
      }
      return request.staffAuth;
    }

    if (!this.config.get<boolean>('DEV_STAFF_AUTH_ENABLED')) {
      throw this.unauthorized();
    }
    const authToken = request.get('x-dev-staff-token');
    const csrfToken = request.get('x-csrf-token');
    const origin = request.get('origin');
    const approvedOrigins = this.config
      .getOrThrow<string>('CORS_ORIGINS')
      .split(',')
      .map((value) => value.trim());
    if (!this.matchesConfiguredToken(authToken, 'DEV_STAFF_AUTH_TOKEN')) {
      throw this.unauthorized();
    }
    if (
      !origin ||
      !approvedOrigins.includes(origin) ||
      !this.matchesConfiguredToken(csrfToken, 'DEV_STAFF_CSRF_TOKEN')
    ) {
      throw this.forbidden();
    }
    const principalId = await this.ensureDevPrincipal();
    return {
      principalId,
      csrfValidated: true,
    };
  }

  private async ensureDevPrincipal(): Promise<string> {
    if (this.devPrincipalId) {
      return this.devPrincipalId;
    }

    try {
      const principal = await this.prisma.principal.upsert({
        where: { externalSubject: DEV_STAFF_SUBJECT },
        update: {},
        create: {
          externalSubject: DEV_STAFF_SUBJECT,
          kind: 'staff',
          displayName: 'Local development catalogue importer',
          permissions: ['catalogue_read', 'catalogue_edit'],
        },
        select: { id: true },
      });
      this.devPrincipalId = principal.id;
      return principal.id;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const principal = await this.prisma.principal.findUnique({
          where: { externalSubject: DEV_STAFF_SUBJECT },
          select: { id: true },
        });
        if (principal) {
          this.devPrincipalId = principal.id;
          return principal.id;
        }
      } else if (
        error instanceof Prisma.PrismaClientKnownRequestError ||
        error instanceof Prisma.PrismaClientUnknownRequestError ||
        error instanceof Prisma.PrismaClientInitializationError
      ) {
        throw new ServiceUnavailableException({
          code: 'TEMPORARY_UNAVAILABLE',
          message_key: 'errors.temporary_unavailable',
        });
      }
      throw error;
    }
  }

  private matchesConfiguredToken(
    provided: string | undefined,
    configurationKey: string,
  ): boolean {
    if (!provided) {
      return false;
    }
    const expected = this.config.getOrThrow<string>(configurationKey);
    const providedDigest = createHash('sha256').update(provided).digest();
    const expectedDigest = createHash('sha256').update(expected).digest();
    return timingSafeEqual(providedDigest, expectedDigest);
  }

  private unauthorized(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'ACCESS_UNAVAILABLE',
      message_key: 'errors.access_unavailable',
    });
  }

  private forbidden(): ForbiddenException {
    return new ForbiddenException({
      code: 'FORBIDDEN',
      message_key: 'errors.forbidden',
    });
  }
}

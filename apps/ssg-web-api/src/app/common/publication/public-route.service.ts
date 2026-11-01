import {
  BadRequestException,
  GoneException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../../generated/prisma/client';
import type { Locale } from '../../../generated/prisma/enums';
import { PrismaService } from '../../database/prisma.service';

export type RouteResolution =
  | {
      state: 'current';
      url: string;
      entity_type: 'product' | 'content';
      entity_id: string;
      locale: Locale;
    }
  | { state: 'redirect'; location: string };

function normalizePath(path: string, locale: Locale): string {
  const hasControlCharacters = [...path].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
  if (
    path.length < 1 ||
    path.length > 1000 ||
    !path.startsWith('/') ||
    path.startsWith('//') ||
    path.includes('\\') ||
    path.includes('%') ||
    path.includes('?') ||
    path.includes('#') ||
    hasControlCharacters ||
    path.normalize('NFC') !== path ||
    path.split('/').some((part) => part === '.' || part === '..')
  ) {
    throw new BadRequestException();
  }
  if (
    (locale === 'en' && path !== '/en' && !path.startsWith('/en/')) ||
    (locale === 'bg' && (path === '/en' || path.startsWith('/en/')))
  ) {
    throw new BadRequestException();
  }
  return path;
}

@Injectable()
export class PublicRouteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async resolve(path: string, locale: Locale): Promise<RouteResolution> {
    const normalizedPath = normalizePath(path, locale);
    try {
      const route = await this.prisma.publicRoute.findUnique({
        where: { path: normalizedPath },
        select: {
          path: true,
          locale: true,
          state: true,
          productId: true,
          contentId: true,
          productIdRelation: {
            select: {
              id: true,
              publicationStatus: true,
              currentRevisionIdRelation: {
                select: { state: true },
              },
            },
          },
          contentIdRelation: {
            select: {
              id: true,
              from_ContentTranslation_contentId: {
                where: { locale },
                select: { published: true },
              },
            },
          },
        },
      });
      if (!route || route.locale !== locale) {
        throw new NotFoundException();
      }
      if (route.state === 'gone') {
        throw new GoneException();
      }

      const entityType = route.productId !== null ? 'product' : 'content';
      const entityId = route.productId ?? route.contentId;
      if (entityId === null) {
        throw new NotFoundException();
      }

      const ownerIsPublished =
        entityType === 'product'
          ? route.productIdRelation?.publicationStatus === 'published' &&
            route.productIdRelation.currentRevisionIdRelation?.state ===
              'published'
          : route.contentIdRelation?.from_ContentTranslation_contentId.some(
              (translation) => translation.published,
            ) === true;
      if (!ownerIsPublished) {
        throw new NotFoundException();
      }

      if (route.state === 'current') {
        return {
          state: 'current',
          url: this.absoluteUrl(route.path),
          entity_type: entityType,
          entity_id: entityId,
          locale,
        };
      }

      const currentRoute = await this.prisma.publicRoute.findFirst({
        where: {
          locale,
          state: 'current',
          ...(entityType === 'product'
            ? { productId: entityId }
            : { contentId: entityId }),
        },
        select: { path: true },
      });
      if (!currentRoute) {
        throw new NotFoundException();
      }
      return {
        state: 'redirect',
        location: this.absoluteUrl(currentRoute.path),
      };
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof GoneException
      ) {
        throw error;
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError ||
        error instanceof Prisma.PrismaClientUnknownRequestError ||
        error instanceof Prisma.PrismaClientInitializationError
      ) {
        throw new ServiceUnavailableException({ statusCode: 503 });
      }
      throw error;
    }
  }

  private absoluteUrl(path: string): string {
    const configuredOrigin = this.config.get<string>('PUBLIC_SITE_ORIGIN');
    if (!configuredOrigin) {
      throw new ServiceUnavailableException({ statusCode: 503 });
    }
    let origin: URL;
    try {
      origin = new URL(configuredOrigin);
    } catch {
      throw new ServiceUnavailableException({ statusCode: 503 });
    }
    if (
      !['http:', 'https:'].includes(origin.protocol) ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash ||
      origin.username ||
      origin.password
    ) {
      throw new ServiceUnavailableException({ statusCode: 503 });
    }
    return new URL(path, origin).toString();
  }
}

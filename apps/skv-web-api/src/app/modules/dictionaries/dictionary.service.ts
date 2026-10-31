import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import type { Locale } from '../../../generated/prisma/enums';
import { PrismaService } from '../../database/prisma.service';
import {
  PUBLIC_DICTIONARY_GROUPS,
} from './dictionary.dto';

@Injectable()
export class DictionaryService {
  private readonly logger = new Logger(DictionaryService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(
    locale: Locale,
    groups?: string[],
  ): Promise<{
    locale: Locale;
    items: {
      group: string;
      code: string;
      label: string;
      applies_to: string[];
    }[];
  }> {
    const selectedGroups = groups ?? [...PUBLIC_DICTIONARY_GROUPS];
    try {
      const entries = await this.prisma.dictionaryEntry.findMany({
        where: {
          active: true,
          group: { in: selectedGroups },
        },
        orderBy: [{ group: 'asc' }, { code: 'asc' }],
        select: {
          group: true,
          code: true,
          labelBg: true,
          labelEn: true,
          appliesTo: true,
        },
      });
      return {
        locale,
        items: entries.map((entry) => ({
          group: entry.group,
          code: entry.code,
          label: locale === 'bg' ? entry.labelBg : entry.labelEn,
          applies_to: entry.appliesTo,
        })),
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError ||
        error instanceof Prisma.PrismaClientUnknownRequestError ||
        error instanceof Prisma.PrismaClientInitializationError
      ) {
        this.logger.warn('Dictionary lookup failed; database is unavailable');
        throw new ServiceUnavailableException({
          statusCode: 503,
        });
      }
      throw error;
    }
  }
}

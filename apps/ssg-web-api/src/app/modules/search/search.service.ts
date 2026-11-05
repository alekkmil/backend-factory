import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../../generated/prisma/client';
import type { ContentType, Locale } from '../../../generated/prisma/enums';
import { PrismaService } from '../../database/prisma.service';
import { configurationUrl, ProductReadService, routeUrl } from '../products/product-read.service';
import type { ProductSummary } from '../products/product-read.service';
import { routeRegistry } from '../../common/publication/route-registry';
import type { SearchQueryDto } from './search.dto';

interface SearchContentSummary {
  id: string;
  type: ContentType | 'store' | 'policy';
  locale: Locale;
  title: string;
  intro: string | null;
  url: string;
  primary_image: null;
}

function record(value: Prisma.JsonValue): Prisma.JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function sectionText(value: Prisma.JsonValue): string {
  if (Array.isArray(value)) return value.map(sectionText).join('\n');
  const object = record(value);
  if (!object) return '';
  return Object.entries(object).flatMap(([key, item]) => {
    if (item === undefined) return [];
    if (['text', 'heading', 'caption', 'label', 'question', 'answer'].includes(key) && typeof item === 'string') {
      return [item];
    }
    if (['items', 'rows', 'columns', 'links'].includes(key)) return [sectionText(item)];
    if (key === 'cells' && Array.isArray(item)) return item.filter((cell) => typeof cell === 'string');
    return [];
  }).join('\n');
}

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductReadService,
    private readonly config: ConfigService,
  ) {}

  async search(query: SearchQueryDto) {
    const emptyProducts: ProductSummary[] = [];
    const emptyContent: SearchContentSummary[] = [];
    const response = {
      query: query.q, locale: query.locale,
      products: { items: emptyProducts, total: 0, page: query.product_page, page_size: query.page_size },
      content: { items: emptyContent, total: 0, page: query.content_page, page_size: query.page_size },
    };
    if (!query.q) return response;
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const contains = query.q.replace(/[\\%_]/gu, '\\$&');
        const where: Prisma.ProductWhereInput = {
            publicationStatus: 'published',
            currentRevisionIdRelation: { is: {
              state: 'published',
              from_ProductTranslation_revisionId: { some: {
                locale: query.locale, OR: [
                  { name: { contains, mode: 'insensitive' } },
                  { description: { contains, mode: 'insensitive' } },
                ],
              } },
            } },
          };
        response.products.total = await transaction.product.count({ where });
        const offset = (query.product_page - 1) * query.page_size;
        const matchingProducts = offset >= response.products.total ? [] :
          await transaction.product.findMany({
            where, select: { id: true }, orderBy: { id: 'asc' },
            skip: offset, take: query.page_size,
          });
        const candidates = await this.products.catalogCandidates(
          transaction,
          matchingProducts.map((product) => product.id),
          query.locale, null,
        );
        response.products.items = candidates.map((candidate) => candidate.summary);
        const content = await this.contentMatches(transaction, query);
        const start = (query.content_page - 1) * query.page_size;
        response.content = {
          ...response.content, total: content.length, items: content.slice(start, start + query.page_size),
        };
        return response;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError ||
        error instanceof Prisma.PrismaClientUnknownRequestError ||
        error instanceof Prisma.PrismaClientInitializationError
      ) {
        this.logger.warn('Public search storage is unavailable');
        throw new ServiceUnavailableException({
          code: 'TEMPORARY_UNAVAILABLE', message_key: 'errors.temporary_unavailable',
        });
      }
      throw error;
    }
  }

  private async contentMatches(
    transaction: Prisma.TransactionClient,
    query: SearchQueryDto,
  ): Promise<SearchContentSummary[]> {
    const origin = configurationUrl(this.config, 'PUBLIC_SITE_ORIGIN', this.config.get('NODE_ENV') === 'production');
    const needle = query.q.toLocaleLowerCase(query.locale);
    const matches = (text: string) => text.normalize('NFC').toLocaleLowerCase(query.locale).includes(needle);
    const items: SearchContentSummary[] = [];
    const contents = await transaction.contentTranslation.findMany({
      where: {
        locale: query.locale, published: true,
        contentIdRelation: { is: {
          type: { notIn: ['home', 'contact'] },
          from_PublicRoute_contentId: { some: { locale: query.locale, state: 'current' } },
        } },
      },
      select: {
        contentId: true, title: true, intro: true, sections: true,
        contentIdRelation: { select: {
          type: true,
          from_PublicRoute_contentId: {
            where: { locale: query.locale, state: 'current' }, select: { path: true },
          },
        } },
      },
      orderBy: { contentId: 'asc' },
    });
    for (const content of contents) {
      if (!matches(`${content.title}\n${content.intro ?? ''}\n${sectionText(content.sections)}`)) continue;
      const path = content.contentIdRelation.from_PublicRoute_contentId[0]?.path;
      if (!path) throw new ServiceUnavailableException({ code: 'ROUTE_CONFLICT', message_key: 'errors.route_unavailable' });
      items.push({
        id: content.contentId, type: content.contentIdRelation.type, locale: query.locale,
        title: content.title, intro: content.intro, url: routeUrl(path, origin), primary_image: null,
      });
    }
    const stores = await transaction.store.findMany({
      select: { code: true, publicData: true }, orderBy: { code: 'asc' },
    });
    for (const store of stores) {
      const localized = record(record(store.publicData)?.[query.locale] ?? null);
      if (!localized || typeof localized.name !== 'string' || typeof localized.address !== 'string') {
        this.logger.warn('Published store search data is malformed');
        throw new ServiceUnavailableException({ code: 'CONFIGURATION_UNAVAILABLE', message_key: 'errors.configuration_unavailable' });
      }
      if (!matches(`${localized.name}\n${localized.address}`)) continue;
      const route = routeRegistry.find((entry) => entry.id === (store.code === 'sofia' ? 'R065' : 'R066'));
      if (!route) throw new Error('Canonical store route is missing');
      items.push({
        id: store.code, type: 'store', locale: query.locale, title: localized.name,
        intro: localized.address, url: routeUrl(route[query.locale], origin), primary_image: null,
      });
    }
    const policies = await transaction.policyVersion.findMany({
      where: { locale: query.locale, current: true, published: true },
      select: { id: true, title: true, body: true, url: true }, orderBy: { id: 'asc' },
    });
    for (const policy of policies) {
      if (!matches(`${policy.title}\n${policy.body}`)) continue;
      items.push({
        id: policy.id, type: 'policy', locale: query.locale, title: policy.title,
        intro: null, url: this.policyUrl(policy.url, origin), primary_image: null,
      });
    }
    return items.sort((left, right) => left.id.localeCompare(right.id));
  }

  private policyUrl(value: string, origin: URL): string {
    let url: URL;
    try {
      url = new URL(value, origin);
    } catch {
      throw new ServiceUnavailableException({
        code: 'ROUTE_CONFLICT', message_key: 'errors.route_unavailable',
      });
    }
    if (url.origin !== origin.origin || url.username || url.password || url.hash) {
      throw new ServiceUnavailableException({
        code: 'ROUTE_CONFLICT', message_key: 'errors.route_unavailable',
      });
    }
    return url.toString();
  }
}

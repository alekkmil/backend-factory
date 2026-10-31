import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import type { Locale } from '../../../generated/prisma/enums';
import { CommercialEvaluator } from '../../common/commercial/commercial-evaluator';
import type { FulfilmentContext } from '../../common/commercial/commercial-evaluator';
import { PrismaService } from '../../database/prisma.service';
import { fulfilmentContext } from './fulfilment-context';
import type { CatalogQueryDto } from './catalog.dto';
import { ProductReadService } from './product-read.service';
import type { CatalogProductCandidate, ProductSummary } from './product-read.service';

interface CatalogResponse {
  items: ProductSummary[];
  total: number;
  page: number;
  page_size: number;
  facets: {
    key: string;
    values: { code: string; label: string; count: number }[];
  }[];
}

function codeSet(values: string[] | undefined): Set<string> {
  return new Set(values ?? []);
}

function increment(
  counts: Map<string, number>,
  group: string,
  code: string,
): void {
  const key = `${group}\u0000${code}`;
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function byId(left: CatalogProductCandidate, right: CatalogProductCandidate): number {
  return left.summary.id < right.summary.id
    ? -1
    : left.summary.id > right.summary.id
      ? 1
      : 0;
}

@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductReadService,
    private readonly evaluator: CommercialEvaluator,
  ) {}

  async list(query: CatalogQueryDto): Promise<CatalogResponse> {
    const page = query.page ?? 1;
    const pageSize = query.page_size ?? 24;
    const context = fulfilmentContext(query);
    if (
      query.price_min &&
      query.price_max &&
      new Prisma.Decimal(query.price_min).greaterThan(
        new Prisma.Decimal(query.price_max),
      )
    ) {
      throw new BadRequestException();
    }
    if (query.product_type === 'loose_stone' && query.jewellery_type) {
      throw new BadRequestException();
    }

    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          await this.validateDictionaryFilters(transaction, query);
          const selectionProductIds = query.selection_id
            ? await this.selectionProducts(
                transaction,
                query.selection_id,
                query.locale,
              )
            : null;
          if (selectionProductIds && selectionProductIds.length === 0) {
            return this.emptyResponse(page, pageSize);
          }

          const revisionWhere: Prisma.ProductRevisionWhereInput = {
            state: 'published',
            from_ProductTranslation_revisionId: {
              some: { locale: query.locale },
            },
          };
          if (query.jewellery_type) {
            revisionWhere.jewelleryTypeIdRelation = {
              is: {
                group: 'jewellery_type',
                code: query.jewellery_type,
                active: true,
              },
            };
          }
          if (query.material_codes?.length) {
            revisionWhere.from_RevisionMaterial_revisionId = {
              some: {
                materialIdRelation: {
                  is: {
                    group: 'material',
                    active: true,
                    code: { in: query.material_codes },
                  },
                },
              },
            };
          }
          if (query.gemstone_codes?.length) {
            revisionWhere.from_RevisionGemstone_revisionId = {
              some: {
                gemstoneIdRelation: {
                  is: {
                    group: 'gemstone',
                    active: true,
                    code: { in: query.gemstone_codes },
                  },
                },
              },
            };
          }
          const productWhere: Prisma.ProductWhereInput = {
            publicationStatus: 'published',
            currentRevisionIdRelation: { is: revisionWhere },
          };
          if (query.product_type) {
            productWhere.productType = query.product_type;
          } else if (query.jewellery_type) {
            productWhere.productType = 'jewellery';
          }
          if (selectionProductIds) {
            productWhere.id = { in: selectionProductIds };
          }
          const products = await transaction.product.findMany({
            where: productWhere,
            orderBy: { id: 'asc' },
            select: { id: true },
          });
          const candidates = await this.products.catalogCandidates(
            transaction,
            products.map((product) => product.id),
            query.locale,
            context,
          );
          const filtered = this.filterCandidates(
            candidates,
            query,
            context,
          );
          this.sortCandidates(filtered, query.sort ?? 'default');
          const total = filtered.length;
          if (total > 0 && page > Math.ceil(total / pageSize)) {
            throw new NotFoundException();
          }
          const start = (page - 1) * pageSize;
          const items = filtered
            .slice(start, start + pageSize)
            .map((candidate) => candidate.summary);
          return {
            items,
            total,
            page,
            page_size: pageSize,
            facets: await this.facets(transaction, filtered, query.locale),
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError ||
        error instanceof Prisma.PrismaClientUnknownRequestError ||
        error instanceof Prisma.PrismaClientInitializationError
      ) {
        this.logger.warn('Catalog lookup is unavailable');
        throw new ServiceUnavailableException({
          code: 'TEMPORARY_UNAVAILABLE',
          message_key: 'errors.temporary_unavailable',
        });
      }
      throw error;
    }
  }

  private async validateDictionaryFilters(
    transaction: Prisma.TransactionClient,
    query: CatalogQueryDto,
  ): Promise<void> {
    const productType = query.product_type;
    const filters = [
      { group: 'jewellery_type', codes: query.jewellery_type ? [query.jewellery_type] : [] },
      { group: 'material', codes: query.material_codes ?? [] },
      { group: 'gemstone', codes: query.gemstone_codes ?? [] },
    ];
    for (const filter of filters) {
      if (filter.codes.length === 0) {
        continue;
      }
      const entries = await transaction.dictionaryEntry.findMany({
        where: {
          group: filter.group,
          code: { in: filter.codes },
          active: true,
        },
        select: { code: true, appliesTo: true },
      });
      if (
        entries.length !== filter.codes.length ||
        (productType !== undefined &&
          entries.some(
            (entry) =>
              entry.appliesTo.length > 0 &&
              !entry.appliesTo.includes(productType),
          ))
      ) {
        throw new BadRequestException();
      }
    }
  }

  private async selectionProducts(
    transaction: Prisma.TransactionClient,
    selectionId: string,
    locale: Locale,
  ): Promise<string[]> {
    const selection = await transaction.contentRecord.findFirst({
      where: {
        id: selectionId,
        type: 'selection',
        from_ContentTranslation_contentId: {
          some: { locale, published: true },
        },
      },
      select: { id: true },
    });
    if (!selection) {
      throw new NotFoundException();
    }
    const links = await transaction.contentLink.findMany({
      where: {
        ownerContentId: selection.id,
        targetProductId: { not: null },
      },
      select: { targetProductId: true },
    });
    return [...new Set(links.flatMap((link) => link.targetProductId ?? []))];
  }

  private filterCandidates(
    candidates: CatalogProductCandidate[],
    query: CatalogQueryDto,
    context: FulfilmentContext,
  ): CatalogProductCandidate[] {
    const materialCodes = codeSet(query.material_codes);
    const gemstoneCodes = codeSet(query.gemstone_codes);
    const hasUnitFilter =
      query.price_min !== undefined ||
      query.price_max !== undefined ||
      query.fulfilment_method !== undefined;
    const minimum = query.price_min
      ? new Prisma.Decimal(query.price_min)
      : null;
    const maximum = query.price_max
      ? new Prisma.Decimal(query.price_max)
      : null;

    return candidates.filter((candidate) => {
      if (
        (query.product_type &&
          candidate.summary.product_type !== query.product_type) ||
        (query.jewellery_type &&
          candidate.jewelleryTypeCode !== query.jewellery_type) ||
        (materialCodes.size > 0 &&
          !candidate.materialCodes.some((code) => materialCodes.has(code))) ||
        (gemstoneCodes.size > 0 &&
          !candidate.gemstoneCodes.some((code) => gemstoneCodes.has(code)))
      ) {
        return false;
      }
      if (!hasUnitFilter) {
        return true;
      }
      if (!candidate.settings) {
        throw new ServiceUnavailableException({
          code: 'CONFIGURATION_UNAVAILABLE',
          message_key: 'errors.configuration_unavailable',
        });
      }
      const matchingUnit = candidate.units.some((unit) => {
        const evaluated = this.evaluator.evaluateCatalogueFilterUnit(
          candidate.product,
          unit,
          candidate.settings,
          context,
        );
        if (!evaluated) {
          return false;
        }
        if (
          query.fulfilment_method &&
          !evaluated.fulfilmentMethods.includes(query.fulfilment_method)
        ) {
          return false;
        }
        const amount = new Prisma.Decimal(evaluated.amount);
        return (
          (minimum === null || amount.greaterThanOrEqualTo(minimum)) &&
          (maximum === null || amount.lessThanOrEqualTo(maximum))
        );
      });
      return matchingUnit;
    });
  }

  private sortCandidates(
    candidates: CatalogProductCandidate[],
    sort: 'default' | 'price_asc' | 'price_desc',
  ): void {
    candidates.sort((left, right) => {
      if (sort === 'default') {
        return byId(left, right);
      }
      const leftPrice = left.summary.commercial_result.display_price?.amount;
      const rightPrice = right.summary.commercial_result.display_price?.amount;
      if (leftPrice === undefined || rightPrice === undefined) {
        if (leftPrice === undefined && rightPrice === undefined) {
          return byId(left, right);
        }
        return leftPrice === undefined ? 1 : -1;
      }
      const comparison = new Prisma.Decimal(leftPrice).comparedTo(
        new Prisma.Decimal(rightPrice),
      );
      if (comparison !== 0) {
        return sort === 'price_asc' ? comparison : -comparison;
      }
      return byId(left, right);
    });
  }

  private async facets(
    transaction: Prisma.TransactionClient,
    candidates: CatalogProductCandidate[],
    locale: Locale,
  ): Promise<CatalogResponse['facets']> {
    if (candidates.length === 0) {
      return [];
    }
    const counts = new Map<string, number>();
    for (const candidate of candidates) {
      increment(counts, 'product_type', candidate.summary.product_type);
      if (candidate.jewelleryTypeCode) {
        increment(counts, 'jewellery_type', candidate.jewelleryTypeCode);
      }
      for (const code of new Set(candidate.materialCodes)) {
        increment(counts, 'material', code);
      }
      for (const code of new Set(candidate.gemstoneCodes)) {
        increment(counts, 'gemstone', code);
      }
    }
    const entries = await transaction.dictionaryEntry.findMany({
      where: {
        active: true,
        group: { in: ['product_type', 'jewellery_type', 'material', 'gemstone'] },
      },
      select: {
        group: true,
        code: true,
        labelBg: true,
        labelEn: true,
      },
      orderBy: [{ group: 'asc' }, { code: 'asc' }],
    });
    const groups = ['product_type', 'jewellery_type', 'material', 'gemstone'];
    return groups.flatMap((group) => {
      const values = entries.flatMap((entry) => {
        const count = counts.get(`${group}\u0000${entry.code}`);
        if (entry.group !== group || count === undefined) {
          return [];
        }
        return [
          {
            code: entry.code,
            label: locale === 'bg' ? entry.labelBg : entry.labelEn,
            count,
          },
        ];
      });
      return values.length > 0 ? [{ key: group, values }] : [];
    });
  }

  private emptyResponse(page: number, pageSize: number): CatalogResponse {
    return { items: [], total: 0, page, page_size: pageSize, facets: [] };
  }
}

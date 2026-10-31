import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../../generated/prisma/client';
import type {
  Locale,
  LocationCode,
  ProductType,
  StockStatus,
} from '../../../generated/prisma/enums';
import { CommercialEvaluator } from '../../common/commercial/commercial-evaluator';
import type {
  CommercialProductInput,
  CommercialSettingsInput,
  CommercialUnitInput,
  FulfilmentContext,
  FulfilmentOptions,
  PublicFacts,
} from '../../common/commercial/commercial-evaluator';
import { PrismaService } from '../../database/prisma.service';

const PRODUCT_SELECT = {
  id: true,
  productType: true,
  publicationStatus: true,
  currentRevisionIdRelation: {
    select: {
      id: true,
      state: true,
      jewelleryTypeIdRelation: { select: { code: true } },
      materialsState: true,
      gemstonesState: true,
      salesMode: true,
      priceVisibility: true,
      fulfilmentMethods: true,
      deliveryScope: true,
      deliveryLocalityIds: true,
      pickupLocationCodes: true,
      mediaReleaseId: true,
      from_ProductTranslation_revisionId: {
        select: {
          locale: true,
          name: true,
          description: true,
          firstPublishedAt: true,
          firstPublishedDate: true,
          publicModifiedAt: true,
        },
      },
      from_RevisionImage_revisionId: {
        orderBy: { sortOrder: 'asc' },
        select: {
          sortOrder: true,
          assetIdRelation: {
            select: {
              id: true,
              releaseId: true,
              logicalImageId: true,
              role: true,
              derivatives: true,
              altBg: true,
              altEn: true,
              processedWithAi: true,
              onModelIllustrative: true,
              reviewStatus: true,
            },
          },
        },
      },
      from_RevisionMaterial_revisionId: {
        select: {
          materialIdRelation: {
            select: { code: true, labelBg: true, labelEn: true },
          },
          finenessIdRelation: {
            select: { code: true, labelBg: true, labelEn: true },
          },
          goldKaratIdRelation: { select: { code: true } },
        },
      },
      from_RevisionGemstone_revisionId: {
        select: {
          gemstoneIdRelation: {
            select: { code: true, labelBg: true, labelEn: true },
          },
        },
      },
    },
  },
} satisfies Prisma.ProductSelect;

type ProductRow = Prisma.ProductGetPayload<{ select: typeof PRODUCT_SELECT }>;
type ProductRevisionRow = NonNullable<ProductRow['currentRevisionIdRelation']>;
type RevisionImageRow =
  ProductRevisionRow['from_RevisionImage_revisionId'][number];
type MediaAssetRow = RevisionImageRow['assetIdRelation'];

interface PublicMedia {
  id: string;
  role: string;
  urls: {
    default: string;
    w200: string | null;
    w400: string | null;
    w800: string | null;
    w1600: string | null;
  };
  width: number;
  height: number;
  alt: string;
  ai_disclosure_required: boolean;
  on_model_illustrative: boolean;
}

export interface ProductSummary {
  id: string;
  product_type: ProductType;
  name: string;
  locale: Locale;
  url: string;
  alternate_urls: { bg: string | null; en: string | null };
  primary_image: PublicMedia;
  commercial_result: ReturnType<CommercialEvaluator['evaluateProduct']>;
}

interface ProductDetail extends ProductSummary {
  description: string;
  materials: {
    material_code: string;
    material_label: string;
    fineness_code: string | null;
    fineness_label: string | null;
    gold_karat_code: string | null;
  }[] | null;
  gemstones: { code: string; label: string }[] | null;
  media: PublicMedia[];
  stock_choices: {
    stock_item_id: string;
    facts: PublicFacts;
    price: { amount: string; currency: string };
    fulfilment_options: FulfilmentOptions;
  }[];
  related_products: ProductSummary[];
  dates: {
    first_published_at: string | null;
    public_modified_at: string | null;
  };
}

interface StockRow {
  id: string;
  status: StockStatus;
  locationCode: LocationCode;
  price: Prisma.Decimal | null;
  currency: string | null;
  weightG: Prisma.Decimal | null;
  stoneWeightCt: Prisma.Decimal | null;
  dimensions: Prisma.JsonValue | null;
}

interface ProjectedData {
  product: ProductRow;
  revision: NonNullable<ProductRow['currentRevisionIdRelation']>;
  stocks: StockRow[];
  settings: CommercialSettingsInput | null;
  routes: Map<Locale, string>;
  origin: URL;
  cdnOrigin: URL;
}

export interface CatalogProductCandidate {
  summary: ProductSummary;
  product: CommercialProductInput;
  settings: CommercialSettingsInput | null;
  units: CommercialUnitInput[];
  jewelleryTypeCode: string | null;
  materialCodes: string[];
  gemstoneCodes: string[];
}

interface Derivative {
  size: number;
  width: number;
  height: number;
  object_key: string;
  mime: string;
  colour_space: string;
  bytes: number;
  sha256: string;
}

function isJsonRecord(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function configurationUrl(
  config: ConfigService,
  key: string,
  production: boolean,
): URL {
  const value = config.get<string>(key);
  if (!value) {
    throw new ServiceUnavailableException({
      code: 'CONFIGURATION_UNAVAILABLE',
      message_key: 'errors.configuration_unavailable',
    });
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ServiceUnavailableException({
      code: 'CONFIGURATION_UNAVAILABLE',
      message_key: 'errors.configuration_unavailable',
    });
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    (production && url.protocol !== 'https:') ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0 ||
    (key === 'PUBLIC_SITE_ORIGIN' && url.pathname !== '/')
  ) {
    throw new ServiceUnavailableException({
      code: 'CONFIGURATION_UNAVAILABLE',
      message_key: 'errors.configuration_unavailable',
    });
  }
  if (!url.pathname.endsWith('/')) {
    url.pathname += '/';
  }
  return url;
}

function readDerivative(value: Prisma.JsonValue): Derivative {
  if (
    !isJsonRecord(value) ||
    typeof value.size !== 'number' ||
    typeof value.width !== 'number' ||
    typeof value.height !== 'number' ||
    typeof value.object_key !== 'string' ||
    typeof value.mime !== 'string' ||
    typeof value.colour_space !== 'string' ||
    typeof value.bytes !== 'number' ||
    typeof value.sha256 !== 'string'
  ) {
    throw new ServiceUnavailableException({
      code: 'MEDIA_NOT_READY',
      message_key: 'errors.media_not_ready',
    });
  }
  if (
    ![200, 400, 800, 1600].includes(value.size) ||
    value.width !== value.size ||
    value.height !== value.size ||
    value.mime !== 'image/webp' ||
    value.colour_space !== 'sRGB' ||
    value.bytes < 1 ||
    !/^[0-9a-f]{64}$/.test(value.sha256) ||
    value.object_key.startsWith('/') ||
    value.object_key.includes('\\') ||
    value.object_key.split('/').some((part) => part === '.' || part === '..') ||
    value.object_key.includes('?') ||
    value.object_key.includes('#') ||
    value.object_key.includes('%') ||
    [...value.object_key].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  ) {
    throw new ServiceUnavailableException({
      code: 'MEDIA_NOT_READY',
      message_key: 'errors.media_not_ready',
    });
  }
  return {
    size: value.size,
    width: value.width,
    height: value.height,
    object_key: value.object_key,
    mime: value.mime,
    colour_space: value.colour_space,
    bytes: value.bytes,
    sha256: value.sha256,
  };
}

function projectMedia(
  asset: MediaAssetRow,
  locale: Locale,
  cdnOrigin: URL,
  releaseId: string | null,
): PublicMedia {
  if (
    asset.reviewStatus !== 'approved' ||
    releaseId === null ||
    asset.releaseId !== releaseId
  ) {
    throw new ServiceUnavailableException({
      code: 'MEDIA_NOT_READY',
      message_key: 'errors.media_not_ready',
    });
  }
  if (!Array.isArray(asset.derivatives)) {
    throw new ServiceUnavailableException({
      code: 'MEDIA_NOT_READY',
      message_key: 'errors.media_not_ready',
    });
  }
  const derivatives = asset.derivatives.map((item) =>
    readDerivative(item),
  );
  const bySize = new Map(derivatives.map((item) => [item.size, item]));
  if (
    derivatives.length !== 4 ||
    [200, 400, 800, 1600].some((size) => !bySize.has(size))
  ) {
    throw new ServiceUnavailableException({
      code: 'MEDIA_NOT_READY',
      message_key: 'errors.media_not_ready',
    });
  }
  const urlFor = (size: number): string | null => {
    const derivative = bySize.get(size);
    if (!derivative) {
      return null;
    }
    const url = new URL(derivative.object_key, cdnOrigin);
    if (
      url.origin !== cdnOrigin.origin ||
      !url.pathname.startsWith(cdnOrigin.pathname)
    ) {
      throw new ServiceUnavailableException({
        code: 'MEDIA_NOT_READY',
        message_key: 'errors.media_not_ready',
      });
    }
    return url.toString();
  };
  const alt = locale === 'bg' ? asset.altBg : asset.altEn;
  const largest = bySize.get(1600);
  const defaultUrl = urlFor(800);
  if (!alt || alt.trim().length === 0 || !largest || !defaultUrl) {
    throw new ServiceUnavailableException({
      code: 'MEDIA_NOT_READY',
      message_key: 'errors.media_not_ready',
    });
  }
  return {
    id: asset.id,
    role: asset.role,
    urls: {
      default: defaultUrl,
      w200: urlFor(200),
      w400: urlFor(400),
      w800: urlFor(800),
      w1600: urlFor(1600),
    },
    width: largest.width,
    height: largest.height,
    alt,
    ai_disclosure_required: asset.processedWithAi,
    on_model_illustrative: asset.onModelIllustrative,
  };
}

function commercialProduct(
  product: ProductRow,
): CommercialProductInput {
  const revision = product.currentRevisionIdRelation;
  if (!revision) {
    throw new ServiceUnavailableException({
      code: 'TEMPORARY_UNAVAILABLE',
      message_key: 'errors.temporary_unavailable',
    });
  }
  return {
    publicationStatus: product.publicationStatus,
    productType: product.productType,
    jewelleryTypeCode: revision.jewelleryTypeIdRelation?.code ?? null,
    salesMode: revision.salesMode,
    priceVisibility: revision.priceVisibility,
    fulfilmentMethods: revision.fulfilmentMethods,
    deliveryScope: revision.deliveryScope,
    deliveryLocalityIds: revision.deliveryLocalityIds,
    pickupLocationCodes: revision.pickupLocationCodes,
  };
}

function commercialUnits(stocks: StockRow[]): CommercialUnitInput[] {
  return stocks.map((stock) => ({
    id: stock.id,
    status: stock.status,
    locationCode: stock.locationCode,
    price: stock.price,
    currency: stock.currency,
    weightG: stock.weightG,
    stoneWeightCt: stock.stoneWeightCt,
    dimensions: stock.dimensions,
  }));
}

function routeUrl(path: string, origin: URL): string {
  const hasControlCharacters = [...path].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
  if (
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
    throw new ServiceUnavailableException({
      code: 'ROUTE_CONFLICT',
      message_key: 'errors.route_unavailable',
    });
  }
  return new URL(path, origin).toString();
}

@Injectable()
export class ProductReadService {
  private readonly logger = new Logger(ProductReadService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly evaluator: CommercialEvaluator,
  ) {}

  async detail(
    id: string,
    locale: Locale,
    context: FulfilmentContext,
  ): Promise<ProductDetail> {
    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          const data = await this.loadProductData(transaction, id);
          if (!data) {
            throw new NotFoundException();
          }
          return this.projectDetail(transaction, data, locale, context);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError ||
        error instanceof Prisma.PrismaClientUnknownRequestError ||
        error instanceof Prisma.PrismaClientInitializationError
      ) {
        this.logger.warn('Product detail lookup is unavailable');
        throw new ServiceUnavailableException({
          code: 'TEMPORARY_UNAVAILABLE',
          message_key: 'errors.temporary_unavailable',
        });
      }
      throw error;
    }
  }

  async batch(
    ids: string[],
    locale: Locale,
  ): Promise<{
    items: {
      id: string;
      state: 'available' | 'unavailable';
      product: ProductSummary | null;
    }[];
  }> {
    const uniqueIds = [...new Set(ids)];
    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          const items = [];
          for (const id of uniqueIds) {
            const data = await this.loadProductData(transaction, id);
            if (!data) {
              items.push({ id, state: 'unavailable' as const, product: null });
              continue;
            }
            const summary = await this.projectSummary(
              transaction,
              data,
              locale,
              null,
            );
            items.push({ id, state: 'available' as const, product: summary });
          }
          return { items };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError ||
        error instanceof Prisma.PrismaClientUnknownRequestError ||
        error instanceof Prisma.PrismaClientInitializationError
      ) {
        this.logger.warn('Product batch lookup is unavailable');
        throw new ServiceUnavailableException({
          code: 'TEMPORARY_UNAVAILABLE',
          message_key: 'errors.temporary_unavailable',
        });
      }
      throw error;
    }
  }

  async catalogCandidates(
    transaction: Prisma.TransactionClient,
    ids: string[],
    locale: Locale,
    context: FulfilmentContext,
  ): Promise<CatalogProductCandidate[]> {
    if (ids.length === 0) {
      return [];
    }
    const products = await transaction.product.findMany({
      where: {
        id: { in: ids },
        publicationStatus: 'published',
        currentRevisionIdRelation: {
          is: {
            state: 'published',
            from_ProductTranslation_revisionId: {
              some: { locale },
            },
          },
        },
      },
      orderBy: { id: 'asc' },
      select: PRODUCT_SELECT,
    });
    if (products.length === 0) {
      return [];
    }
    const productIds = products.map((product) => product.id);
    const stocks = await transaction.stockItem.findMany({
      where: { productId: { in: productIds } },
      orderBy: [{ locationCode: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        productId: true,
        status: true,
        locationCode: true,
        price: true,
        currency: true,
        weightG: true,
        stoneWeightCt: true,
        dimensions: true,
      },
    });
    const settings = await transaction.shopSettings.findUnique({
      where: { id: 1 },
      select: {
        ready: true,
        currency: true,
        allowedProductTypes: true,
        allowedJewelleryTypeCodes: true,
        maxOnlinePrice: true,
      },
    });
    const routes = await transaction.publicRoute.findMany({
      where: {
        productId: { in: productIds },
        state: 'current',
        locale: { in: ['bg', 'en'] },
      },
      select: { productId: true, locale: true, path: true },
    });

    const production = this.config.get<string>('NODE_ENV') === 'production';
    const origin = configurationUrl(this.config, 'PUBLIC_SITE_ORIGIN', production);
    const cdnOrigin = configurationUrl(
      this.config,
      'MEDIA_CDN_BASE_URL',
      production,
    );
    const stocksByProduct = new Map<string, StockRow[]>();
    for (const stock of stocks) {
      const current = stocksByProduct.get(stock.productId) ?? [];
      current.push(stock);
      stocksByProduct.set(stock.productId, current);
    }
    const routesByProduct = new Map<string, Map<Locale, string>>();
    for (const route of routes) {
      if (route.productId === null) {
        continue;
      }
      const current = routesByProduct.get(route.productId) ?? new Map();
      current.set(route.locale, route.path);
      routesByProduct.set(route.productId, current);
    }
    const settingsInput: CommercialSettingsInput | null = settings
      ? {
          ready: settings.ready,
          currency: settings.currency,
          allowedProductTypes: settings.allowedProductTypes,
          allowedJewelleryTypeCodes: settings.allowedJewelleryTypeCodes,
          maxOnlinePrice: settings.maxOnlinePrice,
        }
      : null;

    const candidates: CatalogProductCandidate[] = [];
    for (const product of products) {
      const revision = product.currentRevisionIdRelation;
      if (!revision) {
        continue;
      }
      const productStocks = stocksByProduct.get(product.id) ?? [];
      const data: ProjectedData = {
        product,
        revision,
        stocks: productStocks,
        settings: settingsInput,
        routes: routesByProduct.get(product.id) ?? new Map(),
        origin,
        cdnOrigin,
      };
      candidates.push({
        summary: await this.projectSummary(
          transaction,
          data,
          locale,
          context,
        ),
        product: commercialProduct(product),
        settings: settingsInput,
        units: commercialUnits(productStocks),
        jewelleryTypeCode: revision.jewelleryTypeIdRelation?.code ?? null,
        materialCodes: revision.from_RevisionMaterial_revisionId.map(
          (entry) => entry.materialIdRelation.code,
        ),
        gemstoneCodes: revision.from_RevisionGemstone_revisionId.map(
          (entry) => entry.gemstoneIdRelation.code,
        ),
      });
    }
    return candidates;
  }

  private async loadProductData(
    transaction: Prisma.TransactionClient,
    id: string,
  ): Promise<ProjectedData | null> {
    const product = await transaction.product.findFirst({
      where: { id, publicationStatus: 'published' },
      select: PRODUCT_SELECT,
    });
    const revision = product?.currentRevisionIdRelation;
    if (!product || !revision || revision.state !== 'published') {
      return null;
    }

    const stocks = await transaction.stockItem.findMany({
      where: { productId: product.id },
      orderBy: [{ locationCode: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        status: true,
        locationCode: true,
        price: true,
        currency: true,
        weightG: true,
        stoneWeightCt: true,
        dimensions: true,
      },
    });
    const settings = await transaction.shopSettings.findUnique({
      where: { id: 1 },
      select: {
        ready: true,
        currency: true,
        allowedProductTypes: true,
        allowedJewelleryTypeCodes: true,
        maxOnlinePrice: true,
      },
    });
    const routes = await transaction.publicRoute.findMany({
      where: {
        productId: product.id,
        state: 'current',
        locale: { in: ['bg', 'en'] },
      },
      select: { locale: true, path: true },
    });

    const routeMap = new Map(routes.map((route) => [route.locale, route.path]));
    const production = this.config.get<string>('NODE_ENV') === 'production';
    const origin = configurationUrl(this.config, 'PUBLIC_SITE_ORIGIN', production);
    const cdnOrigin = configurationUrl(
      this.config,
      'MEDIA_CDN_BASE_URL',
      production,
    );
    return {
      product,
      revision,
      stocks,
      settings,
      routes: routeMap,
      origin,
      cdnOrigin,
    };
  }

  private async projectDetail(
    transaction: Prisma.TransactionClient,
    data: ProjectedData,
    locale: Locale,
    context: FulfilmentContext,
  ): Promise<ProductDetail> {
    const revision = data.revision;
    const translation = revision.from_ProductTranslation_revisionId.find(
      (item) => item.locale === locale,
    );
    if (!translation?.name || !translation.description) {
      throw new NotFoundException();
    }
    const summary = await this.projectSummary(
      transaction,
      data,
      locale,
      context,
    );
    const media = revision.from_RevisionImage_revisionId.map((image) =>
      projectMedia(
        image.assetIdRelation,
        locale,
        data.cdnOrigin,
        revision.mediaReleaseId,
      ),
    );
    const mainImage = media.find((image) => image.role === 'main');
    if (!mainImage) {
      throw new ServiceUnavailableException({
        code: 'MEDIA_NOT_READY',
        message_key: 'errors.media_not_ready',
      });
    }
    const materials =
      revision.materialsState === 'unknown'
        ? null
        : revision.materialsState === 'none'
          ? []
          : revision.from_RevisionMaterial_revisionId.map((entry) => ({
              material_code: entry.materialIdRelation.code,
              material_label:
                locale === 'bg'
                  ? entry.materialIdRelation.labelBg
                  : entry.materialIdRelation.labelEn,
              fineness_code: entry.finenessIdRelation?.code ?? null,
              fineness_label: entry.finenessIdRelation
                ? locale === 'bg'
                  ? entry.finenessIdRelation.labelBg
                  : entry.finenessIdRelation.labelEn
                : null,
              gold_karat_code: entry.goldKaratIdRelation?.code ?? null,
            }));
    const gemstones =
      revision.gemstonesState === 'unknown'
        ? null
        : revision.gemstonesState === 'none'
          ? []
          : revision.from_RevisionGemstone_revisionId.map((entry) => ({
              code: entry.gemstoneIdRelation.code,
              label:
                locale === 'bg'
                  ? entry.gemstoneIdRelation.labelBg
                  : entry.gemstoneIdRelation.labelEn,
            }));
    const stockChoices = data.stocks.flatMap((stock) => {
      const evaluated = this.evaluator.evaluateExactUnit(
        commercialProduct(data.product),
        commercialUnits([stock])[0],
        data.settings,
        context,
      );
      return evaluated
        ? [
            {
              stock_item_id: evaluated.unit.id,
              facts: evaluated.facts,
              price: evaluated.price,
              fulfilment_options: evaluated.fulfilment_options,
            },
          ]
        : [];
    });
    const relatedLinks = await transaction.productRelatedLink.findMany({
      where: { productId: data.product.id },
      orderBy: { sortOrder: 'asc' },
      take: 50,
      select: { relatedProductId: true },
    });
    const relatedProducts: ProductSummary[] = [];
    for (const link of relatedLinks) {
      const relatedData = await this.loadProductData(
        transaction,
        link.relatedProductId,
      );
      if (relatedData) {
        relatedProducts.push(
          await this.projectSummary(
            transaction,
            relatedData,
            locale,
            context,
          ),
        );
      }
    }

    return {
      ...summary,
      description: translation.description,
      materials,
      gemstones,
      media,
      stock_choices: stockChoices,
      related_products: relatedProducts,
      dates: {
        first_published_at:
          translation.firstPublishedAt?.toISOString() ??
          translation.firstPublishedDate,
        public_modified_at:
          translation.publicModifiedAt?.toISOString() ?? null,
      },
    };
  }

  private async projectSummary(
    transaction: Prisma.TransactionClient,
    data: ProjectedData,
    locale: Locale,
    context: FulfilmentContext,
  ): Promise<ProductSummary> {
    const translation = data.revision.from_ProductTranslation_revisionId.find(
      (item) => item.locale === locale,
    );
    if (!translation?.name) {
      throw new ServiceUnavailableException({
        code: 'TEMPORARY_UNAVAILABLE',
        message_key: 'errors.temporary_unavailable',
      });
    }
    const route = data.routes.get(locale);
    if (!route) {
      throw new ServiceUnavailableException({
        code: 'ROUTE_CONFLICT',
        message_key: 'errors.route_unavailable',
      });
    }
    const primaryImageRow = data.revision.from_RevisionImage_revisionId.find(
      (image) => image.assetIdRelation.role === 'main',
    );
    if (!primaryImageRow) {
      throw new ServiceUnavailableException({
        code: 'MEDIA_NOT_READY',
        message_key: 'errors.media_not_ready',
      });
    }
    const primaryImage = projectMedia(
      primaryImageRow.assetIdRelation,
      locale,
      data.cdnOrigin,
      data.revision.mediaReleaseId,
    );
    const product = commercialProduct(data.product);
    const units = commercialUnits(data.stocks);
    const commercialResult = this.evaluator.evaluateProduct(
      product,
      units,
      data.settings,
      context,
    );
    const routes = new Map(data.routes);
    return {
      id: data.product.id,
      product_type: data.product.productType,
      name: translation.name,
      locale,
      url: routeUrl(route, data.origin),
      alternate_urls: {
        bg: routes.has('bg')
          ? routeUrl(routes.get('bg') ?? '', data.origin)
          : null,
        en: routes.has('en')
          ? routeUrl(routes.get('en') ?? '', data.origin)
          : null,
      },
      primary_image: primaryImage,
      commercial_result: commercialResult,
    };
  }
}

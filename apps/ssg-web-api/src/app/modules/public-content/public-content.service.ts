import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../../generated/prisma/client';
import type {
  ContentType,
  Locale,
  LocationCode,
  PolicyKind,
} from '../../../generated/prisma/enums';
import {
  configurationUrl,
  projectMedia,
  ProductReadService,
  routeUrl,
} from '../products/product-read.service';
import type { ProductSummary } from '../products/product-read.service';
import { PrismaService } from '../../database/prisma.service';
import { routeRegistry } from '../../common/publication/route-registry';
import type {
  ContentListQueryDto,
  PolicyQueryDto,
  SeoUrlsQueryDto,
} from './public-content.dto';

type JsonRecord = Prisma.JsonObject;
type ReadTransaction = Prisma.TransactionClient;

const POLICY_ROUTES: Record<PolicyKind, string> = {
  delivery_returns: 'R070',
  terms: 'R071',
  privacy: 'R072',
  cookies: 'R073',
  accessibility: 'R074',
};

const HOME_SECTIONS = [
  'hero',
  'categories',
  'campaigns',
  'selected_products',
  'engagement_wedding',
  'knowledge',
  'services',
  'heritage',
  'stories',
  'consultation_stores',
  'footer',
] as const;
const NON_INDEXABLE_PATHS = new Set(
  routeRegistry
    .filter((route) =>
      ['R050', 'R051', 'R052', 'R053', 'R075', 'R076', 'R077', 'R078'].includes(
        route.id,
      ),
    )
    .flatMap((route) => [route.bg, route.en]),
);

interface ResolvedLink {
  label: string;
  url: string;
}

interface StoreDto {
  code: LocationCode;
  locale: Locale;
  name: string;
  address: string;
  phone: string | null;
  email: string | null;
  emails: string[];
  opening_hours: string | null;
  seasonal_note: string | null;
  maps_url: string | null;
  media: ReturnType<typeof projectMedia>[];
}

interface ContentSummary {
  id: string;
  type: ContentType;
  locale: Locale;
  title: string;
  intro: string | null;
  url: string;
  primary_image: ReturnType<typeof projectMedia> | null;
}

interface SeoUrl {
  url: string;
  locale: Locale;
  alternates: { bg: string | null; en: string | null };
  lastmod: string | null;
}

function isRecord(value: Prisma.JsonValue | undefined): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function unavailable(
  code = 'CONFIGURATION_UNAVAILABLE',
  messageKey = 'errors.configuration_unavailable',
  details?: { field: string },
): never {
  throw new ServiceUnavailableException({
    code, message_key: messageKey, ...(details ? { details } : {}),
  });
}

function assertKeys(value: JsonRecord, allowed: readonly string[]): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected) {
    unavailable('CONFIGURATION_UNAVAILABLE', 'errors.configuration_unavailable', {
      field: unexpected,
    });
  }
}

function requiredString(
  value: Prisma.JsonValue | undefined,
  maximum = 2000,
): string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > maximum ||
    /<\/?[a-z!][^>]*>/iu.test(value)
  ) {
    unavailable();
  }
  return value.trim().normalize('NFC');
}

function nullableString(
  value: Prisma.JsonValue | undefined,
  maximum = 2000,
): string | null {
  return value === null ? null : requiredString(value, maximum);
}

function arrayValue(
  value: Prisma.JsonValue | undefined,
  maximum: number,
): Prisma.JsonArray {
  if (!Array.isArray(value) || value.length > maximum) unavailable();
  return value;
}

function recordValue(value: Prisma.JsonValue | undefined): JsonRecord {
  if (value === undefined || !isRecord(value)) unavailable();
  return value;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}

function validEmail(value: string | null): string | null {
  if (value === null) return null;
  if (value.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)) {
    unavailable();
  }
  return value;
}

function validPhone(value: string | null): string | null {
  if (value === null) return null;
  if (value.length < 3 || value.length > 40 || !/^[+()\d .-]+$/u.test(value)) {
    unavailable();
  }
  return value;
}

function dateIso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function externalUrl(value: string, production: boolean): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return unavailable('ROUTE_CONFLICT', 'errors.route_unavailable');
  }
  if (
    url.protocol !== 'https:' ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.hash.length > 0 ||
    (production && url.port.length > 0)
  ) {
    return unavailable('ROUTE_CONFLICT', 'errors.route_unavailable');
  }
  return url.toString();
}

function contentSummaryFrom(
  record: {
    id: string;
    type: ContentType;
    from_ContentTranslation_contentId: {
      locale: Locale;
      title: string;
      intro: string | null;
      sections: Prisma.JsonValue;
    }[];
    from_PublicRoute_contentId: { locale: Locale; path: string }[];
  },
  locale: Locale,
  origin: URL,
  primaryImage: ReturnType<typeof projectMedia> | null,
): ContentSummary {
  const translation = record.from_ContentTranslation_contentId.find(
    (item) => item.locale === locale,
  );
  const route = record.from_PublicRoute_contentId.find(
    (item) => item.locale === locale,
  );
  if (!translation || !route) throw new NotFoundException();
  return {
    id: record.id,
    type: record.type,
    locale,
    title: translation.title,
    intro: translation.intro,
    url: routeUrl(route.path, origin),
    primary_image: primaryImage,
  };
}

function publicEmails(
  legacyEmail: Prisma.JsonValue | undefined,
  emailValues: Prisma.JsonValue | undefined,
): string[] {
  const legacy =
    legacyEmail === undefined
      ? null
      : validEmail(nullableString(legacyEmail, 320));
  if (emailValues === undefined) return legacy ? [legacy] : [];
  const emails = arrayValue(emailValues, 5).map((value) =>
    validEmail(requiredString(value, 320)),
  );
  if (
    emails.some((email) => email === null) ||
    new Set(emails).size !== emails.length
  )
    unavailable();
  if (legacy && emails[0] !== legacy) unavailable();
  return emails.filter((email): email is string => email !== null);
}

@Injectable()
export class PublicContentService {
  private readonly logger = new Logger(PublicContentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly products: ProductReadService,
  ) {}

  async listContent(query: ContentListQueryDto) {
    return this.read(async (transaction) => {
      if (query.parent_id) {
        const parent = await transaction.contentRecord.findFirst({
          where: {
            id: query.parent_id,
            from_ContentTranslation_contentId: {
              some: { locale: query.locale, published: true },
            },
            from_PublicRoute_contentId: {
              some: { locale: query.locale, state: 'current' },
            },
          },
          select: { id: true },
        });
        if (!parent) throw new NotFoundException();
      }

      const where: Prisma.ContentRecordWhereInput = {
        type: query.type,
        ...(query.parent_id ? { parentId: query.parent_id } : {}),
        from_ContentTranslation_contentId: {
          some: { locale: query.locale, published: true },
        },
        from_PublicRoute_contentId: {
          some: { locale: query.locale, state: 'current' },
        },
      };
      const total = await transaction.contentRecord.count({ where });
      const start = (query.page - 1) * query.page_size;
      let ids: string[] | null = null;
      if (query.parent_id) {
        const links = await transaction.contentLink.findMany({
          where: {
            ownerContentId: query.parent_id,
            targetContentId: { not: null },
          },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          select: { targetContentId: true },
        });
        ids = [
          ...new Set(
            links
              .map((link) => link.targetContentId)
              .filter((id): id is string => id !== null),
          ),
        ];
      }

      const rows = await transaction.contentRecord.findMany({
        where,
        select: {
          id: true,
          type: true,
          from_ContentTranslation_contentId: {
            where: { locale: query.locale, published: true },
            select: { locale: true, title: true, intro: true, sections: true },
          },
          from_PublicRoute_contentId: {
            where: { locale: query.locale, state: 'current' },
            select: { locale: true, path: true },
          },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        ...(ids ? {} : { skip: start, take: query.page_size }),
      });

      let ordered = rows;
      if (ids) {
        const byId = new Map(rows.map((row) => [row.id, row]));
        const linked = ids.flatMap((id) => {
          const row = byId.get(id);
          return row ? [row] : [];
        });
        const linkedIds = new Set(linked.map((row) => row.id));
        ordered = [...linked, ...rows.filter((row) => !linkedIds.has(row.id))];
      }
      const page = ids
        ? ordered.slice(start, start + query.page_size)
        : ordered;
      const origin = this.siteOrigin();
      const imageIds = page.flatMap((row) => {
        const translation = row.from_ContentTranslation_contentId[0];
        const id = translation ? this.firstImageId(translation.sections) : null;
        return id ? [id] : [];
      });
      const media = await this.mediaByIds(
        transaction,
        [...new Set(imageIds)],
        query.locale,
      );
      const mediaById = new Map(media.map((item) => [item.id, item]));
      const items = page.map((row) => {
        const translation = row.from_ContentTranslation_contentId[0];
        const imageId = translation
          ? this.firstImageId(translation.sections)
          : null;
        return contentSummaryFrom(
          row,
          query.locale,
          origin,
          imageId ? (mediaById.get(imageId) ?? null) : null,
        );
      });
      return {
        items,
        total,
        page: query.page,
        page_size: query.page_size,
      };
    });
  }

  async contentDetail(id: string, locale: Locale) {
    return this.read((transaction) =>
      this.contentDetailInTransaction(transaction, id, locale),
    );
  }

  async home(locale: Locale) {
    return this.read((transaction) =>
      this.homeInTransaction(transaction, locale),
    );
  }

  async homeInTransaction(transaction: ReadTransaction, locale: Locale) {
    const homeRecords = await transaction.contentRecord.findMany({
      where: {
        type: 'home',
        from_ContentTranslation_contentId: {
          some: { locale, published: true },
        },
        from_PublicRoute_contentId: { some: { locale, state: 'current' } },
      },
      take: 2,
      select: {
        id: true,
        specialData: true,
        from_ContentTranslation_contentId: {
          where: { locale, published: true },
          select: { locale: true, sections: true },
        },
      },
    });
    if (homeRecords.length === 0) throw new NotFoundException();
    if (homeRecords.length !== 1) unavailable();
    const special = recordValue(homeRecords[0].specialData);
    assertKeys(special, ['kind', 'section_keys', 'hero_slides']);
    if (special.kind !== 'home') unavailable();
    const keys = arrayValue(special.section_keys, 11);
    if (
      keys.length !== HOME_SECTIONS.length ||
      keys.some((entry, index) => entry !== HOME_SECTIONS[index])
    ) {
      unavailable();
    }
    const homeTranslation = homeRecords[0].from_ContentTranslation_contentId[0];
    if (!homeTranslation) throw new NotFoundException();
    const homeBlocks = await this.projectSections(
      transaction,
      homeTranslation.sections,
      locale,
    );
    const contentBlocks = new Map<string, typeof homeBlocks>([
      ['hero', homeBlocks.slice(0, 1)],
      ['consultation_stores', homeBlocks.slice(1, 2)],
      ['categories', homeBlocks.slice(2)],
    ]);
    const heroSlides = await this.projectHeroSlides(
      transaction, special.hero_slides, locale,
    );

    const links = await transaction.contentLink.findMany({
      where: { ownerContentId: homeRecords[0].id },
      orderBy: [{ slot: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }],
      select: {
        slot: true,
        sortOrder: true,
        targetContentId: true,
        targetProductId: true,
        targetStoreCode: true,
        routeId: true,
        externalUrl: true,
        labelBg: true,
        labelEn: true,
      },
    });
    const sections = [];
    for (const key of HOME_SECTIONS) {
      const contentRecords: object[] = [];
      const productItems: ProductSummary[] = [];
      const storeItems: StoreDto[] = [];
      const resolved: ResolvedLink[] = [];
      for (const [linkIndex, link] of links.entries()) {
        if (link.slot !== key) continue;
        const label = locale === 'bg' ? link.labelBg : link.labelEn;
        if (link.targetContentId) {
          const record = await transaction.contentRecord.findFirst({
            where: {
              id: link.targetContentId,
              from_ContentTranslation_contentId: {
                some: { locale, published: true },
              },
              from_PublicRoute_contentId: {
                some: { locale, state: 'current' },
              },
            },
            select: { id: true },
          });
          if (!record) continue;
          const detail = await this.atField(
            `links[${linkIndex}].target`,
            () => this.contentDetailInTransaction(transaction, record.id, locale),
          );
          contentRecords.push(detail);
          if (label) resolved.push({ label, url: detail.url });
          continue;
        }
        const result = await this.atField(
          `links[${linkIndex}].target`,
          () => this.resolveStoredLink(transaction, link, locale),
        );
        if (!result) continue;
        if (result.kind === 'content') contentRecords.push(result.value);
        if (result.kind === 'product') productItems.push(result.value);
        if (result.kind === 'store') storeItems.push(result.value);
        if (result.kind === 'link') resolved.push(result.value);
        if (result.kind !== 'link' && label) {
          resolved.push({
            label,
            url:
              result.kind === 'store'
                ? this.storeUrl(result.value.code, locale)
                : this.valueUrl(result.value),
          });
        }
      }
      sections.push({
        key,
        content: null,
        content_blocks: contentBlocks.get(key) ?? [],
        ...(key === 'hero' ? { slides: heroSlides } : {}),
        products: productItems,
        records: contentRecords,
        stores: storeItems,
        links: resolved,
      });
    }
    return { locale, sections };
  }

  async stores(locale: Locale): Promise<{ items: StoreDto[] }> {
    return this.read(async (transaction) => {
      const rows = await transaction.store.findMany({
        orderBy: { code: 'asc' },
        select: { code: true, publicData: true },
      });
      const orderedCodes: LocationCode[] = ['sofia', 'nessebar'];
      const byCode = new Map(rows.map((row) => [row.code, row]));
      const items: StoreDto[] = [];
      for (const code of orderedCodes) {
        const row = byCode.get(code);
        if (row) items.push(await this.storeDto(transaction, row, locale));
      }
      return { items };
    });
  }

  async storeDetail(code: LocationCode, locale: Locale): Promise<StoreDto> {
    return this.read(async (transaction) => {
      const row = await transaction.store.findUnique({
        where: { code },
        select: { code: true, publicData: true },
      });
      if (!row) throw new NotFoundException();
      return this.storeDto(transaction, row, locale);
    });
  }

  async siteContacts(locale: Locale) {
    return this.read((transaction) =>
      this.siteContactsInTransaction(transaction, locale),
    );
  }

  async siteContactsInTransaction(
    transaction: ReadTransaction,
    locale: Locale,
  ) {
    const settings = await transaction.shopSettings.findUnique({
      where: { id: 1 },
      select: { siteContacts: true },
    });
    if (!settings) unavailable();
    const contact = recordValue(settings.siteContacts);
    assertKeys(contact, [
      'phone',
      'email',
      'emails',
      'store_codes',
      'verified_links',
    ]);
    const phone = validPhone(nullableString(contact.phone, 40));
    const emails = publicEmails(contact.email, contact.emails);
    const email = emails[0] ?? null;
    const codes = arrayValue(contact.store_codes, 2).map((value) => {
      if (value !== 'sofia' && value !== 'nessebar') unavailable();
      return value;
    });
    if (new Set(codes).size !== codes.length) unavailable();
    const storeRows = await transaction.store.findMany({
      where: { code: { in: codes } },
      select: { code: true, publicData: true },
    });
    const storeByCode = new Map(storeRows.map((row) => [row.code, row]));
    const stores: StoreDto[] = [];
    for (const code of codes) {
      const row = storeByCode.get(code);
      if (!row) unavailable();
      stores.push(await this.storeDto(transaction, row, locale));
    }
    const links: ResolvedLink[] = arrayValue(contact.verified_links, 50).map(
      (value) => {
        const item = recordValue(value);
        assertKeys(item, ['label_bg', 'label_en', 'url']);
        const label = requiredString(
          locale === 'bg' ? item.label_bg : item.label_en,
          255,
        );
        const url = externalUrl(
          requiredString(item.url, 2000),
          this.production,
        );
        return { label, url };
      },
    );
    return { phone, email, emails, stores, links };
  }

  async policy(kind: PolicyKind, query: PolicyQueryDto) {
    return this.read(async (transaction) => {
      const version = query.version?.trim();
      const row = await transaction.policyVersion.findFirst({
        where: {
          kind,
          locale: query.locale,
          published: true,
          ...(version ? { versionLabel: version } : { current: true }),
        },
        select: {
          id: true,
          kind: true,
          versionLabel: true,
          locale: true,
          title: true,
          body: true,
          url: true,
          verifiedPublishedAt: true,
        },
      });
      if (!row) throw new NotFoundException();
      return {
        id: row.id,
        kind: row.kind,
        version: row.versionLabel,
        locale: row.locale,
        title: row.title,
        text: row.body,
        url: this.policyUrl(row.url, row.kind, row.locale),
        published_at: dateIso(row.verifiedPublishedAt),
      };
    });
  }

  async cookieConfig(locale: Locale) {
    return this.read((transaction) =>
      this.cookieConfigInTransaction(transaction, locale),
    );
  }

  async cookieConfigInTransaction(
    transaction: ReadTransaction,
    locale: Locale,
  ) {
    const settings = await transaction.shopSettings.findUnique({
      where: { id: 1 },
      select: { cookieConfig: true },
    });
    if (!settings) unavailable();
    const config = recordValue(settings.cookieConfig);
    assertKeys(config, [
      'version',
      'policy_version',
      'necessary_enabled',
      'optional_categories',
      'providers',
      'persistence_days',
    ]);
    if (config.necessary_enabled !== true) unavailable();
    const version = requiredString(config.version, 80);
    const policyVersion = requiredString(config.policy_version, 80);
    const categories = arrayValue(config.optional_categories, 2).map(
      (value) => {
        if (value !== 'analytics' && value !== 'marketing') unavailable();
        return value;
      },
    );
    if (new Set(categories).size !== categories.length) unavailable();
    const providers = arrayValue(config.providers, 50).map((value) => {
      const provider = recordValue(value);
      assertKeys(provider, [
        'id',
        'category',
        'name',
        'purpose_bg',
        'purpose_en',
      ]);
      const id = requiredString(provider.id, 80);
      const category = provider.category;
      if (category !== 'analytics' && category !== 'marketing') unavailable();
      if (!categories.includes(category)) unavailable();
      return {
        id,
        category,
        name: requiredString(provider.name, 255),
        purpose:
          locale === 'bg'
            ? requiredString(provider.purpose_bg, 1000)
            : requiredString(provider.purpose_en, 1000),
      };
    });
    if (
      new Set(providers.map((provider) => provider.id)).size !==
      providers.length
    ) {
      unavailable();
    }
    const persistenceDays = config.persistence_days;
    if (
      persistenceDays !== null &&
      (typeof persistenceDays !== 'number' ||
        !Number.isInteger(persistenceDays) ||
        persistenceDays < 1 ||
        persistenceDays > 3650)
    ) {
      unavailable();
    }
    const policy = await transaction.policyVersion.findFirst({
      where: {
        kind: 'cookies',
        locale,
        versionLabel: policyVersion,
        current: true,
        published: true,
      },
      select: { url: true },
    });
    if (!policy) unavailable();
    return {
      version,
      policy_url: this.policyUrl(policy.url, 'cookies', locale),
      necessary_enabled: true as const,
      optional_categories: [
        ...new Set(providers.map((provider) => provider.category)),
      ],
      providers,
      persistence_days: persistenceDays,
    };
  }

  async seoUrls(query: SeoUrlsQueryDto) {
    if (this.config.get<string>('NODE_ENV') !== 'production') {
      throw new NotFoundException();
    }
    const afterId = query.after_id?.toLowerCase();
    return this.read(async (transaction) => {
      const routes = await transaction.publicRoute.findMany({
        where: {
          state: 'current',
          id: afterId ? { gt: afterId } : undefined,
          path: { notIn: [...NON_INDEXABLE_PATHS] },
          OR: [
            {
              productId: { not: null },
              productIdRelation: {
                is: {
                  publicationStatus: 'published',
                  currentRevisionIdRelation: {
                    is: { state: 'published' },
                  },
                },
              },
            },
            {
              contentId: { not: null },
              contentIdRelation: {
                is: {
                  from_ContentTranslation_contentId: {
                    some: { published: true },
                  },
                },
              },
            },
          ],
        },
        orderBy: { id: 'asc' },
        take: query.limit + 1,
        select: {
          id: true,
          path: true,
          locale: true,
          productId: true,
          contentId: true,
        },
      });
      const policies = await transaction.policyVersion.findMany({
        where: {
          current: true,
          published: true,
          id: afterId ? { gt: afterId } : undefined,
        },
        orderBy: { id: 'asc' },
        take: query.limit + 1,
        select: {
          id: true,
          kind: true,
          versionLabel: true,
          locale: true,
          url: true,
          verifiedPublishedAt: true,
        },
      });
      const entries = [
        ...routes.map((route) => ({
          id: route.id,
          type: 'route' as const,
          route,
        })),
        ...policies.map((policy) => ({
          id: policy.id,
          type: 'policy' as const,
          policy,
        })),
        ...(await this.staticSeoEntries(transaction, afterId)).map((entry) => ({
          id: entry.id,
          type: 'static' as const,
          entry,
        })),
      ].sort((left, right) => left.id.localeCompare(right.id));
      const page = entries.slice(0, query.limit);
      const items: SeoUrl[] = [];
      const origin = this.siteOrigin();
      for (const entry of page) {
        if (entry.type === 'policy') {
          const alternates = await transaction.policyVersion.findMany({
            where: {
              kind: entry.policy.kind,
              versionLabel: entry.policy.versionLabel,
              current: true,
              published: true,
            },
            select: { locale: true, url: true },
          });
          items.push({
            url: this.policyUrl(
              entry.policy.url, entry.policy.kind, entry.policy.locale,
            ),
            locale: entry.policy.locale,
            alternates: {
              bg: this.alternatePolicyUrl(alternates, entry.policy.kind, 'bg'),
              en: this.alternatePolicyUrl(alternates, entry.policy.kind, 'en'),
            },
            lastmod: dateIso(entry.policy.verifiedPublishedAt),
          });
          continue;
        }
        if (entry.type === 'static') {
          items.push(entry.entry.value);
          continue;
        }
        const route = entry.route;
        if (route.productId) {
          const product = await transaction.product.findFirst({
            where: {
              id: route.productId,
              publicationStatus: 'published',
              currentRevisionIdRelation: { is: { state: 'published' } },
            },
            select: { currentRevisionId: true },
          });
          const revisionId = product?.currentRevisionId;
          if (!revisionId) continue;
          const translation = await transaction.productTranslation.findFirst({
            where: {
              revisionId,
              locale: route.locale,
            },
            select: { publicModifiedAt: true },
          });
          if (!translation) continue;
          const alternates = await transaction.publicRoute.findMany({
            where: {
              productId: route.productId,
              state: 'current',
              productIdRelation: { is: { publicationStatus: 'published' } },
            },
            select: { locale: true, path: true },
          });
          const translatedLocales =
            await transaction.productTranslation.findMany({
              where: {
                revisionId,
                locale: { in: ['bg', 'en'] },
              },
              select: { locale: true },
            });
          const translated = new Set(
            translatedLocales.map((translation) => translation.locale),
          );
          const validAlternates = alternates.filter((alternate) =>
            translated.has(alternate.locale),
          );
          items.push({
            url: routeUrl(route.path, origin),
            locale: route.locale,
            alternates: {
              bg: this.alternateUrl(validAlternates, 'bg', origin),
              en: this.alternateUrl(validAlternates, 'en', origin),
            },
            lastmod: dateIso(translation.publicModifiedAt),
          });
        } else if (route.contentId) {
          const translation = await transaction.contentTranslation.findFirst({
            where: {
              contentId: route.contentId,
              locale: route.locale,
              published: true,
            },
            select: { publicModifiedAt: true },
          });
          if (!translation) continue;
          const alternates = await transaction.publicRoute.findMany({
            where: {
              contentId: route.contentId,
              state: 'current',
              contentIdRelation: {
                is: {
                  from_ContentTranslation_contentId: {
                    some: { published: true },
                  },
                },
              },
            },
            select: { locale: true, path: true },
          });
          const translatedLocales =
            await transaction.contentTranslation.findMany({
              where: {
                contentId: route.contentId,
                published: true,
                locale: { in: ['bg', 'en'] },
              },
              select: { locale: true },
            });
          const translated = new Set(
            translatedLocales.map((translation) => translation.locale),
          );
          const validAlternates = alternates.filter((alternate) =>
            translated.has(alternate.locale),
          );
          items.push({
            url: routeUrl(route.path, origin),
            locale: route.locale,
            alternates: {
              bg: this.alternateUrl(validAlternates, 'bg', origin),
              en: this.alternateUrl(validAlternates, 'en', origin),
            },
            lastmod: dateIso(translation.publicModifiedAt),
          });
        }
      }
      const next =
        entries.length > query.limit ? (page.at(-1)?.id ?? null) : null;
      const uniqueItems = new Map<string, SeoUrl>();
      for (const item of items) {
        uniqueItems.set(`${item.locale}\u0000${item.url}`, item);
      }
      return { items: [...uniqueItems.values()], next_cursor: next };
    });
  }

  private async staticSeoEntries(
    transaction: ReadTransaction,
    afterId: string | undefined,
  ): Promise<{ id: string; value: SeoUrl }[]> {
    const origin = this.siteOrigin();
    const entries: { id: string; value: SeoUrl }[] = [];
    const route = (id: string) => routeRegistry.find((item) => item.id === id);
    const isAlreadyRouted = async (path: string, locale: Locale) =>
      (await transaction.publicRoute.findFirst({
        where: { path, locale, state: 'current' },
        select: { id: true },
      })) !== null;

    const storeRows = await transaction.store.findMany({
      orderBy: { code: 'asc' },
      select: { code: true, publicData: true },
    });
    if (storeRows.length > 0) {
      const listing = route('R063');
      if (!listing) unavailable('ROUTE_CONFLICT', 'errors.route_unavailable');
      const hasBg = !(await isAlreadyRouted(listing.bg, 'bg'));
      const hasEn = !(await isAlreadyRouted(listing.en, 'en'));
      if (hasBg || hasEn) {
        for (const locale of ['bg', 'en'] as const) {
          if ((locale === 'bg' && !hasBg) || (locale === 'en' && !hasEn)) {
            continue;
          }
          const url = routeUrl(listing[locale], origin);
          entries.push({
            id: this.staticCursorId(`R063:${locale}`),
            value: {
              url,
              locale,
              alternates: {
                bg: hasBg ? routeUrl(listing.bg, origin) : null,
                en: hasEn ? routeUrl(listing.en, origin) : null,
              },
              lastmod: null,
            },
          });
        }
      }

      for (const row of storeRows) {
        const storeRoute = route(row.code === 'sofia' ? 'R065' : 'R066');
        if (!storeRoute)
          unavailable('ROUTE_CONFLICT', 'errors.route_unavailable');
        await this.storeDto(transaction, row, 'bg');
        await this.storeDto(transaction, row, 'en');
        const hasBg = !(await isAlreadyRouted(storeRoute.bg, 'bg'));
        const hasEn = !(await isAlreadyRouted(storeRoute.en, 'en'));
        for (const locale of ['bg', 'en'] as const) {
          if ((locale === 'bg' && !hasBg) || (locale === 'en' && !hasEn)) {
            continue;
          }
          entries.push({
            id: this.staticCursorId(`${storeRoute.id}:${locale}`),
            value: {
              url: routeUrl(storeRoute[locale], origin),
              locale,
              alternates: {
                bg: hasBg ? routeUrl(storeRoute.bg, origin) : null,
                en: hasEn ? routeUrl(storeRoute.en, origin) : null,
              },
              lastmod: null,
            },
          });
        }
      }
    }

    const settings = await transaction.shopSettings.findUnique({
      where: { id: 1 },
      select: { id: true },
    });
    const contactRoute = route('R064');
    if (settings && !contactRoute) {
      unavailable('ROUTE_CONFLICT', 'errors.route_unavailable');
    }
    if (settings && contactRoute) {
      await this.siteContactsInTransaction(transaction, 'bg');
      await this.siteContactsInTransaction(transaction, 'en');
      const hasBg = !(await isAlreadyRouted(contactRoute.bg, 'bg'));
      const hasEn = !(await isAlreadyRouted(contactRoute.en, 'en'));
      for (const locale of ['bg', 'en'] as const) {
        if ((locale === 'bg' && !hasBg) || (locale === 'en' && !hasEn)) {
          continue;
        }
        entries.push({
          id: this.staticCursorId(`R064:${locale}`),
          value: {
            url: routeUrl(contactRoute[locale], origin),
            locale,
            alternates: {
              bg: hasBg ? routeUrl(contactRoute.bg, origin) : null,
              en: hasEn ? routeUrl(contactRoute.en, origin) : null,
            },
            lastmod: null,
          },
        });
      }
    }
    return entries.filter((entry) => !afterId || entry.id > afterId);
  }

  private staticCursorId(key: string): string {
    const hex = createHash('sha1')
      .update(`ssg-web-api:seo-route:${key}`)
      .digest('hex')
      .slice(0, 32)
      .split('');
    hex[12] = '5';
    hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
    const value = hex.join('');
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
  }

  private async contentDetailInTransaction(
    transaction: ReadTransaction,
    id: string,
    locale: Locale,
  ) {
    const record = await transaction.contentRecord.findFirst({
      where: {
        id,
        from_ContentTranslation_contentId: {
          some: { locale, published: true },
        },
        from_PublicRoute_contentId: { some: { locale, state: 'current' } },
      },
      select: {
        id: true,
        type: true,
        parentId: true,
        authorId: true,
        specialData: true,
        from_ContentTranslation_contentId: {
          where: { published: true },
          select: {
            locale: true,
            title: true,
            intro: true,
            sections: true,
            seoTitle: true,
            seoDescription: true,
            publishedAt: true,
            publicModifiedAt: true,
          },
        },
        from_PublicRoute_contentId: {
          where: { state: 'current' },
          select: { locale: true, path: true },
        },
        from_ContentLink_ownerContentId: {
          orderBy: [{ slot: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }],
          select: {
            slot: true,
            sortOrder: true,
            targetContentId: true,
            targetProductId: true,
            targetStoreCode: true,
            routeId: true,
            externalUrl: true,
            labelBg: true,
            labelEn: true,
          },
        },
      },
    });
    if (!record) throw new NotFoundException();
    const translation = record.from_ContentTranslation_contentId.find(
      (item) => item.locale === locale,
    );
    if (!translation) throw new NotFoundException();
    const origin = this.siteOrigin();
    const sections = await this.projectSections(
      transaction,
      translation.sections,
      locale,
    );
    const primaryImage =
      record.type === 'home'
        ? null
        : (sections.find((section) => section.kind === 'image')?.media ??
          sections
            .find((section) => section.kind === 'link_cards')
            ?.items.find((item) => item.media !== null)?.media ??
          null);
    const summary = contentSummaryFrom(record, locale, origin, primaryImage);
    const special = await this.projectSpecial(
      transaction,
      record.type,
      record.specialData,
      record.authorId,
      locale,
    );
    const children: ResolvedLink[] = [];
    const childIds = new Set<string>();
    for (const link of record.from_ContentLink_ownerContentId) {
      if (link.slot !== 'children' || !link.targetContentId) continue;
      const resolved = await this.resolveStoredLink(transaction, link, locale);
      if (resolved?.kind === 'content') {
        childIds.add(resolved.value.id);
        children.push({
          label:
            (locale === 'bg' ? link.labelBg : link.labelEn) ??
            resolved.value.title,
          url: resolved.value.url,
        });
      }
    }
    const childRecords = await transaction.contentRecord.findMany({
      where: {
        parentId: record.id,
        from_ContentTranslation_contentId: {
          some: { locale, published: true },
        },
        from_PublicRoute_contentId: { some: { locale, state: 'current' } },
      },
      orderBy: [{ key: 'asc' }, { id: 'asc' }],
      take: 100,
      select: { id: true },
    });
    for (const child of childRecords) {
      if (childIds.has(child.id)) continue;
      const summary = await this.contentSummary(transaction, child.id, locale);
      if (summary) {
        childIds.add(child.id);
        children.push({ label: summary.title, url: summary.url });
      }
    }
    const contentRelatedIds = record.from_ContentLink_ownerContentId
      .filter(
        (link) => link.slot === 'related_products' && link.targetProductId,
      )
      .flatMap((link) => (link.targetProductId ? [link.targetProductId] : []))
      .slice(0, 50);
    const relatedLinks = contentRelatedIds.length
      ? contentRelatedIds.map((relatedProductId) => ({ relatedProductId }))
      : await transaction.productRelatedLink.findMany({
          where: { productId: id },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          take: 50,
          select: { relatedProductId: true },
        });
    const relatedProductIds = [
      ...new Set(relatedLinks.map((link) => link.relatedProductId)),
    ];
    const candidates = await this.products.catalogCandidates(
      transaction,
      relatedProductIds,
      locale,
      null,
    );
    const candidateById = new Map(
      candidates.map((candidate) => [candidate.summary.id, candidate.summary]),
    );
    const relatedProducts = relatedProductIds.flatMap((relatedProductId) => {
      const candidate = candidateById.get(relatedProductId);
      return candidate ? [candidate] : [];
    });
    const publishedLocales = new Set(
      record.from_ContentTranslation_contentId.map((item) => item.locale),
    );
    const routeMap = new Map(
      record.from_PublicRoute_contentId
        .filter((route) => publishedLocales.has(route.locale))
        .map((route) => [route.locale, route.path]),
    );
    return {
      ...summary,
      sections,
      special,
      children,
      related_products: relatedProducts,
      alternate_urls: {
        bg: routeMap.has('bg')
          ? routeUrl(routeMap.get('bg') ?? '', origin)
          : null,
        en: routeMap.has('en')
          ? routeUrl(routeMap.get('en') ?? '', origin)
          : null,
      },
      seo_title: translation.seoTitle,
      seo_description: translation.seoDescription,
      published_at: dateIso(translation.publishedAt),
      modified_at: dateIso(translation.publicModifiedAt),
    };
  }

  async validateContent(
    transaction: ReadTransaction,
    input: {
      type: ContentType;
      special_data: Prisma.JsonObject;
      author_id: string | null;
      translations: {
        locale: Locale;
        title: string;
        intro: string | null;
        seo_title: string | null;
        seo_description: string | null;
        sections: Prisma.JsonObject[];
      }[];
    },
  ): Promise<void> {
    this.siteOrigin();
    for (const [index, translation] of input.translations.entries()) {
      for (const [field, maximum] of [
        ['title', 250],
        ['intro', 3000],
        ['seo_title', 250],
        ['seo_description', 1000],
      ] as const) {
        await this.atField(`translations[${index}].${field}`, async () => {
          if (field === 'title') requiredString(translation[field], maximum);
          else nullableString(translation[field], maximum);
        });
      }
      await this.atField('special_data', () =>
        this.projectSpecial(
          transaction, input.type, input.special_data, input.author_id,
          translation.locale,
        ),
      );
      for (const [sectionIndex, section] of translation.sections.entries()) {
        await this.atField(
          `translations[${index}].sections[${sectionIndex}]`,
          () => this.projectSections(transaction, [section], translation.locale, true),
        );
      }
    }
  }

  async validateLink(
    transaction: ReadTransaction,
    target: Prisma.JsonObject,
    label: string | null,
    locale: Locale,
  ): Promise<void> {
    const parsed = this.linkTarget(target);
    if (label !== null) requiredString(label, 255);
    const resolved = await this.resolveTarget(
      transaction,
      parsed,
      label ?? 'link',
      locale,
    );
    if (!resolved) unavailable('LINK_TARGET_UNAVAILABLE', 'errors.validation');
  }

  validatePolicy(
    input: { title: string; text: string; url: string; locale: Locale },
    kind: PolicyKind,
  ): void {
    this.siteOrigin();
    requiredString(input.title, 250);
    requiredString(input.text, 100000);
    this.policyUrl(input.url, kind, input.locale, true);
  }

  assertWebsiteConfiguration(): void {
    this.siteOrigin();
  }

  private async atField<T>(field: string, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        const response = error.getResponse();
        if (typeof response === 'object') {
          const nested = 'details' in response ? response.details : null;
          const suffix =
            nested && typeof nested === 'object' &&
            'field' in nested && typeof nested.field === 'string'
              ? nested.field : null;
          throw new ServiceUnavailableException({
            ...response,
            details: { field: suffix ? `${field}.${suffix}` : field },
          });
        }
      }
      throw error;
    }
  }

  private async projectHeroSlides(
    transaction: ReadTransaction,
    value: Prisma.JsonValue | undefined,
    locale: Locale,
  ) {
    if (value === undefined) return [];
    const localized = recordValue(value);
    assertKeys(localized, ['bg', 'en']);
    const bg = arrayValue(localized.bg, Number.MAX_SAFE_INTEGER);
    const en = arrayValue(localized.en, Number.MAX_SAFE_INTEGER);
    if (bg.length !== en.length) unavailable();
    const keys = [bg, en].map(items => items.map(raw => recordValue(raw).key));
    if (keys.some(items => items.some(key => key !== undefined))) {
      if (keys.some(items => items.some(key =>
        typeof key !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(key))) ||
        new Set(keys[0]).size !== bg.length ||
        keys[0].some((key, index) => keys[1][index] !== key)) unavailable();
    }
    const rawSlides = locale === 'bg' ? bg : en;
    const requestedIds = rawSlides.flatMap(raw => {
      const ids = recordValue(raw).product_ids;
      if (ids === undefined) return [];
      return arrayValue(ids, Number.MAX_SAFE_INTEGER).map(id => {
        const parsed = requiredString(id, 36);
        if (!isUuid(parsed)) unavailable();
        return parsed;
      });
    });
    const candidates = requestedIds.length
      ? await this.products.catalogCandidates(transaction, [...new Set(requestedIds)], locale, null)
      : [];
    const productsById = new Map(candidates.map(candidate => [candidate.summary.id, candidate.summary]));
    const slides = [];
    for (const [index, raw] of rawSlides.entries()) {
      const slide = await this.atField(`hero_slides.${locale}[${index}]`, async () => {
        const source = recordValue(raw);
        assertKeys(source, ['key', 'media_id', 'heading', 'text', 'cta', 'product_ids']);
        const mediaId = requiredString(source.media_id, 36);
        if (!isUuid(mediaId)) unavailable();
        const media = (await this.mediaByIds(transaction, [mediaId], locale))[0];
        let cta: ResolvedLink | null = null;
        if (source.cta !== null) {
          const ctaSource = recordValue(source.cta);
          assertKeys(ctaSource, ['label', 'target']);
          cta = await this.resolveTarget(
            transaction, this.linkTarget(ctaSource.target),
            requiredString(ctaSource.label, 255), locale,
          );
          if (!cta) unavailable('LINK_TARGET_UNAVAILABLE', 'errors.validation');
        }
        const productIds = source.product_ids === undefined
          ? [] : arrayValue(source.product_ids, Number.MAX_SAFE_INTEGER);
        if (new Set(productIds).size !== productIds.length) unavailable();
        const products = productIds.map(id => {
          if (typeof id !== 'string') unavailable();
          const product = productsById.get(id);
          if (!product) unavailable('LINK_TARGET_UNAVAILABLE', 'errors.validation');
          return product;
        });
        return {
          key: typeof source.key === 'string' ? source.key : null,
          media,
          heading: nullableString(source.heading, 255),
          text: nullableString(source.text, 3000),
          cta,
          products,
        };
      });
      slides.push(slide);
    }
    return slides;
  }

  private async projectSections(
    transaction: ReadTransaction,
    value: Prisma.JsonValue,
    locale: Locale,
    requireResolvedLinks = false,
  ) {
    const rawSections = arrayValue(value, 200);
    const sections: (
      | { kind: 'text'; heading: string | null; text: string }
      | {
          kind: 'image';
          media: ReturnType<typeof projectMedia>;
          caption: string | null;
        }
      | {
          kind: 'link_cards';
          items: {
            label: string;
            text: string | null;
            link: ResolvedLink | null;
            media: ReturnType<typeof projectMedia> | null;
          }[];
        }
      | {
          kind: 'data_table';
          caption: string;
          columns: { key: string; label: string; unit: string | null }[];
          rows: { cells: (string | null)[] }[];
        }
      | {
          kind: 'faq';
          items: { question: string; answer: string; links: ResolvedLink[] }[];
        }
    )[] = [];
    for (const value of rawSections) {
      const section = recordValue(value);
      const kind = requiredString(section.kind, 40);
      if (kind === 'text') {
        assertKeys(section, ['kind', 'heading', 'text']);
        sections.push({
          kind,
          heading:
            section.heading === null
              ? null
              : requiredString(section.heading, 255),
          text: requiredString(section.text, 20000),
        });
      } else if (kind === 'image') {
        assertKeys(section, ['kind', 'media_id', 'caption']);
        const mediaId = requiredString(section.media_id, 36);
        if (!isUuid(mediaId)) unavailable();
        const media = await this.mediaByIds(transaction, [mediaId], locale);
        sections.push({
          kind,
          media: media[0],
          caption:
            section.caption === null
              ? null
              : requiredString(section.caption, 1000),
        });
      } else if (kind === 'link_cards') {
        assertKeys(section, ['kind', 'items']);
        const cards = arrayValue(section.items, 100);
        const items = [];
        for (const cardValue of cards) {
          const card = recordValue(cardValue);
          assertKeys(card, ['label', 'text', 'target', 'media_id']);
          const target = this.linkTarget(card.target);
          const label = requiredString(card.label, 255);
          const link = await this.resolveTarget(
            transaction,
            target,
            label,
            locale,
          );
          if (requireResolvedLinks && !link)
            unavailable('LINK_TARGET_UNAVAILABLE', 'errors.validation');
          let media: ReturnType<typeof projectMedia> | null = null;
          if (card.media_id !== null) {
            const mediaId = requiredString(card.media_id, 36);
            if (!isUuid(mediaId)) unavailable();
            media = (await this.mediaByIds(transaction, [mediaId], locale))[0];
          }
          items.push({
            label,
            text: card.text === null ? null : requiredString(card.text, 3000),
            link,
            media,
          });
        }
        sections.push({ kind, items });
      } else if (kind === 'data_table') {
        assertKeys(section, ['kind', 'caption', 'columns', 'rows']);
        const columns = arrayValue(section.columns, 20).map((columnValue) => {
          const column = recordValue(columnValue);
          assertKeys(column, ['key', 'label', 'unit']);
          return {
            key: requiredString(column.key, 80),
            label: requiredString(column.label, 255),
            unit: column.unit === null ? null : requiredString(column.unit, 80),
          };
        });
        const rows = arrayValue(section.rows, 100).map((rowValue) => {
          const row = recordValue(rowValue);
          assertKeys(row, ['cells']);
          const cells = arrayValue(row.cells, 20).map((cell) =>
            cell === null ? null : requiredString(cell, 1000),
          );
          if (cells.length !== columns.length) unavailable();
          return { cells };
        });
        sections.push({
          kind,
          caption: requiredString(section.caption, 255),
          columns,
          rows,
        });
      } else if (kind === 'faq') {
        assertKeys(section, ['kind', 'items']);
        const items = [];
        for (const itemValue of arrayValue(section.items, 100)) {
          const item = recordValue(itemValue);
          assertKeys(item, ['question', 'answer', 'links']);
          const links: ResolvedLink[] = [];
          for (const linkValue of arrayValue(item.links, 20)) {
            const linkObject = recordValue(linkValue);
            assertKeys(linkObject, ['label', 'target']);
            const label = requiredString(linkObject.label, 255);
            const resolved = await this.resolveTarget(
              transaction,
              this.linkTarget(linkObject.target),
              label,
              locale,
            );
            if (requireResolvedLinks && !resolved)
              unavailable('LINK_TARGET_UNAVAILABLE', 'errors.validation');
            if (resolved) links.push(resolved);
          }
          items.push({
            question: requiredString(item.question, 1000),
            answer: requiredString(item.answer, 10000),
            links,
          });
        }
        sections.push({ kind, items });
      } else {
        unavailable();
      }
    }
    return sections;
  }

  private async projectSpecial(
    transaction: ReadTransaction,
    type: ContentType,
    value: Prisma.JsonValue,
    authorId: string | null,
    locale: Locale,
  ) {
    const special = recordValue(value);
    if (special.kind !== type) unavailable();
    if (type === 'home') {
      assertKeys(special, ['kind', 'section_keys', 'hero_slides']);
      const keys = arrayValue(special.section_keys, 11);
      if (
        keys.length !== HOME_SECTIONS.length ||
        keys.some((key, index) => key !== HOME_SECTIONS[index])
      )
        unavailable();
      return {
        kind: 'home' as const,
        hero_slides: await this.projectHeroSlides(transaction, special.hero_slides, locale),
      };
    }
    if (type === 'hub' || type === 'selection') {
      assertKeys(special, ['kind', 'selector_key']);
      if (special.selector_key !== null)
        requiredString(special.selector_key, 120);
      return { kind: type };
    }
    if (type === 'knowledge') {
      assertKeys(special, ['kind', 'topic_code', 'gemstone_codes', 'bg', 'en']);
      const localizedContent = {} as Record<
        Locale,
        {
          name: string;
          heading: string;
          lead: string;
          detail_paragraphs: [string, string];
        }
      >;
      for (const candidateLocale of ['bg', 'en'] as const) {
        const localized = recordValue(special[candidateLocale]);
        assertKeys(localized, ['name', 'heading', 'lead', 'detail_paragraphs']);
        const paragraphs = arrayValue(localized.detail_paragraphs, 2);
        if (paragraphs.length !== 2) unavailable();
        localizedContent[candidateLocale] = {
          name: requiredString(localized.name, 255),
          heading: requiredString(localized.heading, 1000),
          lead: requiredString(localized.lead, 5000),
          detail_paragraphs: [
            requiredString(paragraphs[0], 10000),
            requiredString(paragraphs[1], 10000),
          ],
        };
      }
      const localized = localizedContent[locale];
      return {
        kind: type,
        topic_code: requiredString(special.topic_code, 80),
        ...localized,
        gemstone_codes: arrayValue(special.gemstone_codes, 50).map((code) =>
          requiredString(code, 80),
        ),
      };
    }
    if (type === 'service') {
      assertKeys(special, [
        'kind',
        'topic_code',
        'scope_bg',
        'scope_en',
        'enquiry_topic',
      ]);
      return {
        kind: type,
        topic_code: requiredString(special.topic_code, 80),
        scope: requiredString(
          locale === 'bg' ? special.scope_bg : special.scope_en,
          5000,
        ),
        enquiry_topic: requiredString(special.enquiry_topic, 250),
      };
    }
    if (type === 'article' || type === 'case_study') {
      assertKeys(special, ['kind', 'event_at', 'sources', 'evidence_ref']);
      if (
        special.evidence_ref !== null &&
        (typeof special.evidence_ref !== 'string' ||
          special.evidence_ref.length > 2000)
      ) {
        unavailable();
      }
      const sources = arrayValue(special.sources, 50).map((source) =>
        externalUrl(requiredString(source, 2000), this.production),
      );
      let author: ContentSummary | null = null;
      if (authorId) {
        author = await this.contentSummary(transaction, authorId, locale);
        if (author && author.type !== 'author') unavailable();
      }
      const eventAt =
        special.event_at === null ? null : this.dateValue(special.event_at);
      return { kind: type, author, event_at: eventAt, sources };
    }
    if (type === 'press') {
      assertKeys(special, ['kind', 'publisher', 'source_url', 'source_date']);
      return {
        kind: type,
        publisher: requiredString(special.publisher, 255),
        source_url: externalUrl(
          requiredString(special.source_url, 2000),
          this.production,
        ),
        source_date:
          special.source_date === null
            ? null
            : this.dateValue(special.source_date),
      };
    }
    if (type === 'author') {
      assertKeys(special, [
        'kind',
        'verified_role_bg',
        'verified_role_en',
        'portrait_id',
      ]);
      let portrait: ReturnType<typeof projectMedia> | null = null;
      if (special.portrait_id !== null) {
        const id = requiredString(special.portrait_id, 36);
        if (!isUuid(id)) unavailable();
        portrait = (await this.mediaByIds(transaction, [id], locale))[0];
      }
      return {
        kind: type,
        verified_role:
          locale === 'bg'
            ? nullableString(special.verified_role_bg, 255)
            : nullableString(special.verified_role_en, 255),
        portrait,
      };
    }
    if (type === 'guide') {
      assertKeys(special, ['kind', 'unit_codes']);
      arrayValue(special.unit_codes, 100).forEach((code) =>
        requiredString(code, 80),
      );
      return {
        kind: type,
      };
    }
    if (type === 'faq' || type === 'contact') {
      assertKeys(special, ['kind']);
      return { kind: type };
    }
    return unavailable();
  }

  private async contentSummary(
    transaction: ReadTransaction,
    id: string,
    locale: Locale,
  ): Promise<ContentSummary | null> {
    const record = await transaction.contentRecord.findFirst({
      where: {
        id,
        from_ContentTranslation_contentId: {
          some: { locale, published: true },
        },
        from_PublicRoute_contentId: { some: { locale, state: 'current' } },
      },
      select: {
        id: true,
        type: true,
        from_ContentTranslation_contentId: {
          where: { locale, published: true },
          select: { locale: true, title: true, intro: true, sections: true },
        },
        from_PublicRoute_contentId: {
          where: { locale, state: 'current' },
          select: { locale: true, path: true },
        },
      },
    });
    if (!record) return null;
    const translation = record.from_ContentTranslation_contentId[0];
    const image = translation
      ? await this.primaryImage(transaction, translation.sections, locale)
      : null;
    return contentSummaryFrom(record, locale, this.siteOrigin(), image);
  }

  private async primaryImage(
    transaction: ReadTransaction,
    value: Prisma.JsonValue,
    locale: Locale,
  ): Promise<ReturnType<typeof projectMedia> | null> {
    const sections = arrayValue(value, 200);
    for (const sectionValue of sections) {
      const section = recordValue(sectionValue);
      if (section.kind === 'image') {
        const id = requiredString(section.media_id, 36);
        if (!isUuid(id)) unavailable();
        return (await this.mediaByIds(transaction, [id], locale))[0];
      }
    }
    return null;
  }

  private firstImageId(value: Prisma.JsonValue): string | null {
    for (const sectionValue of arrayValue(value, 200)) {
      const section = recordValue(sectionValue);
      if (section.kind !== 'image') continue;
      const id = requiredString(section.media_id, 36);
      if (!isUuid(id)) unavailable();
      return id;
    }
    return null;
  }

  async storeDto(
    transaction: ReadTransaction,
    row: { code: LocationCode; publicData: Prisma.JsonValue },
    locale: Locale,
  ): Promise<StoreDto> {
    const data = recordValue(row.publicData);
    assertKeys(data, [
      'bg',
      'en',
      'phone',
      'email',
      'emails',
      'maps_url',
      'media_ids',
    ]);
    const localized = recordValue(data[locale]);
    assertKeys(localized, [
      'name',
      'address',
      'opening_hours',
      'seasonal_note',
    ]);
    const mediaIds = arrayValue(data.media_ids, 20).map((value) => {
      const id = requiredString(value, 36);
      if (!isUuid(id)) unavailable();
      return id;
    });
    const mapsUrl =
      data.maps_url === null
        ? null
        : externalUrl(requiredString(data.maps_url, 2000), this.production);
    const emails = publicEmails(data.email, data.emails);
    return {
      code: row.code,
      locale,
      name: requiredString(localized.name, 255),
      address: requiredString(localized.address, 500),
      phone: validPhone(nullableString(data.phone, 40)),
      email: emails[0] ?? null,
      emails,
      opening_hours: nullableString(localized.opening_hours, 1000),
      seasonal_note: nullableString(localized.seasonal_note, 1000),
      maps_url: mapsUrl,
      media: await this.mediaByIds(transaction, mediaIds, locale),
    };
  }

  private async mediaByIds(
    transaction: ReadTransaction,
    ids: string[],
    locale: Locale,
  ): Promise<ReturnType<typeof projectMedia>[]> {
    if (ids.length === 0) return [];
    const assets = await transaction.mediaAsset.findMany({
      where: { id: { in: ids } },
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
    });
    const editorialAssets = await transaction.websiteMediaAsset.findMany({
      where: {
        id: { in: ids },
        reviewStatus: 'approved',
        releaseIdRelation: { is: { approved: true } },
      },
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
    });
    const byId = new Map(
      [...assets, ...editorialAssets].map((asset) => [asset.id, asset]),
    );
    const cdnOrigin = configurationUrl(
      this.config,
      'MEDIA_CDN_BASE_URL',
      this.production,
    );
    return ids.map((id) => {
      const asset = byId.get(id);
      if (!asset) unavailable('MEDIA_NOT_READY', 'errors.media_not_ready');
      return projectMedia(asset, locale, cdnOrigin, asset.releaseId);
    });
  }

  private linkTarget(value: Prisma.JsonValue | undefined) {
    const target = recordValue(value);
    if (target.kind === 'content' || target.kind === 'product') {
      assertKeys(target, ['kind', 'id']);
      const id = requiredString(target.id, 36);
      if (!isUuid(id)) unavailable();
      return { kind: target.kind, id } as const;
    }
    if (target.kind === 'store') {
      assertKeys(target, ['kind', 'code']);
      if (target.code !== 'sofia' && target.code !== 'nessebar') unavailable();
      return {
        kind: 'store' as const,
        code: target.code as LocationCode,
      };
    }
    if (target.kind === 'route') {
      assertKeys(target, ['kind', 'route_id']);
      return {
        kind: 'route' as const,
        routeId: requiredString(target.route_id, 80),
      };
    }
    if (target.kind === 'external') {
      assertKeys(target, ['kind', 'url']);
      return {
        kind: 'external' as const,
        url: externalUrl(requiredString(target.url, 2000), this.production),
      };
    }
    return unavailable();
  }

  private async resolveTarget(
    transaction: ReadTransaction,
    target:
      | { kind: 'content'; id: string }
      | { kind: 'product'; id: string }
      | { kind: 'store'; code: LocationCode }
      | { kind: 'route'; routeId: string }
      | { kind: 'external'; url: string },
    label: string,
    locale: Locale,
  ): Promise<ResolvedLink | null> {
    if (target.kind === 'external') return { label, url: target.url };
    if (target.kind === 'product') {
      const candidates = await this.products.catalogCandidates(
        transaction,
        [target.id],
        locale,
        null,
      );
      const product = candidates[0]?.summary;
      return product ? { label, url: product.url } : null;
    }
    if (target.kind === 'content') {
      const content = await this.contentSummary(transaction, target.id, locale);
      return content ? { label, url: content.url } : null;
    }
    if (target.kind === 'store') {
      const routeId = target.code === 'sofia' ? 'R065' : 'R066';
      const route = routeRegistry.find((item) => item.id === routeId);
      const store = await transaction.store.findUnique({
        where: { code: target.code },
        select: { code: true, publicData: true },
      });
      if (!route || !store) return null;
      await this.storeDto(transaction, store, locale);
      return { label, url: routeUrl(route[locale], this.siteOrigin()) };
    }
    const route = routeRegistry.find((item) => item.id === target.routeId);
    if (!route) unavailable('ROUTE_CONFLICT', 'errors.route_unavailable');
    if (
      ['R002', 'R003', 'R004', 'R005', 'R006', 'R007'].includes(target.routeId)
    ) {
      return { label, url: routeUrl(route[locale], this.siteOrigin()) };
    }
    const storeCode =
      target.routeId === 'R065'
        ? 'sofia'
        : target.routeId === 'R066'
          ? 'nessebar'
          : null;
    if (storeCode) {
      const store = await transaction.store.findUnique({
        where: { code: storeCode },
        select: { code: true, publicData: true },
      });
      if (!store) return null;
      await this.storeDto(transaction, store, locale);
      return { label, url: routeUrl(route[locale], this.siteOrigin()) };
    }
    const policyKind = (Object.keys(POLICY_ROUTES) as PolicyKind[])
      .find((kind) => POLICY_ROUTES[kind] === target.routeId);
    if (policyKind) {
      const policy = await transaction.policyVersion.findFirst({
        where: {
          kind: policyKind,
          locale,
          current: true,
          published: true,
        },
        select: { url: true },
      });
      return policy
        ? { label, url: this.policyUrl(policy.url, policyKind, locale) } : null;
    }
    const path = route[locale];
    const current = await transaction.publicRoute.findFirst({
      where: { path, locale, state: 'current' },
      select: {
        productId: true,
        contentId: true,
        productIdRelation: {
          select: { publicationStatus: true },
        },
        contentIdRelation: {
          select: {
            from_ContentTranslation_contentId: {
              where: { locale, published: true },
              select: { id: true },
            },
          },
        },
      },
    });
    if (!current) return null;
    if (current.productId) {
      const products = await this.products.catalogCandidates(
        transaction,
        [current.productId],
        locale,
        null,
      );
      return products[0] ? { label, url: products[0].summary.url } : null;
    }
    if (current.contentId) {
      const content = await this.contentSummary(
        transaction,
        current.contentId,
        locale,
      );
      return content ? { label, url: content.url } : null;
    }
    return null;
  }

  private async resolveStoredLink(
    transaction: ReadTransaction,
    link: {
      targetContentId: string | null;
      targetProductId: string | null;
      targetStoreCode: LocationCode | null;
      routeId: string | null;
      externalUrl: string | null;
      labelBg: string | null;
      labelEn: string | null;
    },
    locale: Locale,
  ): Promise<
    | { kind: 'content'; value: ContentSummary }
    | { kind: 'product'; value: ProductSummary }
    | { kind: 'store'; value: StoreDto }
    | { kind: 'link'; value: ResolvedLink }
    | null
  > {
    const targets = [
      link.targetContentId,
      link.targetProductId,
      link.targetStoreCode,
      link.routeId,
      link.externalUrl,
    ].filter((target) => target !== null);
    if (targets.length !== 1) unavailable();
    const label = locale === 'bg' ? link.labelBg : link.labelEn;
    if (link.targetContentId) {
      const value = await this.contentSummary(
        transaction,
        link.targetContentId,
        locale,
      );
      return value ? { kind: 'content', value } : null;
    }
    if (link.targetProductId) {
      const candidates = await this.products.catalogCandidates(
        transaction,
        [link.targetProductId],
        locale,
        null,
      );
      const value = candidates[0]?.summary;
      return value ? { kind: 'product', value } : null;
    }
    if (link.targetStoreCode) {
      const row = await transaction.store.findUnique({
        where: { code: link.targetStoreCode },
        select: { code: true, publicData: true },
      });
      return row
        ? {
            kind: 'store',
            value: await this.storeDto(transaction, row, locale),
          }
        : null;
    }
    if (!label) unavailable();
    const target = link.routeId
      ? { kind: 'route' as const, routeId: link.routeId }
      : {
          kind: 'external' as const,
          url: externalUrl(link.externalUrl ?? '', this.production),
        };
    const value = await this.resolveTarget(transaction, target, label, locale);
    return value ? { kind: 'link', value } : null;
  }

  private valueUrl(value: object): string {
    if ('url' in value && typeof value.url === 'string') return value.url;
    unavailable('ROUTE_CONFLICT', 'errors.route_unavailable');
  }

  private storeUrl(code: LocationCode, locale: Locale): string {
    const route = routeRegistry.find(
      (item) => item.id === (code === 'sofia' ? 'R065' : 'R066'),
    );
    if (!route) unavailable('ROUTE_CONFLICT', 'errors.route_unavailable');
    return routeUrl(route[locale], this.siteOrigin());
  }

  private policyUrl(
    value: string, kind: PolicyKind, locale: Locale, requireCurrentOrigin = false,
  ): string {
    const origin = this.siteOrigin();
    let url: URL;
    let path: string;
    try {
      url = new URL(value);
      path = decodeURI(url.pathname);
    } catch {
      unavailable('ROUTE_CONFLICT', 'errors.route_unavailable');
    }
    const route = routeRegistry.find((item) => item.id === POLICY_ROUTES[kind]);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      (requireCurrentOrigin && url.origin !== origin.origin) ||
      !route || path !== route[locale] ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      unavailable('ROUTE_CONFLICT', 'errors.route_unavailable');
    }
    return routeUrl(route[locale], origin);
  }

  private dateValue(value: Prisma.JsonValue | undefined): string {
    if (typeof value !== 'string') unavailable();
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/u.test(value);
    if (
      !dateOnly &&
      !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/u.test(value)
    ) {
      unavailable();
    }
    const date = new Date(value);
    if (
      Number.isNaN(date.valueOf()) ||
      (dateOnly && date.toISOString().slice(0, 10) !== value)
    ) {
      unavailable();
    }
    return dateOnly ? value : date.toISOString();
  }

  private alternateUrl(
    values: { locale: Locale; path: string }[],
    locale: Locale,
    origin: URL,
  ): string | null {
    const path = values.find((value) => value.locale === locale)?.path;
    return path ? routeUrl(path, origin) : null;
  }

  private alternatePolicyUrl(
    values: { locale: Locale; url: string }[],
    kind: PolicyKind,
    locale: Locale,
  ): string | null {
    const value = values.find((item) => item.locale === locale)?.url;
    return value ? this.policyUrl(value, kind, locale) : null;
  }

  private siteOrigin(): URL {
    return configurationUrl(this.config, 'PUBLIC_SITE_ORIGIN', this.production);
  }

  private get production(): boolean {
    return this.config.get<string>('NODE_ENV') === 'production';
  }

  private async read<T>(
    operation: (transaction: ReadTransaction) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      });
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError ||
        error instanceof Prisma.PrismaClientUnknownRequestError ||
        error instanceof Prisma.PrismaClientInitializationError
      ) {
        this.logger.warn('Public content dependency is unavailable');
        throw new ServiceUnavailableException({
          code: 'TEMPORARY_UNAVAILABLE',
          message_key: 'errors.temporary_unavailable',
        });
      }
      throw error;
    }
  }
}

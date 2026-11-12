import {
  BadRequestException, ConflictException, Injectable, Logger,
  NotFoundException, ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import type { Locale, LocationCode, PolicyKind } from '../../../generated/prisma/enums';
import { PrismaService } from '../../database/prisma.service';
import { normalizePublicPath } from '../../common/publication/public-route.service';
import { TransactionService } from '../../common/transactions/transaction.service';
import { OutboxService } from '../../common/outbox/outbox.service';
import { PublicContentService } from './public-content.service';
import type {
  WebsiteContentDto, WebsiteLinkDto, WebsitePolicyDto, WebsiteSettingsDto,
  WebsiteStoreDto, WebsiteWriteDto,
} from './website-admin.dto';

function jsonValue(value: unknown): value is Prisma.JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(jsonValue);
  return typeof value === 'object' &&
    Object.values(value).every(jsonValue);
}

function jsonObject(input: unknown): Prisma.InputJsonObject {
  const value: unknown = JSON.parse(JSON.stringify(input));
  if (!jsonValue(value) || value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Website action response must be a JSON object');
  }
  return value;
}

function invalid(code = 'WEBSITE_CONTENT_INVALID', details?: Record<string, string>): never {
  throw new BadRequestException({ code, message_key: 'errors.validation', ...(details ? { details } : {}) });
}

function conflict(code = 'VERSION_CONFLICT'): never {
  throw new ConflictException({ code, message_key: 'errors.version_conflict' });
}

function isJsonObject(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const CONTENT_SELECT = {
  id: true, key: true, type: true, parentId: true, authorId: true,
  specialData: true, updatedAt: true,
  from_ContentTranslation_contentId: {
    orderBy: { locale: 'asc' },
    select: {
      locale: true, published: true, title: true, intro: true, sections: true,
      seoTitle: true, seoDescription: true,
    },
  },
  from_PublicRoute_contentId: {
    where: { state: 'current' },
    select: { locale: true, path: true },
  },
  from_ContentLink_ownerContentId: {
    orderBy: [{ slot: 'asc' }, { sortOrder: 'asc' }],
    select: {
      slot: true, sortOrder: true, targetContentId: true, targetProductId: true,
      targetStoreCode: true, routeId: true, externalUrl: true, labelBg: true, labelEn: true,
    },
  },
} satisfies Prisma.ContentRecordSelect;

@Injectable()
export class WebsiteAdminService {
  private readonly logger = new Logger(WebsiteAdminService.name);

  constructor(
    private readonly db: PrismaService,
    private readonly transactions: TransactionService,
    private readonly publicContent: PublicContentService,
    private readonly outbox: OutboxService,
  ) {}

  content(key: string) {
    return this.database(() => this.db.$transaction(tx => this.readContent(tx, key)));
  }

  store(code: LocationCode) {
    return this.database(() => this.db.$transaction(tx => this.readStore(tx, code)));
  }

  policy(kind: PolicyKind, version: string) {
    return this.database(() => this.db.$transaction(tx => this.readPolicy(tx, kind, version)));
  }

  settings() {
    return this.database(() => this.db.$transaction(tx => this.readSettings(tx)));
  }

  publicationSelectionStatus() {
    return this.database(() =>
      this.db.$transaction(async tx => {
        const rows = await tx.contentRecord.findMany({
          where: {
            type: { in: ['article', 'case_study', 'press'] },
          },
          select: {
            id: true,
            specialData: true,
            from_ContentTranslation_contentId: {
              select: { locale: true, published: true, title: true },
            },
            from_PublicRoute_contentId: {
              where: { state: 'current' },
              select: { locale: true },
            },
          },
        });
        const selected = rows.flatMap(row => {
          if (!isJsonObject(row.specialData)) return [];
          const special = row.specialData;
          if (special.show_on_home !== true) return [];
          const translations = new Map(
            row.from_ContentTranslation_contentId.map(item => [item.locale, item]),
          );
          const routes = new Set(
            row.from_PublicRoute_contentId.map(item => item.locale),
          );
          const available = {
            bg: translations.get('bg')?.published === true && routes.has('bg'),
            en: translations.get('en')?.published === true && routes.has('en'),
          };
          return [{
            id: row.id,
            home_order:
              typeof special.home_order === 'number' ? special.home_order : null,
            title_bg: translations.get('bg')?.title ?? null,
            title_en: translations.get('en')?.title ?? null,
            available,
            incomplete_locales: (['bg', 'en'] as const).filter(
              locale => !available[locale],
            ),
          }];
        }).sort((left, right) =>
          (left.home_order ?? Number.MAX_SAFE_INTEGER) -
            (right.home_order ?? Number.MAX_SAFE_INTEGER) ||
          left.id.localeCompare(right.id),
        );
        const positions = new Set(selected.map(item => item.home_order));
        const complete =
          selected.length === 3 &&
          positions.size === 3 &&
          [1, 2, 3].every(position => positions.has(position)) &&
          selected.every(item => item.incomplete_locales.length === 0);
        return {
          expected_count: 3,
          configured_count: selected.length,
          complete,
          incomplete: !complete,
          items: selected,
        };
      }),
    );
  }

  saveContent(actorId: string, key: string, input: WebsiteContentDto) {
    return this.write(actorId, `content:${key}`, input, async tx => {
      this.locales(input.translations);
      const existing = await tx.contentRecord.findUnique({ where: { key } });
      this.expectedTimestamp(existing?.updatedAt, input.expected_updated_at);
      if (existing && existing.type !== input.type) conflict('CONTENT_TYPE_IMMUTABLE');
      if (input.type === 'home') {
        const other = await tx.contentRecord.findFirst({
          where: { type: 'home', key: { not: key } }, select: { id: true },
        });
        if (other) conflict('HOME_ALREADY_EXISTS');
        for (const translation of input.translations) {
          if (translation.path !== (translation.locale === 'bg' ? '/' : '/en/')) {
            invalid('HOME_ROUTE_INVALID');
          }
        }
      }
      if (input.author_id) {
        const author = await tx.contentRecord.findUnique({
          where: { id: input.author_id }, select: { type: true },
        });
        if (author?.type !== 'author') invalid('CONTENT_AUTHOR_INVALID');
      }
      const ancestors = new Set(existing ? [existing.id] : []);
      let parentId = input.parent_id;
      while (parentId) {
        if (ancestors.has(parentId)) invalid('CONTENT_PARENT_CYCLE');
        ancestors.add(parentId);
        const parent = await tx.contentRecord.findUnique({
          where: { id: parentId }, select: { parentId: true },
        });
        if (!parent) invalid('CONTENT_PARENT_UNAVAILABLE');
        parentId = parent.parentId;
      }
      const positions = input.links.map(link => `${link.slot}:${link.sort_order}`);
      if (new Set(positions).size !== positions.length) invalid('DUPLICATE_LINK_POSITION');
      await this.validateEditorialLinks(
        tx,
        input.type,
        input.special_data,
        input.links,
        input.translations,
      );
      if (input.type === 'home') {
        const keys = input.special_data.section_keys;
        if (!Array.isArray(keys) || input.links.some(link => !keys.includes(link.slot))) {
          invalid('HOME_SECTION_INVALID');
        }
      }
      const data = {
        type: input.type, parentId: input.parent_id, authorId: input.author_id,
        specialData: input.special_data,
      };
      const record = await tx.contentRecord.upsert({
        where: { key }, create: { key, ...data }, update: data,
      });
      const now = new Date();
      for (const translation of input.translations) {
        const path = normalizePublicPath(translation.path, translation.locale);
        if (
          this.isPublicationType(input.type) &&
          !(translation.locale === 'bg'
            ? path.startsWith('/светът-на-ssg/')
            : path.startsWith('/en/world-of-ssg/'))
        ) {
          invalid('PUBLICATION_ROUTE_INVALID');
        }
        const owner = await tx.publicRoute.findUnique({ where: { path } });
        const current = await tx.publicRoute.findFirst({
          where: { contentId: record.id, locale: translation.locale, state: 'current' },
        });
        if (current && current.path !== path) conflict('ROUTE_CHANGE_REQUIRES_MIGRATION');
        if (owner && (owner.contentId !== record.id || owner.locale !== translation.locale ||
            owner.state !== 'current')) conflict('ROUTE_CONFLICT');
        if (!owner) await tx.publicRoute.create({
          data: { path, locale: translation.locale, contentId: record.id, state: 'current', changedAt: now },
        });
        const previous = await tx.contentTranslation.findUnique({
          where: { contentId_locale: { contentId: record.id, locale: translation.locale } },
        });
        const translated = {
          published: translation.published, title: translation.title, intro: translation.intro,
          sections: translation.sections, seoTitle: translation.seo_title,
          seoDescription: translation.seo_description,
          publishedAt: previous?.publishedAt ?? (translation.published ? now : null),
          publicModifiedAt: now,
        };
        await tx.contentTranslation.upsert({
          where: { contentId_locale: { contentId: record.id, locale: translation.locale } },
          create: { contentId: record.id, locale: translation.locale, ...translated },
          update: translated,
        });
      }
      await this.validate(() => this.publicContent.validateContent(tx, input));
      if (this.isPublicationType(input.type)) {
        await this.publicContent.validatePublicationSelections(tx);
      }
      for (const [index, link] of input.links.entries()) {
        for (const translation of input.translations) {
          await this.validate(() => this.publicContent.validateLink(
            tx, link.target, translation.locale === 'bg' ? link.label_bg : link.label_en,
            translation.locale,
          ), `links[${index}]`, translation.locale,
          typeof link.target.route_id === 'string' ? link.target.route_id : undefined);
        }
      }
      await tx.contentLink.deleteMany({ where: { ownerContentId: record.id } });
      for (const link of input.links) {
        await tx.contentLink.create({ data: {
          ownerContentId: record.id, slot: link.slot, sortOrder: link.sort_order,
          ...this.linkTarget(link.target), labelBg: link.label_bg, labelEn: link.label_en,
        } });
      }
      if (input.type === 'home') {
        for (const translation of input.translations.filter(item => item.published)) {
          await this.validate(() => this.publicContent.homeInTransaction(tx, translation.locale),
            'home_projection', translation.locale);
        }
      }
      return this.readContent(tx, key);
    });
  }

  saveStore(actorId: string, code: LocationCode, input: WebsiteStoreDto) {
    return this.write(actorId, `store:${code}`, input, async tx => {
      const existing = await tx.store.findUnique({ where: { code } });
      this.expectedTimestamp(existing?.updatedAt, input.expected_updated_at);
      const store = await tx.store.upsert({
        where: { code }, create: { code, publicData: input.public_data },
        update: { publicData: input.public_data },
      });
      for (const locale of ['bg', 'en'] as const) {
        await this.validate(() => this.publicContent.storeDto(tx, store, locale));
      }
      return this.readStore(tx, code);
    });
  }

  savePolicy(actorId: string, kind: PolicyKind, version: string, input: WebsitePolicyDto) {
    return this.write(actorId, `policy:${kind}:${version}`, input, async tx => {
      this.locales(input.translations);
      const current = await tx.policyVersion.findMany({
        where: { kind, current: true }, select: { versionLabel: true },
      });
      if ((current.length === 0 && input.expected_current_version !== null) ||
          current.some(row => row.versionLabel !== input.expected_current_version)) {
        conflict();
      }
      const now = new Date();
      for (const translation of input.translations) {
        await this.validate(async () => this.publicContent.validatePolicy(translation, kind));
        const url = new URL(translation.url);
        let path: string;
        try {
          path = decodeURI(url.pathname);
        } catch (error) {
          if (error instanceof URIError) invalid('POLICY_URL_INVALID');
          throw error;
        }
        normalizePublicPath(path, translation.locale);
        if (url.search) invalid('POLICY_URL_INVALID');
        const existing = await tx.policyVersion.findUnique({
          where: { kind_versionLabel_locale: { kind, versionLabel: version, locale: translation.locale } },
        });
        if (existing && (existing.title !== translation.title ||
            existing.body !== translation.text || existing.url !== translation.url)) {
          conflict('POLICY_VERSION_IMMUTABLE');
        }
        await tx.policyVersion.updateMany({
          where: { kind, locale: translation.locale, current: true, versionLabel: { not: version } },
          data: { current: false },
        });
        await tx.policyVersion.upsert({
          where: { kind_versionLabel_locale: { kind, versionLabel: version, locale: translation.locale } },
          create: {
            kind, versionLabel: version, locale: translation.locale,
            title: translation.title, body: translation.text, url: translation.url,
            published: true, current: true, verifiedPublishedAt: now,
          },
          update: { published: true, current: true, verifiedPublishedAt: existing?.verifiedPublishedAt ?? now },
        });
      }
      if (kind === 'cookies') {
        const settings = await tx.shopSettings.findUnique({ where: { id: 1 } });
        const config = settings?.cookieConfig;
        if (settings && config && typeof config === 'object' && !Array.isArray(config) &&
            typeof config.policy_version === 'string' && config.policy_version !== version) {
          await tx.shopSettings.update({
            where: { id: 1 },
            data: { cookieConfig: { ...config, policy_version: version }, version: { increment: 1 } },
          });
          for (const locale of ['bg', 'en'] as const) {
            await this.validate(() => this.publicContent.cookieConfigInTransaction(tx, locale));
          }
        }
      }
      return this.readPolicy(tx, kind, version);
    });
  }

  saveSettings(actorId: string, input: WebsiteSettingsDto) {
    return this.write(actorId, 'settings', input, async tx => {
      const settings = await this.transactions.lockSettings(tx);
      if (!settings) throw new NotFoundException();
      if (settings.version !== input.expected_version) conflict();
      if (input.site_contacts === undefined && input.cookie_config === undefined &&
          input.coordinator_email === undefined) invalid('WEBSITE_SETTINGS_EMPTY');
      await tx.shopSettings.update({
        where: { id: 1 }, data: {
          ...(input.site_contacts === undefined ? {} : { siteContacts: input.site_contacts }),
          ...(input.cookie_config === undefined ? {} : { cookieConfig: input.cookie_config }),
          ...(input.coordinator_email === undefined ? {} : { coordinatorEmail: input.coordinator_email }),
          version: { increment: 1 },
        },
      });
      for (const locale of ['bg', 'en'] as const) {
        if (input.site_contacts !== undefined) {
          await this.validate(() => this.publicContent.siteContactsInTransaction(tx, locale));
        }
        if (input.cookie_config !== undefined) {
          await this.validate(() => this.publicContent.cookieConfigInTransaction(tx, locale));
        }
      }
      return this.readSettings(tx);
    });
  }

  private async readContent(tx: Prisma.TransactionClient, key: string) {
    const row = await tx.contentRecord.findUnique({ where: { key }, select: CONTENT_SELECT });
    if (!row) throw new NotFoundException();
    return {
      id: row.id, key: row.key, type: row.type, updated_at: row.updatedAt.toISOString(),
      parent_id: row.parentId, author_id: row.authorId, special_data: row.specialData,
      translations: row.from_ContentTranslation_contentId.map(item => ({
        locale: item.locale, path: row.from_PublicRoute_contentId.find(route => route.locale === item.locale)?.path ?? null,
        published: item.published, title: item.title, intro: item.intro,
        seo_title: item.seoTitle, seo_description: item.seoDescription, sections: item.sections,
      })),
      links: row.from_ContentLink_ownerContentId.map(link => ({
        slot: link.slot, sort_order: link.sortOrder,
        target: link.targetContentId ? { kind: 'content', id: link.targetContentId }
          : link.targetProductId ? { kind: 'product', id: link.targetProductId }
          : link.targetStoreCode ? { kind: 'store', code: link.targetStoreCode }
          : link.routeId ? { kind: 'route', route_id: link.routeId }
          : { kind: 'external', url: link.externalUrl },
        label_bg: link.labelBg, label_en: link.labelEn,
      })),
    };
  }

  private async readStore(tx: Prisma.TransactionClient, code: LocationCode) {
    const row = await tx.store.findUnique({ where: { code }, select: { code: true, publicData: true, updatedAt: true } });
    if (!row) throw new NotFoundException();
    return { code: row.code, public_data: row.publicData, updated_at: row.updatedAt.toISOString() };
  }

  private async readPolicy(tx: Prisma.TransactionClient, kind: PolicyKind, version: string) {
    const rows = await tx.policyVersion.findMany({
      where: { kind, versionLabel: version }, orderBy: { locale: 'asc' },
      select: { id: true, locale: true, title: true, body: true, url: true, published: true, current: true },
    });
    if (!rows.length) throw new NotFoundException();
    return { kind, version, translations: rows.map(row => ({
      id: row.id, locale: row.locale, title: row.title, text: row.body, url: row.url,
      published: row.published, current: row.current,
    })) };
  }

  private async readSettings(tx: Prisma.TransactionClient) {
    const row = await tx.shopSettings.findUnique({
      where: { id: 1 },
      select: { version: true, siteContacts: true, cookieConfig: true, coordinatorEmail: true },
    });
    if (!row) throw new NotFoundException();
    return { version: row.version, site_contacts: row.siteContacts, cookie_config: row.cookieConfig, coordinator_email: row.coordinatorEmail };
  }

  private locales(translations: { locale: Locale }[]): void {
    if (translations.length !== 2 || new Set(translations.map(item => item.locale)).size !== 2) {
      invalid('BOTH_LOCALES_REQUIRED');
    }
  }

  private expectedTimestamp(actual: Date | undefined, expected: string | null): void {
    if ((actual === undefined && expected !== null) ||
        (actual !== undefined && (expected === null || actual.getTime() !== new Date(expected).getTime()))) {
      conflict();
    }
  }

  private linkTarget(target: Prisma.JsonObject): Pick<
    Prisma.ContentLinkUncheckedCreateInput,
    'targetContentId' | 'targetProductId' | 'targetStoreCode' | 'routeId' | 'externalUrl'
  > {
    if (target.kind === 'content' && typeof target.id === 'string') return { targetContentId: target.id };
    if (target.kind === 'product' && typeof target.id === 'string') return { targetProductId: target.id };
    if (target.kind === 'store' && (target.code === 'sofia' || target.code === 'nessebar')) return { targetStoreCode: target.code };
    if (target.kind === 'route' && typeof target.route_id === 'string') return { routeId: target.route_id };
    if (target.kind === 'external' && typeof target.url === 'string') return { externalUrl: target.url };
    return invalid('LINK_TARGET_INVALID');
  }

  private isPublicationType(type: WebsiteContentDto['type']): boolean {
    return type === 'article' || type === 'case_study' || type === 'press';
  }

  private async validateEditorialLinks(
    tx: Prisma.TransactionClient,
    type: WebsiteContentDto['type'],
    specialData: Prisma.JsonObject,
    links: WebsiteLinkDto[],
    translations: WebsiteContentDto['translations'],
  ): Promise<void> {
    if (!this.isPublicationType(type)) return;
    const group = type === 'press' ? 'media' : 'stories';
    if (specialData.group !== group) invalid('PUBLICATION_GROUP_INVALID');
    if (links.some(link => link.target.kind === 'external')) {
      invalid('PUBLICATION_EXTERNAL_LINKS_NOT_ALLOWED');
    }

    const products = links.filter(link => link.slot === 'related_products');
    if (
      products.length > 3 ||
      products.some(link => link.target.kind !== 'product') ||
      new Set(products.map(link => link.target.id)).size !== products.length
    ) {
      invalid('RELATED_PRODUCTS_INVALID');
    }
    const related = links.filter(link => link.slot === 'related_articles');
    if (
      related.length > 2 ||
      related.some(link => link.target.kind !== 'content') ||
      new Set(related.map(link => link.target.id)).size !== related.length
    ) {
      invalid('RELATED_ARTICLES_INVALID');
    }
    const about = links.filter(link => link.slot === 'about');
    if (
      about.length > 1 ||
      about.some(
        link =>
          link.target.kind !== 'route' ||
          link.target.route_id !== 'R062' ||
          !link.label_bg?.trim() ||
          !link.label_en?.trim(),
      )
    ) {
      invalid('PUBLICATION_ABOUT_LINK_INVALID');
    }
    const hasSources =
      Array.isArray(specialData.sources) && specialData.sources.length > 0;
    for (const translation of translations) {
      const sourceMarkers = translation.sections.filter(
        section => section.kind === 'sources',
      ).length;
      const aboutMarkers = translation.sections.filter(
        section => section.kind === 'about',
      ).length;
      if (sourceMarkers !== (hasSources ? 1 : 0)) {
        invalid('PUBLICATION_SOURCES_LAYOUT_INVALID');
      }
      if (aboutMarkers !== (about.length ? 1 : 0)) {
        invalid('PUBLICATION_ABOUT_LAYOUT_INVALID');
      }
    }

    const relatedIds = related.flatMap(link =>
      link.target.kind === 'content' && typeof link.target.id === 'string'
        ? [link.target.id]
        : [],
    );
    if (relatedIds.length === 0) return;
    const targets = await tx.contentRecord.findMany({
      where: { id: { in: relatedIds } },
      select: { id: true, type: true, specialData: true },
    });
    const byId = new Map(targets.map(target => [target.id, target]));
    for (const id of relatedIds) {
      const target = byId.get(id);
      if (!target || !this.isPublicationType(target.type)) {
        invalid('RELATED_ARTICLE_TARGET_INVALID');
      }
      const targetGroup = target.type === 'press' ? 'media' : 'stories';
      if (
        targetGroup !== group ||
        !isJsonObject(target.specialData) ||
        target.specialData.group !== group
      ) {
        invalid('RELATED_ARTICLE_GROUP_MISMATCH');
      }
    }
  }

  private async validate(
    work: () => Promise<unknown>, field = 'content', locale?: Locale, routeId?: string,
  ): Promise<void> {
    try {
      await work();
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        const response = error.getResponse();
        if (typeof response === 'object' && 'code' in response &&
            ['CONFIGURATION_UNAVAILABLE', 'MEDIA_NOT_READY', 'ROUTE_CONFLICT', 'LINK_TARGET_UNAVAILABLE'].includes(String(response.code))) {
          const source = 'details' in response ? response.details : null;
          const sourceField = source && typeof source === 'object' &&
            'field' in source && typeof source.field === 'string' ? source.field : field;
          this.logger.warn(`Website write rejected: ${String(response.code)} at ${sourceField}`);
          invalid(response.code === 'LINK_TARGET_UNAVAILABLE' ? response.code : 'WEBSITE_CONTENT_INVALID', {
            field: sourceField,
            cause_code: String(response.code),
            ...(locale ? { locale } : {}),
            ...(routeId ? { route_id: routeId } : {}),
          });
        }
      }
      throw error;
    }
  }

  private write(
    actorId: string, resource: string, input: WebsiteWriteDto,
    work: (tx: Prisma.TransactionClient) => Promise<unknown>,
  ) {
    return this.database(async () => {
      this.publicContent.assertWebsiteConfiguration();
      const outcome = await this.transactions.serializable(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('website-admin'))`;
        return this.transactions.executeIdempotentAction(tx, {
          scopeKey: `website:${actorId}:${resource}`, requestId: input.request_id,
          payload: jsonObject(input),
        }, async () => {
          const response = jsonObject(await work(tx));
          await tx.auditEvent.create({ data: {
            actorId, action: 'website_upsert', subjectType: 'Website', subjectId: resource,
            eventKey: `website:${actorId}:${resource}:${input.request_id}`,
            after: { resource },
          } });
          await this.outbox.enqueue(tx, {
            dedupeKey: `website:${actorId}:${resource}:${input.request_id}`,
            kind: 'cache_invalidate', payload: { kind: 'cache_invalidate', resource },
          });
          return { status_code: 200, body: response };
        });
      });
      if (!outcome.replayed) this.logger.log(`Website saved: ${resource}`);
      return { ...outcome.body, replayed: outcome.replayed };
    });
  }

  private async database<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') conflict('WEBSITE_RESOURCE_CONFLICT');
        if (error.code === 'P2003' || error.code === 'P2004') invalid('WEBSITE_REFERENCE_INVALID');
        if (error.code === 'P2025') throw new NotFoundException();
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError ||
          error instanceof Prisma.PrismaClientUnknownRequestError ||
          error instanceof Prisma.PrismaClientInitializationError) {
        this.logger.warn('Website database operation failed');
        throw new ServiceUnavailableException({ code: 'TEMPORARY_UNAVAILABLE', message_key: 'errors.temporary_unavailable' });
      }
      throw error;
    }
  }
}

import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { isEmail, isUUID } from 'class-validator';
import { Prisma } from '../../../generated/prisma/client';
import type { Locale } from '../../../generated/prisma/enums';
import { OutboxService } from '../../common/outbox/outbox.service';
import { hashIdempotencyPayload, TransactionService } from '../../common/transactions/transaction.service';
import { PrismaService } from '../../database/prisma.service';
import type { AdminEnquiryQueryDto, EnquiryContextDto, EnquirySubmitDto } from './enquiry.dto';
import { routeRegistry } from '../../common/publication/route-registry';
import { enquiryTopics } from './enquiry-topics';

interface EnquiryReceipt {
  state: 'received';
  reference: string;
}

type EntitySnapshot = {
  type: 'product' | 'content' | 'store';
  id: string;
  title: string;
  url: string;
  product_type?: 'jewellery' | 'loose_stone';
  model_codes?: string[];
};

function invalidField(field: string, reason: string): never {
  throw new BadRequestException({
    code: 'VALIDATION_ERROR', message_key: 'errors.validation',
    details: { [field]: reason },
  });
}

@Injectable()
export class EnquiryService {
  private readonly logger = new Logger(EnquiryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionService,
    private readonly outbox: OutboxService,
  ) {}

  async submit(
    guestId: string,
    clientIp: string,
    input: EnquirySubmitDto,
  ): Promise<{ receipt: EnquiryReceipt; replayed: boolean }> {
    const payloadHash = hashIdempotencyPayload({
      request_type: input.request_type, name: input.name, email: input.email,
      phone: input.phone ?? null, topic: input.topic, message: input.message ?? '',
      language: input.language, origin_route_id: input.origin_route_id,
      context: input.context ? { type: input.context.type, id: input.context.id } : null,
      ...(input.opening_action === undefined ? {} : { opening_action: input.opening_action }),
      ...(input.origin_entity === undefined ? {} : {
        origin_entity: { type: input.origin_entity.type, id: input.origin_entity.id },
      }),
    });
    const ipScope = `enquiry-rate:${createHash('sha256').update(clientIp).digest('hex')}`;
    try {
      return await this.transactions.serializable(async (transaction) => {
        await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ipScope}, 0))::text`;
        const sessions = await transaction.$queryRaw<{ id: string }[]>`
          SELECT id FROM "GuestSession"
          WHERE id = ${guestId}::uuid AND "revokedAt" IS NULL AND "expiresAt" > now()
          FOR UPDATE
        `;
        if (sessions.length === 0) throw new UnauthorizedException();
        const prior = await transaction.inquiry.findUnique({
          where: { guestId_requestId: { guestId, requestId: input.request_id } },
          select: { id: true, payloadHash: true },
        });
        if (prior) {
          if (prior.payloadHash !== payloadHash) {
            throw new ConflictException({
              code: 'REQUEST_PAYLOAD_MISMATCH',
              message_key: 'errors.request_payload_mismatch',
            });
          }
          return { receipt: { state: 'received', reference: prior.id }, replayed: true };
        }
        const context = await this.resolveContext(transaction, input);
        const now = new Date();
        const minute = new Date(now.getTime() - 60000);
        const hour = new Date(now.getTime() - 3600000);
        const [guestRecent, guestHourly, ipRecent, ipHourly] = await Promise.all([
          transaction.inquiry.count({ where: { guestId, createdAt: { gte: minute } } }),
          transaction.inquiry.count({ where: { guestId, createdAt: { gte: hour } } }),
          transaction.actionRequest.count({ where: { scopeKey: ipScope, createdAt: { gte: minute } } }),
          transaction.actionRequest.count({ where: { scopeKey: ipScope, createdAt: { gte: hour } } }),
        ]);
        if (guestRecent >= 5 || guestHourly >= 20 || ipRecent >= 20 || ipHourly >= 100) {
          throw new HttpException({
            code: 'TEMPORARY_UNAVAILABLE', message_key: 'errors.temporary_unavailable',
          }, HttpStatus.TOO_MANY_REQUESTS);
        }
        const settings = await transaction.shopSettings.findUnique({
          where: { id: 1 }, select: { coordinatorEmail: true },
        });
        if (!settings?.coordinatorEmail || !isEmail(settings.coordinatorEmail)) {
          this.logger.warn('Enquiry notification recipient is not configured');
          throw new ServiceUnavailableException({
            code: 'CONFIGURATION_UNAVAILABLE', message_key: 'errors.configuration_unavailable',
          });
        }
        const inquiry = await transaction.inquiry.create({
          data: {
            guestId, requestId: input.request_id, payloadHash,
            type: input.request_type, name: input.name, email: input.email,
            phone: input.phone, topic: input.topic, message: input.message ?? '',
            locale: input.language, originRouteId: input.origin_route_id,
            openingAction: input.opening_action ?? null,
            ...context,
          },
          select: { id: true },
        });
        await this.outbox.enqueue(transaction, {
          dedupeKey: `inquiry_received:${inquiry.id}`,
          kind: 'inquiry_received', inquiryId: inquiry.id,
          recipientSnapshot: settings.coordinatorEmail, locale: input.language,
          templateVersion: 'inquiry-v1',
          payload: { kind: 'inquiry_received', inquiry_id: inquiry.id },
        });
        await transaction.auditEvent.create({
          data: {
            guestId, action: 'inquiry_received', subjectType: 'Inquiry',
            subjectId: inquiry.id, eventKey: `inquiry_received:${inquiry.id}`,
          },
        });
        await transaction.actionRequest.deleteMany({
          where: { scopeKey: ipScope, createdAt: { lt: hour } },
        });
        await transaction.actionRequest.create({
          data: { scopeKey: ipScope, requestId: inquiry.id, payloadHash, state: 'committed' },
        });
        return { receipt: { state: 'received', reference: inquiry.id }, replayed: false };
      });
    } catch (error) {
      this.storageError(error);
    }
  }

  async status(guestId: string, requestId: string): Promise<EnquiryReceipt | { state: 'unknown_result' }> {
    try {
      const inquiry = await this.prisma.inquiry.findUnique({
        where: { guestId_requestId: { guestId, requestId } }, select: { id: true },
      });
      return inquiry ? { state: 'received', reference: inquiry.id } : { state: 'unknown_result' };
    } catch (error) {
      this.storageError(error);
    }
  }

  async topics(language: Locale) {
    try {
      return await this.prisma.$transaction(async transaction => ({
        items: await Promise.all(enquiryTopics.map(async topic => {
          const service = topic.routeId
            ? await this.purposeService(transaction, topic.routeId, language) : null;
          return {
            topic: topic.topic, label: topic[language], request_type: 'general',
            context: service ? { type: 'content', id: service.id } : null,
            available: topic.routeId === null || service !== null,
          };
        })),
      }));
    } catch (error) {
      this.storageError(error);
    }
  }

  async adminList(query: AdminEnquiryQueryDto) {
    try {
      return await this.prisma.$transaction(async transaction => {
        const [total, items] = await Promise.all([
          transaction.inquiry.count(),
          transaction.inquiry.findMany({
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
            skip: (query.page - 1) * query.page_size, take: query.page_size,
            select: {
              id: true, type: true, name: true, topic: true, locale: true,
              originRouteId: true, openingAction: true, createdAt: true,
            },
          }),
        ]);
        return {
          items: items.map(item => ({
            id: item.id, request_type: item.type, name: item.name, topic: item.topic,
            language: item.locale, origin_route_id: item.originRouteId,
            opening_action: item.openingAction, created_at: item.createdAt.toISOString(),
          })),
          total, page: query.page, page_size: query.page_size,
        };
      });
    } catch (error) {
      this.storageError(error);
    }
  }

  async adminDetail(id: string) {
    try {
      const item = await this.prisma.inquiry.findUnique({
        where: { id },
        select: {
          id: true, type: true, name: true, email: true, phone: true, topic: true,
          message: true, locale: true, originRouteId: true, openingAction: true,
          originPath: true, originEntity: true, contextSnapshot: true,
          productId: true, contentId: true, storeCode: true, createdAt: true,
          from_OutboxMessage_inquiryId: {
            select: { status: true, attempts: true, sentAt: true },
          },
        },
      });
      if (!item) throw new NotFoundException();
      return {
        id: item.id, request_type: item.type, name: item.name, email: item.email,
        phone: item.phone, topic: item.topic, message: item.message,
        language: item.locale, origin_route_id: item.originRouteId,
        opening_action: item.openingAction, origin_path: item.originPath,
        origin_entity: item.originEntity, context: item.contextSnapshot,
        product_id: item.productId, content_id: item.contentId, store_code: item.storeCode,
        created_at: item.createdAt.toISOString(),
        notifications: item.from_OutboxMessage_inquiryId.map(notification => ({
          status: notification.status, attempts: notification.attempts,
          sent_at: notification.sentAt?.toISOString() ?? null,
        })),
      };
    } catch (error) {
      this.storageError(error);
    }
  }

  private async resolveContext(transaction: Prisma.TransactionClient, input: EnquirySubmitDto) {
    const origin = routeRegistry.find((route) => route.id === input.origin_route_id);
    if (!origin) invalidField('origin_route_id', 'unknown_route');
    const originPath = origin[input.language];
    let originEntity = input.origin_entity
      ? await this.resolveEntity(transaction, input.origin_entity, input.language, 'origin_entity')
      : null;
    if (!originEntity && !originPath.includes('{')) {
      const route = await transaction.publicRoute.findUnique({
        where: { path: originPath },
        select: { contentId: true, productId: true, state: true },
      });
      if (route?.state === 'current' && (route.contentId || route.productId)) {
        originEntity = await this.resolveEntity(transaction, route.contentId
          ? { type: 'content', id: route.contentId }
          : { type: 'product', id: route.productId ?? '' }, input.language, 'origin_entity');
      }
    }
    if (originEntity && !this.matchesRoute(originPath, originEntity.url)) {
      invalidField('origin_entity', 'route_mismatch');
    }
    if (input.opening_action && originPath.includes('{') && !originEntity) {
      invalidField('origin_entity', 'required');
    }
    const selected = input.context
      ? await this.resolveEntity(transaction, input.context, input.language, 'context') : null;
    if (input.request_type === 'similar_jewellery_creation' &&
        (selected?.type !== 'product' || selected.product_type !== 'jewellery')) {
      invalidField('context', 'jewellery_required');
    }
    const topic = enquiryTopics.find(option => option.topic === input.topic);
    const purpose = topic?.routeId
      ? await this.purposeService(transaction, topic.routeId, input.language) : null;
    if (topic?.routeId && !purpose) invalidField('topic', 'service_unavailable');
    if (purpose && selected?.type === 'content' && selected.id !== purpose.id) {
      invalidField('context', 'topic_mismatch');
    }
    if (purpose && selected?.type === 'store') invalidField('context', 'topic_mismatch');
    const product = selected?.type === 'product' ? selected : null;
    const content = purpose ?? (selected?.type === 'content' ? selected : null);
    const store = selected?.type === 'store' ? selected : null;
    return {
      originPath: originEntity?.url ?? (originPath.includes('{') ? null : originPath),
      originEntity: originEntity ?? Prisma.DbNull,
      productId: product?.id ?? null,
      contentId: content?.id ?? null,
      storeCode: store ? this.storeCode(store.id) : null,
      contextSnapshot: { product, content, store },
    };
  }

  private async purposeService(
    transaction: Prisma.TransactionClient, routeId: string, language: Locale,
  ): Promise<EntitySnapshot | null> {
    const registered = routeRegistry.find(route => route.id === routeId);
    if (!registered) throw new Error('Enquiry service route is not registered');
    const route = await transaction.publicRoute.findFirst({
      where: {
        path: registered[language], locale: language, state: 'current',
        contentIdRelation: { is: {
          type: 'service',
          from_ContentTranslation_contentId: { some: { locale: language, published: true } },
        } },
      },
      select: { contentId: true },
    });
    return route?.contentId ? this.resolveEntity(
      transaction, { type: 'content', id: route.contentId }, language, 'topic',
    ) : null;
  }

  private async resolveEntity(
    transaction: Prisma.TransactionClient, context: EnquiryContextDto,
    language: Locale, field: string,
  ): Promise<EntitySnapshot> {
    if (context.type === 'product') {
      if (!isUUID(context.id)) invalidField(`${field}.id`, 'isUuid');
      const product = await transaction.product.findFirst({
        where: {
          id: context.id, publicationStatus: 'published',
          currentRevisionIdRelation: { is: { state: 'published' } },
        },
        select: {
          id: true, ssgId: true, productType: true,
          currentRevisionIdRelation: {
            select: { from_ProductTranslation_revisionId: {
              where: { locale: language }, select: { name: true },
            } },
          },
          from_PublicRoute_productId: {
            where: { locale: language, state: 'current' }, select: { path: true },
          },
        },
      });
      const title = product?.currentRevisionIdRelation?.from_ProductTranslation_revisionId[0]?.name;
      const path = product?.from_PublicRoute_productId[0]?.path;
      if (!product || !title || !path) invalidField(field, 'unavailable');
      return {
        type: 'product', id: product.id, title, url: path,
        model_codes: [product.ssgId], product_type: product.productType,
      };
    }
    if (context.type === 'content') {
      if (!isUUID(context.id)) invalidField(`${field}.id`, 'isUuid');
      const content = await transaction.contentRecord.findFirst({
        where: { id: context.id },
        select: {
          id: true,
          from_ContentTranslation_contentId: {
            where: { locale: language, published: true }, select: { title: true },
          },
          from_PublicRoute_contentId: {
            where: { locale: language, state: 'current' }, select: { path: true },
          },
        },
      });
      const title = content?.from_ContentTranslation_contentId[0]?.title;
      const path = content?.from_PublicRoute_contentId[0]?.path;
      if (!content || !title || !path) invalidField(field, 'unavailable');
      return { type: 'content', id: content.id, title, url: path };
    }
    if (context.type === 'store') {
      const code = this.storeCode(context.id, `${field}.id`);
      const store = await transaction.store.findUnique({ where: { code }, select: { code: true } });
      if (!store) invalidField(field, 'unavailable');
      const route = routeRegistry.find(item => item.id === (code === 'sofia' ? 'R065' : 'R066'));
      if (!route) throw new Error('Enquiry store route is not registered');
      return { type: 'store', id: code, title: code, url: route[language] };
    }
    return invalidField(field, 'invalid_type');
  }

  private matchesRoute(pattern: string, path: string): boolean {
    const expression = pattern.split(/(\{[^}]+\})/).map(part =>
      part.startsWith('{') ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    ).join('');
    return new RegExp(`^${expression}$`).test(path);
  }

  private storeCode(value: string, field = 'context.id'): 'sofia' | 'nessebar' {
    if (value !== 'sofia' && value !== 'nessebar') invalidField(field, 'invalid_store');
    return value;
  }

  private storageError(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError ||
      error instanceof Prisma.PrismaClientUnknownRequestError ||
      error instanceof Prisma.PrismaClientInitializationError
    ) {
      this.logger.warn('Enquiry storage is unavailable');
      throw new ServiceUnavailableException({
        code: 'TEMPORARY_UNAVAILABLE', message_key: 'errors.temporary_unavailable',
      });
    }
    throw error;
  }
}

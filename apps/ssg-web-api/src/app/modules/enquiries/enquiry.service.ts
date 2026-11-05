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
import { OutboxService } from '../../common/outbox/outbox.service';
import { hashIdempotencyPayload, TransactionService } from '../../common/transactions/transaction.service';
import { PrismaService } from '../../database/prisma.service';
import type { EnquirySubmitDto } from './enquiry.dto';
import { routeRegistry } from '../../common/publication/route-registry';

interface EnquiryReceipt {
  state: 'received';
  reference: string;
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
      phone: input.phone ?? null, topic: input.topic, message: input.message,
      language: input.language, origin_route_id: input.origin_route_id,
      context: input.context ? { type: input.context.type, id: input.context.id } : null,
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
        await this.assertContext(transaction, input);
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
            phone: input.phone ?? null, topic: input.topic, message: input.message,
            locale: input.language, originRouteId: input.origin_route_id,
            productId: input.context?.type === 'product' ? input.context.id : null,
            contentId: input.context?.type === 'content' ? input.context.id : null,
            storeCode: input.context?.type === 'store'
              ? this.storeCode(input.context.id) : null,
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

  private async assertContext(transaction: Prisma.TransactionClient, input: EnquirySubmitDto): Promise<void> {
    const origin = routeRegistry.find((route) => route.id === input.origin_route_id);
    if (!origin) throw new BadRequestException();
    const context = input.context;
    if (context?.type === 'product') {
      if (!isUUID(context.id)) throw new BadRequestException();
      const product = await transaction.product.findFirst({
        where: {
          id: context.id, publicationStatus: 'published',
          currentRevisionIdRelation: { is: {
            state: 'published', from_ProductTranslation_revisionId: { some: { locale: input.language } },
          } },
        }, select: { productType: true },
      });
      if (!product) throw new NotFoundException();
      if (input.request_type === 'similar_jewellery_creation' && product.productType !== 'jewellery') {
        throw new BadRequestException();
      }
    } else if (context?.type === 'content') {
      if (!isUUID(context.id)) throw new BadRequestException();
      const content = await transaction.contentTranslation.findUnique({
        where: { contentId_locale: { contentId: context.id, locale: input.language } },
        select: { published: true },
      });
      if (!content?.published) throw new NotFoundException();
    } else if (context?.type === 'store') {
      const code = this.storeCode(context.id);
      if (!await transaction.store.findUnique({ where: { code }, select: { code: true } })) {
        throw new NotFoundException();
      }
    }
    if (input.request_type === 'similar_jewellery_creation' && context?.type !== 'product') {
      throw new BadRequestException();
    }
  }

  private storeCode(value: string): 'sofia' | 'nessebar' {
    if (value !== 'sofia' && value !== 'nessebar') throw new BadRequestException();
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

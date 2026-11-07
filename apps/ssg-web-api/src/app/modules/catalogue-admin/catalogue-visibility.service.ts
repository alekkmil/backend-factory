import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../../generated/prisma/client';
import { OutboxService } from '../../common/outbox/outbox.service';
import { TransactionService } from '../../common/transactions/transaction.service';
import { ProductReadService } from '../products/product-read.service';
import type { AdminProduct } from './catalogue-admin.dto';
import { CatalogueVisibilityDto } from './catalogue-admin.dto';
import { CatalogueAdminService } from './catalogue-admin.service';

function isPrismaFailure(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientInitializationError;
}

@Injectable()
export class CatalogueVisibilityService {
  private readonly logger = new Logger(CatalogueVisibilityService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly transactions: TransactionService,
    private readonly catalogue: CatalogueAdminService,
    private readonly products: ProductReadService,
    private readonly outbox: OutboxService,
  ) {}

  async setVisibility(
    actorId: string,
    productId: string,
    request: CatalogueVisibilityDto,
  ): Promise<AdminProduct> {
    if (
      this.config.get<string>('NODE_ENV') === 'production' ||
      !this.config.get<boolean>('DEV_CATALOGUE_PUBLISH_ENABLED')
    ) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message_key: 'errors.forbidden',
      });
    }

    try {
      const replay = await this.transactions.serializable((transaction) =>
        this.transactions.executeIdempotentAction(transaction, {
          scopeKey: `catalogue-visibility:${actorId}:${productId}`,
          requestId: request.request_id,
          payload: {
            expected_version: request.expected_version,
            publication_status: request.publication_status,
            reason: request.reason,
            note: request.note.normalize('NFC').trim(),
          },
        }, async () => {
          const locks = await this.transactions.lockProducts(transaction, [productId]);
          if (!locks.length) throw new NotFoundException();
          if (locks[0].version !== request.expected_version) this.conflict();

          const product = await transaction.product.findUniqueOrThrow({
            where: { id: productId },
            select: {
              publicationStatus: true,
              currentRevisionId: true,
              currentRevisionIdRelation: {
                select: {
                  id: true,
                  productId: true,
                  state: true,
                },
              },
            },
          });
          const current = product.currentRevisionIdRelation;
          if (
            !product.currentRevisionId ||
            !current ||
            current.id !== product.currentRevisionId ||
            current.productId !== productId ||
            current.state !== 'published'
          ) this.conflict();

          if (
            request.publication_status === 'published' &&
            product.publicationStatus !== 'hidden'
          ) this.conflict();
          if (
            request.publication_status === 'hidden' &&
            product.publicationStatus !== 'published'
          ) {
            if (product.publicationStatus === 'hidden') {
              const unchanged = await this.catalogue.detailInTransaction(transaction, productId);
              return {
                status_code: 200,
                body: JSON.parse(JSON.stringify(unchanged)) as Prisma.InputJsonObject,
              };
            }
            this.conflict();
          }

          const routes = await transaction.publicRoute.findMany({
            where: { productId, state: 'current' },
            select: { path: true, locale: true },
          });
          if (
            routes.length !== 2 ||
            !routes.some((route) => route.locale === 'bg') ||
            !routes.some((route) => route.locale === 'en')
          ) this.conflict();

          const updated = await transaction.product.update({
            where: { id: productId },
            data: {
              publicationStatus: request.publication_status,
              version: { increment: 1 },
            },
          });
          if (request.publication_status === 'published') {
            try {
              await this.products.assertPublicationMedia(transaction, productId);
            } catch (error) {
              if (error instanceof ServiceUnavailableException) {
                const response = error.getResponse();
                if (
                  response !== null &&
                  typeof response === 'object' &&
                  'code' in response &&
                  response.code === 'MEDIA_NOT_READY'
                ) {
                  throw new ConflictException({
                    code: 'MEDIA_NOT_READY',
                    message_key: 'errors.media_not_ready',
                  });
                }
              }
              throw error;
            }
          }
          await transaction.auditEvent.create({
            data: {
              actorId,
              action: 'catalogue_visibility',
              subjectType: 'Product',
              subjectId: productId,
              reason: request.reason,
              note: request.note.normalize('NFC').trim(),
              eventKey: `catalogue-visibility:${productId}:${request.request_id}`,
              before: {
                publication_status: product.publicationStatus,
                version: request.expected_version,
              },
              after: {
                publication_status: updated.publicationStatus,
                version: updated.version,
                current_revision_id: current.id,
              },
            },
          });
          await this.outbox.enqueue(transaction, {
            dedupeKey: `catalogue-visibility:${productId}:${request.request_id}`,
            kind: 'cache_invalidate',
            payload: {
              kind: 'cache_invalidate',
              product_ids: [productId],
              content_ids: [],
              route_paths: routes.map((route) => route.path),
              revision_key: `catalogue-visibility:${productId}:${updated.version}`,
            },
          });
          const response = await this.catalogue.detailInTransaction(transaction, productId);
          return {
            status_code: 200,
            body: JSON.parse(JSON.stringify(response)) as Prisma.InputJsonObject,
          };
        }),
      );
      return this.readAdminProduct(replay.body);
    } catch (error) {
      if (isPrismaFailure(error)) {
        this.logger.warn('Catalogue visibility database dependency failed');
        throw new ServiceUnavailableException({
          code: 'TEMPORARY_UNAVAILABLE',
          message_key: 'errors.temporary_unavailable',
        });
      }
      throw error;
    }
  }

  private readAdminProduct(value: Prisma.JsonObject | Prisma.InputJsonObject): AdminProduct {
    if (
      value === null ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      typeof value.id !== 'string' ||
      typeof value.ssg_id !== 'string' ||
      !Array.isArray(value.validation_errors)
    ) throw new ServiceUnavailableException({
      code: 'TEMPORARY_UNAVAILABLE',
      message_key: 'errors.temporary_unavailable',
    });
    return value as unknown as AdminProduct;
  }

  private conflict(): never {
    throw new ConflictException({
      code: 'VERSION_CONFLICT',
      message_key: 'errors.version_conflict',
    });
  }
}

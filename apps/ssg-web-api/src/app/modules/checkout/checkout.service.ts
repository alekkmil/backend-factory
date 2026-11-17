import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../../generated/prisma/client';
import { CommercialEvaluator } from '../../common/commercial/commercial-evaluator';
import type { FulfilmentContext } from '../../common/commercial/commercial-evaluator';
import {
  hashIdempotencyPayload,
  TransactionService,
} from '../../common/transactions/transaction.service';
import {
  configurationUrl,
  ProductReadService,
} from '../products/product-read.service';
import type { CreateCheckoutQuoteDto } from './checkout.dto';
import {
  checkoutConflict,
  checkoutMinorUnits,
  MAX_CART_MINOR,
} from './checkout-validation.service';

@Injectable()
export class CheckoutService {
  constructor(
    private readonly config: ConfigService,
    private readonly transactions: TransactionService,
    private readonly products: ProductReadService,
    private readonly evaluator: CommercialEvaluator,
  ) {}

  async quote(guestId: string, input: CreateCheckoutQuoteDto) {
    if (!this.config.get<boolean>('CHECKOUT_ENABLED')) {
      throw new ServiceUnavailableException({
        code: 'TEMPORARILY_UNAVAILABLE',
        message_key: 'errors.temporary_unavailable',
      });
    }

    const receiving = input.receiving;
    if (
      (receiving.method === 'store_pickup' &&
        [receiving.recipientName, receiving.phone, receiving.locality,
          receiving.address, receiving.office].some((value) => value !== undefined)) ||
      (receiving.method === 'econt_address' && receiving.office !== undefined) ||
      (receiving.method === 'econt_office' && receiving.address !== undefined)
    ) {
      throw new BadRequestException({
        code: 'FIELD_INVALID',
        message_key: 'errors.validation',
      });
    }
    const context: FulfilmentContext = receiving.method === 'store_pickup'
      ? { method: 'store_pickup', locationCode: 'sofia' }
      : { method: 'delivery', localityId: receiving.locality ?? '' };
    const unitIds = input.items.map((item) => item.unitId.toLowerCase());
    if (new Set(unitIds).size !== unitIds.length) {
      throw new BadRequestException({
        code: 'FIELD_INVALID',
        message_key: 'errors.validation',
      });
    }
    const ttlSeconds = this.config.getOrThrow<number>('CHECKOUT_QUOTE_TTL_SECONDS');

    return this.transactions.serializable(async (transaction) => {
      const stocks = await transaction.stockItem.findMany({
        where: { id: { in: unitIds } },
        select: { id: true, productId: true },
      });
      if (stocks.length !== unitIds.length) {
        throw checkoutConflict('ITEM_UNAVAILABLE');
      }
      const stockToProduct = new Map(stocks.map((stock) => [stock.id, stock.productId]));
      const productIds = [...new Set(stocks.map((stock) => stock.productId))];
      const settings = await this.transactions.lockSettings(transaction);
      if (!settings) {
        throw checkoutConflict('ITEM_NOT_PURCHASABLE');
      }
      const productVersions = await this.transactions.lockProducts(transaction, productIds);
      const stockVersions = await this.transactions.lockStockItems(transaction, unitIds);
      const productVersionById = new Map(productVersions.map((row) => [row.id, row.version]));
      const stockVersionById = new Map(stockVersions.map((row) => [row.id, row.version]));
      const candidates = await this.products.catalogCandidates(
        transaction, productIds, input.locale, context,
      );
      const byProduct = new Map(candidates.map((candidate) => [candidate.summary.id, candidate]));
      let totalMinor = 0n;
      const selected = unitIds.map((unitId, index) => {
        const productId = stockToProduct.get(unitId);
        const candidate = productId ? byProduct.get(productId) : undefined;
        const unit = candidate?.units.find((entry) => entry.id === unitId);
        const productVersion = productId ? productVersionById.get(productId) : undefined;
        const stockVersion = stockVersionById.get(unitId);
        if (!productId || !candidate || !unit || !productVersion || !stockVersion) {
          throw checkoutConflict('ITEM_UNAVAILABLE');
        }
        if (
          candidate.summary.product_type !== 'jewellery' ||
          candidate.settings?.currency !== 'EUR' ||
          unit.currency !== 'EUR'
        ) {
          throw checkoutConflict('ITEM_NOT_PURCHASABLE');
        }
        if (unit.status !== 'available') {
          throw checkoutConflict('ITEM_UNAVAILABLE');
        }
        if (
          receiving.method !== 'store_pickup' &&
          candidate.product.deliveryScope !== 'bulgaria'
        ) {
          throw checkoutConflict('FULFILMENT_UNAVAILABLE');
        }
        const minor = checkoutMinorUnits(unit.price);
        totalMinor += minor;
        return {
          unitId,
          productId,
          sortOrder: index + 1,
          stockVersion,
          productVersion,
          candidate,
          unit,
          minor,
        };
      });

      if (totalMinor > MAX_CART_MINOR) {
        return {
          payable: false as const,
          code: 'CART_TOTAL_LIMIT_EXCEEDED',
          limitMinor: Number(MAX_CART_MINOR),
          currency: 'EUR',
        };
      }
      const lines = selected.map((line) => {
        const evaluated = this.evaluator.evaluateExactUnit(
          line.candidate.product, line.unit, line.candidate.settings, context,
        );
        if (!evaluated) {
          throw checkoutConflict('ITEM_NOT_PURCHASABLE');
        }
        return {
          unitId: line.unitId,
          productId: line.productId,
          assetId: line.candidate.summary.primary_image.id,
          sortOrder: line.sortOrder,
          stockVersion: line.stockVersion,
          productVersion: line.productVersion,
          unitPrice: evaluated.price.amount,
          snapshot: {
            title: line.candidate.summary.name,
            imageUrl: line.candidate.summary.primary_image.urls.default,
            productUrl: line.candidate.summary.url,
            variant: {
              dimensions_mm: evaluated.facts.dimensions_mm,
              weight_g: evaluated.facts.weight_g,
              stone_weight_ct: evaluated.facts.stone_weight_ct,
            },
            quantity: 1,
            unitPriceMinor: Number(line.minor),
          },
        };
      });
      const policies = await transaction.policyVersion.findMany({
        where: {
          kind: 'terms', locale: input.locale, current: true, published: true,
        },
        take: 2,
        select: { id: true, versionLabel: true, title: true, url: true },
      });
      if (policies.length !== 1) {
        throw new ServiceUnavailableException({
          code: 'TEMPORARILY_UNAVAILABLE',
          message_key: 'errors.temporary_unavailable',
        });
      }
      const policy = policies[0];
      const origin = configurationUrl(this.config, 'PUBLIC_SITE_ORIGIN', false);
      const termsUrl = new URL(policy.url, origin);
      if (termsUrl.origin !== origin.origin || termsUrl.username || termsUrl.password) {
        throw new ServiceUnavailableException({
          code: 'TEMPORARILY_UNAVAILABLE',
          message_key: 'errors.temporary_unavailable',
        });
      }
      const customer = {
        firstName: input.contact.firstName,
        lastName: input.contact.lastName,
        email: input.contact.email,
        phone: input.contact.phone,
        cardholder: {
          name: input.cardholder.name,
          email: input.cardholder.email,
          billingAddress: input.cardholder.billingAddress,
        },
      };
      const fulfilment = receiving.method === 'store_pickup'
        ? { method: receiving.method, country: 'BG' }
        : {
            method: receiving.method,
            country: 'BG',
            recipientName: receiving.recipientName,
            phone: receiving.phone,
            locality: receiving.locality,
            ...(receiving.method === 'econt_address'
              ? { address: receiving.address }
              : { office: receiving.office }),
          };
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
      const total = new Prisma.Decimal(totalMinor.toString()).dividedBy(100);
      const publicItems = lines.map((line) => ({
        unitId: line.unitId,
        ...line.snapshot,
      }));
      const quote = await transaction.quote.create({
        data: {
          guestId,
          policyVersionId: policy.id,
          locale: input.locale,
          customer,
          fulfilment,
          paymentMethodCode: 'borica',
          paymentTiming: 'prepayment',
          itemsTotal: total,
          deliveryFee: new Prisma.Decimal(0),
          total,
          currency: 'EUR',
          settingsVersion: settings.version,
          reviewHash: hashIdempotencyPayload({
            customer, fulfilment, lines: publicItems,
            policyVersionId: policy.id, settingsVersion: settings.version,
          }),
          expiresAt,
          from_QuoteLine_quoteId: {
            create: lines.map((line) => ({
              stockItemId: line.unitId,
              productId: line.productId,
              assetId: line.assetId,
              sortOrder: line.sortOrder,
              unitPrice: new Prisma.Decimal(line.unitPrice),
              publicSnapshot: line.snapshot,
              stockVersion: line.stockVersion,
              productVersion: line.productVersion,
            })),
          },
        },
        select: { id: true },
      });
      return {
        payable: true as const,
        quoteId: quote.id,
        quoteVersion: 1,
        expiresAt: expiresAt.toISOString(),
        items: publicItems,
        contact: input.contact,
        receiving: fulfilment,
        terms: { version: policy.versionLabel, title: policy.title, url: termsUrl.toString() },
        money: {
          currency: 'EUR',
          subtotalMinor: Number(totalMinor),
          deliveryMinor: 0,
          totalMinor: Number(totalMinor),
        },
        limitMinor: Number(MAX_CART_MINOR),
      };
    });
  }
}

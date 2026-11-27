import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isEmail } from 'class-validator';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { EcontDirectoryService } from '../../modules/checkout/econt-directory.service';
import { configurationUrl, routeUrl } from '../../modules/products/product-read.service';
import { OutboxDispatchError } from './outbox-handler';
import { renderStaffPaymentMail } from './staff-payment-mail-template';

function record(value: Prisma.JsonValue | null | undefined): Prisma.JsonObject | null {
  return value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value)
    ? value : null;
}

function text(value: Prisma.JsonValue | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function money(value: Prisma.Decimal, currency: string): string {
  const match = /^(\d+)\.(\d{2})$/.exec(value.toFixed(2));
  if (!match || !/^[A-Z]{3}$/.test(currency)) throw new OutboxDispatchError('CHECKOUT_SNAPSHOT_INVALID');
  const whole = match[1].replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
  return `${whole},${match[2]} ${currency === 'EUR' ? '€' : currency}`;
}

function publicUrl(value: string | null, origin: URL): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.origin !== origin.origin || url.username || url.password || url.search || url.hash) return null;
    return url.toString();
  } catch {
    return null;
  }
}

@Injectable()
export class StaffPaymentNotificationService {
  private readonly logger = new Logger(StaffPaymentNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly econt: EcontDirectoryService,
  ) {}

  async render(attemptId: string, orderId: string, recipient: string) {
    const attempt = await this.prisma.bankPaymentAttempt.findUnique({
      where: { id: attemptId },
      include: {
        order: {
          include: {
            from_OrderLine_orderId: {
              orderBy: { sortOrder: 'asc' },
              include: {
                stockItemIdRelation: { select: { barcode: true, productId: true } },
                productIdRelation: {
                  select: {
                    ssgId: true,
                    currentRevisionIdRelation: {
                      select: {
                        from_ProductTranslation_revisionId: {
                          where: { locale: 'bg' }, select: { name: true },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!attempt || attempt.orderId !== orderId || attempt.order.sandbox ||
        attempt.outcome !== 'paid' || !attempt.paidAt) {
      throw new OutboxDispatchError('CHECKOUT_SNAPSHOT_UNAVAILABLE');
    }
    const order = attempt.order;
    const customer = record(order.customer);
    const firstName = text(customer?.firstName);
    const lastName = text(customer?.lastName);
    const buyerPhone = text(customer?.phone);
    const buyerEmail = text(customer?.email);
    if (!firstName || !lastName || !buyerPhone || !buyerEmail || !isEmail(buyerEmail)) {
      throw new OutboxDispatchError('CHECKOUT_SNAPSHOT_INVALID');
    }
    const origin = configurationUrl(this.config, 'PUBLIC_SITE_ORIGIN',
      this.config.get<string>('NODE_ENV') === 'production');
    const lines = order.from_OrderLine_orderId;
    if (!lines.length) throw new OutboxDispatchError('CHECKOUT_SNAPSHOT_INVALID');
    const currentRoutes = await this.prisma.publicRoute.findMany({
      where: { productId: { in: lines.map((line) => line.productId) }, locale: 'bg', state: 'current' },
      select: { productId: true, path: true },
    });
    let currentProductData = false;
    const items = lines.map((line) => {
      const snapshot = record(line.snapshot);
      const staff = record(line.staffSnapshot);
      if (!snapshot || typeof snapshot.quantity !== 'number' || !Number.isSafeInteger(snapshot.quantity) ||
          snapshot.quantity < 1 || line.stockItemIdRelation.productId !== line.productId) {
        throw new OutboxDispatchError('CHECKOUT_SNAPSHOT_INVALID');
      }
      const snapshotBarcodes = staff?.barcodes;
      const storedBarcodes = Array.isArray(snapshotBarcodes) && snapshotBarcodes.length > 0 &&
        snapshotBarcodes.every((barcode) => typeof barcode === 'string' && barcode.trim())
        ? snapshotBarcodes.map((barcode) => String(barcode).trim()) : null;
      if ((storedBarcodes && (storedBarcodes.length !== snapshot.quantity ||
          new Set(storedBarcodes).size !== storedBarcodes.length)) ||
          (!storedBarcodes && snapshot.quantity > 1)) {
        throw new OutboxDispatchError('CHECKOUT_SNAPSHOT_INVALID');
      }
      const storedName = text(staff?.nameBg);
      const storedSsgId = text(staff?.ssgId);
      const storedUrl = publicUrl(text(staff?.productUrlBg), origin);
      const currentName = text(line.productIdRelation.currentRevisionIdRelation
        ?.from_ProductTranslation_revisionId[0]?.name);
      const matchingRoutes = currentRoutes.filter((route) => route.productId === line.productId);
      let currentUrl: string | null = null;
      if (matchingRoutes.length === 1) {
        try {
          currentUrl = routeUrl(matchingRoutes[0].path, origin);
        } catch (error) {
          if (!(error instanceof ServiceUnavailableException)) throw error;
          this.logger.warn('Current Bulgarian product route is invalid for a staff payment notification');
        }
      }
      if (!storedBarcodes || !storedName || !storedSsgId || !storedUrl) currentProductData = true;
      const name = storedName ?? currentName ?? text(snapshot.title);
      const barcode = text(line.stockItemIdRelation.barcode);
      const barcodes = storedBarcodes ?? (barcode ? [barcode] : []);
      const ssgId = storedSsgId ?? text(line.productIdRelation.ssgId);
      if (!name || !barcodes.length || !ssgId) {
        throw new OutboxDispatchError('CHECKOUT_SNAPSHOT_INVALID');
      }
      return {
        name, barcodes, ssgId, quantity: snapshot.quantity,
        unitPrice: money(line.unitPrice, order.currency), productUrl: currentUrl ?? storedUrl,
      };
    });
    const receiving = record(order.fulfilment);
    if (!receiving) throw new OutboxDispatchError('CHECKOUT_SNAPSHOT_INVALID');
    let receivingLabel: string;
    let receivingLines: string[];
    if (receiving.method === 'store_pickup') {
      receivingLabel = 'Вземане от бутик SSG София';
      receivingLines = [
        `Получаване: ${receivingLabel}`, 'Бутик: SSG София',
        'Подгответе бижуто и се обадете на клиента, за да уговорите вземането.',
      ];
    } else if (receiving.method === 'econt_address') {
      receivingLabel = 'Еконт до адрес';
      const recipientName = text(receiving.recipientName);
      const recipientPhone = text(receiving.phone);
      const locality = text(receiving.locality);
      const address = text(receiving.address);
      if (!recipientName || !recipientPhone || !locality || !address) {
        throw new OutboxDispatchError('CHECKOUT_SNAPSHOT_INVALID');
      }
      receivingLines = [
        `Получаване: ${receivingLabel}`, `Получател: ${recipientName}`,
        `Телефон на получателя: ${recipientPhone}`, `Населено място: ${locality}`,
        `Адрес за доставка: ${address}`, 'Подгответе пратката за доставка до посочения адрес.',
      ];
    } else if (receiving.method === 'econt_office') {
      const recipientName = text(receiving.recipientName);
      const recipientPhone = text(receiving.phone);
      const code = text(receiving.officeCode);
      const cityId = text(receiving.cityId);
      const officeId = text(receiving.officeId);
      let locality = text(receiving.locality);
      let name = text(receiving.office);
      let address = text(receiving.officeAddress);
      let locationType = text(receiving.locationType);
      if (!recipientName || !recipientPhone || !code) throw new OutboxDispatchError('CHECKOUT_SNAPSHOT_INVALID');
      if ((!locality || !name || !address || !locationType) && cityId) {
        try {
          const current = await this.econt.selectedOffice(cityId, code, 'bg');
          if (officeId && current.id !== officeId) {
            if (!locality || !name || !address) throw new OutboxDispatchError('ECONT_LOCATION_CHANGED');
            this.logger.warn('Econt location identity changed for a legacy payment notification');
          } else {
            locality ??= current.locality;
            name ??= current.name;
            address ??= current.address;
            locationType ??= current.locationType;
          }
        } catch (error) {
          if (!(error instanceof BadRequestException) && !(error instanceof ServiceUnavailableException)) throw error;
          if (!locality || !name || !address) throw new OutboxDispatchError('ECONT_DIRECTORY_UNAVAILABLE');
          this.logger.warn('Econt location type is unavailable for a legacy payment notification');
        }
      }
      if (!locality || !name || !address) throw new OutboxDispatchError('ECONT_DIRECTORY_UNAVAILABLE');
      const locker = locationType === 'drop_box';
      receivingLabel = locker ? 'Еконт до Еконтомат' : 'Еконт до офис';
      receivingLines = [
        `Получаване: ${receivingLabel}`, `Получател: ${recipientName}`,
        `Телефон на получателя: ${recipientPhone}`, `Населено място: ${locality}`,
        `${locker ? 'Еконтомат' : 'Офис на Еконт'}: ${name}`,
        `${locker ? 'Код на Еконтомата' : 'Код на офиса'}: ${code}`,
        `${locker ? 'Адрес на Еконтомата' : 'Адрес на офиса'}: ${address}`,
        locker ? 'Подгответе пратката за доставка до посочения Еконтомат.'
          : 'Подгответе пратката за доставка до посочения офис на Еконт.',
      ];
    } else {
      throw new OutboxDispatchError('CHECKOUT_SNAPSHOT_INVALID');
    }
    const parts = new Intl.DateTimeFormat('bg-BG', {
      timeZone: 'Europe/Sofia', day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(attempt.paidAt);
    const part = (type: Intl.DateTimeFormatPartTypes) => {
      const value = parts.find((item) => item.type === type)?.value;
      if (!value) throw new OutboxDispatchError('CHECKOUT_SNAPSHOT_INVALID');
      return value;
    };
    return renderStaffPaymentMail({
      recipient, orderNumber: order.number, receivingLabel,
      paymentDate: `${part('day')}.${part('month')}.${part('year')} г.`,
      paymentTime: `${part('hour')}:${part('minute')}`,
      itemsTotal: money(order.itemsTotal, order.currency),
      deliveryFee: money(order.deliveryFee, order.currency),
      paidTotal: money(attempt.amount, attempt.currency),
      manualReview: attempt.manualReviewRequired || !attempt.amount.equals(order.total) ||
        attempt.currency !== order.currency,
      currentProductData, items, buyerName: `${firstName} ${lastName}`, buyerPhone, buyerEmail,
      receivingLines,
    });
  }
}

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isEmail, isUUID } from 'class-validator';
import { createHash } from 'node:crypto';
import type { JobKind, Locale } from '../../../generated/prisma/enums';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { configurationUrl } from '../../modules/products/product-read.service';
import { MailDeliveryService, MailDeliveryError } from './mail-delivery.service';
import { MailCaptureError } from './local-mail-capture.service';
import { OrderNotificationService } from './order-notification.service';
import { OutboxDispatchError, renderMail } from './outbox-handler';
import { renderEnquiryMail } from './enquiry-mail-template';
import type { EnquiryMailContext, EnquiryMailKind } from './enquiry-mail-template';
import type { OutboxDispatchResult, OutboxJobHandler } from './outbox-handler';
import type { ClaimedOutboxMessage } from './outbox.service';
import { CheckoutOrderNotificationService } from './checkout-order-notification.service';

export { OutboxDispatchError } from './outbox-handler';
export type { OutboxDispatchResult, OutboxJobHandler } from './outbox-handler';

interface MailEntitySnapshot {
  type: 'product' | 'content' | 'store';
  title: string;
  url: string;
  productType?: 'jewellery' | 'loose_stone';
  imageUrl?: string;
  codes?: string[];
}

function isJsonRecord(value: Prisma.JsonValue | null): value is Prisma.JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readEntitySnapshot(value: Prisma.JsonValue | null): MailEntitySnapshot | null {
  if (!isJsonRecord(value)) return null;
  if (
    (value.type !== 'product' && value.type !== 'content' && value.type !== 'store') ||
    typeof value.title !== 'string' ||
    typeof value.url !== 'string'
  ) return null;
  const imageUrl = typeof value.image_url === 'string' ? value.image_url : undefined;
  const productType = value.product_type === 'jewellery' || value.product_type === 'loose_stone'
    ? value.product_type
    : undefined;
  const storedCodes = value.public_codes ?? value.model_codes;
  const codes = Array.isArray(storedCodes)
    ? storedCodes.filter((item): item is string => typeof item === 'string')
    : [];
  return { type: value.type, title: value.title, url: value.url, productType, imageUrl, codes };
}

function enquiryMailKind(topic: string, hasJewellery: boolean): EnquiryMailKind {
  switch (topic) {
    case 'consultation': return 'consultation';
    case 'bespoke': return 'bespoke';
    case 'assessment': return 'assessment';
    case 'documents': return 'documents';
    case 'gemstone_selection': return 'gemstone';
    case 'maintenance': return 'maintenance';
    case 'general': return hasJewellery ? 'jewellery' : 'general';
    default: return hasJewellery ? 'jewellery' : 'general';
  }
}

@Injectable()
export class OutboxDispatcherService {
  private readonly handlers = new Map<JobKind, OutboxJobHandler>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailDelivery: MailDeliveryService,
    private readonly orderNotifications: OrderNotificationService,
    private readonly checkoutNotifications: CheckoutOrderNotificationService,
    private readonly config: ConfigService,
  ) {}

  register(kind: JobKind, handler: OutboxJobHandler): void {
    if (
      this.handlers.has(kind) ||
      ['inquiry_received', 'customer_payment_received', 'customer_order_confirmed', 'ops_payment_received'].includes(kind)
    ) {
      throw new Error(`An outbox handler is already registered for ${kind}`);
    }
    this.handlers.set(kind, handler);
  }

  async dispatch(message: ClaimedOutboxMessage): Promise<OutboxDispatchResult> {
    if (message.dedupeKey.startsWith('sandbox-access-lookup:') ||
        ['sandbox-order-v1', 'sandbox-simulation-v1'].includes(message.templateVersion ?? '')) {
      return { outcome: 'suppressed', safeError: 'LEGACY_SANDBOX_JOB' };
    }
    if (message.kind === 'customer_access_lookup' &&
        message.dedupeKey.startsWith('checkout-access-lookup:')) {
      return this.checkoutNotifications.dispatchLookup(message);
    }
    if (
      message.templateVersion === 'checkout-order-v1' &&
      (message.kind === 'customer_payment_received' || message.kind === 'customer_order_access')
    ) {
      return this.checkoutNotifications.dispatchMail(message);
    }
    if (message.kind === 'inquiry_received') {
      return this.deliverInquiry(message);
    }
    if (message.kind === 'ops_payment_received') {
      return this.deliverStaffPayment(message);
    }
    if (
      message.kind === 'customer_payment_received' ||
      message.kind === 'customer_order_confirmed'
    ) {
      return this.orderNotifications.dispatch(message);
    }
    const handler = this.handlers.get(message.kind);
    if (!handler) {
      throw new OutboxDispatchError('JOB_HANDLER_UNAVAILABLE');
    }
    return handler.dispatch(message);
  }

  private async deliverStaffPayment(message: ClaimedOutboxMessage): Promise<OutboxDispatchResult> {
    const payload = message.payload;
    if (
      !isJsonRecord(payload) || !message.orderId || message.inquiryId || message.encryptedSecret ||
      !message.recipientSnapshot || !isEmail(message.recipientSnapshot) ||
      message.templateVersion !== 'verified-payment-staff-v1' ||
      payload.order_id !== message.orderId || typeof payload.payment_attempt_id !== 'string' ||
      !isUUID(payload.payment_attempt_id) ||
      Object.keys(payload).some((key) => !['order_id', 'payment_attempt_id'].includes(key))
    ) throw new OutboxDispatchError('JOB_PAYLOAD_INVALID');
    const recipientHash = createHash('sha256').update(message.recipientSnapshot.toLowerCase()).digest('hex');
    if (message.dedupeKey !== `bank-payment-staff:${payload.payment_attempt_id}:${recipientHash}`) {
      throw new OutboxDispatchError('JOB_PAYLOAD_INVALID');
    }
    const attempt = await this.prisma.bankPaymentAttempt.findUnique({
      where: { id: payload.payment_attempt_id }, include: { order: true },
    });
    if (!attempt || attempt.orderId !== message.orderId || attempt.order.sandbox ||
        attempt.outcome !== 'paid' || !attempt.paidAt) {
      throw new OutboxDispatchError('CHECKOUT_SNAPSHOT_UNAVAILABLE');
    }
    const review = attempt.manualReviewRequired || !attempt.amount.equals(attempt.order.total) ||
      attempt.currency !== attempt.order.currency;
    const mail = renderMail(message.recipientSnapshot, `Verified payment — order ${attempt.order.number}`, [
      ['Order', attempt.order.number],
      ['Amount received', `${attempt.amount.toFixed(2)} ${attempt.currency}`],
      ['Verified at', attempt.paidAt.toISOString()],
      ['Manual payment review required', review ? 'Yes' : 'No'],
    ]);
    try {
      const prior = await this.mailDelivery.lookup(message.id, 'staff-payment');
      if (prior) return { outcome: 'sent', providerMessageId: prior };
      return { outcome: 'sent', providerMessageId: await this.mailDelivery.deliver(message.id, mail, 'staff-payment') };
    } catch (error) {
      if (error instanceof MailCaptureError || error instanceof MailDeliveryError) {
        throw new OutboxDispatchError(error.code);
      }
      throw error;
    }
  }

  private async deliverInquiry(
    message: ClaimedOutboxMessage,
  ): Promise<OutboxDispatchResult> {
    const payload = message.payload;
    if (
      !message.inquiryId ||
      message.orderId !== null ||
      payload === null ||
      Array.isArray(payload) ||
      typeof payload !== 'object' ||
      payload.kind !== 'inquiry_received' ||
      payload.inquiry_id !== message.inquiryId ||
      Object.keys(payload).some(
        (key) => key !== 'kind' && key !== 'inquiry_id',
      )
    ) {
      throw new OutboxDispatchError('JOB_PAYLOAD_INVALID');
    }
    if (
      !message.recipientSnapshot ||
      !isEmail(message.recipientSnapshot) ||
      !message.locale ||
      message.templateVersion !== 'inquiry-v1'
    ) {
      throw new OutboxDispatchError('MAIL_CONFIGURATION_UNAVAILABLE');
    }
    const inquiry = await this.prisma.inquiry.findUnique({
      where: { id: message.inquiryId },
      select: {
        name: true,
        email: true,
        phone: true,
        topic: true,
        message: true,
        locale: true,
        originRouteId: true,
        originPath: true,
        originEntity: true,
        contextSnapshot: true,
        createdAt: true,
      },
    });
    if (!inquiry || inquiry.locale !== message.locale) {
      throw new OutboxDispatchError('INQUIRY_SNAPSHOT_UNAVAILABLE');
    }
    const snapshot = isJsonRecord(inquiry.contextSnapshot) ? inquiry.contextSnapshot : null;
    const product = readEntitySnapshot(snapshot?.product ?? null);
    const content = readEntitySnapshot(snapshot?.content ?? null);
    const originalEntity = readEntitySnapshot(inquiry.originEntity);
    const kind = enquiryMailKind(
      inquiry.topic,
      product?.type === 'product' && product.productType === 'jewellery',
    );
    let context: EnquiryMailContext | null = null;
    if (kind === 'jewellery' && product?.type === 'product') {
      context = {
        kind: 'jewellery',
        name: product.title,
        url: product.url,
        ...(product.imageUrl ? { imageUrl: product.imageUrl } : {}),
        ...(product.codes?.length ? { codes: product.codes } : {}),
      };
    } else if (kind === 'gemstone') {
      const selected = product ?? content;
      if (selected) {
        context = {
          kind: 'regarding',
          name: selected.title,
          url: selected.url,
          ...(selected.imageUrl ? { imageUrl: selected.imageUrl } : {}),
          ...(product?.codes?.length ? { codes: product.codes } : {}),
        };
      }
    } else if (
      ['consultation', 'bespoke', 'assessment', 'documents'].includes(kind) &&
      content?.type === 'content'
    ) {
      context = { kind: 'service', name: content.title, url: content.url };
    }

    const locale: Locale = inquiry.locale;
    const labels = locale === 'bg'
      ? { home: 'Начална страница', sofia: 'Бутик София', nessebar: 'Бутик Несебър' }
      : { home: 'Home', sofia: 'Sofia boutique', nessebar: 'Nessebar boutique' };
    const sourceLabel = inquiry.originRouteId === 'R001'
      ? labels.home
      : originalEntity?.type === 'store'
        ? originalEntity.title === 'sofia' ? labels.sofia : labels.nessebar
        : originalEntity?.title;
    const frontendOrigin = configurationUrl(
      this.config,
      'PUBLIC_SITE_ORIGIN',
      this.config.get<string>('NODE_ENV') === 'production',
    );
    const mediaOrigin = this.config.get<string>('MEDIA_CDN_BASE_URL')
      ? configurationUrl(
          this.config,
          'MEDIA_CDN_BASE_URL',
          this.config.get<string>('NODE_ENV') === 'production',
        )
      : null;
    const mail = renderEnquiryMail({
      recipient: message.recipientSnapshot,
      locale,
      kind,
      receivedAt: inquiry.createdAt,
      name: inquiry.name,
      email: inquiry.email,
      phone: inquiry.phone,
      message: inquiry.message,
      context,
      sourcePage: inquiry.originPath
        ? { label: sourceLabel ?? '', url: inquiry.originPath }
        : null,
      frontendOrigin,
      mediaOrigin,
    });
    try {
      const providerMessageId = await this.mailDelivery.deliver(message.id, mail);
      return { outcome: 'sent', providerMessageId };
    } catch (error) {
      if (error instanceof MailCaptureError) {
        throw new OutboxDispatchError(error.code);
      }
      if (error instanceof MailDeliveryError) {
        throw new OutboxDispatchError(error.code);
      }
      throw error;
    }
  }
}

import { Injectable } from '@nestjs/common';
import { isEmail } from 'class-validator';
import type { JobKind } from '../../../generated/prisma/enums';
import { PrismaService } from '../../database/prisma.service';
import { MailDeliveryService, MailDeliveryError } from './mail-delivery.service';
import { MailCaptureError } from './local-mail-capture.service';
import { OrderNotificationService } from './order-notification.service';
import { OutboxDispatchError, renderMail } from './outbox-handler';
import type { OutboxDispatchResult, OutboxJobHandler } from './outbox-handler';
import type { ClaimedOutboxMessage } from './outbox.service';

export { OutboxDispatchError } from './outbox-handler';
export type { OutboxDispatchResult, OutboxJobHandler } from './outbox-handler';

@Injectable()
export class OutboxDispatcherService {
  private readonly handlers = new Map<JobKind, OutboxJobHandler>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailDelivery: MailDeliveryService,
    private readonly orderNotifications: OrderNotificationService,
  ) {}

  register(kind: JobKind, handler: OutboxJobHandler): void {
    if (
      this.handlers.has(kind) ||
      ['inquiry_received', 'customer_payment_received', 'customer_order_confirmed'].includes(kind)
    ) {
      throw new Error(`An outbox handler is already registered for ${kind}`);
    }
    this.handlers.set(kind, handler);
  }

  async dispatch(message: ClaimedOutboxMessage): Promise<OutboxDispatchResult> {
    if (message.kind === 'inquiry_received') {
      return this.deliverInquiry(message);
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
        type: true,
        name: true,
        email: true,
        phone: true,
        topic: true,
        message: true,
        locale: true,
        originRouteId: true,
        openingAction: true,
        originPath: true,
        originEntity: true,
        contextSnapshot: true,
        productId: true,
        contentId: true,
        storeCode: true,
        createdAt: true,
      },
    });
    if (!inquiry || inquiry.locale !== message.locale) {
      throw new OutboxDispatchError('INQUIRY_SNAPSHOT_UNAVAILABLE');
    }
    const labels = message.locale === 'bg'
      ? {
          subject: 'Ново запитване',
          name: 'Име',
          email: 'Имейл',
          phone: 'Телефон',
          topic: 'Тема',
          message: 'Съобщение',
          source: 'Източник',
          received: 'Получено',
          type: 'Тип',
          product: 'Продукт',
          content: 'Съдържание',
          store: 'Магазин',
          action: 'Действие',
          originEntity: 'Първоначален контекст',
          finalContext: 'Избран контекст',
          path: 'Първоначална страница',
        }
      : {
          subject: 'New enquiry',
          name: 'Name',
          email: 'Email',
          phone: 'Phone',
          topic: 'Topic',
          message: 'Message',
          source: 'Source',
          received: 'Received',
          type: 'Type',
          product: 'Product',
          content: 'Content',
          store: 'Store',
          action: 'Opening action',
          originEntity: 'Original context',
          finalContext: 'Selected context',
          path: 'Original page',
        };
    const fields: [string, string][] = [
      [labels.name, inquiry.name],
      [labels.email, inquiry.email],
      [labels.phone, inquiry.phone ?? ''],
      [labels.topic, inquiry.topic],
      [labels.message, inquiry.message],
      [labels.source, inquiry.originRouteId],
      [labels.action, inquiry.openingAction ?? ''],
      [labels.originEntity, inquiry.originEntity ? JSON.stringify(inquiry.originEntity) : ''],
      [labels.finalContext, inquiry.contextSnapshot ? JSON.stringify(inquiry.contextSnapshot) : ''],
      [labels.path, inquiry.originPath ?? ''],
      [labels.received, inquiry.createdAt.toISOString()],
      [labels.type, inquiry.type],
      [labels.product, inquiry.productId ?? ''],
      [labels.content, inquiry.contentId ?? ''],
      [labels.store, inquiry.storeCode ?? ''],
    ];
    const mail = renderMail(message.recipientSnapshot, labels.subject, fields);
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

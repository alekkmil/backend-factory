import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { TransactionService } from '../../common/transactions/transaction.service';
import { StockPublicationService } from '../../common/stock-facts/stock-publication.service';

@Injectable()
export class PaymentHoldExpiryService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PaymentHoldExpiryService.name);
  private timer?: ReturnType<typeof setTimeout>;
  private active?: Promise<boolean>;
  private stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionService,
    private readonly publication: StockPublicationService,
  ) {}

  onApplicationBootstrap(): void {
    this.schedule(0);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    await this.active;
  }

  private schedule(delay: number): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => { void this.tick(); }, delay);
    this.timer.unref();
  }

  private async tick(): Promise<void> {
    let worked = false;
    try {
      worked = await this.runOnce();
    } catch {
      this.logger.error('Unpaid hold expiry failed; reservations retained for retry');
    } finally {
      this.schedule(worked ? 0 : 5000);
    }
  }

  async runOnce(): Promise<boolean> {
    if (this.active) return this.active;
    const work = this.expireNext();
    this.active = work;
    try { return await work; } finally { this.active = undefined; }
  }

  private async expireNext(): Promise<boolean> {
    const candidate = await this.prisma.order.findFirst({
      where: {
        sandbox: false,
        paymentHoldExpiresAt: { lte: new Date() },
        paymentHoldExpiredAt: null,
        bankPaymentAttempt: { is: null },
      },
      orderBy: [{ paymentHoldExpiresAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    if (!candidate) return false;
    return this.transactions.serializable(async (tx) => {
      const lines = await tx.orderLine.findMany({
        where: { orderId: candidate.id },
        select: { productId: true, stockItemId: true, reservationReference: true, reservedLocation: true },
      });
      const productIds = [...new Set(lines.map((line) => line.productId))].sort();
      await this.transactions.lockProducts(tx, productIds);
      await this.transactions.lockStockItems(tx, lines.map((line) => line.stockItemId));
      await this.transactions.lockOrders(tx, [candidate.id]);
      const order = await tx.order.findUnique({
        where: { id: candidate.id },
        select: {
          status: true, sandbox: true, paymentHoldExpiresAt: true, paymentHoldExpiredAt: true,
          attentionCodes: true, bankPaymentAttempt: { select: { id: true } },
          from_Acceptance_orderId: { select: { id: true } },
          from_PaymentOperation_orderId: { select: { id: true }, take: 1 },
        },
      });
      const now = new Date();
      if (!order || order.sandbox || order.paymentHoldExpiredAt || !order.paymentHoldExpiresAt ||
        order.paymentHoldExpiresAt > now || order.bankPaymentAttempt) return false;

      const fingerprints = new Map<string, string>();
      for (const id of productIds) fingerprints.set(id, await this.publication.fingerprint(tx, id));
      let released = 0;
      if (order.status === 'received' && !order.from_Acceptance_orderId &&
        order.from_PaymentOperation_orderId.length === 0) {
        for (const line of lines) {
          if (!line.reservationReference || !line.reservedLocation) continue;
          const result = await tx.stockItem.updateMany({
            where: {
              id: line.stockItemId, productId: line.productId, status: 'reserved',
              reservationReference: line.reservationReference, locationCode: line.reservedLocation,
              from_StockSale_stockItemId: { is: null },
            },
            data: { status: 'available', reservationReference: null, version: { increment: 1 } },
          });
          released += result.count;
        }
      }
      const review = lines.length === 0 || released !== lines.length;
      await tx.order.update({
        where: { id: candidate.id },
        data: {
          paymentHoldExpiredAt: now,
          version: { increment: 1 },
          ...(review ? { attentionCodes: [...new Set([
            ...order.attentionCodes, 'expired_hold_stock_review_required',
          ])] } : {}),
        },
      });
      for (const [id, before] of fingerprints) {
        await this.publication.changed(tx, id, before, `expire-hold:${candidate.id}:${id}`);
      }
      await tx.auditEvent.create({
        data: {
          systemActor: 'checkout-hold-expiry', action: 'checkout.hold_expired',
          subjectType: 'Order', subjectId: candidate.id,
          eventKey: `checkout-hold-expired:${candidate.id}`,
          after: { releasedUnits: released, reviewRequired: review },
        },
      });
      if (review) this.logger.warn('Expired unpaid hold has conflicting stock; staff review required');
      return true;
    });
  }
}

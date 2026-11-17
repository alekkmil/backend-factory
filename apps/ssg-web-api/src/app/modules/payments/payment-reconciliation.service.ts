import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPrivateKey, randomBytes } from 'node:crypto';
import axios from 'axios';
import { PrismaService } from '../../database/prisma.service';
import { TransactionService } from '../../common/transactions/transaction.service';
import { signBoricaInquiry } from './borica-signature';
import { PaymentService } from './payment.service';

@Injectable()
export class PaymentReconciliationService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PaymentReconciliationService.name);
  private timer?: ReturnType<typeof setTimeout>;
  private active?: Promise<boolean>;
  private stopping = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionService,
    private readonly payments: PaymentService,
  ) { }

  onApplicationBootstrap(): void {
    if (this.config.get<number>('PAYMENT_RECONCILE_INTERVAL_SECONDS')) this.schedule(0);
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
      this.logger.error('Payment reconciliation iteration failed; reservations retained');
    } finally {
      this.schedule(worked ? 0 :
        this.config.getOrThrow<number>('PAYMENT_RECONCILE_INTERVAL_SECONDS') * 1000);
    }
  }

  async runOnce(): Promise<boolean> {
    if (this.active) return this.active;
    const work = this.processNext();
    this.active = work;
    try { return await work; } finally { this.active = undefined; }
  }

  private async processNext(): Promise<boolean> {
    const notification = await this.prisma.bankPaymentAttempt.findFirst({
      where: { outcome: 'paid', notificationQueuedAt: null },
      orderBy: { updatedAt: 'asc' }, select: { id: true },
    });
    if (notification) {
      try {
        await this.payments.queueNotification(notification.id);
        return true;
      } catch {
        await this.prisma.bankPaymentAttempt.update({
          where: { id: notification.id }, data: { updatedAt: new Date() },
        });
        this.logger.error('Payment notification preparation failed; continuing bank reconciliation');
      }
    }
    const interval = this.config.getOrThrow<number>('PAYMENT_RECONCILE_INTERVAL_SECONDS') * 1000;
    const timeout = this.config.getOrThrow<number>('BORICA_REQUEST_TIMEOUT_MS');
    const attempt = await this.transactions.serializable(async (tx) => {
      const now = new Date();
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "BankPaymentAttempt"
        WHERE outcome = 'pending' AND "nextReconcileAt" <= ${now}
          AND ("reconcileLeaseUntil" IS NULL OR "reconcileLeaseUntil" <= ${now})
        ORDER BY "nextReconcileAt", id LIMIT 1 FOR UPDATE SKIP LOCKED
      `;
      if (!rows[0]) return null;
      return tx.bankPaymentAttempt.update({
        where: { id: rows[0].id },
        data: {
          reconcileLeaseUntil: new Date(now.getTime() + timeout + interval),
          nextReconcileAt: new Date(now.getTime() + interval)
        },
      });
    });
    if (!attempt) return false;
    try {
      // The bank retains inquiry data for 24 hours. An absent result is never permission to release stock.
      if (Date.now() - attempt.createdAt.getTime() >= 24 * 60 * 60 * 1000) {
        await this.prisma.bankPaymentAttempt.update({
          where: { id: attempt.id },
          data: { manualReviewRequired: true, nextReconcileAt: null },
        });
        this.logger.error('Bank inquiry window exhausted; manual payment review required, stock retained');
        return true;
      }
      if (attempt.gatewayUrl !== this.config.getOrThrow<string>('BORICA_GATEWAY_URL')) {
        throw new Error('Payment gateway environment mismatch');
      }
      const nonce = randomBytes(16).toString('hex').toUpperCase();
      const privateKey = createPrivateKey(Buffer.from(
        this.config.getOrThrow<string>('BORICA_PRIVATE_KEY_BASE64'), 'base64',
      ));
      const form = new URLSearchParams({
        TERMINAL: attempt.terminal, TRTYPE: '90', ORDER: attempt.bankOrder,
        TRAN_TRTYPE: '1', NONCE: nonce,
        P_SIGN: signBoricaInquiry(attempt.terminal, attempt.bankOrder, nonce, privateKey),
      });
      const response = await axios.post<unknown>(attempt.gatewayUrl, form.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout, maxRedirects: 0, maxContentLength: 16 * 1024, responseType: 'json',
      });
      await this.payments.verifyInquiry(attempt.id, nonce, response.data);
      return true;
    } catch {
      this.logger.warn('BORICA status inquiry failed or was unverified; payment unresolved, stock retained');
      return false;
    } finally {
      await this.prisma.bankPaymentAttempt.updateMany({
        where: { id: attempt.id, reconcileLeaseUntil: attempt.reconcileLeaseUntil },
        data: { reconcileLeaseUntil: null },
      });
    }
  }
}

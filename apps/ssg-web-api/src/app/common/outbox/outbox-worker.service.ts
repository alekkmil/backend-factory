import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { requestContext } from '../logging/request-context';
import { TransactionService } from '../transactions/transaction.service';
import {
  OutboxDispatcherService,
  OutboxDispatchError,
} from './outbox-dispatcher.service';
import type { OutboxDispatchResult } from './outbox-dispatcher.service';
import { OutboxService } from './outbox.service';

@Injectable()
export class OutboxWorkerService
  implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxWorkerService.name);
  private readonly leaseOwner = randomUUID();
  private timer?: ReturnType<typeof setTimeout>;
  private active?: Promise<boolean>;
  private stopping = false;

  constructor(
    private readonly config: ConfigService,
    private readonly transactions: TransactionService,
    private readonly outbox: OutboxService,
    private readonly dispatcher: OutboxDispatcherService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.get<boolean>('OUTBOX_WORKER_ENABLED')) {
      this.schedule(0);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) {
      clearTimeout(this.timer);
    }
    await this.active;
  }

  async runOnce(): Promise<boolean> {
    if (this.stopping) {
      throw new Error('Outbox worker is shutting down');
    }
    if (this.active) {
      return this.active;
    }
    const work = this.processNext();
    this.active = work;
    try {
      return await work;
    } finally {
      if (this.active === work) {
        this.active = undefined;
      }
    }
  }

  private schedule(delay: number): void {
    if (this.stopping) {
      return;
    }
    this.timer = setTimeout(() => {
      void this.tick();
    }, delay);
    this.timer.unref();
  }

  private async tick(): Promise<void> {
    try {
      await this.runOnce();
    } catch {
      this.logger.error('Outbox worker iteration failed; durable lease remains recoverable');
    } finally {
      this.schedule(this.config.getOrThrow<number>('OUTBOX_POLL_INTERVAL_MS'));
    }
  }

  private async processNext(): Promise<boolean> {
    const message = await this.transactions.serializable((transaction) =>
      this.outbox.claimNext(
        transaction,
        this.leaseOwner,
        new Date(),
        this.config.getOrThrow<number>('OUTBOX_LEASE_MS'),
        this.config.getOrThrow<number>('OUTBOX_MAX_ATTEMPTS'),
      ),
    );
    if (!message) {
      return false;
    }
    return requestContext.run({ requestId: `outbox:${message.id}` }, async () => {
      let result: OutboxDispatchResult;
      try {
        result = await this.dispatcher.dispatch(message);
      } catch (error) {
        const safeError = error instanceof OutboxDispatchError
          ? error.safeCode
          : 'JOB_EXECUTION_FAILED';
        const finishedAt = new Date();
        const delay = Math.min(
          this.config.getOrThrow<number>('OUTBOX_RETRY_MAX_MS'),
          this.config.getOrThrow<number>('OUTBOX_RETRY_BASE_MS') *
            2 ** Math.min(message.attemptNumber - 1, 20),
        );
        await this.transactions.serializable((transaction) =>
          this.outbox.finishClaim(transaction, {
            messageId: message.id,
            leaseOwner: this.leaseOwner,
            attemptNumber: message.attemptNumber,
            outcome: 'failed',
            safeError,
            finishedAt,
            nextAttemptAt: new Date(finishedAt.getTime() + delay),
          }),
        );
        this.logger.warn(
          `Outbox job ${message.kind} failed (${safeError}); attempt ${message.attemptNumber}`,
        );
        if (
          message.attemptNumber >=
          this.config.getOrThrow<number>('OUTBOX_MAX_ATTEMPTS')
        ) {
          this.logger.error('Outbox retry limit reached; operational attention required');
        }
        return true;
      }
      await this.transactions.serializable((transaction) =>
        this.outbox.finishClaim(transaction, {
          messageId: message.id,
          leaseOwner: this.leaseOwner,
          attemptNumber: message.attemptNumber,
          outcome: result.outcome,
          providerMessageId:
            result.outcome === 'sent' ? result.providerMessageId : undefined,
          safeError: result.outcome === 'suppressed' ? result.safeError : undefined,
          finishedAt: new Date(),
        }),
      );
      this.logger.log(`Outbox job ${message.kind} ${result.outcome}`);
      return true;
    });
  }
}

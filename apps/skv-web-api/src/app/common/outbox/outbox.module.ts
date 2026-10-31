import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { TransactionModule } from '../transactions/transaction.module';
import { LocalMailCaptureService } from './local-mail-capture.service';
import { OrderNotificationService } from './order-notification.service';
import { OutboxDispatcherService } from './outbox-dispatcher.service';
import { OutboxService } from './outbox.service';
import { OutboxWorkerService } from './outbox-worker.service';

@Module({
  imports: [PrismaModule, TransactionModule],
  providers: [
    OutboxService,
    LocalMailCaptureService,
    OrderNotificationService,
    OutboxDispatcherService,
    OutboxWorkerService,
  ],
  exports: [OutboxService, OutboxDispatcherService, LocalMailCaptureService],
})
export class OutboxModule {}

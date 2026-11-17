import { Module } from '@nestjs/common';
import { BoricaController } from './borica.controller';
import { PrismaModule } from '../../database/prisma.module';
import { TransactionModule } from '../../common/transactions/transaction.module';
import { OutboxModule } from '../../common/outbox/outbox.module';
import { CheckoutModule } from '../checkout/checkout.module';
import { GuestSessionModule } from '../guest-session/guest-session.module';
import { OrderPaymentsController } from './order-payments.controller';
import { PaymentService } from './payment.service';
import { PaymentReconciliationService } from './payment-reconciliation.service';

@Module({
  imports: [PrismaModule, TransactionModule, OutboxModule, CheckoutModule, GuestSessionModule],
  controllers: [BoricaController, OrderPaymentsController],
  providers: [PaymentService, PaymentReconciliationService],
})
export class PaymentsModule {}

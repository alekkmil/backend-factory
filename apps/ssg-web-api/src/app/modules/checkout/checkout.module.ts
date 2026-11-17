import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { CommercialModule } from '../../common/commercial/commercial.module';
import { TransactionModule } from '../../common/transactions/transaction.module';
import { OutboxModule } from '../../common/outbox/outbox.module';
import { GuestSessionModule } from '../guest-session/guest-session.module';
import { ProductReadModule } from '../products/product-read.module';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';
import { CheckoutValidationService } from './checkout-validation.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrderAccessController } from './order-access.controller';
import { OrderAccessService } from './order-access.service';
import { StockFactModule } from '../../common/stock-facts/stock-fact.module';

@Module({
  imports: [
    PrismaModule,
    CommercialModule,
    TransactionModule,
    OutboxModule,
    GuestSessionModule,
    ProductReadModule,
    StockFactModule,
  ],
  controllers: [CheckoutController, OrdersController, OrderAccessController],
  providers: [CheckoutService, CheckoutValidationService, OrdersService, OrderAccessService],
  exports: [CheckoutValidationService, OrderAccessService],
})
export class CheckoutModule {}

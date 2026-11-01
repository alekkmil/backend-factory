import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { OutboxModule } from '../outbox/outbox.module';
import { TransactionModule } from '../transactions/transaction.module';
import { StockFactService } from './stock-fact.service';

@Module({
  imports: [PrismaModule, OutboxModule, TransactionModule],
  providers: [StockFactService],
  exports: [StockFactService],
})
export class StockFactModule {}

import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { OutboxModule } from '../outbox/outbox.module';
import { TransactionModule } from '../transactions/transaction.module';
import { StockFactService } from './stock-fact.service';
import { STOCK_FACT_HOOK } from './stock-fact.service';
import { StockImpactService } from './stock-impact.service';
import { StockPublicationService } from './stock-publication.service';
import { CommercialModule } from '../commercial/commercial.module';

@Module({
  imports: [PrismaModule, OutboxModule, TransactionModule, CommercialModule],
  providers: [
    StockFactService,
    StockPublicationService,
    StockImpactService,
    { provide: STOCK_FACT_HOOK, useExisting: StockImpactService },
  ],
  exports: [StockFactService, StockPublicationService],
})
export class StockFactModule {}

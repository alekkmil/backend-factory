import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { StaffTokenGuard } from '../../common/guards/staff-token.guard';
import { StockAdapterGuard } from '../../common/guards/stock-adapter.guard';
import { StockFactModule } from '../../common/stock-facts/stock-fact.module';
import { TransactionModule } from '../../common/transactions/transaction.module';
import {
  InventoryController,
  StockAdapterController,
} from './inventory.controller';
import { InventoryService } from './inventory.service';

@Module({})
export class InventoryModule {
  static register(): DynamicModule {
    return {
      module: InventoryModule,
      imports: [PrismaModule, TransactionModule, StockFactModule],
      controllers: [
        InventoryController,
        ...(process.env.NODE_ENV === 'production'
          ? []
          : [StockAdapterController]),
      ],
      providers: [InventoryService, StaffTokenGuard, StockAdapterGuard],
    };
  }
}

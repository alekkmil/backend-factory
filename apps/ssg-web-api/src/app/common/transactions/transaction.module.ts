import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { TransactionService } from './transaction.service';

@Module({
  imports: [PrismaModule],
  providers: [TransactionService],
  exports: [TransactionService],
})
export class TransactionModule {}

import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { OutboxModule } from '../../common/outbox/outbox.module';
import { TransactionModule } from '../../common/transactions/transaction.module';
import { GuestSessionModule } from '../guest-session/guest-session.module';
import { EnquiryController } from './enquiry.controller';
import { EnquiryService } from './enquiry.service';

@Module({
  imports: [PrismaModule, TransactionModule, OutboxModule, GuestSessionModule],
  controllers: [EnquiryController],
  providers: [EnquiryService],
})
export class EnquiryModule {}

import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { OutboxModule } from '../../common/outbox/outbox.module';
import { TransactionModule } from '../../common/transactions/transaction.module';
import { GuestSessionModule } from '../guest-session/guest-session.module';
import { EnquiryController } from './enquiry.controller';
import { EnquiryService } from './enquiry.service';
import { EnquiryAdminController } from './enquiry-admin.controller';
import { StaffTokenGuard } from '../../common/guards/staff-token.guard';

@Module({
  imports: [PrismaModule, TransactionModule, OutboxModule, GuestSessionModule],
  controllers: [EnquiryController, EnquiryAdminController],
  providers: [EnquiryService, StaffTokenGuard],
})
export class EnquiryModule {}

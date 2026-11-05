import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { StaffTokenGuard } from '../../common/guards/staff-token.guard';
import { CatalogueAdminController } from './catalogue-admin.controller';
import { CatalogueAdminService } from './catalogue-admin.service';
import { CataloguePublishService } from './catalogue-publish.service';
import { TransactionModule } from '../../common/transactions/transaction.module';
import { OutboxModule } from '../../common/outbox/outbox.module';
import { ProductReadModule } from '../products/product-read.module';

@Module({
  imports: [PrismaModule, TransactionModule, OutboxModule, ProductReadModule],
  controllers: [CatalogueAdminController],
  providers: [CatalogueAdminService, CataloguePublishService, StaffTokenGuard],
})
export class CatalogueAdminModule {}

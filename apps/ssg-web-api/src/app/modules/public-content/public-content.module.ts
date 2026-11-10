import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { ProductReadModule } from '../products/product-read.module';
import { PublicContentController } from './public-content.controller';
import { PublicContentService } from './public-content.service';
import { WebsiteAdminController } from './website-admin.controller';
import { WebsiteAdminService } from './website-admin.service';
import { StaffTokenGuard } from '../../common/guards/staff-token.guard';
import { TransactionModule } from '../../common/transactions/transaction.module';
import { OutboxModule } from '../../common/outbox/outbox.module';
import { MediaStorageService } from '../../common/media-storage.service';
import { WebsiteMediaService } from './website-media.service';

@Module({
  imports: [PrismaModule, ProductReadModule, TransactionModule, OutboxModule],
  controllers: [PublicContentController, WebsiteAdminController],
  providers: [
    PublicContentService,
    WebsiteAdminService,
    WebsiteMediaService,
    MediaStorageService,
    StaffTokenGuard,
  ],
  exports: [PublicContentService],
})
export class PublicContentModule {}

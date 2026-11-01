import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { CommercialModule } from '../../common/commercial/commercial.module';
import { ProductBatchController } from './product-batch.controller';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { ProductDetailController } from './product-detail.controller';
import { ProductReadService } from './product-read.service';

@Module({
  imports: [PrismaModule, CommercialModule],
  controllers: [ProductDetailController, ProductBatchController, CatalogController],
  providers: [ProductReadService, CatalogService],
  exports: [ProductReadService],
})
export class ProductReadModule {}

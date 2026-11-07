import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { ProductReadModule } from '../products/product-read.module';
import { PublicContentController } from './public-content.controller';
import { PublicContentService } from './public-content.service';

@Module({
  imports: [PrismaModule, ProductReadModule],
  controllers: [PublicContentController],
  providers: [PublicContentService],
  exports: [PublicContentService],
})
export class PublicContentModule {}

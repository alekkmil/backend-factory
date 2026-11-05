import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { ProductReadModule } from '../products/product-read.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  imports: [PrismaModule, ProductReadModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}

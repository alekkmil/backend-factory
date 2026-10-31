import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { ProductResolveController } from '../../modules/products/product-resolve.controller';
import { PublicRouteService } from './public-route.service';

@Module({
  imports: [PrismaModule],
  controllers: [ProductResolveController],
  providers: [PublicRouteService],
  exports: [PublicRouteService],
})
export class PublicationModule {}

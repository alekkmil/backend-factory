import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PublicRouteService } from '../../common/publication/public-route.service';
import { ProductResolveQueryDto } from './product-resolve.dto';

@Controller('products')
export class ProductResolveController {
  constructor(private readonly routes: PublicRouteService) {}

  @Get('resolve')
  async resolve(
    @Query() query: ProductResolveQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.routes.resolve(query.path, query.locale);
    if (result.state === 'redirect') {
      response.status(301);
      response.setHeader('Location', result.location);
    }
    return result;
  }
}

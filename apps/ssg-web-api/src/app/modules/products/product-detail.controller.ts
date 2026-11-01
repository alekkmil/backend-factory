import { Controller, Get, Param, Query } from '@nestjs/common';
import { ProductPathDto, ProductQueryDto } from './product-detail.dto';
import { fulfilmentContext } from './fulfilment-context';
import { ProductReadService } from './product-read.service';

@Controller('products')
export class ProductDetailController {
  constructor(private readonly products: ProductReadService) {}

  @Get(':id')
  detail(
    @Param() path: ProductPathDto,
    @Query() query: ProductQueryDto,
  ) {
    return this.products.detail(
      path.id,
      query.locale,
      fulfilmentContext(query),
    );
  }
}

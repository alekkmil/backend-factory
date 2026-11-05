import { Body, Controller, Header, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ProductBatchDto } from './product-batch.dto';
import { ProductReadService } from './product-read.service';

@Controller('products')
export class ProductBatchController {
  constructor(private readonly products: ProductReadService) {}

  @Post('batch')
  @Header('Cache-Control', 'no-store')
  @HttpCode(HttpStatus.OK)
  batch(@Body() request: ProductBatchDto) {
    return this.products.batch(request.ids, request.locale);
  }
}

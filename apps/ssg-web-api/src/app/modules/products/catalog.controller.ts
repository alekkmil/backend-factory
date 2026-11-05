import { Controller, Get, Header, Query } from '@nestjs/common';
import { CatalogQueryDto } from './catalog.dto';
import { CatalogService } from './catalog.service';

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Query() query: CatalogQueryDto) {
    return this.catalog.list(query);
  }
}

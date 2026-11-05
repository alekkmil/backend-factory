import { Controller, Get, Header, Query } from '@nestjs/common';
import { SearchQueryDto } from './search.dto';
import { SearchService } from './search.service';

@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @Header('X-Robots-Tag', 'noindex')
  @Header('Cache-Control', 'no-store')
  list(@Query() query: SearchQueryDto) {
    return this.search.search(query);
  }
}

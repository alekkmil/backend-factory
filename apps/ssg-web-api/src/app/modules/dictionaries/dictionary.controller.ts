import { Controller, Get, Query } from '@nestjs/common';
import { DictionaryQueryDto } from './dictionary.dto';
import { DictionaryService } from './dictionary.service';

@Controller('dictionaries')
export class DictionaryController {
  constructor(private readonly dictionaries: DictionaryService) {}

  @Get()
  list(
    @Query() query: DictionaryQueryDto,
  ): ReturnType<DictionaryService['list']> {
    return this.dictionaries.list(query.locale, query.groups);
  }
}

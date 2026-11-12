import {
  Controller,
  Get,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import {
  ContentDetailPathDto,
  ContentListQueryDto,
  LocaleQueryDto,
  PolicyPathDto,
  PolicyQueryDto,
  PublicationsQueryDto,
  SeoUrlsQueryDto,
  StorePathDto,
} from './public-content.dto';
import { PublicContentService } from './public-content.service';

@Controller()
export class PublicContentController {
  constructor(
    private readonly publicContent: PublicContentService,
    private readonly config: ConfigService,
  ) {}

  @Get('content')
  listContent(@Query() query: ContentListQueryDto) {
    return this.publicContent.listContent(query);
  }

  @Get('publications')
  publications(@Query() query: PublicationsQueryDto) {
    return this.publicContent.publications(query);
  }

  @Get('publications/landing')
  publicationLanding(@Query() query: LocaleQueryDto) {
    return this.publicContent.publicationLanding(query.locale);
  }

  @Get('content/:id')
  contentDetail(
    @Param() path: ContentDetailPathDto,
    @Query() query: LocaleQueryDto,
  ) {
    return this.publicContent.contentDetail(path.id, query.locale);
  }

  @Get('home')
  home(@Query() query: LocaleQueryDto) {
    return this.publicContent.home(query.locale);
  }

  @Get('stores')
  stores(@Query() query: LocaleQueryDto) {
    return this.publicContent.stores(query.locale);
  }

  @Get('stores/:code')
  storeDetail(
    @Param() path: StorePathDto,
    @Query() query: LocaleQueryDto,
  ) {
    return this.publicContent.storeDetail(path.code, query.locale);
  }

  @Get('site-contacts')
  siteContacts(@Query() query: LocaleQueryDto) {
    return this.publicContent.siteContacts(query.locale);
  }

  @Get('policies/:kind')
  policy(
    @Param() path: PolicyPathDto,
    @Query() query: PolicyQueryDto,
  ) {
    return this.publicContent.policy(path.kind, query);
  }

  @Get('cookie-config')
  cookieConfig(@Query() query: LocaleQueryDto) {
    return this.publicContent.cookieConfig(query.locale);
  }

  @Get('seo/urls')
  seoUrls(
    @Query() query: SeoUrlsQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (this.config.get<string>('NODE_ENV') !== 'production') {
      response.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    }
    return this.publicContent.seoUrls(query);
  }
}

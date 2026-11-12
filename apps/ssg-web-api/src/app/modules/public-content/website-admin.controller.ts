import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { StaffTokenGuard } from '../../common/guards/staff-token.guard';
import type { StaffAuthenticatedRequest } from '../../common/guards/staff-token.guard';
import { CatalogueEmptyQueryPipe } from '../catalogue-admin/catalogue-empty-query.pipe';
import { CatalogueDetailQueryDto } from '../catalogue-admin/catalogue-admin.dto';
import {
  WebsiteContentDto,
  WebsiteKeyDto,
  WebsitePolicyDto,
  WebsitePolicyPathDto,
  WebsiteSettingsDto,
  WebsiteStoreDto,
  WebsiteStorePathDto,
} from './website-admin.dto';
import { WebsiteAdminService } from './website-admin.service';
import { WebsiteMediaMultipartDto } from './website-media.dto';
import { WebsiteMediaService } from './website-media.service';

@Controller('admin/website')
@UseGuards(StaffTokenGuard)
export class WebsiteAdminController {
  constructor(
    private readonly website: WebsiteAdminService,
    private readonly media: WebsiteMediaService,
  ) {}

  @Get('publications/selection-status')
  publicationSelectionStatus(
    @Query(CatalogueEmptyQueryPipe) query: CatalogueDetailQueryDto,
  ) {
    void query;
    return this.website.publicationSelectionStatus();
  }

  @Post('media')
  @HttpCode(200)
  @UseInterceptors(
    AnyFilesInterceptor({
      limits: {
        files: 5,
        fileSize: 10 * 1024 * 1024,
        fields: 1,
        fieldSize: 65536,
        parts: 6,
      },
    }),
  )
  uploadMedia(
    @Body() input: WebsiteMediaMultipartDto,
    @UploadedFiles() files: Express.Multer.File[],
    @Req() request: StaffAuthenticatedRequest,
    @Query(CatalogueEmptyQueryPipe) query: CatalogueDetailQueryDto,
  ) {
    void query;
    const actorId = request.staffAuth?.principalId;
    if (!actorId) throw new UnauthorizedException();
    return this.media.upload(actorId, input.metadata, files ?? []);
  }

  @Get('content/:key')
  content(
    @Param() path: WebsiteKeyDto,
    @Query(CatalogueEmptyQueryPipe) query: CatalogueDetailQueryDto,
  ) {
    void query;
    return this.website.content(path.key);
  }

  @Put('content/:key')
  @HttpCode(200)
  saveContent(
    @Param() path: WebsiteKeyDto,
    @Body() body: WebsiteContentDto,
    @Req() request: StaffAuthenticatedRequest,
    @Query(CatalogueEmptyQueryPipe) query: CatalogueDetailQueryDto,
  ) {
    void query;
    return this.website.saveContent(this.actor(request), path.key, body);
  }

  @Get('stores/:code')
  store(
    @Param() path: WebsiteStorePathDto,
    @Query(CatalogueEmptyQueryPipe) query: CatalogueDetailQueryDto,
  ) {
    void query;
    return this.website.store(path.code);
  }

  @Put('stores/:code')
  @HttpCode(200)
  saveStore(
    @Param() path: WebsiteStorePathDto,
    @Body() body: WebsiteStoreDto,
    @Req() request: StaffAuthenticatedRequest,
    @Query(CatalogueEmptyQueryPipe) query: CatalogueDetailQueryDto,
  ) {
    void query;
    return this.website.saveStore(this.actor(request), path.code, body);
  }

  @Get('policies/:kind/:version')
  policy(
    @Param() path: WebsitePolicyPathDto,
    @Query(CatalogueEmptyQueryPipe) query: CatalogueDetailQueryDto,
  ) {
    void query;
    return this.website.policy(path.kind, path.version);
  }

  @Put('policies/:kind/:version')
  @HttpCode(200)
  savePolicy(
    @Param() path: WebsitePolicyPathDto,
    @Body() body: WebsitePolicyDto,
    @Req() request: StaffAuthenticatedRequest,
    @Query(CatalogueEmptyQueryPipe) query: CatalogueDetailQueryDto,
  ) {
    void query;
    return this.website.savePolicy(
      this.actor(request),
      path.kind,
      path.version,
      body,
    );
  }

  @Get('settings')
  settings(@Query(CatalogueEmptyQueryPipe) query: CatalogueDetailQueryDto) {
    void query;
    return this.website.settings();
  }

  @Patch('settings')
  saveSettings(
    @Body() body: WebsiteSettingsDto,
    @Req() request: StaffAuthenticatedRequest,
    @Query(CatalogueEmptyQueryPipe) query: CatalogueDetailQueryDto,
  ) {
    void query;
    return this.website.saveSettings(this.actor(request), body);
  }

  private actor(request: StaffAuthenticatedRequest): string {
    if (!request.staffAuth) throw new UnauthorizedException();
    return request.staffAuth.principalId;
  }
}

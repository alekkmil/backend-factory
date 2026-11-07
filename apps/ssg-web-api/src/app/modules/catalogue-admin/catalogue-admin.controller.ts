import {
  Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req,
  Res, UnauthorizedException, UploadedFiles, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { CatalogueMediaMultipartDto } from './catalogue-media.dto';
import { CatalogueMediaService } from './catalogue-media.service';
import { StaffTokenGuard } from '../../common/guards/staff-token.guard';
import type { StaffAuthenticatedRequest } from '../../common/guards/staff-token.guard';
import {
  CatalogueDetailQueryDto, CatalogueListQueryDto, CataloguePublishDto,
  CatalogueSaveDraftDto, CatalogueVisibilityDto,
} from './catalogue-admin.dto';
import { CataloguePublishService } from './catalogue-publish.service';
import type { AdminCatalogueList, AdminProduct } from './catalogue-admin.dto';
import { CatalogueAdminService } from './catalogue-admin.service';
import { CatalogueDraftService } from './catalogue-draft.service';
import { CatalogueVisibilityService } from './catalogue-visibility.service';
import { CatalogueMediaReleaseDto } from './catalogue-media.dto';
import { CatalogueMediaRegistrationService } from './catalogue-media-registration.service';
import { CatalogueEmptyQueryPipe } from './catalogue-empty-query.pipe';
import type { Response } from 'express';

@Controller('admin/catalogue')
@UseGuards(StaffTokenGuard)
export class CatalogueAdminController {
  constructor(
    private readonly catalogue: CatalogueAdminService,
    private readonly publication: CataloguePublishService,
    private readonly media: CatalogueMediaService,
    private readonly drafts: CatalogueDraftService,
    private readonly visibility: CatalogueVisibilityService,
    private readonly mediaRegistration: CatalogueMediaRegistrationService,
  ) {}

  @Post(':id/media')
  @HttpCode(200)
  @UseInterceptors(AnyFilesInterceptor({
    limits: { files: 5, fileSize: 10 * 1024 * 1024, fields: 1, fieldSize: 65536, parts: 6 },
  }))
  attachMedia(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: CatalogueMediaMultipartDto,
    @UploadedFiles() files: Express.Multer.File[],
    @Query(CatalogueEmptyQueryPipe) query: CatalogueDetailQueryDto,
    @Req() request: StaffAuthenticatedRequest,
  ) {
    void query;
    if (!request.staffAuth?.principalId) throw new UnauthorizedException();
    return this.media.attach(request.staffAuth.principalId, id, input.metadata, files ?? []);
  }

  @Post(':id/publish')
  @HttpCode(200)
  publish(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: CataloguePublishDto,
    @Query(CatalogueEmptyQueryPipe) query: CatalogueDetailQueryDto,
    @Req() request: StaffAuthenticatedRequest,
  ) {
    void query;
    const actorId = request.staffAuth?.principalId;
    if (!actorId) throw new UnauthorizedException();
    return this.publication.publish(actorId, id, input);
  }

  @Patch(':id/draft')
  @HttpCode(200)
  saveDraft(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: CatalogueSaveDraftDto,
    @Req() request: StaffAuthenticatedRequest,
    @Query(CatalogueEmptyQueryPipe) query: CatalogueDetailQueryDto,
  ): Promise<AdminProduct> {
    void query;
    const actorId = request.staffAuth?.principalId;
    if (!actorId) throw new UnauthorizedException();
    return this.drafts.save(actorId, id, input);
  }

  @Post(':id/media-releases')
  async registerMediaRelease(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: CatalogueMediaReleaseDto,
    @Req() request: StaffAuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
    @Query(CatalogueEmptyQueryPipe) query: CatalogueDetailQueryDto,
  ) {
    void query;
    const actorId = request.staffAuth?.principalId;
    if (!actorId) throw new UnauthorizedException();
    const outcome = await this.mediaRegistration.register(actorId, id, input);
    response.status(outcome.statusCode);
    return outcome.result;
  }

  @Post(':id/visibility')
  @HttpCode(200)
  setVisibility(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: CatalogueVisibilityDto,
    @Req() request: StaffAuthenticatedRequest,
    @Query(CatalogueEmptyQueryPipe) query: CatalogueDetailQueryDto,
  ): Promise<AdminProduct> {
    void query;
    const actorId = request.staffAuth?.principalId;
    if (!actorId) throw new UnauthorizedException();
    return this.visibility.setVisibility(actorId, id, input);
  }

  @Get()
  list(@Query() query: CatalogueListQueryDto): Promise<AdminCatalogueList> {
    return this.catalogue.list(query);
  }

  @Get(':id')
  detail(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(CatalogueEmptyQueryPipe) query: CatalogueDetailQueryDto,
  ): Promise<AdminProduct> {
    void query;
    return this.catalogue.detail(id);
  }
}

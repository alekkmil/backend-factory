import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UnauthorizedException, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { CatalogueMediaMultipartDto } from './catalogue-media.dto';
import { CatalogueMediaService } from './catalogue-media.service';
import { StaffTokenGuard } from '../../common/guards/staff-token.guard';
import type { StaffAuthenticatedRequest } from '../../common/guards/staff-token.guard';
import { CatalogueDetailQueryDto, CatalogueListQueryDto, CataloguePublishDto } from './catalogue-admin.dto';
import { CataloguePublishService } from './catalogue-publish.service';
import type { AdminCatalogueList, AdminProduct } from './catalogue-admin.dto';
import { CatalogueAdminService } from './catalogue-admin.service';

@Controller('admin/catalogue')
@UseGuards(StaffTokenGuard)
export class CatalogueAdminController {
  constructor(
    private readonly catalogue: CatalogueAdminService,
    private readonly publication: CataloguePublishService,
    private readonly media: CatalogueMediaService,
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
    @Query() query: CatalogueDetailQueryDto,
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
    @Query() query: CatalogueDetailQueryDto,
    @Req() request: StaffAuthenticatedRequest,
  ) {
    void query;
    const actorId = request.staffAuth?.principalId;
    if (!actorId) throw new UnauthorizedException();
    return this.publication.publish(actorId, id, input);
  }

  @Get()
  list(@Query() query: CatalogueListQueryDto): Promise<AdminCatalogueList> {
    return this.catalogue.list(query);
  }

  @Get(':id')
  detail(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: CatalogueDetailQueryDto,
  ): Promise<AdminProduct> {
    void query;
    return this.catalogue.detail(id);
  }
}

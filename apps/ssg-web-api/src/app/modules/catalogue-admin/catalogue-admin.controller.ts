import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
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
  ) {}

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

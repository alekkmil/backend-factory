import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { RequireStaffPermission, StaffPermissionGuard } from '../../common/guards/staff-permission.guard';
import { CatalogueDetailQueryDto, CatalogueListQueryDto } from './catalogue-admin.dto';
import type { AdminCatalogueList, AdminProduct } from './catalogue-admin.dto';
import { CatalogueAdminService } from './catalogue-admin.service';

@Controller('admin/catalogue')
@UseGuards(StaffPermissionGuard)
@RequireStaffPermission('catalogue_read')
export class CatalogueAdminController {
  constructor(private readonly catalogue: CatalogueAdminService) {}

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

import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { StaffTokenGuard } from '../../common/guards/staff-token.guard';
import { CatalogueEmptyQueryPipe } from '../catalogue-admin/catalogue-empty-query.pipe';
import { CatalogueDetailQueryDto } from '../catalogue-admin/catalogue-admin.dto';
import { AdminEnquiryQueryDto } from './enquiry.dto';
import { EnquiryService } from './enquiry.service';

@Controller('admin/enquiries')
@UseGuards(StaffTokenGuard)
export class EnquiryAdminController {
  constructor(private readonly enquiries: EnquiryService) {}

  @Get()
  list(@Query() query: AdminEnquiryQueryDto) {
    return this.enquiries.adminList(query);
  }

  @Get(':id')
  detail(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(CatalogueEmptyQueryPipe) query: CatalogueDetailQueryDto,
  ) {
    void query;
    return this.enquiries.adminDetail(id);
  }
}

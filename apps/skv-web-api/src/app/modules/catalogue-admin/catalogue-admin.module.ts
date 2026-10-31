import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { StaffPermissionGuard } from '../../common/guards/staff-permission.guard';
import { CatalogueAdminController } from './catalogue-admin.controller';
import { CatalogueAdminService } from './catalogue-admin.service';

@Module({
  imports: [PrismaModule],
  controllers: [CatalogueAdminController],
  providers: [CatalogueAdminService, StaffPermissionGuard],
})
export class CatalogueAdminModule {}

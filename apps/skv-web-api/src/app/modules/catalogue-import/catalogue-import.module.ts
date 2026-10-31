import { Module } from "@nestjs/common";
import { PrismaModule } from "../../database/prisma.module";
import { StaffPermissionGuard } from "../../common/guards/staff-permission.guard";
import { CatalogueImportController } from "./catalogue-import.controller";
import { CatalogueImportCommitService } from "./catalogue-import-commit.service";
import { CatalogueImportService } from "./catalogue-import.service";

@Module({
  imports: [PrismaModule],
  controllers: [CatalogueImportController],
  providers: [
    CatalogueImportService,
    CatalogueImportCommitService,
    StaffPermissionGuard,
  ],
})
export class CatalogueImportModule {}

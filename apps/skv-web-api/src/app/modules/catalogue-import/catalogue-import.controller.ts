import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import type { StaffAuthenticatedRequest } from "../../common/guards/staff-permission.guard";
import {
  RequireStaffPermission,
  StaffPermissionGuard,
} from "../../common/guards/staff-permission.guard";
import {
  ImportCommitRequestDto,
  ImportPreflightRequestDto,
} from "./import.dto";
import { CatalogueImportService } from "./catalogue-import.service";
import type { ImportResult } from "./catalogue-import.service";
import { CatalogueImportCommitService } from "./catalogue-import-commit.service";

@Controller("admin/catalogue/imports")
@UseGuards(StaffPermissionGuard)
@RequireStaffPermission("catalogue_edit")
export class CatalogueImportController {
  constructor(
    private readonly imports: CatalogueImportService,
    private readonly commits: CatalogueImportCommitService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async preflight(
    @Body() request: ImportPreflightRequestDto,
    @Req() httpRequest: StaffAuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ImportResult> {
    const actorId = httpRequest.staffAuth?.principalId;
    if (!actorId) {
      throw new UnauthorizedException({
        code: "ACCESS_UNAVAILABLE",
        message_key: "errors.access_unavailable",
      });
    }
    const outcome = await this.imports.preflight(actorId, request);
    response.status(outcome.statusCode);
    return outcome.result;
  }

  @Post(":id/commit")
  @HttpCode(HttpStatus.OK)
  async commit(
    @Param("id", ParseUUIDPipe) batchId: string,
    @Body() request: ImportCommitRequestDto,
    @Req() httpRequest: StaffAuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ImportResult> {
    const actorId = httpRequest.staffAuth?.principalId;
    if (!actorId) {
      throw new UnauthorizedException({
        code: "ACCESS_UNAVAILABLE",
        message_key: "errors.access_unavailable",
      });
    }
    const outcome = await this.commits.commit(actorId, batchId, request);
    response.status(outcome.statusCode);
    return outcome.result;
  }
}

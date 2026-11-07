import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import type { StaffAuthenticatedRequest } from "../../common/guards/staff-token.guard";
import {
  StaffTokenGuard,
} from "../../common/guards/staff-token.guard";
import {
  ImportCommitRequestDto,
  ImportPreflightRequestDto,
} from "./import.dto";
import { CatalogueImportService } from "./catalogue-import.service";
import type { ImportResult } from "./catalogue-import.service";
import { CatalogueImportCommitService } from "./catalogue-import-commit.service";
import { CatalogueEmptyQueryPipe } from "../catalogue-admin/catalogue-empty-query.pipe";
import { CatalogueDetailQueryDto } from "../catalogue-admin/catalogue-admin.dto";

@Controller("admin/catalogue/imports")
@UseGuards(StaffTokenGuard)
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

  @Get(":id")
  async read(
    @Param("id", ParseUUIDPipe) batchId: string,
    @Req() httpRequest: StaffAuthenticatedRequest,
    @Query(CatalogueEmptyQueryPipe) query: CatalogueDetailQueryDto,
  ): Promise<ImportResult> {
    void query;
    const actorId = httpRequest.staffAuth?.principalId;
    if (!actorId) {
      throw new UnauthorizedException({
        code: "ACCESS_UNAVAILABLE",
        message_key: "errors.access_unavailable",
      });
    }
    return this.imports.read(actorId, batchId);
  }
}

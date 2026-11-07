import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { StaffTokenGuard } from '../../common/guards/staff-token.guard';
import type { StaffAuthenticatedRequest } from '../../common/guards/staff-token.guard';
import { StockAdapterGuard } from '../../common/guards/stock-adapter.guard';
import type { StockAdapterRequest } from '../../common/guards/stock-adapter.guard';
import { StockFactService } from '../../common/stock-facts/stock-fact.service';
import {
  EmptyInventoryQueryDto,
  PhysicalAbsenceDto,
  PromoteVerifiedUnitDto,
  StoreSaleDto,
  VerifiedUnitDetailsDto,
} from './inventory.dto';
import { InventoryService } from './inventory.service';

@Controller('admin')
@UseGuards(StaffTokenGuard)
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Post('catalogue/staged-units/promote')
  async promote(
    @Body() body: PromoteVerifiedUnitDto,
    @Query() _query: EmptyInventoryQueryDto,
    @Req() request: StaffAuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!request.staffAuth) throw new UnauthorizedException();
    const result = await this.inventory.promote(
      request.staffAuth.principalId,
      body,
    );
    response.status(result.replayed ? 200 : result.status_code);
    return { ...result.body, replayed: result.replayed };
  }

  @Patch('stock/:id/details')
  async details(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: VerifiedUnitDetailsDto,
    @Query() _query: EmptyInventoryQueryDto,
    @Req() request: StaffAuthenticatedRequest,
  ) {
    if (!request.staffAuth) throw new UnauthorizedException();
    return (
      await this.inventory.details(request.staffAuth.principalId, id, body)
    ).body;
  }
}

@Controller('internal/stock')
@UseGuards(StockAdapterGuard)
export class StockAdapterController {
  constructor(private readonly facts: StockFactService) {}

  @Post(':id/physical-absence')
  @HttpCode(200)
  absence(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: PhysicalAbsenceDto,
    @Query() _query: EmptyInventoryQueryDto,
    @Req() request: StockAdapterRequest,
  ) {
    if (!request.stockActorId) throw new UnauthorizedException();
    return this.facts.recordPhysicalAbsence({
      stockItemId: id,
      actorId: request.stockActorId,
      requestId: body.request_id,
      expectedVersion: body.expected_version,
      sourceEventId: body.source_event_id,
      evidenceRef: body.evidence_ref,
      reason: body.reason,
      note: body.note,
    });
  }

  @Post(':id/store-sale')
  @HttpCode(200)
  sale(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: StoreSaleDto,
    @Query() _query: EmptyInventoryQueryDto,
    @Req() request: StockAdapterRequest,
  ) {
    if (!request.stockActorId) throw new UnauthorizedException();
    return this.facts.recordStoreSale({
      stockItemId: id,
      actorId: request.stockActorId,
      requestId: body.request_id,
      expectedVersion: body.expected_version,
      sourceEventId: body.source_event_id,
      storeCode: body.store_code,
      documentRef: body.document_ref,
      soldAt: body.sold_at,
      amount: body.amount,
      currency: body.currency,
      sellerProvenance: body.seller_provenance,
    });
  }
}

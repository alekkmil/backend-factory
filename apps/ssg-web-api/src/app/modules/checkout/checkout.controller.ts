import { Body, Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { GuestSessionService } from '../guest-session/guest-session.service';
import { CreateCheckoutQuoteDto } from './checkout.dto';
import { CheckoutService } from './checkout.service';
import { EcontDirectoryService } from './econt-directory.service';
import { EcontLocalitiesQueryDto, EcontOfficesQueryDto } from './econt-directory.dto';

@Controller('checkout')
export class CheckoutController {
  constructor(
    private readonly guests: GuestSessionService,
    private readonly checkout: CheckoutService,
    private readonly econt: EcontDirectoryService,
  ) {}

  @Get('localities')
  async localities(
    @Query() query: EcontLocalitiesQueryDto, @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    this.guests.enforceRateLimit(request.ip ?? 'unknown');
    return { localities: await this.econt.localities(query.locale, query.q) };
  }

  @Get('offices')
  async offices(
    @Query() query: EcontOfficesQueryDto, @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    this.guests.enforceRateLimit(request.ip ?? 'unknown');
    return { offices: await this.econt.offices(query.localityId, query.locale) };
  }

  @Post('quotes')
  async quote(
    @Body() input: CreateCheckoutQuoteDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    this.guests.enforceRateLimit(request.ip ?? 'unknown');
    const guestId = await this.guests.assertValidCsrf(
      request.headers.cookie,
      request.get('x-csrf-token'),
      request.get('origin'),
    );
    const result = await this.checkout.quote(guestId, input);
    response.status(result.payable ? 201 : 200);
    return result;
  }
}

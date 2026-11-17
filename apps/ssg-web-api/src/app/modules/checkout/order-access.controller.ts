import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { GuestSessionService } from '../guest-session/guest-session.service';
import { OrderAccessRequestDto, OrderAccessSessionDto } from './order-access.dto';
import { OrderAccessService } from './order-access.service';

@Controller('customer-order')
export class OrderAccessController {
  constructor(
    private readonly guests: GuestSessionService,
    private readonly access: OrderAccessService,
  ) {}

  @Post('access-requests')
  @HttpCode(202)
  async requestAccess(@Body() input: OrderAccessRequestDto, @Req() request: Request,
    @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'private, no-store');
    const guestId = await this.authenticate(request);
    await this.access.requestAccess(guestId, input);
    return { message: 'If the number and email match an order, you will receive a link to view it.' };
  }

  @Post('access-session')
  @HttpCode(200)
  async exchange(@Body() input: OrderAccessSessionDto, @Req() request: Request,
    @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'private, no-store');
    const guestId = await this.authenticate(request);
    const session = await this.access.exchange(guestId, input.grantToken);
    response.appendHeader('Set-Cookie', session.cookie);
    return { expiresAt: session.expiresAt };
  }

  @Get()
  async view(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'private, no-store');
    const guestId = await this.authenticate(request);
    return this.access.view(guestId, request.headers.cookie);
  }

  private async authenticate(request: Request): Promise<string> {
    this.guests.enforceRateLimit(request.ip ?? 'unknown');
    return this.guests.assertValidCsrf(
      request.headers.cookie, request.get('x-csrf-token'), request.get('origin'),
    );
  }
}

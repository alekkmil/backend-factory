import { Body, Controller, Headers, HttpException, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { GuestSessionService } from '../guest-session/guest-session.service';
import { CommitOrderDto } from './orders.dto';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly guests: GuestSessionService,
    private readonly orders: OrdersService,
  ) {}

  @Post()
  async commit(
    @Body() input: CommitOrderDto,
    @Headers('idempotency-key') key: string | undefined,
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
    const result = await this.orders.commit(guestId, key, input);
    if (result.status_code >= 400) {
      throw new HttpException(result.body, result.status_code);
    }
    response.status(result.replayed ? 200 : result.status_code);
    return result.body;
  }
}

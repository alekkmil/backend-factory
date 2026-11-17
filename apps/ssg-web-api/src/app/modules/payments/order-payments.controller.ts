import {
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { GuestSessionService } from '../guest-session/guest-session.service';
import { OrderAccessService } from '../checkout/order-access.service';
import { PaymentService } from './payment.service';

@Controller('orders/:orderRef')
export class OrderPaymentsController {
  constructor(
    private readonly guests: GuestSessionService,
    private readonly payments: PaymentService,
    private readonly access: OrderAccessService,
  ) {}

  @Get()
  async order(
    @Param('orderRef', ParseUUIDPipe) orderRef: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    const guestId = await this.authenticate(request);
    return this.access.viewOwned(guestId, orderRef);
  }

  @Post('payment-attempts')
  async initiate(
    @Param('orderRef', ParseUUIDPipe) orderRef: string,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    const guestId = await this.authenticate(request);
    const result = await this.payments.initiate(guestId, orderRef, key);
    response.status('form' in result ? 201 : 200);
    return result;
  }

  @Get('payment-result')
  async result(
    @Param('orderRef', ParseUUIDPipe) orderRef: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    const guestId = await this.authenticate(request);
    return this.payments.result(guestId, orderRef);
  }

  private async authenticate(request: Request): Promise<string> {
    this.guests.enforceRateLimit(request.ip ?? 'unknown');
    return this.guests.assertValidCsrf(
      request.headers.cookie, request.get('x-csrf-token'), request.get('origin'),
    );
  }
}

import { Body, Controller, HttpCode, Post, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { PaymentService } from './payment.service';

@Controller('payments/borica')
export class BoricaController {
  constructor(
    private readonly config: ConfigService,
    private readonly payments: PaymentService,
  ) {}

  @Post('callback')
  @HttpCode(200)
  async handleCallback(@Body() body: unknown, @Res() response: Response): Promise<void> {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    await this.payments.verifyCallback(body);
    response.redirect(303, this.config.getOrThrow<string>('BORICA_BROWSER_RETURN_URL'));
  }
}

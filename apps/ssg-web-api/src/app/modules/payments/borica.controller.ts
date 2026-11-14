import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
} from '@nestjs/common';

function diagnosticField(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^[A-Za-z0-9 .,:;=_/-]{0,128}$/.test(value)) {
    return '[invalid]';
  }
  return value;
}

@Controller('payments/borica')
export class BoricaController {
  private readonly logger = new Logger(BoricaController.name);

  @Post('callback')
  @HttpCode(200)
  handleCallback(
    @Body() body: unknown,
    @Headers('content-type') contentType?: string,
  ): { received: true } {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException();
    }

    this.logger.log({
      event: 'borica.callback_received_unverified',
      contentType: diagnosticField(contentType),
      action: diagnosticField('ACTION' in body ? body.ACTION : undefined),
      rc: diagnosticField('RC' in body ? body.RC : undefined),
      order: diagnosticField('ORDER' in body ? body.ORDER : undefined),
      terminal: diagnosticField('TERMINAL' in body ? body.TERMINAL : undefined),
      amount: diagnosticField('AMOUNT' in body ? body.AMOUNT : undefined),
      currency: diagnosticField('CURRENCY' in body ? body.CURRENCY : undefined),
      transactionType: diagnosticField('TRTYPE' in body ? body.TRTYPE : undefined),
      rrn: diagnosticField('RRN' in body ? body.RRN : undefined),
      internalReference: diagnosticField('INT_REF' in body ? body.INT_REF : undefined),
      hasSignature: 'P_SIGN' in body &&
        typeof body.P_SIGN === 'string' && body.P_SIGN.length > 0,
    });

    return { received: true };
  }
}

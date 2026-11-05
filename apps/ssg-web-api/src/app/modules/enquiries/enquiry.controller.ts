import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { GuestSessionService } from '../guest-session/guest-session.service';
import { EnquiryAttemptDto, EnquirySubmitDto } from './enquiry.dto';
import { EnquiryService } from './enquiry.service';

@Controller('enquiries')
export class EnquiryController {
  constructor(
    private readonly guests: GuestSessionService,
    private readonly enquiries: EnquiryService,
  ) {}

  @Post()
  async submit(
    @Body() input: EnquirySubmitDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    const guestId = await this.authenticate(request);
    const result = await this.enquiries.submit(guestId, request.ip ?? 'unknown', input);
    response.status(result.replayed ? 200 : 201);
    return result.receipt;
  }

  @Post('attempt-status')
  async status(
    @Body() input: EnquiryAttemptDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    const guestId = await this.authenticate(request);
    response.status(200);
    return this.enquiries.status(guestId, input.request_id);
  }

  private async authenticate(request: Request): Promise<string> {
    this.guests.enforceRateLimit(request.ip ?? 'unknown');
    return this.guests.assertValidCsrf(
      request.headers.cookie,
      request.get('x-csrf-token'),
      request.get('origin'),
    );
  }
}

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { GuestSessionRequestDto } from './guest-session.dto';
import { GuestSessionService } from './guest-session.service';

@Controller('guest-session')
export class GuestSessionController {
  constructor(private readonly sessions: GuestSessionService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  bootstrap(
    @Body() _body: GuestSessionRequestDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): ReturnType<GuestSessionService['bootstrap']> {
    return this.sessions.bootstrap(
      request.get('origin'),
      request.ip ?? 'unknown',
      request.get('cookie'),
      (cookie) => response.setHeader('Set-Cookie', cookie),
      (cacheControl) => response.setHeader('Cache-Control', cacheControl),
    );
  }
}

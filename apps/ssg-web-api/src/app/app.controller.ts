import {
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  ServiceUnavailableException,
  Body,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { MailDeliveryError, MailDeliveryService } from './common/outbox/mail-delivery.service';
import { renderMail } from './common/outbox/outbox-handler';
import { LocalTestMailDto } from './modules/local-test-mail.dto';

@Controller()
export class AppController {
  constructor(
    private readonly config: ConfigService,
    private readonly mailDelivery: MailDeliveryService,
  ) {}

  @Post('test')
  @HttpCode(HttpStatus.ACCEPTED)
  async sendTestMail(@Body() input: LocalTestMailDto): Promise<{
    accepted_by_mail_transport: true;
  }> {
    if (!this.config.get<boolean>('LOCAL_TEST_MAIL_ENABLED')) {
      throw new NotFoundException();
    }

    const recipient = this.config.getOrThrow<string>('MAIL_TO');
    const mail = renderMail(recipient, '[TEST] SSG enquiry notification', [
      ['Topic', input.topic],
      ['Message', input.message],
      ['Notice', 'Test message only; no customer enquiry was submitted.'],
    ]);

    try {
      await this.mailDelivery.deliver(`local-test-mail:${randomUUID()}`, mail);
    } catch (error) {
      if (error instanceof MailDeliveryError) {
        throw new ServiceUnavailableException({ code: error.code });
      }
      throw error;
    }

    return { accepted_by_mail_transport: true };
  }
}

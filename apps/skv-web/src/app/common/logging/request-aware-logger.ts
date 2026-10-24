import { ConsoleLogger, Injectable } from '@nestjs/common';
import { requestContext } from './request-context';

@Injectable()
export class RequestAwareLogger extends ConsoleLogger {
  constructor() {
    super({
      json: process.env.NODE_ENV === 'production',
    });
  }

  override log(message: unknown, ...optionalParams: unknown[]): void {
    super.log(this.withRequestId(message), ...optionalParams);
  }

  override error(message: unknown, ...optionalParams: unknown[]): void {
    super.error(this.withRequestId(message), ...optionalParams);
  }

  override warn(message: unknown, ...optionalParams: unknown[]): void {
    super.warn(this.withRequestId(message), ...optionalParams);
  }

  override debug(message: unknown, ...optionalParams: unknown[]): void {
    super.debug(this.withRequestId(message), ...optionalParams);
  }

  override verbose(message: unknown, ...optionalParams: unknown[]): void {
    super.verbose(this.withRequestId(message), ...optionalParams);
  }

  override fatal(message: unknown, ...optionalParams: unknown[]): void {
    super.fatal(this.withRequestId(message), ...optionalParams);
  }

  private withRequestId(message: unknown): unknown {
    const requestId = requestContext.getStore()?.requestId;
    if (!requestId) {
      return message;
    }

    if (typeof message === 'string') {
      return `[${requestId}] ${message}`;
    }
    if (message instanceof Error) {
      return {
        name: message.name,
        message: message.message,
        stack: message.stack,
        requestId,
      };
    }
    if (typeof message === 'object' && message !== null && !Array.isArray(message)) {
      return {
        ...message,
        requestId,
      };
    }

    return {
      message,
      requestId,
    };
  }
}

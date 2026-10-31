import { ConsoleLogger, LogLevel } from '@nestjs/common';
import { requestContext } from './request-context';

export class RequestAwareConsoleLogger extends ConsoleLogger {
  constructor() {
    const isProduction = process.env.NODE_ENV === 'production';
    super({
      json: isProduction,
      logLevels: isProduction
        ? ['log', 'error', 'warn', 'fatal']
        : ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'],
    });
  }

  protected override printMessages(
    messages: unknown[],
    context?: string,
    logLevel?: LogLevel,
    writeStreamType?: 'stdout' | 'stderr',
    errorStack?: unknown,
  ): void {
    const requestId = requestContext.getStore()?.requestId;
    const requestContextLabel = requestId
      ? `${context ? `${context} ` : ''}[${requestId}]`
      : context;

    super.printMessages(
      messages,
      requestContextLabel,
      logLevel,
      writeStreamType,
      errorStack,
    );
  }
}

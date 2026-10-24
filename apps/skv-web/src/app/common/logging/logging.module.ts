import { Module } from '@nestjs/common';
import { RequestAwareLogger } from './request-aware-logger';
import { RequestContextMiddleware } from './request-context.middleware';

@Module({
  providers: [RequestAwareLogger, RequestContextMiddleware],
  exports: [RequestAwareLogger, RequestContextMiddleware],
})
export class LoggingModule {}

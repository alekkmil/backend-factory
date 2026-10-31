import { Logger, RequestMethod, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app/app.module';
import { ApiExceptionFilter } from './app/common/api-exception.filter';
import { RequestAwareConsoleLogger } from './app/common/logging/request-aware-console-logger';
import { RequestContextMiddleware } from './app/common/logging/request-context.middleware';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });
  const requestContextMiddleware = app.get(RequestContextMiddleware);
  app.use((request: Request, response: Response, next: NextFunction) =>
    requestContextMiddleware.use(request, response, next),
  );
  app.useBodyParser('json', { limit: '10mb' });
  app.useLogger(new RequestAwareConsoleLogger());

  const config = app.get(ConfigService);
  const port = config.getOrThrow<number>('PORT');

  app.setGlobalPrefix('api', {
    exclude: [{ path: 'internal/health', method: RequestMethod.GET }],
  });
  app.enableCors({
    origin: config.getOrThrow<string>('CORS_ORIGINS').split(','),
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: false,
      },
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
  await app.listen(port);
  Logger.log(`Application is running on: http://localhost:${port}/api`);
}

void bootstrap();

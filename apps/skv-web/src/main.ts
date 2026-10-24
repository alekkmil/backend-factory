import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { json, NextFunction, Request, Response } from 'express';
import { RequestAwareLogger } from './app/common/logging/request-aware-logger';
import { AppModule } from './app/app.module';
import { RequestContextMiddleware } from './app/common/logging/request-context.middleware';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  app.useLogger(app.get(RequestAwareLogger));
  const requestContextMiddleware = app.get(RequestContextMiddleware);
  app.use((request: Request, response: Response, next: NextFunction) => {
    requestContextMiddleware.use(request, response, next);
  });
  app.use(json({ limit: 16 * 1024, type: 'application/json' }));
  app.setGlobalPrefix('api');
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

  const config = app.get(ConfigService);
  app.set('trust proxy', config.getOrThrow<number>('TRUST_PROXY_HOPS'));
  app.enableShutdownHooks();

  const port = config.getOrThrow<number>('PORT');
  await app.listen(port);

  app.get(RequestAwareLogger).log(
    `Application is listening on port ${port} at /api`,
    'Bootstrap',
  );
}

void bootstrap();

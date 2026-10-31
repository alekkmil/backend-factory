import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { RequestAwareConsoleLogger } from './app/common/logging/request-aware-console-logger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(new RequestAwareConsoleLogger());

  const config = app.get(ConfigService);
  const port = config.getOrThrow<number>('PORT');

  app.setGlobalPrefix('api');
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
  app.enableShutdownHooks();
  await app.listen(port);
  Logger.log(`Application is running on: http://localhost:${port}/api`);
}

void bootstrap();

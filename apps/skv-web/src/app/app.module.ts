import {
  Module,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { resolve } from 'node:path';
import { validateEnvironment } from './config/environment';
import { HealthModule } from './modules/health/health.module';
import { LoggingModule } from './common/logging/logging.module';
import { EnquiriesModule } from './modules/enquiries/enquiries.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: resolve(process.cwd(), 'apps/skv-web/.env'),
      validate: validateEnvironment,
    }),
    LoggingModule,
    EnquiriesModule,
    HealthModule,
  ],
})
export class AppModule {}

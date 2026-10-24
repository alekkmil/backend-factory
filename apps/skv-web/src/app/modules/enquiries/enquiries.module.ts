import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { PrismaModule } from '../../database/prisma.module';
import { EnquiryContextRegistryService } from './enquiry-context-registry.service';
import { EnquiryCryptoService } from './enquiry-crypto.service';
import { EnquiryExceptionFilter } from './enquiry-exception.filter';
import { EnquiryRateLimiterService } from './enquiry-rate-limiter.service';
import { EnquiriesController } from './enquiries.controller';
import { EnquiriesService } from './enquiries.service';

@Module({
  imports: [PrismaModule],
  controllers: [EnquiriesController],
  providers: [
    EnquiryContextRegistryService,
    EnquiryCryptoService,
    EnquiryRateLimiterService,
    EnquiriesService,
    {
      provide: APP_FILTER,
      useClass: EnquiryExceptionFilter,
    },
  ],
})
export class EnquiriesModule {}

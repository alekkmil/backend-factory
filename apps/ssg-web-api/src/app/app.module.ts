import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { resolve } from 'node:path';
import { HealthModule } from './modules/health/health.module';
import { PrismaModule } from './database/prisma.module';
import { RequestContextMiddleware } from './common/logging/request-context.middleware';
import { validateEnvironment } from './config/environment';
import { CommercialModule } from './common/commercial/commercial.module';
import { DictionaryModule } from './modules/dictionaries/dictionary.module';
import { TransactionModule } from './common/transactions/transaction.module';
import { OutboxModule } from './common/outbox/outbox.module';
import { PublicationModule } from './common/publication/publication.module';
import { StockFactModule } from './common/stock-facts/stock-fact.module';
import { GuestSessionModule } from './modules/guest-session/guest-session.module';
import { ProductReadModule } from './modules/products/product-read.module';
import { CatalogueImportModule } from './modules/catalogue-import/catalogue-import.module';
import { CatalogueAdminModule } from './modules/catalogue-admin/catalogue-admin.module';
import { EnquiryModule } from './modules/enquiries/enquiry.module';
import { SearchModule } from './modules/search/search.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { PublicContentModule } from './modules/public-content/public-content.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: resolve(process.cwd(), 'apps/ssg-web-api/.env'),
      validate: validateEnvironment,
    }),
    PrismaModule,
    CommercialModule,
    TransactionModule,
    OutboxModule,
    PublicationModule,
    StockFactModule,
    GuestSessionModule,
    ProductReadModule,
    CatalogueImportModule,
    CatalogueAdminModule,
    EnquiryModule,
    SearchModule,
    InventoryModule.register(),
    PublicContentModule,
    HealthModule,
    DictionaryModule,
  ],
  providers: [RequestContextMiddleware],
})
export class AppModule {}

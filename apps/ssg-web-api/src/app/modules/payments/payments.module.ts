import { Module } from '@nestjs/common';
import { BoricaController } from './borica.controller';

@Module({
  controllers: [BoricaController],
})
export class PaymentsModule {}

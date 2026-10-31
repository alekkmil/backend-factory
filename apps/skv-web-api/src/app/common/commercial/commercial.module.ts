import { Module } from '@nestjs/common';
import { CommercialEvaluator } from './commercial-evaluator';

@Module({
  providers: [CommercialEvaluator],
  exports: [CommercialEvaluator],
})
export class CommercialModule {}

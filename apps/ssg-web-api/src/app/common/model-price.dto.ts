import { BadRequestException } from '@nestjs/common';
import { Equals, IsString, Matches } from 'class-validator';

const MODEL_PRICE_PATTERN = /^(?:0|[1-9]\d{0,9})\.\d{2}$/;

export class ModelPriceDto {
  @IsString()
  @Matches(MODEL_PRICE_PATTERN)
  amount!: string;

  @Equals('EUR')
  currency!: 'EUR';
}

export function modelPriceAmount(value: ModelPriceDto | null): string | null {
  if (value === null) return null;
  if (value.currency !== 'EUR' ||
      !MODEL_PRICE_PATTERN.test(value.amount) || value.amount === '0.00') {
    throw new BadRequestException({ code: 'MODEL_PRICE_INVALID', message_key: 'errors.validation' });
  }
  return value.amount;
}

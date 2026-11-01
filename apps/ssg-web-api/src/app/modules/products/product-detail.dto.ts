import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  IsUUID,
} from 'class-validator';
import {
  FulfilmentMethod,
  Locale,
  LocationCode,
} from '../../../generated/prisma/enums';

export class ProductQueryDto {
  @IsIn(Object.values(Locale))
  locale!: Locale;

  @IsOptional()
  @IsIn(Object.values(FulfilmentMethod))
  fulfilment_method?: FulfilmentMethod;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().normalize('NFC') : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  locality_id?: string;

  @IsOptional()
  @IsIn(Object.values(LocationCode))
  pickup_location_code?: LocationCode;
}

export class ProductPathDto {
  @IsUUID()
  id!: string;
}

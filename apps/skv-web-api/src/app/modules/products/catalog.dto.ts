import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  FulfilmentMethod,
  Locale,
  LocationCode,
  ProductType,
} from '../../../generated/prisma/enums';

function normalizeCode(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().normalize('NFC') : value;
}

function normalizeCodeList(value: unknown): unknown {
  const values = Array.isArray(value) ? value : value === undefined ? undefined : [value];
  if (!values) {
    return values;
  }
  if (!values.every((item) => typeof item === 'string')) {
    return values;
  }
  return [...new Set(values.map((item) => item.trim().normalize('NFC')))];
}

function parsePage(value: unknown, fallback: number): unknown {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    return value;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : value;
}

export class CatalogQueryDto {
  @IsIn(Object.values(Locale))
  locale!: Locale;

  @IsOptional()
  @IsIn(Object.values(ProductType))
  product_type?: ProductType;

  @IsOptional()
  @Transform(({ value }) => normalizeCode(value))
  @IsString()
  @Length(1, 80)
  jewellery_type?: string;

  @IsOptional()
  @IsUUID()
  selection_id?: string;

  @IsOptional()
  @Transform(({ value }) => normalizeCodeList(value))
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @Length(1, 80, { each: true })
  material_codes?: string[];

  @IsOptional()
  @Transform(({ value }) => normalizeCodeList(value))
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @Length(1, 80, { each: true })
  gemstone_codes?: string[];

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @Matches(/^[0-9]{1,10}(?:\.[0-9]{1,2})?$/)
  price_min?: string;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @Matches(/^[0-9]{1,10}(?:\.[0-9]{1,2})?$/)
  price_max?: string;

  @IsOptional()
  @IsIn(Object.values(FulfilmentMethod))
  fulfilment_method?: FulfilmentMethod;

  @IsOptional()
  @Transform(({ value }) => normalizeCode(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  locality_id?: string;

  @IsOptional()
  @IsIn(Object.values(LocationCode))
  pickup_location_code?: LocationCode;

  @IsOptional()
  @IsIn(['default', 'price_asc', 'price_desc'])
  sort: 'default' | 'price_asc' | 'price_desc' = 'default';

  @Transform(({ value }) => parsePage(value, 1))
  @IsInt()
  @Min(1)
  page = 1;

  @Transform(({ value }) => parsePage(value, 24))
  @IsInt()
  @Min(1)
  @Max(100)
  page_size = 24;
}

import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  Matches,
} from 'class-validator';
import {
  ContentType,
  Locale,
  LocationCode,
  PolicyKind,
} from '../../../generated/prisma/enums';

function queryInteger(value: unknown, fallback: number): unknown {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/u.test(value)) return value;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : value;
}

export class LocaleQueryDto {
  @IsIn(Object.values(Locale))
  locale!: Locale;
}

export class ContentListQueryDto extends LocaleQueryDto {
  @IsIn(Object.values(ContentType))
  type!: ContentType;

  @IsOptional()
  @IsUUID()
  parent_id?: string;

  @Transform(({ value }) => queryInteger(value, 1))
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  page = 1;

  @Transform(({ value }) => queryInteger(value, 24))
  @IsInt()
  @Min(1)
  @Max(100)
  page_size = 24;
}

export class PublicationsQueryDto extends LocaleQueryDto {
  @IsOptional()
  @IsIn(['stories', 'media'])
  group?: 'stories' | 'media';

  @IsOptional()
  @Transform(({ value }) =>
    value === undefined ? undefined : queryInteger(value, 0),
  )
  @IsInt()
  @Min(1000)
  @Max(9999)
  year?: number;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().normalize('NFC') : value,
  )
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,80}$/u)
  topic?: string;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().normalize('NFC') : value,
  )
  @IsString()
  @Length(1, 200)
  search?: string;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().normalize('NFC') : value,
  )
  @IsString()
  @Length(1, 255)
  publisher?: string;

  @Transform(({ value }) => queryInteger(value, 1))
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  page = 1;
}

export class ContentDetailPathDto {
  @IsUUID()
  id!: string;
}

export class StorePathDto {
  @IsIn(Object.values(LocationCode))
  code!: LocationCode;
}

export class PolicyPathDto {
  @IsIn(Object.values(PolicyKind))
  kind!: PolicyKind;
}

export class PolicyQueryDto extends LocaleQueryDto {
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().normalize('NFC') : value,
  )
  @IsString()
  @Length(1, 80)
  version?: string;
}

export class SeoUrlsQueryDto {
  @IsOptional()
  @IsUUID()
  after_id?: string;

  @Transform(({ value }) => queryInteger(value, 500))
  @IsInt()
  @Min(1)
  @Max(1000)
  limit = 500;
}

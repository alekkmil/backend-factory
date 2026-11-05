import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsString, Max, MaxLength, Min } from 'class-validator';
import { Locale } from '../../../generated/prisma/enums';

function pageNumber(value: unknown): unknown {
  return typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : value;
}

export class SearchQueryDto {
  @IsIn(Object.values(Locale))
  locale!: Locale;

  @Transform(({ value }) => typeof value === 'string' ? value.trim().normalize('NFC') : value)
  @IsString()
  @MaxLength(200)
  q!: string;

  @Transform(({ value }) => pageNumber(value))
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  product_page = 1;

  @Transform(({ value }) => pageNumber(value))
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  content_page = 1;

  @Transform(({ value }) => pageNumber(value))
  @IsInt()
  @Min(1)
  @Max(100)
  page_size = 24;
}

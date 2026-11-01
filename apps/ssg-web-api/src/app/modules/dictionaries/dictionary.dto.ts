import { ArrayMaxSize, IsArray, IsIn, IsOptional } from 'class-validator';
import { Locale } from '../../../generated/prisma/enums';

export const PUBLIC_DICTIONARY_GROUPS = [
  'product_type',
  'jewellery_type',
  'material',
  'fineness',
  'gold_karat',
  'gemstone',
] as const;

export class DictionaryQueryDto {
  @IsIn(Object.values(Locale))
  locale!: Locale;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PUBLIC_DICTIONARY_GROUPS.length)
  @IsIn(PUBLIC_DICTIONARY_GROUPS, { each: true })
  groups?: string[];
}

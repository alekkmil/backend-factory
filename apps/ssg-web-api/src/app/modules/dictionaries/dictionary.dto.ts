import { ArrayMaxSize, IsArray, IsIn, IsOptional } from 'class-validator';
import { Locale } from '../../../generated/prisma/enums';

export const PUBLIC_DICTIONARY_GROUPS = [
  'product_type',
  'jewellery_type',
  'material',
  'fineness',
  'gold_karat',
  'gemstone',
  'material_colour',
  'stone_colour',
  'stone_grade',
  'stone_clarity',
  'stone_shape',
  'pearl_type',
  'finish',
  'construction_detail',
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

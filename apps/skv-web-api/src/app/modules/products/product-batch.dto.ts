import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsUUID,
} from 'class-validator';
import { Locale } from '../../../generated/prisma/enums';

export class ProductBatchDto {
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  ids!: string[];

  @IsIn(Object.values(Locale))
  locale!: Locale;
}

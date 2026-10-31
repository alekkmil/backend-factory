import { IsIn, IsString, Length } from 'class-validator';
import { Locale } from '../../../generated/prisma/enums';

export class ProductResolveQueryDto {
  @IsIn(Object.values(Locale))
  locale!: Locale;

  @IsString()
  @Length(1, 1000)
  path!: string;
}

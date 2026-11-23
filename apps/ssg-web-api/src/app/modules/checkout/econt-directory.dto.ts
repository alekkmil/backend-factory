import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

export class EcontLocalitiesQueryDto {
  @IsIn(['bg', 'en'])
  locale!: 'bg' | 'en';

  @IsOptional()
  @IsString()
  @Length(1, 100)
  q?: string;
}

export class EcontOfficesQueryDto {
  @IsIn(['bg', 'en'])
  locale!: 'bg' | 'en';

  @IsString()
  @Matches(/^[1-9]\d{0,8}$/)
  localityId!: string;
}

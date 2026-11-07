import { BadRequestException } from '@nestjs/common';
import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDefined, IsIn, IsInt,
  IsObject, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';

export class CatalogueImageMetadataDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,80}$/)
  client_key!: string;

  @IsIn(['main', 'angle', 'back_profile', 'detail', 'on_body', 'original'])
  role!: 'main' | 'angle' | 'back_profile' | 'detail' | 'on_body' | 'original';

  @IsInt()
  @Min(1)
  @Max(10000)
  sort_order!: number;

  @IsString()
  @Matches(/\S/)
  @MaxLength(500)
  alt_bg!: string;

  @IsString()
  @Matches(/\S/)
  @MaxLength(500)
  alt_en!: string;

  @IsBoolean()
  processed_with_ai!: boolean;

  @IsBoolean()
  on_model_illustrative!: boolean;
}

export class CatalogueMediaRequestDto {
  @IsUUID()
  request_id!: string;

  @IsInt()
  @Min(1)
  @Max(2147483646)
  expected_version!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => CatalogueImageMetadataDto)
  images!: CatalogueImageMetadataDto[];
}

export class CatalogueMediaMultipartDto {
  @IsDefined()
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') throw new BadRequestException();
    try {
      return plainToInstance(CatalogueMediaRequestDto, JSON.parse(value));
    } catch (error) {
      if (error instanceof SyntaxError) throw new BadRequestException();
      throw error;
    }
  })
  @IsObject()
  @ValidateNested()
  metadata!: CatalogueMediaRequestDto;
}

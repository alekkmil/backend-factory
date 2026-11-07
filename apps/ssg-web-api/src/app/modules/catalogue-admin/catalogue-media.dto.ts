import { BadRequestException } from '@nestjs/common';
import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDefined, IsIn, IsInt,
  IsObject, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { MediaRole } from '../../../generated/prisma/enums';

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

export class CatalogueDerivativeDto {
  @IsIn([200, 400, 800, 1600])
  size!: number;

  @IsInt()
  @Min(200)
  @Max(1600)
  width!: number;

  @IsInt()
  @Min(200)
  @Max(1600)
  height!: number;

  @IsString()
  @MaxLength(1000)
  @Matches(/^[^\\%?#]+$/)
  object_key!: string;

  @IsIn(['image/webp'])
  mime!: 'image/webp';

  @IsIn(['sRGB'])
  colour_space!: 'sRGB';

  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  bytes!: number;

  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  sha256!: string;
}

export class ReviewedMediaImageDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,80}$/)
  logical_image_id!: string;

  @IsIn(Object.values(MediaRole))
  role!: MediaRole;

  @IsString()
  @MaxLength(1000)
  original_relative_path!: string;

  @IsString()
  @MaxLength(500)
  alt_bg!: string;

  @IsString()
  @MaxLength(500)
  alt_en!: string;

  @IsBoolean()
  processed_with_ai!: boolean;

  @IsBoolean()
  on_model_illustrative!: boolean;

  @IsArray()
  @ArrayMinSize(4)
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => CatalogueDerivativeDto)
  derivatives!: CatalogueDerivativeDto[];
}

export class CatalogueMediaReleaseDto {
  @IsString()
  @Matches(/^[A-Za-z0-9._:-]{1,128}$/)
  request_id!: string;

  @IsString()
  @Matches(/^v[1-9][0-9]{0,28}$/)
  version!: string;

  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  receipt_sha256!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ReviewedMediaImageDto)
  images!: ReviewedMediaImageDto[];
}

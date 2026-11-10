import { BadRequestException } from '@nestjs/common';
import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsObject,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class WebsiteMediaImageDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,80}$/)
  client_key!: string;

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

  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsBoolean()
  on_model_illustrative?: boolean;
}

export class WebsiteMediaUploadDto {
  @IsUUID()
  request_id!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => WebsiteMediaImageDto)
  images!: WebsiteMediaImageDto[];
}

export class WebsiteMediaMultipartDto {
  @IsDefined()
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') throw new BadRequestException();
    try {
      return plainToInstance(WebsiteMediaUploadDto, JSON.parse(value));
    } catch (error) {
      if (error instanceof SyntaxError) throw new BadRequestException();
      throw error;
    }
  })
  @IsObject()
  @ValidateNested()
  metadata!: WebsiteMediaUploadDto;
}

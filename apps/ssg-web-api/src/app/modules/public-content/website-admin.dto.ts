import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDefined, IsEmail,
  IsIn, IsInt, IsISO8601, IsObject, IsString, IsUUID, Matches,
  MaxLength, Min, ValidateIf, ValidateNested,
} from 'class-validator';
import { ContentType, Locale, LocationCode, PolicyKind } from '../../../generated/prisma/enums';
import type { Prisma } from '../../../generated/prisma/client';

export class WebsiteKeyDto {
  @Matches(/^[A-Za-z0-9_-]{1,120}$/)
  key!: string;
}

export class WebsitePolicyPathDto {
  @IsIn(Object.values(PolicyKind))
  kind!: PolicyKind;

  @Matches(/^[A-Za-z0-9._-]{1,80}$/)
  version!: string;
}

export class WebsiteWriteDto {
  @IsUUID()
  request_id!: string;
}

export class WebsiteUpsertDto extends WebsiteWriteDto {
  @ValidateIf((_, value: unknown) => value !== null)
  @IsISO8601({ strict: true })
  expected_updated_at!: string | null;
}

export class WebsiteTranslationDto {
  @IsIn(Object.values(Locale))
  locale!: Locale;

  @IsString()
  @Matches(/\S/)
  @MaxLength(1000)
  path!: string;

  @IsBoolean()
  published!: boolean;

  @IsString()
  @Matches(/\S/)
  @MaxLength(250)
  title!: string;

  @ValidateIf((_, value: unknown) => value !== null)
  @IsString()
  @MaxLength(3000)
  intro!: string | null;

  @ValidateIf((_, value: unknown) => value !== null)
  @IsString()
  @MaxLength(250)
  seo_title!: string | null;

  @ValidateIf((_, value: unknown) => value !== null)
  @IsString()
  @MaxLength(1000)
  seo_description!: string | null;

  @ValidateIf((_, value: unknown) => value !== undefined && value !== null)
  @IsUUID()
  og_image_id?: string | null;

  @IsArray()
  @ArrayMaxSize(200)
  @IsObject({ each: true })
  sections!: Prisma.JsonObject[];
}

export class WebsiteLinkDto {
  @Matches(/^[A-Za-z0-9_-]{1,80}$/)
  slot!: string;

  @IsInt()
  @Min(1)
  sort_order!: number;

  @IsObject()
  target!: Prisma.JsonObject;

  @ValidateIf((_, value: unknown) => value !== null)
  @IsString()
  @MaxLength(255)
  label_bg!: string | null;

  @ValidateIf((_, value: unknown) => value !== null)
  @IsString()
  @MaxLength(255)
  label_en!: string | null;
}

export class WebsiteContentDto extends WebsiteUpsertDto {
  @IsIn(Object.values(ContentType))
  type!: ContentType;

  @ValidateIf((_, value: unknown) => value !== null)
  @IsUUID()
  parent_id!: string | null;

  @ValidateIf((_, value: unknown) => value !== null)
  @IsUUID()
  author_id!: string | null;

  @IsObject()
  special_data!: Prisma.JsonObject;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => WebsiteTranslationDto)
  translations!: WebsiteTranslationDto[];

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => WebsiteLinkDto)
  links!: WebsiteLinkDto[];
}

export class WebsiteStoreDto extends WebsiteUpsertDto {
  @IsObject()
  public_data!: Prisma.JsonObject;
}

export class WebsiteStorePathDto {
  @IsIn(Object.values(LocationCode))
  code!: LocationCode;
}

export class WebsitePolicyTranslationDto {
  @IsIn(Object.values(Locale))
  locale!: Locale;

  @IsString()
  @Matches(/\S/)
  @MaxLength(250)
  title!: string;

  @IsString()
  @Matches(/\S/)
  @MaxLength(100000)
  text!: string;

  @IsString()
  @MaxLength(1000)
  url!: string;
}

export class WebsitePolicyDto extends WebsiteWriteDto {
  @ValidateIf((_, value: unknown) => value !== null)
  @IsString()
  @Matches(/^[A-Za-z0-9._-]{1,80}$/)
  expected_current_version!: string | null;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => WebsitePolicyTranslationDto)
  translations!: WebsitePolicyTranslationDto[];
}

export class WebsiteSettingsDto extends WebsiteWriteDto {
  @IsInt()
  @Min(1)
  expected_version!: number;

  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsDefined()
  @IsObject()
  site_contacts?: Prisma.JsonObject;

  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsDefined()
  @IsObject()
  cookie_config?: Prisma.JsonObject;

  @ValidateIf((_, value: unknown) => value !== undefined && value !== null)
  @IsEmail()
  @MaxLength(320)
  coordinator_email?: string | null;
}

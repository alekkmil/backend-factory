import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsInt,
  IsOptional,
  IsObject,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  Matches,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class ImportProductRowDto {
  @IsString()
  @MaxLength(40)
  ssg_id!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  product_type?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  jewellery_type?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  name_bg?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  name_en?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  description_bg?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  description_en?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  materials_state?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  gemstones_state?: string | null;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  gemstone_codes?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(40)
  requested_sales_mode?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  requested_price_visibility?: string | null;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  fulfilment_methods?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(40)
  delivery_scope?: string | null;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  delivery_locality_ids?: string[];

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  pickup_location_codes?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(40)
  legacy_published_at?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  legacy_published_source?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  change_reason_code?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  change_reason_note?: string | null;
}

export class ImportUnitRowDto {
  @IsString()
  @MaxLength(40)
  ssg_id!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  barcode?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  location_code?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  stock_status?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(13)
  price?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(13)
  weight_g?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(13)
  stone_weight_ct?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(13)
  length_mm?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(13)
  width_mm?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(13)
  height_mm?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(13)
  inner_diameter_mm?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(13)
  circumference_mm?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  transfer_to?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  reservation_reference?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  sale_json?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  verified_at?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  source_ref?: string | null;
}

export class ImportMaterialRowDto {
  @IsString()
  @MaxLength(40)
  ssg_id!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  material_code?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  fineness_code?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  gold_karat_code?: string | null;
}

export class ImportImageRowDto {
  @IsString()
  @MaxLength(40)
  ssg_id!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  image_id?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  version?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  role?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  sort_order?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  original_relative_path?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  alt_bg?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  alt_en?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  processed_with_ai?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  on_model_illustrative?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  review_status?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  webp_1600_path?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  webp_800_path?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  webp_400_path?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  webp_200_path?: string | null;
}

export class ImportLegacyLinkRowDto {
  @IsString()
  @MaxLength(40)
  ssg_id!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  legacy_id?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  legacy_url_bg?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  legacy_url_en?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(13)
  historical_price?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  historical_currency?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  source_ref?: string | null;
}

export class ImportProductPayloadDto {
  @IsArray()
  @ArrayMaxSize(1000)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => ImportProductRowDto)
  products!: ImportProductRowDto[];

  @IsArray()
  @ArrayMaxSize(10000)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => ImportUnitRowDto)
  units!: ImportUnitRowDto[];

  @IsArray()
  @ArrayMaxSize(10000)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => ImportMaterialRowDto)
  materials!: ImportMaterialRowDto[];

  @IsArray()
  @ArrayMaxSize(10000)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => ImportImageRowDto)
  images!: ImportImageRowDto[];

  @IsArray()
  @ArrayMaxSize(10000)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => ImportLegacyLinkRowDto)
  legacy_links!: ImportLegacyLinkRowDto[];
}

export class ImportPreflightRequestDto {
  @IsUUID()
  @IsString()
  @MaxLength(128)
  request_id!: string;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => ImportProductPayloadDto)
  data!: ImportProductPayloadDto;
}

export class ImportExpectedProductVersionDto {
  @IsString()
  @Matches(/^SSG-\d{6,}$/)
  @MaxLength(40)
  ssg_id!: string;

  @ValidateIf((_object, value: unknown) => value !== null)
  @IsInt()
  @Min(1)
  version!: number | null;
}

export class ImportCommitRequestDto {
  @IsUUID()
  request_id!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @Matches(/^SSG-\d{6,}$/, { each: true })
  @MaxLength(40, { each: true })
  ssg_ids!: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ImportExpectedProductVersionDto)
  expected_product_versions!: ImportExpectedProductVersionDto[];
}

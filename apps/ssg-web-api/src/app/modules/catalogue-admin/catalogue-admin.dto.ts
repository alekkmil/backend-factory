import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, Equals, IsArray, IsDefined, IsIn, IsInt, IsString,
  IsUUID, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested,
} from 'class-validator';
import { Locale, PublicationStatus } from '../../../generated/prisma/enums';
import { JewellerySpecificationsDto } from '../../common/jewellery-specifications';
import type {
  CompositionState, DeliveryScope, FulfilmentMethod, LocationCode, PriceVisibility,
  ProductType, RestrictionReason, SalesMode, StockStatus,
} from '../../../generated/prisma/enums';

function pageNumber(value: unknown): unknown {
  return typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
}

export class CatalogueListQueryDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }) => typeof value === 'string' ? value.trim().normalize('NFC') : value)
  @IsString()
  @MaxLength(200)
  q?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(Object.values(PublicationStatus))
  publication_status?: PublicationStatus;

  @Transform(({ value }) => pageNumber(value))
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  page = 1;

  @Transform(({ value }) => pageNumber(value))
  @IsInt()
  @Min(1)
  @Max(100)
  page_size = 24;
}

export class CatalogueDetailQueryDto {}

export class CataloguePublishDto {
  @IsUUID()
  request_id!: string;

  @IsInt()
  @Min(1)
  @Max(2147483646)
  expected_version!: number;

  @IsUUID()
  revision_id!: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Equals(true)
  confirm_archive_exit?: true;
}

export class CatalogueDraftMaterialDto {
  @IsString()
  @MaxLength(80)
  material_code!: string;

  @ValidateIf((_object, value: unknown) => value !== null)
  @IsDefined()
  @IsString()
  @MaxLength(80)
  fineness_code!: string | null;

  @ValidateIf((_object, value: unknown) => value !== null)
  @IsDefined()
  @IsString()
  @MaxLength(80)
  gold_karat_code!: string | null;
}

export class ProductSeoTranslationDto {
  @IsIn(Object.values(Locale))
  locale!: Locale;

  @ValidateIf((_, value: unknown) => value !== null)
  @IsString()
  @Matches(/\S/)
  @MaxLength(250)
  seo_title!: string | null;

  @ValidateIf((_, value: unknown) => value !== null)
  @IsString()
  @Matches(/\S/)
  @MaxLength(1000)
  seo_description!: string | null;

  @ValidateIf((_, value: unknown) => value !== null)
  @IsUUID()
  og_image_id!: string | null;
}

export class ProductDraftInputDto {
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => ProductSeoTranslationDto)
  seo_translations?: ProductSeoTranslationDto[];

  @ValidateIf((_, value: unknown) => value !== undefined && value !== null)
  @ValidateNested()
  @Type(() => JewellerySpecificationsDto)
  specifications?: JewellerySpecificationsDto | null;

  @IsIn(['jewellery', 'loose_stone'])
  product_type!: ProductDraft['product_type'];

  @ValidateIf((_object, value: unknown) => value !== null)
  @IsDefined()
  @IsString()
  @MaxLength(80)
  jewellery_type!: string | null;

  @ValidateIf((_object, value: unknown) => value !== null)
  @IsDefined()
  @IsString()
  @MaxLength(250)
  name_bg!: string | null;

  @ValidateIf((_object, value: unknown) => value !== null)
  @IsDefined()
  @IsString()
  @MaxLength(250)
  name_en!: string | null;

  @ValidateIf((_object, value: unknown) => value !== null)
  @IsDefined()
  @IsString()
  @MaxLength(20000)
  description_bg!: string | null;

  @ValidateIf((_object, value: unknown) => value !== null)
  @IsDefined()
  @IsString()
  @MaxLength(20000)
  description_en!: string | null;

  @IsIn(['unknown', 'none', 'known'])
  materials_state!: ProductDraft['materials_state'];

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CatalogueDraftMaterialDto)
  materials!: CatalogueDraftMaterialDto[];

  @IsIn(['unknown', 'none', 'known'])
  gemstones_state!: ProductDraft['gemstones_state'];

  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  gemstone_codes!: string[];

  @IsIn(['direct_purchase', 'enquiry_only', 'archive_catalogue'])
  sales_mode!: ProductDraft['sales_mode'];

  @IsIn(['visible', 'hidden'])
  price_visibility!: ProductDraft['price_visibility'];

  @IsArray()
  @ArrayMaxSize(2)
  @IsIn(['delivery', 'store_pickup'], { each: true })
  fulfilment_methods!: ProductDraft['fulfilment_methods'];

  @ValidateIf((_object, value: unknown) => value !== null)
  @IsDefined()
  @IsIn(['bulgaria', 'selected_localities'])
  delivery_scope!: ProductDraft['delivery_scope'];

  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  delivery_locality_ids!: string[];

  @IsArray()
  @ArrayMaxSize(2)
  @IsIn(['sofia', 'nessebar'], { each: true })
  pickup_location_codes!: ProductDraft['pickup_location_codes'];

  @ValidateIf((_object, value: unknown) => value !== null)
  @IsDefined()
  @IsUUID()
  media_release_id!: string | null;

  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID(undefined, { each: true })
  image_ids!: string[];

  @ValidateIf((_object, value: unknown) => value !== null)
  @IsDefined()
  @IsIn(['damage', 'data_check', 'management_decision', 'other'])
  change_reason_code!: ProductDraft['change_reason_code'];

  @ValidateIf((_object, value: unknown) => value !== null)
  @IsDefined()
  @IsString()
  @MaxLength(2000)
  change_reason_note!: string | null;
}

export class CatalogueSaveDraftDto {
  @IsString()
  @Matches(/^[A-Za-z0-9._:-]{1,128}$/)
  request_id!: string;

  @IsInt()
  @Min(1)
  @Max(2147483646)
  expected_version!: number;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Equals(true)
  confirm_archive_exit?: true;

  @IsDefined()
  @ValidateNested()
  @Type(() => ProductDraftInputDto)
  draft!: ProductDraftInputDto;
}

export class CatalogueVisibilityDto {
  @IsString()
  @Matches(/^[A-Za-z0-9._:-]{1,128}$/)
  request_id!: string;

  @IsInt()
  @Min(1)
  @Max(2147483646)
  expected_version!: number;

  @IsIn(['hidden', 'published'])
  publication_status!: 'hidden' | 'published';

  @IsIn(['damage', 'data_check', 'management_decision', 'other'])
  reason!: RestrictionReason;

  @IsString()
  @Matches(/\S/)
  @MaxLength(2000)
  note!: string;
}

export interface CatalogueFieldError {
  field: string;
  code: string;
  message_key: string;
}

export interface AdminCatalogueList {
  items: {
    id: string;
    ssg_id: string;
    publication_status: PublicationStatus;
    version: number;
    name_bg: string | null;
    name_en: string | null;
    has_draft: boolean;
  }[];
  total: number;
  page: number;
  page_size: number;
}

export interface ProductDraft {
  seo_translations?: ProductSeoTranslationDto[];
  specifications?: JewellerySpecificationsDto | null;
  product_type: ProductType;
  jewellery_type: string | null;
  name_bg: string | null;
  name_en: string | null;
  description_bg: string | null;
  description_en: string | null;
  materials_state: CompositionState;
  materials: { material_code: string; fineness_code: string | null; gold_karat_code: string | null }[];
  gemstones_state: CompositionState;
  gemstone_codes: string[];
  sales_mode: SalesMode;
  price_visibility: PriceVisibility;
  fulfilment_methods: FulfilmentMethod[];
  delivery_scope: DeliveryScope | null;
  delivery_locality_ids: string[];
  pickup_location_codes: LocationCode[];
  media_release_id: string | null;
  image_ids: string[];
  change_reason_code: RestrictionReason | null;
  change_reason_note: string | null;
}

export interface AdminProduct {
  id: string;
  ssg_id: string;
  public_url_id: string;
  version: number;
  publication_status: PublicationStatus;
  draft: ProductDraft | null;
  draft_revision_id: string | null;
  published_revision_id: string | null;
  slug_preview: { bg: string | null; en: string | null };
  units: {
    id: string;
    barcode: string;
    location_code: LocationCode;
    status: StockStatus;
    price: { amount: string; currency: string } | null;
    version: number;
  }[];
  staged_unit_count: number;
  validation_errors: CatalogueFieldError[];
}

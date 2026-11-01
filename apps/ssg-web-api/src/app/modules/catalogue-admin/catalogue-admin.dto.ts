import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { PublicationStatus } from '../../../generated/prisma/enums';
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

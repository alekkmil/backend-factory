import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type {
  LocationCode,
  RestrictionReason,
  SaleChannel,
  StockStatus,
} from '../../../generated/prisma/enums';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().normalize('NFC') : value;
const money = /^\d{1,10}(?:\.\d{1,2})?$/;
const measurement = /^\d{1,9}(?:\.\d{1,3})?$/;

export class EmptyInventoryQueryDto {}

export class DimensionsDto {
  @ValidateIf((_, value: unknown) => value !== undefined)
  @Matches(measurement)
  length?: string;
  @ValidateIf((_, value: unknown) => value !== undefined)
  @Matches(measurement)
  width?: string;
  @ValidateIf((_, value: unknown) => value !== undefined)
  @Matches(measurement)
  height?: string;
  @ValidateIf((_, value: unknown) => value !== undefined)
  @Matches(measurement)
  inner_diameter?: string;
  @ValidateIf((_, value: unknown) => value !== undefined)
  @Matches(measurement)
  circumference?: string;
}

export class VerifiedFactsDto {
  @ValidateIf((_, value: unknown) => value !== null) @Matches(money) price!:
    string | null;
  @ValidateIf((_, value: unknown) => value !== null)
  @Matches(/^[A-Z]{3}$/)
  currency!: string | null;
  @ValidateIf((_, value: unknown) => value !== null)
  @Matches(measurement)
  weight_g!: string | null;
  @ValidateIf((_, value: unknown) => value !== null)
  @Matches(measurement)
  stone_weight_ct!: string | null;
  @ValidateIf((_, value: unknown) => value !== null)
  @IsObject()
  @ValidateNested()
  @Type(() => DimensionsDto)
  dimensions_mm!: DimensionsDto | null;
  @IsISO8601({ strict: true }) verified_at!: string;
  @Transform(trim)
  @IsString()
  @Matches(/\S/)
  @MaxLength(2000)
  source_ref!: string;
}

export class VerifiedLegacySaleDto {
  @IsIn(['online', 'store']) channel!: SaleChannel;
  @ValidateIf((_, value: unknown) => value !== null)
  @IsIn(['sofia', 'nessebar'])
  store_location!: LocationCode | null;
  @Transform(trim)
  @IsString()
  @Matches(/\S/)
  @MaxLength(255)
  document_ref!: string;
  @IsISO8601({ strict: true }) sold_at!: string;
  @Matches(money) amount!: string;
  @Matches(/^[A-Z]{3}$/) currency!: string;
  @ValidateIf((_, value: unknown) => value !== null)
  @IsString()
  @MaxLength(1000)
  seller_provenance!: string | null;
}

export class PromoteVerifiedUnitDto extends VerifiedFactsDto {
  @Matches(/^[A-Za-z0-9._:-]{1,128}$/) request_id!: string;
  @IsUUID() batch_id!: string;
  @Matches(/^SSG-[A-Z0-9]{1,36}$/) ssg_id!: string;
  @Transform(trim) @IsString() @Matches(/\S/) @MaxLength(128) barcode!: string;
  @IsIn(['sofia', 'nessebar']) location_code!: LocationCode;
  @IsIn(['available', 'reserved', 'in_transit', 'blocked', 'sold'])
  stock_status!: StockStatus;
  @ValidateIf((_, value: unknown) => value !== null)
  @IsIn(['sofia', 'nessebar'])
  transfer_to!: LocationCode | null;
  @ValidateIf((_, value: unknown) => value !== null)
  @Transform(trim)
  @IsString()
  @Matches(/\S/)
  @MaxLength(128)
  reservation_reference!: string | null;
  @ValidateIf((_, value: unknown) => value !== null)
  @IsObject()
  @ValidateNested()
  @Type(() => VerifiedLegacySaleDto)
  sale!: VerifiedLegacySaleDto | null;
}

export class VerifiedUnitDetailsDto extends VerifiedFactsDto {
  @Matches(/^[A-Za-z0-9._:-]{1,128}$/) request_id!: string;
  @IsInt() @Min(1) expected_version!: number;
  @IsIn(['damage', 'data_check', 'management_decision', 'other'])
  reason!: RestrictionReason;
  @Transform(trim) @IsString() @Matches(/\S/) @MaxLength(2000) note!: string;
}

export class PhysicalAbsenceDto {
  @Matches(/^[A-Za-z0-9._:-]{1,128}$/) request_id!: string;
  @IsInt() @Min(1) expected_version!: number;
  @Transform(trim)
  @IsString()
  @Matches(/^[A-Za-z0-9._:-]{1,128}$/)
  source_event_id!: string;
  @Transform(trim)
  @IsString()
  @Matches(/\S/)
  @MaxLength(2000)
  evidence_ref!: string;
  @IsIn(['damage', 'data_check', 'management_decision', 'other'])
  reason!: RestrictionReason;
  @Transform(trim) @IsString() @Matches(/\S/) @MaxLength(2000) note!: string;
}

export class StoreSaleDto {
  @Matches(/^[A-Za-z0-9._:-]{1,128}$/) request_id!: string;
  @IsInt() @Min(1) expected_version!: number;
  @Transform(trim)
  @IsString()
  @Matches(/^[A-Za-z0-9._:-]{1,128}$/)
  source_event_id!: string;
  @IsIn(['sofia', 'nessebar']) store_code!: LocationCode;
  @Transform(trim)
  @IsString()
  @Matches(/\S/)
  @MaxLength(255)
  document_ref!: string;
  @IsISO8601({ strict: true }) sold_at!: string;
  @Matches(money) amount!: string;
  @Matches(/^[A-Z]{3}$/) currency!: string;
  @ValidateIf((_, value: unknown) => value !== undefined)
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  seller_provenance?: string;
}

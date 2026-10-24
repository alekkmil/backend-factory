import { Type } from 'class-transformer';
import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export enum EnquiryKind {
  Contact = 'contact',
  Ferry = 'ferry',
  Tunnel = 'tunnel',
}

export enum EnquiryLocale {
  Bulgarian = 'bg',
  English = 'en',
}

export enum TunnelId {
  Frejus = 'frejus',
  MontBlanc = 'mont-blanc',
  NotSure = 'not-sure',
}

export class EnquiryRouteContextDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(100)
  pageId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(100)
  routeId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsEnum(TunnelId)
  tunnelId?: TunnelId;
}

export class SubmitEnquiryDto {
  @IsEnum(EnquiryKind)
  kind!: EnquiryKind;

  @IsEnum(EnquiryLocale)
  locale!: EnquiryLocale;

  @IsString()
  @MaxLength(300)
  @Matches(/^\/(?!\/)[^?#]*$/)
  sourcePath!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsObject()
  @ValidateNested()
  @Type(() => EnquiryRouteContextDto)
  routeContext?: EnquiryRouteContextDto;

  @IsObject()
  fields!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  antiSpamToken?: string;
}

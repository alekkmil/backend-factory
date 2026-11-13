import { Transform, Type } from 'class-transformer';
import {
  IsDefined,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsPhoneNumber,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateBy,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { InquiryType, Locale } from '../../../generated/prisma/enums';

export function normalizeText(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().normalize('NFC') : value;
}

function PlainText(multiline = false): PropertyDecorator {
  return ValidateBy({
    name: 'plainText',
    validator: {
      validate: (value: unknown) => typeof value === 'string' &&
        [...value].every((character) => {
          const code = character.codePointAt(0) ?? 0;
          return character !== '<' && character !== '>' && code !== 127 &&
            (code >= 32 || (multiline && [9, 10, 13].includes(code)));
        }),
      defaultMessage: () => 'Value must be plain text without markup or control characters',
    },
  });
}

export class EnquiryContextDto {
  @IsIn(['product', 'content', 'store'])
  type!: 'product' | 'content' | 'store';

  @IsString()
  @Length(1, 80)
  id!: string;
}

export class EnquiryAttemptDto {
  @IsUUID()
  request_id!: string;
}

export class EnquirySubmitDto extends EnquiryAttemptDto {
  @IsIn(Object.values(InquiryType))
  request_type!: InquiryType;

  @Transform(({ value }) => normalizeText(value))
  @IsString()
  @Length(1, 200)
  @PlainText()
  name!: string;

  @Transform(({ value }) => {
    const text = normalizeText(value);
    if (typeof text !== 'string') return text;
    const at = text.lastIndexOf('@');
    return at < 0 ? text : text.slice(0, at + 1) + text.slice(at + 1).toLowerCase();
  })
  @IsEmail()
  @Length(1, 320)
  email!: string;

  @Transform(({ value }) => normalizeText(value))
  @IsString()
  @Length(3, 40)
  @IsPhoneNumber()
  phone!: string;

  @Transform(({ value }) => normalizeText(value))
  @IsString()
  @Length(1, 250)
  @PlainText()
  topic!: string;

  @Transform(({ value }) => normalizeText(value))
  @IsString()
  @Length(0, 10000)
  @PlainText(true)
  message = '';

  @IsIn(Object.values(Locale))
  language!: Locale;

  @IsString()
  @Length(1, 80)
  origin_route_id!: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Matches(/^[a-z][a-z0-9_]{0,79}$/)
  opening_action?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => EnquiryContextDto)
  origin_entity?: EnquiryContextDto;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => EnquiryContextDto)
  context?: EnquiryContextDto;
}

export class EnquiryTopicsQueryDto {
  @IsIn(Object.values(Locale))
  language!: Locale;
}

export class AdminEnquiryQueryDto {
  @Transform(({ value }) => typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value)
  @IsInt()
  @Min(1)
  @Max(21474836)
  page = 1;

  @Transform(({ value }) => typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value)
  @IsInt()
  @Min(1)
  @Max(100)
  page_size = 24;
}

import { Transform, Type } from 'class-transformer';
import {
  IsDefined,
  IsEmail,
  IsIn,
  IsObject,
  IsPhoneNumber,
  IsString,
  IsUUID,
  Length,
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

  @ValidateIf((object: EnquirySubmitDto, value: unknown) =>
    value !== undefined || object.request_type !== 'general',
  )
  @Transform(({ value }) => normalizeText(value))
  @IsString()
  @Length(3, 40)
  @IsPhoneNumber()
  phone?: string;

  @Transform(({ value }) => normalizeText(value))
  @IsString()
  @Length(1, 250)
  @PlainText()
  topic!: string;

  @Transform(({ value }) => normalizeText(value))
  @IsString()
  @Length(1, 10000)
  @PlainText(true)
  message!: string;

  @IsIn(Object.values(Locale))
  language!: Locale;

  @IsString()
  @Length(1, 80)
  origin_route_id!: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => EnquiryContextDto)
  context?: EnquiryContextDto;
}

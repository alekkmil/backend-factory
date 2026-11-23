import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayUnique,
  Equals,
  IsArray,
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
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Locale } from '../../../generated/prisma/enums';
import { normalizeText } from '../enquiries/enquiry.dto';

const PLAIN_TEXT = /^[^\p{C}<>]+$/u;

export class CheckoutItemDto {
  @IsUUID()
  unitId!: string;

  @IsInt()
  @Equals(1)
  quantity!: number;
}

export class CheckoutContactDto {
  @Transform(({ value }) => normalizeText(value))
  @IsString()
  @Length(1, 100)
  @Matches(PLAIN_TEXT)
  firstName!: string;

  @Transform(({ value }) => normalizeText(value))
  @IsString()
  @Length(1, 100)
  @Matches(PLAIN_TEXT)
  lastName!: string;

  @Transform(({ value }) => normalizeText(value))
  @IsEmail()
  @Length(1, 320)
  email!: string;

  @Transform(({ value }) => normalizeText(value))
  @IsPhoneNumber()
  @Length(3, 40)
  phone!: string;
}

export class CheckoutCardholderDto {
  @Transform(({ value }) => normalizeText(value))
  @IsString()
  @Length(1, 45)
  @Matches(/^[\p{Script=Latin}][\p{Script=Latin} .'-]*$/u)
  name!: string;

  @Transform(({ value }) => normalizeText(value))
  @IsEmail()
  @Length(1, 254)
  email!: string;

  @Transform(({ value }) => normalizeText(value))
  @IsString()
  @Length(1, 50)
  @Matches(PLAIN_TEXT)
  billingAddress!: string;
}

export class CheckoutReceivingDto {
  @IsIn(['econt_address', 'econt_office', 'store_pickup'])
  method!: 'econt_address' | 'econt_office' | 'store_pickup';

  @Equals('BG')
  country!: 'BG';

  @ValidateIf((object: CheckoutReceivingDto) => object.method !== 'store_pickup')
  @Transform(({ value }) => normalizeText(value))
  @IsString()
  @Length(1, 200)
  @Matches(PLAIN_TEXT)
  recipientName?: string;

  @ValidateIf((object: CheckoutReceivingDto) => object.method !== 'store_pickup')
  @Transform(({ value }) => normalizeText(value))
  @IsPhoneNumber()
  @Length(3, 40)
  phone?: string;

  @ValidateIf((object: CheckoutReceivingDto) => object.method === 'econt_address')
  @Transform(({ value }) => normalizeText(value))
  @IsString()
  @Length(1, 200)
  @Matches(PLAIN_TEXT)
  locality?: string;

  @ValidateIf((object: CheckoutReceivingDto) => object.method === 'econt_address')
  @Transform(({ value }) => normalizeText(value))
  @IsString()
  @Length(1, 300)
  @Matches(PLAIN_TEXT)
  address?: string;

  @ValidateIf((object: CheckoutReceivingDto) => object.method === 'econt_office')
  @IsString()
  @Matches(/^[1-9]\d{0,8}$/)
  cityId?: string;

  @ValidateIf((object: CheckoutReceivingDto) => object.method === 'econt_office')
  @IsString()
  @Matches(/^[A-Za-z0-9@._-]{1,80}$/)
  officeCode?: string;
}

export class CreateCheckoutQuoteDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique((item: CheckoutItemDto | null) =>
    typeof item?.unitId === 'string' ? item.unitId.toLowerCase() : item?.unitId,
  )
  @ValidateNested({ each: true })
  @Type(() => CheckoutItemDto)
  items!: CheckoutItemDto[];

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => CheckoutContactDto)
  contact!: CheckoutContactDto;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => CheckoutCardholderDto)
  cardholder!: CheckoutCardholderDto;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => CheckoutReceivingDto)
  receiving!: CheckoutReceivingDto;

  @IsIn(Object.values(Locale))
  locale!: Locale;
}

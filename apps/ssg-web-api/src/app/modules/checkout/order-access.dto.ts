import { IsEmail, IsIn, IsString, IsUUID, Length, Matches } from 'class-validator';
import { Locale } from '../../../generated/prisma/enums';

export class OrderAccessRequestDto {
  @IsString()
  @Matches(/^SSG-[0-9A-F]{24}$/)
  orderNumber!: string;

  @IsEmail()
  @Length(1, 320)
  email!: string;

  @IsIn(Object.values(Locale))
  locale!: Locale;

  @IsUUID()
  requestId!: string;
}

export class OrderAccessSessionDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  grantToken!: string;
}

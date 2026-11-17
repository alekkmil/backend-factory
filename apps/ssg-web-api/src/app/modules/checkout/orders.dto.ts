import { Equals, IsBoolean, IsInt, IsString, IsUUID, Length } from 'class-validator';

export class CommitOrderDto {
  @IsUUID()
  quoteId!: string;

  @IsInt()
  @Equals(1)
  quoteVersion!: number;

  @IsString()
  @Length(1, 80)
  acceptedTermsVersion!: string;

  @IsBoolean()
  @Equals(true)
  accepted!: boolean;
}

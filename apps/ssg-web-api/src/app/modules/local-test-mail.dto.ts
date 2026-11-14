import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

export class LocalTestMailDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().normalize('NFC') : value,
  )
  @IsString()
  @Length(1, 150)
  topic!: string;

  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().normalize('NFC') : value,
  )
  @IsString()
  @Length(1, 4000)
  message!: string;
}

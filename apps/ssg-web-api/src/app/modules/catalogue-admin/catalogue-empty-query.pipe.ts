import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

@Injectable()
export class CatalogueEmptyQueryPipe implements PipeTransform<unknown, void> {
  transform(value: unknown): void {
    if (
      value === null ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).length > 0
    ) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message_key: 'errors.validation',
      });
    }
  }
}

import { BadRequestException } from '@nestjs/common';
import type { ValidationError } from 'class-validator';

export function validationException(errors: ValidationError[]): BadRequestException {
  const fields: [string, string][] = [];
  const visit = (items: ValidationError[], prefix: string): void => {
    for (const error of items) {
      const field = prefix ? `${prefix}.${error.property}` : error.property;
      const constraint = Object.keys(error.constraints ?? {})[0];
      if (constraint) fields.push([field, constraint]);
      if (error.children?.length) visit(error.children, field);
    }
  };
  visit(errors, '');
  return new BadRequestException({
    code: 'VALIDATION_ERROR',
    message_key: 'errors.validation',
    details: Object.fromEntries(fields),
  });
}

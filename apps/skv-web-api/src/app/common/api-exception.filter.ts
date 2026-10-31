import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { requestContext } from './logging/request-context';

interface ApiErrorResponse {
  code: string;
  message_key: string;
  correlation_id: string;
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();
    const correlationId =
      requestContext.getStore()?.requestId ?? 'unavailable';
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : this.isPayloadTooLarge(exception)
          ? HttpStatus.PAYLOAD_TOO_LARGE
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionBody =
      exception instanceof HttpException ? exception.getResponse() : null;
    const customBody =
      exceptionBody !== null &&
      typeof exceptionBody === 'object' &&
      !Array.isArray(exceptionBody)
        ? new Map(Object.entries(exceptionBody))
        : null;
    const customCode = customBody?.get('code');
    const customMessageKey = customBody?.get('message_key');

    if (status === HttpStatus.TOO_MANY_REQUESTS) {
      response.setHeader('Retry-After', '60');
    }
    if (
      !(exception instanceof HttpException) &&
      !this.isPayloadTooLarge(exception)
    ) {
      this.logger.error(
        `Unhandled API exception for ${request.method} ${request.path}`,
        exception instanceof Error ? exception.name : 'unknown',
      );
    }

    const body: ApiErrorResponse = {
      code:
        typeof customCode === 'string'
          ? customCode
          : this.errorCode(status),
      message_key:
        typeof customMessageKey === 'string'
          ? customMessageKey
          : this.messageKey(status),
      correlation_id: correlationId,
    };
    response.status(status).json(body);
  }

  private errorCode(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'VALIDATION_ERROR';
      case HttpStatus.UNAUTHORIZED:
        return 'ACCESS_UNAVAILABLE';
      case HttpStatus.FORBIDDEN:
        return 'FORBIDDEN';
      case HttpStatus.NOT_FOUND:
        return 'NOT_FOUND';
      case HttpStatus.CONFLICT:
        return 'VERSION_CONFLICT';
      case HttpStatus.GONE:
        return 'NOT_FOUND';
      case HttpStatus.PAYLOAD_TOO_LARGE:
        return 'VALIDATION_ERROR';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'TEMPORARY_UNAVAILABLE';
      case HttpStatus.SERVICE_UNAVAILABLE:
        return 'TEMPORARY_UNAVAILABLE';
      default:
        return 'INTERNAL_ERROR';
    }
  }

  private isPayloadTooLarge(exception: unknown): boolean {
    return (
      typeof exception === 'object' &&
      exception !== null &&
      'status' in exception &&
      exception.status === HttpStatus.PAYLOAD_TOO_LARGE
    );
  }

  private messageKey(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'errors.validation';
      case HttpStatus.UNAUTHORIZED:
        return 'errors.access_unavailable';
      case HttpStatus.FORBIDDEN:
        return 'errors.forbidden';
      case HttpStatus.NOT_FOUND:
      case HttpStatus.GONE:
        return 'errors.not_found';
      case HttpStatus.CONFLICT:
        return 'errors.version_conflict';
      case HttpStatus.PAYLOAD_TOO_LARGE:
        return 'errors.payload_too_large';
      case HttpStatus.TOO_MANY_REQUESTS:
      case HttpStatus.SERVICE_UNAVAILABLE:
        return 'errors.temporary_unavailable';
      default:
        return 'errors.internal';
    }
  }
}

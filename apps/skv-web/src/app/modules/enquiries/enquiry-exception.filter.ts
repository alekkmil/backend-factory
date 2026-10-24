import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { BaseExceptionFilter } from "@nestjs/core/exceptions/base-exception-filter";
import { Request, Response } from "express";
import { EnquiryErrorCode, EnquiryException } from "./enquiry-exception";

interface ParserError {
  status?: number;
  type?: string;
}

@Catch()
export class EnquiryExceptionFilter
  extends BaseExceptionFilter
  implements ExceptionFilter
{
  private readonly logger = new Logger(EnquiryExceptionFilter.name);

  constructor(adapterHost: HttpAdapterHost) {
    super(adapterHost.httpAdapter);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const path = request.path.replace(/\/+$/, "");
    if (path !== "/api/enquiries") {
      super.catch(exception, host);
      return;
    }

    const { status, code, fieldErrors, retryAfterSeconds } =
      this.toEnquiryError(exception);
    response.setHeader("Cache-Control", "no-store");
    if (status === HttpStatus.METHOD_NOT_ALLOWED) {
      response.setHeader("Allow", "POST");
    }
    if (retryAfterSeconds !== undefined) {
      response.setHeader("Retry-After", String(retryAfterSeconds));
    }

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `Enquiry request failed with ${code}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(status);
    if (request.method === "HEAD") {
      response.end();
      return;
    }

    response.json({
      code,
      requestId: response.getHeader("X-Request-ID")?.toString(),
      ...(fieldErrors === undefined ? {} : { fieldErrors }),
    });
  }

  private toEnquiryError(exception: unknown): {
    status: number;
    code: EnquiryErrorCode;
    fieldErrors?: EnquiryException["fieldErrors"];
    retryAfterSeconds?: number;
  } {
    if (exception instanceof EnquiryException) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        ...(exception.fieldErrors === undefined
          ? {}
          : { fieldErrors: exception.fieldErrors }),
        ...(exception.retryAfterSeconds === undefined
          ? {}
          : { retryAfterSeconds: exception.retryAfterSeconds }),
      };
    }

    if (exception instanceof HttpException) {
      return this.errorForStatus(exception.getStatus());
    }

    const parserError: ParserError =
      typeof exception === "object" && exception !== null
        ? (exception as ParserError)
        : { status: undefined, type: undefined };
    if (
      parserError.type === "entity.parse.failed" ||
      parserError.status === 400
    ) {
      return this.errorForStatus(HttpStatus.BAD_REQUEST);
    }
    if (
      parserError.type === "entity.too.large" ||
      parserError.status === HttpStatus.PAYLOAD_TOO_LARGE
    ) {
      return this.errorForStatus(HttpStatus.PAYLOAD_TOO_LARGE);
    }

    return this.errorForStatus(HttpStatus.SERVICE_UNAVAILABLE);
  }

  private errorForStatus(status: number): {
    status: number;
    code: EnquiryErrorCode;
  } {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return { status, code: "invalid_request" };
      case HttpStatus.FORBIDDEN:
        return { status, code: "origin_rejected" };
      case HttpStatus.METHOD_NOT_ALLOWED:
        return { status, code: "method_not_allowed" };
      case HttpStatus.CONFLICT:
        return { status, code: "idempotency_conflict" };
      case HttpStatus.PAYLOAD_TOO_LARGE:
        return { status, code: "payload_too_large" };
      case HttpStatus.UNSUPPORTED_MEDIA_TYPE:
        return { status, code: "unsupported_media_type" };
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return { status, code: "validation_failed" };
      case HttpStatus.TOO_MANY_REQUESTS:
        return { status, code: "rate_limited" };
      default:
        return {
          status: HttpStatus.SERVICE_UNAVAILABLE,
          code: "service_unavailable",
        };
    }
  }
}

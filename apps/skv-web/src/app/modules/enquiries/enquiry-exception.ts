import { HttpException, HttpStatus } from '@nestjs/common';

export type EnquiryErrorCode =
  | 'invalid_request'
  | 'method_not_allowed'
  | 'validation_failed'
  | 'origin_rejected'
  | 'spam_rejected'
  | 'challenge_required'
  | 'idempotency_conflict'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'rate_limited'
  | 'service_unavailable';

export type EnquiryFieldErrorCode =
  | 'required'
  | 'too_long'
  | 'invalid_email'
  | 'invalid_date'
  | 'invalid_choice'
  | 'invalid_context';

export class EnquiryException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: EnquiryErrorCode,
    readonly fieldErrors?: Record<string, EnquiryFieldErrorCode[]>,
    readonly retryAfterSeconds?: number,
  ) {
    super(code, status);
  }
}

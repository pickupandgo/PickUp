import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from './error-codes';

/** Shape of every error response body. */
export interface ErrorResponseBody {
  readonly error: {
    readonly code: ErrorCode;
    readonly message: string;
    readonly requestId?: string;
    readonly details?: Readonly<Record<string, unknown>>;
  };
}

/** Safe default message per status, used when the original message must not be exposed. */
const DEFAULT_MESSAGES: Readonly<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: 'Bad request',
  [HttpStatus.UNAUTHORIZED]: 'Authentication required',
  [HttpStatus.FORBIDDEN]: 'You do not have access to this resource',
  [HttpStatus.NOT_FOUND]: 'Resource not found',
  [HttpStatus.METHOD_NOT_ALLOWED]: 'Method not allowed',
  [HttpStatus.CONFLICT]: 'Request conflicts with the current state',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'Request body is too large',
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'Unsupported content type',
  [HttpStatus.TOO_MANY_REQUESTS]: 'Too many requests, please retry later',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'Service temporarily unavailable, please retry',
};

const CODES: Readonly<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.VALIDATION_FAILED,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.AUTH_REQUIRED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [HttpStatus.METHOD_NOT_ALLOWED]: ErrorCode.NOT_FOUND,
  [HttpStatus.CONFLICT]: ErrorCode.CONFLICT,
  [HttpStatus.PAYLOAD_TOO_LARGE]: ErrorCode.PAYLOAD_TOO_LARGE,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.RATE_LIMITED,
  [HttpStatus.SERVICE_UNAVAILABLE]: ErrorCode.SERVICE_UNAVAILABLE,
};

export function defaultMessageFor(status: number): string {
  return DEFAULT_MESSAGES[status] ?? (status >= 500 ? 'Internal server error' : 'Request failed');
}

export function codeForStatus(status: number): ErrorCode {
  return CODES[status] ?? (status >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.VALIDATION_FAILED);
}

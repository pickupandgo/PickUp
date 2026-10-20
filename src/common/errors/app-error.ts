import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from './error-codes';

/**
 * Domain error with a stable code. The message is safe to show to clients; never put secrets,
 * tokens, SQL or provider payloads in it. Put structured, non-sensitive context in `details`.
 */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: HttpStatus,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (code: ErrorCode, message: string): AppError =>
  new AppError(code, HttpStatus.NOT_FOUND, message);

export const forbidden = (message = 'You do not have access to this resource'): AppError =>
  new AppError(ErrorCode.FORBIDDEN, HttpStatus.FORBIDDEN, message);

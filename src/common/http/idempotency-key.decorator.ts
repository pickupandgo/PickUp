import { createParamDecorator, ExecutionContext, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';

export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

/** UUIDs fit; the 64-character cap keeps derived ledger keys within their column size. */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * Reads and validates the `Idempotency-Key` header. Clients generate one key per logical
 * operation and reuse it on every retry of that operation.
 */
export const IdempotencyKey = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<Request>();
    const raw = request.headers['idempotency-key'];
    if (raw === undefined) {
      throw new AppError(
        ErrorCode.IDEMPOTENCY_KEY_REQUIRED,
        HttpStatus.BAD_REQUEST,
        `${IDEMPOTENCY_KEY_HEADER} header is required`,
      );
    }
    if (typeof raw !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(raw)) {
      throw new AppError(
        ErrorCode.IDEMPOTENCY_KEY_INVALID,
        HttpStatus.BAD_REQUEST,
        `${IDEMPOTENCY_KEY_HEADER} must be 16-64 characters of letters, digits, "-" or "_"`,
      );
    }
    return raw;
  },
);

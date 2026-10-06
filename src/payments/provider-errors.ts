import { HttpStatus } from '@nestjs/common';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { RazorpayApiError, RazorpayUnavailableError } from '../razorpay/razorpay.errors';

/** Converts Razorpay client errors into client-safe API errors. Other errors pass through. */
export function toProviderAppError(error: unknown): unknown {
  if (error instanceof RazorpayUnavailableError) {
    return new AppError(
      ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE,
      HttpStatus.SERVICE_UNAVAILABLE,
      'Payment provider is temporarily unavailable, please retry',
    );
  }
  if (error instanceof RazorpayApiError) {
    return new AppError(
      ErrorCode.PAYMENT_PROVIDER_ERROR,
      HttpStatus.BAD_GATEWAY,
      'Payment provider rejected the request',
    );
  }
  return error;
}

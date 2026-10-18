import { HttpStatus } from '@nestjs/common';
import { engineError } from '../common/errors';
import type { EngineOutbox } from '../generated/prisma/client';
import type { PaymentGate } from '../payment-backend/payment-backend.types';

/** 409 PAYMENT_REQUIRED, with what the payment backend says is owed. The OTP is never checked. */
export function paymentRequired(
  message: string,
  gate: Partial<PaymentGate> & { readonly stage: 'PICKUP' | 'DROP' },
) {
  return engineError(HttpStatus.CONFLICT, 'PAYMENT_REQUIRED', message, {
    stage: gate.stage,
    stopSequence: gate.stopSequence ?? null,
    amountPaise: gate.amountPaise ?? null,
    paymentState: gate.paymentState ?? null,
  });
}

/** The payment backend refused a backend-first command: the engine changed nothing. */
export function refusedCommand(record: EngineOutbox, action: string) {
  const result = (record.result ?? {}) as Record<string, unknown>;
  const details = (result['details'] ?? null) as Record<string, unknown> | null;
  if (record.lastErrorCode === 'PAYMENT_REQUIRED') {
    return engineError(
      HttpStatus.CONFLICT,
      'PAYMENT_REQUIRED',
      `Payment is required before ${action}`,
      details ?? undefined,
    );
  }
  if (record.lastErrorCode === 'SUPERSEDED') {
    return engineError(
      HttpStatus.CONFLICT,
      'BOOKING_CANCELLED',
      `The booking was cancelled before ${action} was confirmed`,
    );
  }
  const status =
    record.lastHttpStatus &&
    record.lastHttpStatus >= 400 &&
    record.lastHttpStatus < 500
      ? record.lastHttpStatus
      : HttpStatus.CONFLICT;
  return engineError(
    status,
    record.lastErrorCode ?? 'PAYMENT_BACKEND_REFUSED',
    `The payment backend refused ${action}${record.lastError ? `: ${record.lastError}` : ''}`,
    details ?? undefined,
  );
}

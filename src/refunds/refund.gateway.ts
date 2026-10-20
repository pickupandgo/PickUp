import type { z } from 'zod';
import type { razorpayRefundSchema } from '../razorpay/razorpay.types';

/**
 * Port for provider refunds (Razorpay): money a customer paid online to Nikhil Enterprises goes
 * back to the payment method it came from. Only the refunds service calls it, for a refund an
 * admin requested (payment flow Phase 6); nothing here decides whether a refund is due.
 *
 * Implementations throw RazorpayApiError (definitive) or RazorpayUnavailableError (retryable).
 * Callers never hold database locks while calling these methods.
 */

/** Stored on every provider refund (CHECK). The simulated provider stands in for Razorpay. */
export const REFUND_PROVIDER_RAZORPAY = 'RAZORPAY';

/** Razorpay refund statuses. Anything else is treated as still in progress. */
export const ProviderRefundStatus = {
  PENDING: 'pending',
  PROCESSED: 'processed',
  FAILED: 'failed',
} as const;

export interface ProviderRefund {
  /** rfnd_... */
  readonly id: string;
  /** pay_..., the payment refunded. */
  readonly paymentId: string;
  readonly amount: number;
  readonly currency: string;
  /** pending | processed | failed */
  readonly status: string;
  /** Our refund id, sent as the receipt. */
  readonly receipt: string | null;
  /** The notes sent with the refund (refund_id, booking_id and the source). */
  readonly notes: Readonly<Record<string, string>>;
  /** The bank's reference for a processed refund (ARN, RRN or UTR), when reported. */
  readonly reference: string | null;
}

export interface CreateRefundInput {
  /** Our refund id: X-Refund-Idempotency and receipt, so a retry never refunds twice. */
  readonly refundId: string;
  readonly providerPaymentId: string;
  readonly amountPaise: number;
  /** Non-sensitive metadata. Razorpay allows at most 15 pairs of 256 characters. */
  readonly notes: Readonly<Record<string, string>>;
}

export abstract class RefundGateway {
  /** False when provider refunds are off (REFUND_PROVIDER=disabled); every call then fails. */
  abstract readonly enabled: boolean;

  /** POST /v1/payments/:id/refund, idempotent on the refund id. */
  abstract createRefund(input: CreateRefundInput): Promise<ProviderRefund>;

  /** GET /v1/refunds/:id */
  abstract fetchRefund(providerRefundId: string): Promise<ProviderRefund>;

  /** GET /v1/payments/:id/refunds: recovery after a lost reply (ours carry our receipt). */
  abstract listPaymentRefunds(providerPaymentId: string): Promise<ProviderRefund[]>;
}

/** The provider refund that carries our refund id (receipt or notes.refund_id), if any. */
export function findOurRefund(
  refunds: readonly ProviderRefund[],
  refundId: string,
): ProviderRefund | null {
  return (
    refunds.find((refund) => refund.receipt === refundId || refund.notes.refund_id === refundId) ??
    null
  );
}

export function toProviderRefund(raw: z.infer<typeof razorpayRefundSchema>): ProviderRefund {
  return {
    id: raw.id,
    paymentId: raw.payment_id,
    amount: raw.amount,
    currency: raw.currency,
    status: raw.status,
    receipt: raw.receipt ?? null,
    notes: stringRecord(raw.notes),
    reference: acquirerReference(raw.acquirer_data),
  };
}

/** Razorpay notes: an object of short strings, or [] when empty. Anything else counts as none. */
function stringRecord(value: unknown): Readonly<Record<string, string>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const notes: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string' && entry.length <= 256) {
      notes[key] = entry;
    } else if (typeof entry === 'number' && Number.isFinite(entry)) {
      notes[key] = String(entry);
    }
  }
  return notes;
}

/** acquirer_data.arn / rrn / utr: the bank's reference for the refund, once there is one. */
function acquirerReference(value: unknown): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const data = value as Record<string, unknown>;
  for (const key of ['arn', 'rrn', 'utr']) {
    const entry = data[key];
    if (typeof entry === 'string' && entry.trim().length > 0 && entry.length <= 100) {
      return entry.trim();
    }
  }
  return null;
}

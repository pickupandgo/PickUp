import type { RefundCase } from '../config/env.schema';

/**
 * Pure refund rules (payment flow Phase 6). Only technical rules live here: what a refund's facts
 * are, how much of a source is left, and how a provider status moves a refund. Whether a refund
 * is due at all is an open business decision (OPEN_DECISIONS L-7 to L-10, L-21): an admin
 * decides each one, within the configured safe defaults.
 */

export const RefundKind = {
  /** Razorpay refunds the customer's online payment (QR collection or historical prepaid). */
  PROVIDER: 'PROVIDER',
  /** The cash a driver collected was handed back to the customer; recorded, nothing is sent. */
  CASH_RETURNED: 'CASH_RETURNED',
} as const;
export type RefundKind = (typeof RefundKind)[keyof typeof RefundKind];

export const RefundStatus = {
  /** Recorded; not (or not yet known to be) accepted by the provider. */
  PENDING: 'PENDING',
  /** The provider accepted it and is processing it (Razorpay `pending`). */
  PROCESSING: 'PROCESSING',
  /** The money went back (Razorpay `processed`, or the cash was handed back). */
  COMPLETED: 'COMPLETED',
  /** The provider accepted it, then failed it. Nothing was refunded. */
  FAILED: 'FAILED',
  /** The provider rejected the request outright. Nothing was refunded. */
  REFUSED: 'REFUSED',
  /** An admin withdrew it before it reached the provider. Nothing was refunded. */
  CANCELLED: 'CANCELLED',
} as const;
export type RefundStatus = (typeof RefundStatus)[keyof typeof RefundStatus];

/** A refund that may still move money: one per source at a time (partial unique index). */
export const LIVE_REFUND_STATUSES: readonly RefundStatus[] = ['PENDING', 'PROCESSING'];

export const FeeTreatment = {
  /** The cash platform fee stays debited from the driver's wallet. */
  KEPT: 'KEPT',
  /** The cash platform fee is credited back to the collecting driver's wallet (REFUND_REVERSAL). */
  CREDITED_TO_WALLET: 'CREDITED_TO_WALLET',
} as const;
export type FeeTreatment = (typeof FeeTreatment)[keyof typeof FeeTreatment];

export interface RefundCaseFacts {
  readonly bookingStatus: 'CANCELLED' | 'COMPLETED';
  /**
   * The goods behind the refunded money were handed over: picked up (trip pickup verified) for
   * money collected for the whole booking, delivered for money collected for one drop.
   */
  readonly handedOver: boolean;
  /** The refunded money's drop, for a collection made drop by drop. */
  readonly stopStatus: string | null;
}

/**
 * What the booking's facts show, recorded on the refund for review. It decides nothing by itself;
 * REFUND_ALLOWED_CASES only narrows which cases an admin may refund (L-7, open).
 */
export function refundCaseOf(facts: RefundCaseFacts): RefundCase {
  if (facts.stopStatus === 'UNDELIVERED') {
    return 'UNDELIVERED_DROP';
  }
  if (facts.bookingStatus === 'COMPLETED') {
    return 'COMPLETED_BOOKING';
  }
  return facts.handedOver ? 'CANCELLED_AFTER_HANDOVER' : 'CANCELLED_BEFORE_HANDOVER';
}

export type RefundAmountResult =
  | { readonly ok: true; readonly amountPaise: bigint }
  | { readonly ok: false; readonly reason: 'NOTHING_LEFT' | 'PARTIAL_NOT_ALLOWED' | 'TOO_MUCH' };

/**
 * The amount of a new refund, always computed on the server from what is left of the source.
 * Partial refunds off (REFUND_PARTIAL_ALLOWED=false, the default): everything that is left; an
 * admin may confirm that amount but never choose another. On: 1 paisa up to what is left.
 */
export function resolveRefundAmount(input: {
  readonly refundablePaise: bigint;
  readonly requestedPaise: bigint | null;
  readonly partialAllowed: boolean;
}): RefundAmountResult {
  if (input.refundablePaise <= 0n) {
    return { ok: false, reason: 'NOTHING_LEFT' };
  }
  if (input.requestedPaise === null) {
    return { ok: true, amountPaise: input.refundablePaise };
  }
  if (input.requestedPaise > input.refundablePaise || input.requestedPaise <= 0n) {
    return { ok: false, reason: 'TOO_MUCH' };
  }
  if (input.requestedPaise !== input.refundablePaise && !input.partialAllowed) {
    return { ok: false, reason: 'PARTIAL_NOT_ALLOWED' };
  }
  return { ok: true, amountPaise: input.requestedPaise };
}

/** Razorpay refund status -> our refund status. Unknown statuses count as still processing. */
export function refundStatusForProvider(
  providerStatus: string,
): 'PROCESSING' | 'COMPLETED' | 'FAILED' {
  switch (providerStatus) {
    case 'processed':
      return 'COMPLETED';
    case 'failed':
      return 'FAILED';
    default:
      return 'PROCESSING';
  }
}

export type RefundMove =
  /** Apply the provider's state. */
  | 'APPLY'
  /** Already in that state (a repeated webhook, a sync after the webhook): refresh only. */
  | 'ALREADY_APPLIED'
  /** An older provider state after a newer one (refund.created after refund.processed). */
  | 'STALE'
  /** The provider reports something our record rules out: needs a human. */
  | 'CONFLICT';

/**
 * Forward-only moves. A refund we closed without the provider (REFUSED, CANCELLED) that the
 * provider reports anyway, and a failure reported for a completed refund (or the reverse), are
 * conflicts for an admin: nothing is applied automatically.
 */
export function refundMove(
  current: RefundStatus,
  target: 'PROCESSING' | 'COMPLETED' | 'FAILED',
): RefundMove {
  switch (current) {
    case 'PENDING':
      return 'APPLY';
    case 'PROCESSING':
      return target === 'PROCESSING' ? 'ALREADY_APPLIED' : 'APPLY';
    case 'COMPLETED':
      return target === 'COMPLETED'
        ? 'ALREADY_APPLIED'
        : target === 'PROCESSING'
          ? 'STALE'
          : 'CONFLICT';
    case 'FAILED':
      return target === 'FAILED'
        ? 'ALREADY_APPLIED'
        : target === 'PROCESSING'
          ? 'STALE'
          : 'CONFLICT';
    case 'REFUSED':
    case 'CANCELLED':
      return 'CONFLICT';
  }
}

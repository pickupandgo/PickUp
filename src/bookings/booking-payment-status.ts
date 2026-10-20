/** What a booking's completed collections say it is paid (payment flow Phase 4). */
export type CollectedPaymentStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';

export interface CollectedPaymentInput {
  /** PAY_AT_DELIVERY priced per drop: each drop is paid on its own. */
  readonly perDrop: boolean;
  /** The booking's drops. */
  readonly stopIds: readonly string[];
  /** The booking's COMPLETED collections. */
  readonly completed: readonly { readonly bookingStopId: string | null }[];
}

/**
 * A booking paid drop by drop is UNPAID until its first drop is paid, PARTIALLY_PAID while some of
 * its drops are, and PAID once every drop is. Any other booking is paid in one go: PAID once its
 * one collection for the whole booking completed. The database computes the same thing
 * (booking_collected_status) and refuses any other payment status.
 */
export function collectedPaymentStatus(input: CollectedPaymentInput): CollectedPaymentStatus {
  if (!input.perDrop) {
    return input.completed.some((collection) => collection.bookingStopId === null)
      ? 'PAID'
      : 'UNPAID';
  }
  const stops = new Set(input.stopIds);
  const paid = new Set(
    input.completed.flatMap((collection) =>
      collection.bookingStopId !== null && stops.has(collection.bookingStopId)
        ? [collection.bookingStopId]
        : [],
    ),
  );
  if (paid.size === 0) {
    return 'UNPAID';
  }
  return paid.size === stops.size ? 'PAID' : 'PARTIALLY_PAID';
}

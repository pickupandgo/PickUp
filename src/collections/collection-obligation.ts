import { DELIVERY_COLLECTION_WINDOW, PICKUP_COLLECTION_WINDOW } from '../bookings/trip-lifecycle';
import type {
  BookingPaymentMethod,
  BookingPaymentModel,
  BookingPaymentStatus,
  BookingStatus,
  BookingStopStatus,
  TripStatus,
} from '../generated/prisma/enums';

/**
 * What one collection pays for (payment flow Phase 4): exactly one obligation, resolved on the
 * server from the booking's frozen snapshot, never from the request.
 *
 *   PAY_AT_PICKUP (every booking model)  the whole booking, from the driver's arrival
 *   PAY_AT_DELIVERY, historical          the whole booking, once it is delivered
 *   PAY_AT_DELIVERY, priced per drop     the drop the driver is at (ARRIVED, not paid yet), for
 *                                        that drop's frozen payable amount
 *
 * The database enforces the same rules (guard_collection_insert).
 */
export interface CollectionObligation {
  readonly stage: 'PICKUP' | 'DELIVERY';
  /** The drop paid for; null when the collection is for the whole booking. */
  readonly stop: { readonly id: string; readonly sequence: number } | null;
  /** What the customer pays, in paise: the booking's payable amount, or the drop's. */
  readonly amountPaise: bigint;
  /** The platform fee debited from the driver's wallet when this is paid in cash. */
  readonly cashFeePaise: bigint;
}

export interface ObligationBooking {
  readonly status: BookingStatus;
  readonly paymentMethod: BookingPaymentMethod;
  readonly paymentModel: BookingPaymentModel;
  readonly paymentStatus: BookingPaymentStatus;
  /** The booking's payable amount, frozen at registration. */
  readonly finalFareMinor: bigint;
}

export interface ObligationStop {
  readonly id: string;
  readonly sequence: number;
  readonly status: BookingStopStatus;
  readonly payablePaise: bigint;
  readonly platformFeeSharePaise: bigint;
}

export interface ObligationContext {
  readonly booking: ObligationBooking;
  readonly tripStatus: TripStatus;
  /** The booking's drops (bookings priced per drop); empty for a historical booking. */
  readonly stops: readonly ObligationStop[];
  /** The booking's platform fee: frozen at registration, or a historical booking's pinned rule's. */
  readonly bookingFeePaise: bigint;
}

export interface ObligationRequest {
  /** What the driver says the customer pays: a confirmation echo, never the amount itself. */
  readonly amountPaise: bigint;
  /** The drop being paid for: required when the booking is paid drop by drop, refused otherwise. */
  readonly stopSequence: number | null;
}

export type ObligationRefusal =
  /** A prepaid booking: paid in the app, never collected by the driver. */
  | { readonly kind: 'NOT_COLLECTED' }
  /** Paid drop by drop, but the request names no drop. */
  | { readonly kind: 'STOP_REQUIRED' }
  /** Paid for the whole booking, but the request names a drop. */
  | { readonly kind: 'STOP_NOT_EXPECTED' }
  | { readonly kind: 'ALREADY_PAID' }
  | { readonly kind: 'BOOKING_CLOSED' }
  /** Not collectable at this point of the trip (before the pickup, or before delivery). */
  | { readonly kind: 'WINDOW_CLOSED'; readonly stage: 'PICKUP' | 'DELIVERY' }
  | { readonly kind: 'STOP_NOT_FOUND'; readonly stopSequence: number }
  /** Not the drop the driver is at: not reached yet, already paid, failed, or finished. */
  | {
      readonly kind: 'NOT_CURRENT_STOP';
      readonly stopSequence: number;
      readonly reason: 'STOP_ALREADY_PAID' | 'NOT_CURRENT';
      readonly stopStatus: BookingStopStatus;
      /** The drop the driver is at, if any. */
      readonly currentStop: number | null;
    }
  | { readonly kind: 'AMOUNT_MISMATCH'; readonly expectedPaise: bigint };

export type ObligationDecision =
  | { readonly ok: true; readonly obligation: CollectionObligation }
  | { readonly ok: false; readonly refusal: ObligationRefusal };

/** A drop whose payment is confirmed: paid, then handed over or about to be. */
const PAID_STOP_STATUSES: ReadonlySet<BookingStopStatus> = new Set([
  'PAYMENT_CONFIRMED',
  'DELIVERED',
]);

/** True for a PAY_AT_DELIVERY booking priced per drop: it is collected drop by drop. */
export function isPerDropDelivery(
  booking: Pick<ObligationBooking, 'paymentMethod' | 'paymentModel'>,
): boolean {
  return booking.paymentMethod === 'PAY_AT_DELIVERY' && booking.paymentModel === 'QUOTE_PER_STOP';
}

export function resolveObligation(
  context: ObligationContext,
  request: ObligationRequest,
): ObligationDecision {
  const { booking, tripStatus } = context;
  const stage = stageOf(booking.paymentMethod);
  if (!stage) {
    return refuse({ kind: 'NOT_COLLECTED' });
  }
  if (isPerDropDelivery(booking)) {
    return resolveDrop(context, request);
  }
  if (request.stopSequence !== null) {
    return refuse({ kind: 'STOP_NOT_EXPECTED' });
  }
  if (booking.paymentStatus !== 'UNPAID') {
    return refuse({ kind: 'ALREADY_PAID' });
  }
  if (isClosed(booking.status, tripStatus)) {
    return refuse({ kind: 'BOOKING_CLOSED' });
  }
  const window = stage === 'PICKUP' ? PICKUP_COLLECTION_WINDOW : DELIVERY_COLLECTION_WINDOW;
  if (!window.has(tripStatus)) {
    return refuse({ kind: 'WINDOW_CLOSED', stage });
  }
  if (request.amountPaise !== booking.finalFareMinor) {
    return refuse({ kind: 'AMOUNT_MISMATCH', expectedPaise: booking.finalFareMinor });
  }
  return {
    ok: true,
    obligation: {
      stage,
      stop: null,
      amountPaise: booking.finalFareMinor,
      cashFeePaise: context.bookingFeePaise,
    },
  };
}

/** The drop the driver is at, if it is the one named, unpaid, for exactly its payable amount. */
function resolveDrop(context: ObligationContext, request: ObligationRequest): ObligationDecision {
  const { booking, tripStatus } = context;
  if (request.stopSequence === null) {
    return refuse({ kind: 'STOP_REQUIRED' });
  }
  if (booking.paymentStatus !== 'UNPAID' && booking.paymentStatus !== 'PARTIALLY_PAID') {
    return refuse({ kind: 'ALREADY_PAID' });
  }
  if (isClosed(booking.status, tripStatus)) {
    return refuse({ kind: 'BOOKING_CLOSED' });
  }
  const stop = context.stops.find((candidate) => candidate.sequence === request.stopSequence);
  if (!stop) {
    return refuse({ kind: 'STOP_NOT_FOUND', stopSequence: request.stopSequence });
  }
  if (stop.status !== 'ARRIVED') {
    const current = context.stops.find(
      (candidate) => candidate.status === 'ARRIVED' || candidate.status === 'PAYMENT_CONFIRMED',
    );
    return refuse({
      kind: 'NOT_CURRENT_STOP',
      stopSequence: stop.sequence,
      reason: PAID_STOP_STATUSES.has(stop.status) ? 'STOP_ALREADY_PAID' : 'NOT_CURRENT',
      stopStatus: stop.status,
      currentStop: current?.sequence ?? null,
    });
  }
  if (request.amountPaise !== stop.payablePaise) {
    return refuse({ kind: 'AMOUNT_MISMATCH', expectedPaise: stop.payablePaise });
  }
  return {
    ok: true,
    obligation: {
      stage: 'DELIVERY',
      stop: { id: stop.id, sequence: stop.sequence },
      amountPaise: stop.payablePaise,
      cashFeePaise: stop.platformFeeSharePaise,
    },
  };
}

function stageOf(method: BookingPaymentMethod): 'PICKUP' | 'DELIVERY' | null {
  switch (method) {
    case 'PAY_AT_PICKUP':
      return 'PICKUP';
    case 'PAY_AT_DELIVERY':
      return 'DELIVERY';
    default:
      return null;
  }
}

function isClosed(status: BookingStatus, tripStatus: TripStatus): boolean {
  return (
    status === 'CANCELLED' ||
    status === 'COMPLETED' ||
    tripStatus === 'CANCELLED' ||
    tripStatus === 'COMPLETED'
  );
}

function refuse(refusal: ObligationRefusal): ObligationDecision {
  return { ok: false, refusal };
}

import type {
  BookingPaymentMethod,
  BookingStopStatus,
  TripStatus,
} from '../generated/prisma/enums';

/**
 * The stop lifecycle of a booking priced per drop (QUOTE_PER_STOP), as approved in
 * docs/PAYMENT_FLOW_FINAL_REVIEW.md section E. The database enforces the same rules
 * (guard_booking_stop_update); these functions decide first, so callers get a clear error.
 *
 *   PENDING           -> ARRIVED            engine: the trip is under way, every earlier drop finished
 *   ARRIVED           -> PAYMENT_CONFIRMED  backend only: a completed collection for this drop
 *   PAYMENT_CONFIRMED -> DELIVERED          engine: PAY_AT_DELIVERY, the drop is paid
 *   ARRIVED           -> DELIVERED          engine: PAY_AT_PICKUP, the booking is paid
 *   ARRIVED / PAYMENT_CONFIRMED -> DELIVERY_FAILED   engine, with a reason
 *   DELIVERY_FAILED   -> ARRIVED (unpaid) or PAYMENT_CONFIRMED (paid)   engine or admin retry
 *   DELIVERY_FAILED   -> UNDELIVERED        admin only, with a reason and an audit record
 *   any unfinished    -> CANCELLED          the booking's cancellation
 */

/** What the trip engine reports for a drop. PAYMENT_CONFIRMED is set by this backend. */
export const ENGINE_STOP_STATUSES = [
  'ARRIVED',
  'DELIVERED',
  'DELIVERY_FAILED',
] as const satisfies readonly BookingStopStatus[];
export type EngineStopStatus = (typeof ENGINE_STOP_STATUSES)[number];

/** An admin's decision on a failed delivery attempt. */
export const STOP_RESOLUTIONS = ['RETRY', 'UNDELIVERED'] as const;
export type StopResolution = (typeof STOP_RESOLUTIONS)[number];

/** A drop is finished once delivered, resolved as undelivered, or cancelled. */
export const FINAL_STOP_STATUSES: ReadonlySet<BookingStopStatus> = new Set([
  'DELIVERED',
  'UNDELIVERED',
  'CANCELLED',
]);

/** The drop the driver is at. At most one per booking (uq_booking_stops_current). */
export const CURRENT_STOP_STATUSES: ReadonlySet<BookingStopStatus> = new Set([
  'ARRIVED',
  'PAYMENT_CONFIRMED',
]);

/** Trip statuses in which drops are reached. */
export const UNDER_WAY_TRIP_STATUSES: ReadonlySet<TripStatus> = new Set([
  'IN_TRANSIT',
  'DROP_PROGRESS',
]);

export interface StopState {
  readonly sequence: number;
  readonly status: BookingStopStatus;
  /** A completed collection exists for this drop (pay-at-delivery drops only). */
  readonly paid: boolean;
  /** The last failed delivery attempt, if any. */
  readonly failedAt: Date | null;
}

export interface StopContext {
  readonly paymentMethod: BookingPaymentMethod;
  /** The booking's payment status is not UNPAID. */
  readonly bookingPaid: boolean;
  /** The booking or its trip is COMPLETED or CANCELLED. */
  readonly closed: boolean;
  /** Null before a driver is assigned. */
  readonly tripStatus: TripStatus | null;
  /** Every stop of the booking. */
  readonly stops: readonly StopState[];
}

export type StopRefusal =
  /** The booking or its trip is closed, or the drop was cancelled with its booking. */
  | 'BOOKING_CLOSED'
  /** A drop is reached only while the trip is IN_TRANSIT or DROP_PROGRESS. */
  | 'TRIP_NOT_UNDER_WAY'
  /** An earlier drop is not finished, or another drop is current. */
  | 'OUT_OF_ORDER'
  /** The move is not in the state machine. */
  | 'INVALID_TRANSITION'
  /** The drop cannot be handed over before it (or the booking) is paid. */
  | 'PAYMENT_REQUIRED';

export type StopDecision =
  | { readonly kind: 'NO_CHANGE' }
  | { readonly kind: 'MOVE'; readonly to: BookingStopStatus }
  | { readonly kind: 'REFUSE'; readonly refusal: StopRefusal };

const NO_CHANGE: StopDecision = { kind: 'NO_CHANGE' };
const move = (to: BookingStopStatus): StopDecision => ({ kind: 'MOVE', to });
const refuse = (refusal: StopRefusal): StopDecision => ({ kind: 'REFUSE', refusal });

export function isFinalStop(status: BookingStopStatus): boolean {
  return FINAL_STOP_STATUSES.has(status);
}

/**
 * The drop that matters now: the current one if the driver is at a drop, otherwise the first
 * unfinished drop (PENDING, or a failed attempt waiting for a retry or a resolution). Null once
 * every drop is finished.
 */
export function focusStop<
  T extends { readonly sequence: number; readonly status: BookingStopStatus },
>(stops: readonly T[]): T | null {
  const ordered = [...stops].sort((a, b) => a.sequence - b.sequence);
  return (
    ordered.find((stop) => CURRENT_STOP_STATUSES.has(stop.status)) ??
    ordered.find((stop) => !isFinalStop(stop.status)) ??
    null
  );
}

/**
 * What a status reported by the trip engine does to a drop. Repeats, and statuses the drop has
 * already passed, change nothing, so engine retries are safe.
 */
export function decideEngineStopRequest(
  context: StopContext,
  stop: StopState,
  requested: EngineStopStatus,
): StopDecision {
  if (stop.status === 'CANCELLED') {
    return refuse('BOOKING_CLOSED');
  }
  switch (requested) {
    case 'ARRIVED':
      if (stop.status === 'PENDING') {
        return arrive(context, stop);
      }
      if (stop.status === 'DELIVERY_FAILED') {
        return retry(context, stop);
      }
      // ARRIVED, PAYMENT_CONFIRMED, DELIVERED, UNDELIVERED: the drop was already reached.
      return NO_CHANGE;
    case 'DELIVERED':
      if (stop.status === 'DELIVERED') {
        return NO_CHANGE;
      }
      if (stop.status === 'ARRIVED' || stop.status === 'PAYMENT_CONFIRMED') {
        return handOver(context, stop);
      }
      // PENDING (not reached), DELIVERY_FAILED (retry first), UNDELIVERED (resolved).
      return refuse('INVALID_TRANSITION');
    case 'DELIVERY_FAILED':
      if (stop.status === 'DELIVERY_FAILED' || stop.status === 'UNDELIVERED') {
        return NO_CHANGE;
      }
      if (stop.status === 'ARRIVED' || stop.status === 'PAYMENT_CONFIRMED') {
        return context.closed ? refuse('BOOKING_CLOSED') : move('DELIVERY_FAILED');
      }
      // PENDING (not reached) or DELIVERED (already handed over).
      return refuse('INVALID_TRANSITION');
  }
}

/** What an admin's resolution does to a drop. Repeating a resolution changes nothing. */
export function decideStopResolution(
  context: StopContext,
  stop: StopState,
  resolution: StopResolution,
): StopDecision {
  if (stop.status === 'CANCELLED') {
    return refuse('BOOKING_CLOSED');
  }
  if (resolution === 'UNDELIVERED') {
    if (stop.status === 'UNDELIVERED') {
      return NO_CHANGE;
    }
    if (stop.status !== 'DELIVERY_FAILED') {
      return refuse('INVALID_TRANSITION');
    }
    return context.closed ? refuse('BOOKING_CLOSED') : move('UNDELIVERED');
  }
  if (CURRENT_STOP_STATUSES.has(stop.status) && stop.failedAt !== null) {
    // Already retried (by the engine or an admin).
    return NO_CHANGE;
  }
  if (stop.status !== 'DELIVERY_FAILED') {
    return refuse('INVALID_TRANSITION');
  }
  return retry(context, stop);
}

/**
 * The trip statuses the backend sets after a drop moved, in order: DROP_PROGRESS once a drop has
 * been reached, then DELIVERED once every drop is finished.
 */
export function tripAdvanceAfterStops(
  tripStatus: TripStatus,
  stops: readonly { readonly status: BookingStopStatus }[],
): TripStatus[] {
  const advance: TripStatus[] = [];
  let current = tripStatus;
  if (current === 'IN_TRANSIT' && stops.some((stop) => stop.status !== 'PENDING')) {
    current = 'DROP_PROGRESS';
    advance.push(current);
  }
  if (
    current === 'DROP_PROGRESS' &&
    stops.length > 0 &&
    stops.every((stop) => isFinalStop(stop.status))
  ) {
    advance.push('DELIVERED');
  }
  return advance;
}

function isUnderWay(tripStatus: TripStatus | null): boolean {
  return tripStatus !== null && UNDER_WAY_TRIP_STATUSES.has(tripStatus);
}

function arrive(context: StopContext, stop: StopState): StopDecision {
  if (context.closed) {
    return refuse('BOOKING_CLOSED');
  }
  if (!isUnderWay(context.tripStatus)) {
    return refuse('TRIP_NOT_UNDER_WAY');
  }
  const blocked = context.stops.some(
    (other) =>
      other.sequence !== stop.sequence &&
      ((other.sequence < stop.sequence && !isFinalStop(other.status)) ||
        CURRENT_STOP_STATUSES.has(other.status)),
  );
  return blocked ? refuse('OUT_OF_ORDER') : move('ARRIVED');
}

/** A failed attempt tried again: the drop is current again, paid or not. */
function retry(context: StopContext, stop: StopState): StopDecision {
  if (context.closed) {
    return refuse('BOOKING_CLOSED');
  }
  if (!isUnderWay(context.tripStatus)) {
    return refuse('TRIP_NOT_UNDER_WAY');
  }
  if (
    context.stops.some(
      (other) => other.sequence !== stop.sequence && CURRENT_STOP_STATUSES.has(other.status),
    )
  ) {
    return refuse('OUT_OF_ORDER');
  }
  const paid = context.paymentMethod === 'PAY_AT_DELIVERY' && stop.paid;
  return move(paid ? 'PAYMENT_CONFIRMED' : 'ARRIVED');
}

/** The goods for this drop are handed over: only once what is owed for them is paid. */
function handOver(context: StopContext, stop: StopState): StopDecision {
  if (context.closed) {
    return refuse('BOOKING_CLOSED');
  }
  switch (context.paymentMethod) {
    case 'PAY_AT_PICKUP':
      // Paid in full at the pickup; its drops are never collected on their own.
      return stop.status === 'ARRIVED' && context.bookingPaid
        ? move('DELIVERED')
        : refuse('PAYMENT_REQUIRED');
    case 'PAY_AT_DELIVERY':
      return stop.status === 'PAYMENT_CONFIRMED' && stop.paid
        ? move('DELIVERED')
        : refuse('PAYMENT_REQUIRED');
    default:
      // Historical prepaid bookings have no stops.
      return refuse('INVALID_TRANSITION');
  }
}

import type { Prisma } from '../generated/prisma/client';
import type {
  BookingPaymentMethod,
  BookingPaymentModel,
  BookingStopStatus,
  TripStatus,
} from '../generated/prisma/enums';
import { isFinalStop } from './stop-lifecycle';

/**
 * M6 trip lifecycle from assignment onwards (D-02 option A, D-03 option A). PAYMENT_CONFIRMED is
 * owned by this backend: it is set when the booking's payment is verified, never by a client.
 */
export const TRIP_SEQUENCE: readonly TripStatus[] = [
  'DRIVER_ASSIGNED',
  'DRIVER_ARRIVED',
  'PICKUP_VERIFIED',
  'IN_TRANSIT',
  'DROP_PROGRESS',
  'DELIVERED',
  'PAYMENT_CONFIRMED',
  'COMPLETED',
];

/** Statuses the trip engine may report. */
export const ENGINE_TRIP_STATUSES = [
  'DRIVER_ARRIVED',
  'PICKUP_VERIFIED',
  'IN_TRANSIT',
  'DROP_PROGRESS',
  'DELIVERED',
  'COMPLETED',
] as const satisfies readonly TripStatus[];
export type EngineTripStatus = (typeof ENGINE_TRIP_STATUSES)[number];

export const FINAL_TRIP_STATUSES: ReadonlySet<TripStatus> = new Set(['COMPLETED', 'CANCELLED']);

export function tripRank(status: TripStatus): number {
  return TRIP_SEQUENCE.indexOf(status);
}

/** The status that directly follows `status`, or null at the end of the lifecycle. */
export function nextTripStatus(status: TripStatus): TripStatus | null {
  const index = TRIP_SEQUENCE.indexOf(status);
  return index >= 0 && index < TRIP_SEQUENCE.length - 1 ? (TRIP_SEQUENCE[index + 1] ?? null) : null;
}

/** A trip status change plus the M6 lifecycle timestamp that goes with it. */
export function tripLifecycleUpdate(
  status: TripStatus,
  now: Date,
): Prisma.TripUncheckedUpdateInput {
  switch (status) {
    case 'DRIVER_ARRIVED':
      return { status, arrivedAt: now };
    case 'PICKUP_VERIFIED':
      return { status, pickupVerifiedAt: now };
    case 'IN_TRANSIT':
      return { status, startedAt: now };
    case 'DELIVERED':
      return { status, deliveredAt: now };
    case 'PAYMENT_CONFIRMED':
      return { status, paymentConfirmedAt: now };
    default:
      return { status };
  }
}

export interface TripRequestContext {
  readonly paymentMethod: BookingPaymentMethod;
  readonly paymentModel: BookingPaymentModel;
  /** The booking's payment status is not UNPAID. */
  readonly bookingPaid: boolean;
  readonly tripStatus: TripStatus;
  /** The booking's stops (QUOTE_PER_STOP); empty for a historical booking. */
  readonly stops: readonly { readonly sequence: number; readonly status: BookingStopStatus }[];
}

export type TripRefusal =
  /** PAY_AT_PICKUP: the goods are handed over (PICKUP_VERIFIED) only once the booking is paid. */
  | { readonly kind: 'PAYMENT_REQUIRED' }
  /** Priced per drop: DROP_PROGRESS follows from a drop's arrival, reported per drop. */
  | { readonly kind: 'STOP_REQUIRED' }
  /** Priced per drop: DELIVERED follows from the last drop finishing. */
  | { readonly kind: 'STOPS_PENDING'; readonly pendingStops: readonly number[] }
  /** Out of the M6 order. */
  | { readonly kind: 'INVALID_TRANSITION' };

/**
 * Whether the trip engine may move a trip forward to `requested` (payment flow Phase 3). The
 * caller handles repeats and older statuses (no-ops) and COMPLETED (the M6 payment gate) first.
 * The database enforces the same rules (guard_trip_change).
 *
 * - Pickup gate: an unpaid PAY_AT_PICKUP trip cannot leave DRIVER_ARRIVED, for every booking
 *   model (N2). Priced per drop, it can also not start unpaid.
 * - Priced per drop: the trip reaches DROP_PROGRESS and DELIVERED through its drops (see
 *   tripAdvanceAfterStops), never from an engine report.
 * - Historical bookings keep the engine-reported order otherwise.
 */
export function checkTripRequest(
  context: TripRequestContext,
  requested: EngineTripStatus,
): TripRefusal | null {
  const rank = tripRank(requested);
  if (context.paymentMethod === 'PAY_AT_PICKUP' && !context.bookingPaid) {
    const heldAt =
      context.tripStatus === 'DRIVER_ARRIVED' ||
      (context.tripStatus === 'PICKUP_VERIFIED' && context.paymentModel === 'QUOTE_PER_STOP');
    if (heldAt && rank > tripRank(context.tripStatus)) {
      return { kind: 'PAYMENT_REQUIRED' };
    }
  }
  if (context.paymentModel === 'QUOTE_PER_STOP') {
    if (requested === 'DROP_PROGRESS') {
      return { kind: 'STOP_REQUIRED' };
    }
    if (requested === 'DELIVERED' && tripRank(context.tripStatus) >= tripRank('IN_TRANSIT')) {
      const pendingStops = context.stops
        .filter((stop) => !isFinalStop(stop.status))
        .map((stop) => stop.sequence)
        .sort((a, b) => a - b);
      if (pendingStops.length > 0) {
        return { kind: 'STOPS_PENDING', pendingStops };
      }
    }
  }
  return nextTripStatus(context.tripStatus) === requested ? null : { kind: 'INVALID_TRANSITION' };
}

/**
 * Collection window for pay-at-pickup / pay-at-delivery bookings (safe defaults, D-19):
 * PAY_AT_PICKUP from the driver's arrival until delivery; PAY_AT_DELIVERY once every drop is
 * delivered (historical bookings; per-drop collection is Phase 4). The pickup gate keeps an
 * unpaid PAY_AT_PICKUP trip at DRIVER_ARRIVED, so it is collected there; the rest of the window
 * serves historical trips that passed the pickup unpaid before the gate existed.
 */
export const PICKUP_COLLECTION_WINDOW: ReadonlySet<TripStatus> = new Set([
  'DRIVER_ARRIVED',
  'PICKUP_VERIFIED',
  'IN_TRANSIT',
  'DROP_PROGRESS',
  'DELIVERED',
]);
export const DELIVERY_COLLECTION_WINDOW: ReadonlySet<TripStatus> = new Set(['DELIVERED']);

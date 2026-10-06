import type { TripStatus } from '../generated/prisma/enums';

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

/**
 * Collection window for pay-at-pickup / pay-at-delivery bookings (safe defaults, D-19):
 * PAY_AT_PICKUP from the driver's arrival until delivery; PAY_AT_DELIVERY once every drop is
 * delivered. Completion is what the payment gate blocks.
 */
export const PICKUP_COLLECTION_WINDOW: ReadonlySet<TripStatus> = new Set([
  'DRIVER_ARRIVED',
  'PICKUP_VERIFIED',
  'IN_TRANSIT',
  'DROP_PROGRESS',
  'DELIVERED',
]);
export const DELIVERY_COLLECTION_WINDOW: ReadonlySet<TripStatus> = new Set(['DELIVERED']);

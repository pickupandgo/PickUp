import type {
  EngineStopStatus,
  EngineTripStatus,
} from '../generated/prisma/enums';

/** A drop is finished once delivered, closed undelivered by an admin, or cancelled. */
export const FINAL_STOP_STATUSES: ReadonlySet<EngineStopStatus> = new Set([
  'DELIVERED',
  'UNDELIVERED',
  'CANCELLED',
]);

export const FINAL_TRIP_STATUSES: ReadonlySet<EngineTripStatus> = new Set([
  'COMPLETED',
  'CANCELLED',
]);

/** Trip statuses reached in order (IN_TRANSIT and DROP_PROGRESS alternate between drops). */
const TRIP_ORDER: readonly EngineTripStatus[] = [
  'DRIVER_ASSIGNED',
  'DRIVER_ARRIVED',
  'PICKUP_VERIFIED',
  'IN_TRANSIT',
  'DROP_PROGRESS',
  'DELIVERED',
  'COMPLETED',
];

/** True when the trip has reached `status` or a later one (never for a cancelled trip). */
export function tripReached(
  current: EngineTripStatus,
  status: EngineTripStatus,
): boolean {
  if (current === 'CANCELLED') {
    return false;
  }
  const rank = (value: EngineTripStatus) =>
    value === 'DROP_PROGRESS'
      ? TRIP_ORDER.indexOf('IN_TRANSIT')
      : TRIP_ORDER.indexOf(value);
  return rank(current) >= rank(status);
}

/**
 * Where the trip goes once the drop at `index` is finished: the next unfinished drop (the trip
 * heads there, IN_TRANSIT), or null when every drop is finished (the trip is DELIVERED).
 */
export function nextStopIndex(
  stops: readonly { readonly status: EngineStopStatus }[],
  index: number,
): number | null {
  for (let next = index + 1; next < stops.length; next += 1) {
    const stop = stops[next];
    if (stop && !FINAL_STOP_STATUSES.has(stop.status)) {
      return next;
    }
  }
  return null;
}

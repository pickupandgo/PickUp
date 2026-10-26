import { request } from './http';
import type {
  CreateRideInput,
  NearbyDriver,
  Ride,
  RideOtps,
  Trip,
} from './types';

/** The engine wraps every response in `{ success, ... }`. */
interface Envelope {
  readonly success: boolean;
}

// ─── Drivers ─────────────────────────────────────────────────────────────────

export const getDriver = async (driverId: string, signal?: AbortSignal) => {
  const res = await request<Envelope & { driver: NearbyDriver }>(
    `/drivers/${encodeURIComponent(driverId)}`,
    { signal }
  );
  return res.driver;
};

// ─── Rides ───────────────────────────────────────────────────────────────────

/**
 * Confirms a server fare quote into a booking (engine POST /rides). The body carries only the
 * quote id and the payment method: the route, vehicle, weight and fare all come from the quote,
 * the engine dispatches to an eligible driver, and the customer is the signed-in user (the token). Never
 * retried: a retry could create a duplicate ride.
 */
export const createRide = async (input: CreateRideInput, signal?: AbortSignal): Promise<Ride> => {
  const res = await request<Envelope & { ride: Ride }>('/rides', {
    method: 'POST',
    body: input,
    signal,
    retries: 0,
  });
  return res.ride;
};

export const getRide = async (rideId: string, signal?: AbortSignal): Promise<Ride> => {
  const res = await request<Envelope & { ride: Ride }>(
    `/rides/${encodeURIComponent(rideId)}`,
    { signal }
  );
  return res.ride;
};

/**
 * The handover OTPs for this ride (engine GET /rides/:id/otps). The pickup / drop code is
 * withheld until the payment backend allows that handover; the server decides, not the app.
 */
export const getRideOtps = async (rideId: string, signal?: AbortSignal): Promise<RideOtps> => {
  const res = await request<Envelope & RideOtps>(
    `/rides/${encodeURIComponent(rideId)}/otps`,
    { signal }
  );
  const { success, ...otps } = res;
  return otps;
};

export const cancelRide = async (
  rideId: string,
  reason = 'Cancelled by the customer',
  signal?: AbortSignal
): Promise<Ride> => {
  const res = await request<Envelope & { ride: Ride }>(
    `/rides/${encodeURIComponent(rideId)}/cancel`,
    { method: 'POST', body: { reason }, signal, retries: 0 }
  );
  return res.ride;
};

/** The trip created once a driver accepts, or null while still searching. */
export const getRideTrip = async (rideId: string, signal?: AbortSignal): Promise<Trip | null> => {
  const res = await request<Envelope & { trip: Trip | null }>(
    `/rides/${encodeURIComponent(rideId)}/trip`,
    { signal }
  );
  return res.trip ?? null;
};

// ─── Trips ───────────────────────────────────────────────────────────────────

export const getTrip = async (tripId: string, signal?: AbortSignal): Promise<Trip> => {
  const res = await request<Envelope & { trip: Trip }>(
    `/trips/${encodeURIComponent(tripId)}`,
    { signal }
  );
  return res.trip;
};

export const getActiveTripForCustomer = async (
  customerId: string,
  signal?: AbortSignal
): Promise<Trip | null> => {
  const res = await request<Envelope & { trip: Trip | null }>(
    `/trips/active/customer/${encodeURIComponent(customerId)}`,
    { signal }
  );
  return res.trip ?? null;
};

export const cancelTrip = async (
  tripId: string,
  customerIdOrReason?: string,
  reasonOrSignal?: string | AbortSignal,
  signal?: AbortSignal
): Promise<Trip> => {
  let customerId: string | undefined;
  let reason = 'Cancelled by the customer';
  let abortSignal = signal;

  if (typeof reasonOrSignal === 'string') {
    customerId = customerIdOrReason;
    reason = reasonOrSignal;
  } else if (reasonOrSignal && typeof (reasonOrSignal as any).aborted === 'boolean') {
    abortSignal = reasonOrSignal as AbortSignal;
    reason = customerIdOrReason || reason;
  } else if (customerIdOrReason) {
    reason = customerIdOrReason;
  }

  const body: Record<string, any> = { reason };
  if (customerId) body.customerId = customerId;

  const res = await request<Envelope & { trip: Trip }>(
    `/trips/${encodeURIComponent(tripId)}/cancel`,
    { method: 'POST', body, signal: abortSignal, retries: 0 }
  );
  return res.trip;
};

export const getCustomerHistory = async (customerId: string, signal?: AbortSignal): Promise<Trip[]> => {
  const res = await request<Envelope & { trips: Trip[] }>(`/trips/history/customer/${encodeURIComponent(customerId)}`, {
    signal,
  });
  return res.trips;
};

import { request } from './http';
import type { GeoPoint, Ride, Trip } from './types';

/**
 * Driver-side calls to Pickup-Go-Core-Engine.
 *
 * Two engine behaviours shape this file:
 *  - A driver is only discoverable by `/drivers/nearby` while marked available
 *    AND having pinged within 60s. `getPendingRequests` is that ping, so it must
 *    be polled continuously to stay online.
 *  - A REQUESTED ride auto-expires 15s after creation, and the expiry check only
 *    runs inside `getPendingRequests`. The countdown shown to the driver must
 *    therefore be measured from the ride's `createdAt`, not from render time.
 */

interface Envelope {
  readonly success: boolean;
}

/** Engine's expiry window for a pending request, in milliseconds. */
export const RIDE_REQUEST_TTL_MS = 15_000;

export interface RideRequestSummary {
  readonly rideId: string;
  readonly customerId: string;
  readonly pickup: GeoPoint;
  readonly drop: GeoPoint;
  readonly vehicleType?: string;
  readonly weight?: number;
  readonly fare?: number;
  readonly status: string;
  readonly createdAt: string;
}

// ─── Availability and location ───────────────────────────────────────────────

export const setDriverAvailability = async (
  driverId: string,
  isAvailable: boolean,
  signal?: AbortSignal
): Promise<void> => {
  await request<Envelope>(`/drivers/${encodeURIComponent(driverId)}/availability`, {
    method: 'PATCH',
    body: { isAvailable },
    signal,
    retries: 0,
  });
};

export const updateDriverLocation = async (
  driverId: string,
  point: GeoPoint,
  signal?: AbortSignal
): Promise<void> => {
  await request<Envelope>(`/drivers/${encodeURIComponent(driverId)}/location`, {
    method: 'PATCH',
    body: { latitude: point.latitude, longitude: point.longitude },
    signal,
    retries: 0,
  });
};

// ─── Request inbox (doubles as the heartbeat) ────────────────────────────────

export const getPendingRequests = async (
  driverId: string,
  signal?: AbortSignal
): Promise<readonly RideRequestSummary[]> => {
  const res = await request<Envelope & { requests: RideRequestSummary[] }>(
    `/ride-requests/${encodeURIComponent(driverId)}`,
    { signal, retries: 0 }
  );
  return res.requests ?? [];
};

export const acceptRide = async (
  rideId: string,
  driverId: string,
  signal?: AbortSignal
): Promise<Ride> => {
  const res = await request<Envelope & { ride: Ride }>(
    `/rides/${encodeURIComponent(rideId)}/accept`,
    { method: 'POST', body: { driverId }, signal, retries: 0 }
  );
  return res.ride;
};

export const rejectRide = async (
  rideId: string,
  driverId: string,
  signal?: AbortSignal
): Promise<Ride> => {
  const res = await request<Envelope & { ride: Ride }>(
    `/rides/${encodeURIComponent(rideId)}/reject`,
    { method: 'POST', body: { driverId }, signal, retries: 0 }
  );
  return res.ride;
};

// ─── Trip progression ────────────────────────────────────────────────────────

export const getActiveTripForDriver = async (
  driverId: string,
  signal?: AbortSignal
): Promise<Trip | null> => {
  const res = await request<Envelope & { trip: Trip | null }>(
    `/trips/active/driver/${encodeURIComponent(driverId)}`,
    { signal }
  );
  return res.trip ?? null;
};

export const getTripForRide = async (
  rideId: string,
  signal?: AbortSignal
): Promise<Trip | null> => {
  const res = await request<Envelope & { trip: Trip | null }>(
    `/rides/${encodeURIComponent(rideId)}/trip`,
    { signal }
  );
  return res.trip ?? null;
};

export const getTrip = async (tripId: string, signal?: AbortSignal): Promise<Trip> => {
  const res = await request<Envelope & { trip: Trip }>(
    `/trips/${encodeURIComponent(tripId)}`,
    { signal }
  );
  return res.trip;
};

/** Trip transitions the driver can trigger, in the engine's own order. */
export type DriverTripAction = 'arrive' | 'start' | 'drop/start' | 'drop/confirm' | 'complete';

export const advanceTrip = async (
  tripId: string,
  driverId: string,
  action: DriverTripAction,
  signal?: AbortSignal
): Promise<Trip> => {
  const res = await request<Envelope & { trip: Trip }>(
    `/trips/${encodeURIComponent(tripId)}/${action}`,
    { method: 'POST', body: { driverId }, signal, retries: 0 }
  );
  return res.trip;
};

/**
 * Confirms pickup with the code the customer reads out.
 * The customer app displays the OTP; only the driver submits it.
 */
export const verifyPickupOtp = async (
  tripId: string,
  driverId: string,
  otp: string,
  signal?: AbortSignal
): Promise<Trip> => {
  const res = await request<Envelope & { trip: Trip }>(
    `/trips/${encodeURIComponent(tripId)}/pickup/verify-otp`,
    { method: 'POST', body: { driverId, otp }, signal, retries: 0 }
  );
  return res.trip;
};

export const cancelTripAsDriver = async (
  tripId: string,
  driverId: string,
  reason?: string,
  signal?: AbortSignal
): Promise<Trip> => {
  const res = await request<Envelope & { trip: Trip }>(
    `/trips/${encodeURIComponent(tripId)}/cancel`,
    { method: 'POST', body: { driverId, reason }, signal, retries: 0 }
  );
  return res.trip;
};

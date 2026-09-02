import { request } from './http';
import type {
  CreateRideInput,
  FareEstimate,
  GeoPoint,
  NearbyDriver,
  Ride,
  Trip,
} from './types';

/** The engine wraps every response in `{ success, ... }`. */
interface Envelope {
  readonly success: boolean;
}

// ─── Fare ────────────────────────────────────────────────────────────────────

export const getFareEstimate = async (
  pickup: GeoPoint,
  drop: GeoPoint,
  weightKg: number,
  signal?: AbortSignal
): Promise<FareEstimate> => {
  const res = await request<Envelope & FareEstimate>('/fare/estimate', {
    query: {
      pickupLat: pickup.latitude,
      pickupLng: pickup.longitude,
      dropLat: drop.latitude,
      dropLng: drop.longitude,
      weight: weightKg,
    },
    signal,
  });
  const { success, ...estimate } = res;
  return estimate;
};

// ─── Drivers ─────────────────────────────────────────────────────────────────

/**
 * Available drivers within `radiusKm`, nearest first.
 *
 * The engine only returns drivers that are marked available AND have pinged
 * within the last 60s, so an empty result usually means no driver app is
 * currently online rather than a client error.
 */
export const getNearbyDrivers = async (
  point: GeoPoint,
  radiusKm = 20,
  signal?: AbortSignal
): Promise<readonly NearbyDriver[]> => {
  const res = await request<Envelope & { drivers: NearbyDriver[] }>('/drivers/nearby', {
    query: { lat: point.latitude, lng: point.longitude, radius: radiusKm },
    signal,
  });
  return res.drivers ?? [];
};

export const getDriver = async (driverId: string, signal?: AbortSignal) => {
  const res = await request<Envelope & { driver: NearbyDriver }>(
    `/drivers/${encodeURIComponent(driverId)}`,
    { signal }
  );
  return res.driver;
};

// ─── Rides ───────────────────────────────────────────────────────────────────

export const createRide = async (input: CreateRideInput, signal?: AbortSignal): Promise<Ride> => {
  const res = await request<Envelope & { ride: Ride }>('/rides', {
    method: 'POST',
    body: input,
    signal,
    // Never retry: a retry could create a duplicate ride.
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

export const cancelRide = async (rideId: string, signal?: AbortSignal): Promise<Ride> => {
  const res = await request<Envelope & { ride: Ride }>(
    `/rides/${encodeURIComponent(rideId)}/cancel`,
    { method: 'POST', signal, retries: 0 }
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
  customerId: string,
  reason?: string,
  signal?: AbortSignal
): Promise<Trip> => {
  const res = await request<Envelope & { trip: Trip }>(
    `/trips/${encodeURIComponent(tripId)}/cancel`,
    { method: 'POST', body: { customerId, reason }, signal, retries: 0 }
  );
  return res.trip;
};

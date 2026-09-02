/**
 * Driver-side dispatch client for the Pickup-Go Core Engine.
 *
 * Talks to the engine's driver + ride endpoints so an online driver can:
 *  - advertise availability + live location (so the customer's /drivers/nearby
 *    returns them),
 *  - poll for incoming ride requests targeted at this driver,
 *  - accept / reject a request.
 *
 * The engine has no auth, so requests are sent without a bearer token.
 * All responses are wrapped in a `{ success, ... }` envelope.
 */

import { getAuth } from '@react-native-firebase/auth';
import { ApiClient } from '../api/ApiClient';
import type { ActiveTrip, TripStatus, TripOffer } from '../../types/trip';

const client = ApiClient.getInstance();

export interface EngineLocation {
  latitude: number;
  longitude: number;
  address?: string;
}

/** A pending ride request as returned by GET /ride-requests/:driverId. */
export interface EngineRideRequest {
  rideId: string;
  customerId: string;
  pickup: EngineLocation;
  drop: EngineLocation;
  vehicleType?: string;
  weight?: number;
  fare?: number;
  status: string;
  createdAt: string;
}

/** The engine auto-expires a REQUESTED ride 15s after creation. */
const RIDE_TTL_MS = 15_000;

/**
 * Stable driver id used for all engine calls. The engine lazily creates a
 * driver record for any id, so this just needs to be consistent for this
 * device/account. We use the Firebase UID (same id onboarding assigns).
 */
export const getCurrentDriverId = (): string | null => {
  try {
    return getAuth().currentUser?.uid ?? null;
  } catch {
    return null;
  }
};

const enc = encodeURIComponent;

/** PATCH /drivers/:id/availability — mark the driver available/unavailable. */
export const setDriverAvailability = (driverId: string, isAvailable: boolean): Promise<unknown> =>
  client.request({
    endpoint: `/drivers/${enc(driverId)}/availability`,
    method: 'PATCH',
    body: { isAvailable },
    retryable: false,
    withAuth: false,
  });

/** PATCH /drivers/:id/location — update the driver's live location (also refreshes lastSeen). */
export const updateDriverLocation = (
  driverId: string,
  latitude: number,
  longitude: number,
): Promise<unknown> =>
  client.request({
    endpoint: `/drivers/${enc(driverId)}/location`,
    method: 'PATCH',
    body: { latitude, longitude },
    retryable: false,
    withAuth: false,
  });

/** GET /ride-requests/:driverId — pending requests for this driver (also heartbeats lastSeen). */
export const fetchRideRequests = async (driverId: string): Promise<EngineRideRequest[]> => {
  const res = await client.get<{ success: boolean; requests: EngineRideRequest[] }>(
    `/ride-requests/${enc(driverId)}`,
    { withAuth: false, deduplicate: false },
  );
  return res?.requests ?? [];
};

/** POST /rides/:rideId/accept — accept a ride. Throws (409/400) if no longer available. */
export const acceptRideRequest = (rideId: string, driverId: string): Promise<unknown> =>
  client.post(`/rides/${enc(rideId)}/accept`, { driverId }, { withAuth: false, retryable: false });

/** POST /rides/:rideId/reject — decline a ride. */
export const rejectRideRequest = (rideId: string, driverId: string): Promise<unknown> =>
  client.post(`/rides/${enc(rideId)}/reject`, { driverId }, { withAuth: false, retryable: false });

/** GET /rides/:rideId/trip — the trip created after accepting (null while still requested). */
export const getTripIdForRide = async (rideId: string): Promise<string | null> => {
  const res = await client.get<{ success: boolean; trip: { id: string } | null }>(
    `/rides/${enc(rideId)}/trip`,
    { withAuth: false, deduplicate: false },
  );
  return res?.trip?.id ?? null;
};

// ─── Trips (post-accept lifecycle) ───────────────────────────────────────────

/** A trip as returned by the engine's /trips endpoints. */
export interface EngineTrip {
  id: string;
  rideId: string;
  customerId: string;
  driverId: string;
  pickup: EngineLocation;
  drop: EngineLocation;
  status: string;
  weight?: number;
  fare?: number;
  otp?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

/** GET /trips/active/driver/:driverId — the driver's current active trip, or null. */
export const getActiveTripForDriver = async (driverId: string): Promise<EngineTrip | null> => {
  const res = await client.get<{ success: boolean; trip: EngineTrip | null }>(
    `/trips/active/driver/${enc(driverId)}`,
    { withAuth: false, deduplicate: false },
  );
  return res?.trip ?? null;
};

/** GET /trips/:tripId — a specific trip. */
export const getTripById = async (tripId: string): Promise<EngineTrip | null> => {
  const res = await client.get<{ success: boolean; trip: EngineTrip | null }>(
    `/trips/${enc(tripId)}`,
    { withAuth: false, deduplicate: false },
  );
  return res?.trip ?? null;
};

const postTripAction = async (
  tripId: string,
  action: string,
  driverId: string,
  extra: Record<string, unknown> = {},
): Promise<EngineTrip> => {
  const res = await client.post<{ success: boolean; trip: EngineTrip }>(
    `/trips/${enc(tripId)}/${action}`,
    { driverId, ...extra },
    { withAuth: false, retryable: false },
  );
  return res.trip;
};

export const arriveAtPickup = (tripId: string, driverId: string) =>
  postTripAction(tripId, 'arrive', driverId);
export const verifyPickupOtp = (tripId: string, driverId: string, otp: string) =>
  postTripAction(tripId, 'pickup/verify-otp', driverId, { otp });
export const startTrip = (tripId: string, driverId: string) =>
  postTripAction(tripId, 'start', driverId);
export const startDrop = (tripId: string, driverId: string) =>
  postTripAction(tripId, 'drop/start', driverId);
export const confirmDrop = (tripId: string, driverId: string) =>
  postTripAction(tripId, 'drop/confirm', driverId);
export const completeTrip = (tripId: string, driverId: string) =>
  postTripAction(tripId, 'complete', driverId);

/** Engine trip lifecycle order (strict state machine). */
const ENGINE_STATUS_ORDER = [
  'DRIVER_ASSIGNED',
  'DRIVER_ARRIVED',
  'PICKUP_VERIFIED',
  'IN_TRANSIT',
  'DROP_PROGRESS',
  'DELIVERED',
  'COMPLETED',
] as const;

/**
 * Drive a trip forward from its current status to `targetStatus`, performing
 * each intermediate engine transition in order. `otp` is validated by the
 * engine at the DRIVER_ARRIVED → PICKUP_VERIFIED step (throws if wrong).
 */
export const advanceTripTo = async (
  tripId: string,
  driverId: string,
  targetStatus: string,
  otp?: string,
): Promise<EngineTrip> => {
  let trip = await getTripById(tripId);
  if (!trip) throw new Error('Trip not found');

  const targetIdx = ENGINE_STATUS_ORDER.indexOf(targetStatus as never);
  let guard = 0;
  while (ENGINE_STATUS_ORDER.indexOf(trip.status as never) < targetIdx && guard++ < 8) {
    switch (trip.status) {
      case 'DRIVER_ASSIGNED':
        trip = await arriveAtPickup(tripId, driverId);
        break;
      case 'DRIVER_ARRIVED':
        trip = otp
          ? await verifyPickupOtp(tripId, driverId, otp)
          : await postTripAction(tripId, 'pickup/confirm', driverId);
        break;
      case 'PICKUP_VERIFIED':
        trip = await startTrip(tripId, driverId);
        break;
      case 'IN_TRANSIT':
        trip = await startDrop(tripId, driverId);
        break;
      case 'DROP_PROGRESS':
        trip = await confirmDrop(tripId, driverId);
        break;
      case 'DELIVERED':
        trip = await completeTrip(tripId, driverId);
        break;
      default:
        return trip;
    }
  }
  return trip;
};

const ENGINE_TO_APP_TRIP_STATUS: Record<string, TripStatus> = {
  DRIVER_ASSIGNED: 'en_route_pickup',
  DRIVER_ARRIVED: 'arrived_pickup',
  PICKUP_VERIFIED: 'in_transit',
  IN_TRANSIT: 'in_transit',
  DROP_PROGRESS: 'arrived_drop',
  DELIVERED: 'drop_verified',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};

/** Map an engine Trip into the app's rich ActiveTrip shape. */
export const engineTripToActiveTrip = (t: EngineTrip): ActiveTrip => {
  const pickupDone = ['PICKUP_VERIFIED', 'IN_TRANSIT', 'DROP_PROGRESS', 'DELIVERED', 'COMPLETED'].includes(
    t.status,
  );
  const dropDone = ['DELIVERED', 'COMPLETED'].includes(t.status);
  const currentStopIndex = pickupDone ? 1 : 0;
  const distanceKm = haversineKm(
    t.pickup.latitude,
    t.pickup.longitude,
    t.drop.latitude,
    t.drop.longitude,
  );

  return {
    id: t.id,
    status: ENGINE_TO_APP_TRIP_STATUS[t.status] ?? 'in_transit',
    stops: [
      {
        id: `${t.id}-pickup`,
        type: 'pickup',
        label: 'Pickup',
        address: formatAddress(t.pickup),
        latitude: t.pickup.latitude,
        longitude: t.pickup.longitude,
        status: pickupDone ? 'completed' : 'current',
        requiresOtp: true,
      },
      {
        id: `${t.id}-drop`,
        type: 'drop',
        label: 'Drop-off',
        address: formatAddress(t.drop),
        latitude: t.drop.latitude,
        longitude: t.drop.longitude,
        status: dropDone ? 'completed' : currentStopIndex === 1 ? 'current' : 'pending',
        requiresPhoto: true,
      },
    ],
    currentStopIndex,
    estimatedEarning: t.fare ?? 0,
    currency: '₹',
    totalDistanceKm: Math.round(distanceKm * 10) / 10,
    loadType: 'other',
    goodsType: '',
    vehicleId: '',
    vehicleRegistration: '',
    startedAt: t.startedAt ? new Date(t.startedAt).getTime() : undefined,
    completedAt: t.completedAt ? new Date(t.completedAt).getTime() : undefined,
  };
};

// ─── Mapping ────────────────────────────────────────────────────────────────

const toRad = (deg: number): number => (deg * Math.PI) / 180;

const haversineKm = (aLat: number, aLng: number, bLat: number, bLng: number): number => {
  const R = 6371;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
};

const formatAddress = (loc: EngineLocation): string =>
  loc.address?.trim() || `${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)}`;

/** Map an engine ride request into the app's rich TripOffer shape. */
export const rideRequestToOffer = (r: EngineRideRequest): TripOffer => {
  const distanceKm = haversineKm(
    r.pickup.latitude,
    r.pickup.longitude,
    r.drop.latitude,
    r.drop.longitude,
  );
  const createdMs = new Date(r.createdAt).getTime();

  return {
    id: r.rideId,
    estimatedEarning: r.fare ?? 0,
    currency: '₹',
    pickupStop: {
      id: `${r.rideId}-pickup`,
      type: 'pickup',
      label: 'Pickup',
      address: formatAddress(r.pickup),
      latitude: r.pickup.latitude,
      longitude: r.pickup.longitude,
      status: 'current',
    },
    dropStops: [
      {
        id: `${r.rideId}-drop`,
        type: 'drop',
        label: 'Drop-off',
        address: formatAddress(r.drop),
        latitude: r.drop.latitude,
        longitude: r.drop.longitude,
        status: 'pending',
      },
    ],
    totalDistanceKm: Math.round(distanceKm * 10) / 10,
    loadType: 'other',
    vehicleType: r.vehicleType ?? 'Mini Truck',
    expiresAt: (Number.isFinite(createdMs) ? createdMs : Date.now()) + RIDE_TTL_MS,
    demandLevel: 'medium',
  };
};

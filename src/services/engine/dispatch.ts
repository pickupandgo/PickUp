/**
 * Driver-side client for the trip engine (Phase 8 contract, docs/PAYMENT_FLOW_FINAL_REVIEW.md
 * sections D and G).
 *
 * Every call is authenticated with the signed-in driver's Firebase ID token (engineClient). The
 * engine takes the driver's identity from the token: no request body carries a driverId, and a
 * driver id in a path is only ever the signed-in driver's own (the engine refuses any other).
 *
 * The engine owns dispatch and the trip lifecycle; the payment backend owns money. This app sends
 * exactly one engine step per driver action and shows the state the engine answers with:
 *   - it never chains steps (arrive, pickup OTP and start are three separate actions);
 *   - it never completes a trip on its own;
 *   - a failure (refusal, timeout, no network) is never treated as a success.
 * Removed routes (POST /trips/:id/pickup/confirm, POST /rides/:id/verify-otp,
 * POST /trips/:id/drop/confirm) are not used. No engine response carries an OTP.
 */

import { getAuth } from '@react-native-firebase/auth';
import type {
  ActiveTrip,
  TripOffer,
  TripStatus,
  TripStop,
} from '../../types/trip';
import { EngineApiError, getEngineClient } from './engineClient';

// ─── Identity ───────────────────────────────────────────────────────────────

/**
 * The signed-in driver's id: the Firebase UID, which is also the engine's token subject. Used
 * only in paths that name the driver (presence, offers, active trip); the engine checks it
 * against the token and refuses any other id.
 */
export const getCurrentDriverId = (): string | null => {
  try {
    return getAuth().currentUser?.uid ?? null;
  } catch {
    return null;
  }
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DRIVER_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function uuid(value: string, what: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new RangeError(`Invalid ${what}`);
  }
  return value;
}

function driver(value: string): string {
  if (!DRIVER_ID_PATTERN.test(value)) {
    throw new RangeError('Invalid driver id');
  }
  return value;
}

function invalid(what: string): never {
  throw new EngineApiError(
    'INVALID_RESPONSE',
    `Unexpected ${what} in server response`,
    0,
  );
}

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown, what: string): Json {
  return isRecord(value) ? value : invalid(what);
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

// ─── DTOs ───────────────────────────────────────────────────────────────────

export interface EngineLocation {
  readonly latitude: number;
  readonly longitude: number;
  readonly address?: string;
}

export type EngineTripStatus =
  | 'DRIVER_ASSIGNED'
  | 'DRIVER_ARRIVED'
  | 'PICKUP_VERIFIED'
  | 'IN_TRANSIT'
  | 'DROP_PROGRESS'
  | 'DELIVERED'
  | 'COMPLETED'
  | 'CANCELLED';

export type EngineStopStatus =
  | 'PENDING'
  | 'IN_TRANSIT'
  | 'ARRIVED'
  | 'DELIVERED'
  | 'DELIVERY_FAILED'
  | 'UNDELIVERED'
  | 'CANCELLED';

const TRIP_STATUSES: readonly EngineTripStatus[] = [
  'DRIVER_ASSIGNED',
  'DRIVER_ARRIVED',
  'PICKUP_VERIFIED',
  'IN_TRANSIT',
  'DROP_PROGRESS',
  'DELIVERED',
  'COMPLETED',
  'CANCELLED',
];

const STOP_STATUSES: readonly EngineStopStatus[] = [
  'PENDING',
  'IN_TRANSIT',
  'ARRIVED',
  'DELIVERED',
  'DELIVERY_FAILED',
  'UNDELIVERED',
  'CANCELLED',
];

/** Drops that are finished: delivered, closed as not delivered by an admin, or cancelled. */
export const FINAL_STOP_STATUSES: ReadonlySet<EngineStopStatus> = new Set([
  'DELIVERED',
  'UNDELIVERED',
  'CANCELLED',
]);

/** A drop of a trip, as the engine shows it to the driver (never with its OTP). */
export interface EngineStop {
  readonly id: string;
  readonly sequence: number;
  readonly location: EngineLocation;
  readonly status: EngineStopStatus;
  /** What this drop's receiver pays at delivery: display copy, the payment backend decides. */
  readonly payablePaise?: number;
  readonly otpVerified: boolean;
  readonly failureReason?: string;
}

/** A trip as returned by the engine's /trips endpoints. */
export interface EngineTrip {
  readonly id: string;
  readonly rideId: string;
  readonly driverId: string;
  /** The booking reference shared with the payment backend. */
  readonly externalRef?: string;
  /** The payment backend's trip id; null until the backend accepted the assignment. */
  readonly paymentTripId: string | null;
  readonly paymentMethod?: string;
  readonly pickup: EngineLocation;
  readonly stops: readonly EngineStop[];
  /** Index into `stops` of the drop the trip is at (or heading to). */
  readonly currentStopIndex: number;
  readonly completedStops?: number;
  readonly remainingStops?: number;
  readonly status: EngineTripStatus;
  /** INR, display copy of the payment backend's quote. */
  readonly fare?: number;
  readonly payablePaise?: number;
  readonly totalDistanceKm?: number;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly cancellationReason?: string;
}

function parseLocation(value: unknown, what: string): EngineLocation {
  const json = record(value, what);
  const latitude = finite(json.latitude);
  const longitude = finite(json.longitude);
  if (latitude === undefined || longitude === undefined) {
    invalid(what);
  }
  return { latitude, longitude, address: optionalText(json.address) };
}

function parseStop(value: unknown): EngineStop {
  const json = record(value, 'stop');
  const id = optionalText(json.id) ?? invalid('stop id');
  const sequence = json.sequence;
  if (
    typeof sequence !== 'number' ||
    !Number.isSafeInteger(sequence) ||
    sequence < 1
  ) {
    invalid('stop sequence');
  }
  const status = json.status;
  if (!STOP_STATUSES.includes(status as EngineStopStatus)) {
    invalid('stop status');
  }
  return {
    id,
    sequence,
    location: parseLocation(json.location, 'stop location'),
    status: status as EngineStopStatus,
    payablePaise: finite(json.payablePaise),
    otpVerified: json.otpVerified === true,
    failureReason: optionalText(json.failureReason),
  };
}

/** Checks the fields the driver's actions depend on; anything unexpected is refused. */
export function parseEngineTrip(value: unknown): EngineTrip {
  const json = record(value, 'trip');
  const status = json.status;
  if (!TRIP_STATUSES.includes(status as EngineTripStatus)) {
    invalid('trip status');
  }
  if (!Array.isArray(json.stops)) {
    invalid('trip stops');
  }
  const stops = json.stops
    .map(parseStop)
    .sort((a, b) => a.sequence - b.sequence);
  const currentStopIndex = json.currentStopIndex;
  if (
    typeof currentStopIndex !== 'number' ||
    !Number.isSafeInteger(currentStopIndex) ||
    currentStopIndex < 0
  ) {
    invalid('current stop');
  }
  const paymentTripId = json.paymentTripId;
  if (
    paymentTripId !== null &&
    paymentTripId !== undefined &&
    (typeof paymentTripId !== 'string' || !UUID_PATTERN.test(paymentTripId))
  ) {
    invalid('payment trip id');
  }
  return {
    id: optionalText(json.id) ?? invalid('trip id'),
    rideId: optionalText(json.rideId) ?? invalid('ride id'),
    driverId: optionalText(json.driverId) ?? invalid('driver id'),
    externalRef: optionalText(json.externalRef),
    paymentTripId: typeof paymentTripId === 'string' ? paymentTripId : null,
    paymentMethod: optionalText(json.paymentMethod),
    pickup: parseLocation(json.pickup, 'pickup'),
    stops,
    currentStopIndex,
    completedStops: finite(json.completedStops),
    remainingStops: finite(json.remainingStops),
    status: status as EngineTripStatus,
    fare: finite(json.fare),
    payablePaise: finite(json.payablePaise),
    totalDistanceKm: finite(json.totalDistanceKm),
    createdAt: optionalText(json.createdAt),
    updatedAt: optionalText(json.updatedAt),
    startedAt: optionalText(json.startedAt),
    completedAt: optionalText(json.completedAt),
    cancellationReason: optionalText(json.cancellationReason),
  };
}

/** What an engine action answered: the trip as it is now, and whether this request changed it. */
export interface EngineActionResult {
  readonly trip: EngineTrip;
  /** False when the step had already been done (a repeat changes nothing). */
  readonly changed: boolean;
  /** POST /complete only: COMPLETED, or PENDING while the payment backend has not confirmed. */
  readonly completion?: 'COMPLETED' | 'PENDING';
  /** POST /complete only: what the completion waits for (e.g. PAYMENT_REQUIRED). */
  readonly waitingFor?: string | null;
}

function parseActionResult(value: unknown): EngineActionResult {
  const json = record(value, 'action result');
  const completion =
    json.completion === 'COMPLETED' || json.completion === 'PENDING'
      ? json.completion
      : undefined;
  return {
    trip: parseEngineTrip(json.trip),
    changed: json.changed === true,
    completion,
    waitingFor:
      completion === undefined
        ? undefined
        : typeof json.waitingFor === 'string'
        ? json.waitingFor
        : null,
  };
}

/** A pending ride request as returned by GET /ride-requests/:driverId. */
export interface EngineRideRequest {
  readonly rideId: string;
  readonly offerId?: string;
  readonly pickup: EngineLocation;
  readonly drop: EngineLocation | null;
  readonly drops: readonly EngineLocation[];
  readonly vehicleType?: string;
  readonly weight?: number;
  /** INR, display copy of the payment backend's quote. */
  readonly fare?: number;
  readonly paymentMethod?: string;
  readonly status: string;
  readonly createdAt: string;
  /** When the engine stops holding this offer for the driver. */
  readonly expiresAt?: string;
}

function parseRideRequest(value: unknown): EngineRideRequest {
  const json = record(value, 'ride request');
  const drops = Array.isArray(json.drops)
    ? json.drops.map(drop => parseLocation(drop, 'drop'))
    : [];
  const drop =
    json.drop === null || json.drop === undefined
      ? drops[0] ?? null
      : parseLocation(json.drop, 'drop');
  return {
    rideId: optionalText(json.rideId) ?? invalid('ride id'),
    offerId: optionalText(json.offerId),
    pickup: parseLocation(json.pickup, 'pickup'),
    drop,
    drops: drops.length > 0 ? drops : drop ? [drop] : [],
    vehicleType: optionalText(json.vehicleType),
    weight: finite(json.weight),
    fare: finite(json.fare),
    paymentMethod: optionalText(json.paymentMethod),
    status: optionalText(json.status) ?? 'REQUESTED',
    createdAt: optionalText(json.createdAt) ?? new Date().toISOString(),
    expiresAt: optionalText(json.expiresAt),
  };
}

// ─── Presence and offers ────────────────────────────────────────────────────

const enc = encodeURIComponent;

/** PATCH /drivers/:id/availability: mark the signed-in driver available or not. */
export const setDriverAvailability = async (
  driverId: string,
  isAvailable: boolean,
): Promise<void> => {
  await getEngineClient().request({
    method: 'PATCH',
    path: `/drivers/${enc(driver(driverId))}/availability`,
    body: { isAvailable },
    retry: false,
  });
};

/** PATCH /drivers/:id/location: the signed-in driver's live location (also a heartbeat). */
export const updateDriverLocation = async (
  driverId: string,
  latitude: number,
  longitude: number,
): Promise<void> => {
  await getEngineClient().request({
    method: 'PATCH',
    path: `/drivers/${enc(driver(driverId))}/location`,
    body: { latitude, longitude },
    retry: false,
  });
};

/** GET /ride-requests/:driverId: the offer held for the signed-in driver, if any. */
export const fetchRideRequests = async (
  driverId: string,
): Promise<EngineRideRequest[]> => {
  const json = record(
    await getEngineClient().request({
      method: 'GET',
      path: `/ride-requests/${enc(driver(driverId))}`,
      retry: false, // polled every few seconds: the next poll retries
    }),
    'ride requests',
  );
  return Array.isArray(json.requests)
    ? json.requests.map(parseRideRequest)
    : [];
};

/**
 * POST /rides/:rideId/accept. The engine creates the trip (or, for a repeat by the same driver,
 * returns the same one: never a second trip). Refusals: 409 taken/expired, 422 driver not
 * approved by the payment backend.
 */
export const acceptRideRequest = async (
  rideId: string,
): Promise<EngineTrip | null> => {
  const json = record(
    await getEngineClient().request({
      method: 'POST',
      path: `/rides/${enc(uuid(rideId, 'ride id'))}/accept`,
    }),
    'acceptance',
  );
  return json.trip === null || json.trip === undefined
    ? null
    : parseEngineTrip(json.trip);
};

/** POST /rides/:rideId/reject: decline the offer. */
export const rejectRideRequest = async (rideId: string): Promise<void> => {
  await getEngineClient().request({
    method: 'POST',
    path: `/rides/${enc(uuid(rideId, 'ride id'))}/reject`,
    retry: false, // a repeat is refused (already rejected); the offer expires anyway
  });
};

/** GET /rides/:rideId/trip: the trip created when the ride was accepted, or null. */
export const getTripIdForRide = async (
  rideId: string,
): Promise<string | null> => {
  const json = record(
    await getEngineClient().request({
      method: 'GET',
      path: `/rides/${enc(uuid(rideId, 'ride id'))}/trip`,
    }),
    'ride trip',
  );
  return isRecord(json.trip) ? optionalText(json.trip.id) ?? null : null;
};

// ─── Trips ──────────────────────────────────────────────────────────────────

/** GET /trips/active/driver/:driverId: the signed-in driver's running trip, or null. */
export const getActiveTripForDriver = async (
  driverId: string,
): Promise<EngineTrip | null> => {
  const json = record(
    await getEngineClient().request({
      method: 'GET',
      path: `/trips/active/driver/${enc(driver(driverId))}`,
    }),
    'active trip',
  );
  return json.trip === null || json.trip === undefined
    ? null
    : parseEngineTrip(json.trip);
};

/** GET /trips/:tripId: one of the driver's trips (another driver's trip is a 404). */
export const getTripById = async (tripId: string): Promise<EngineTrip> => {
  const json = record(
    await getEngineClient().request({
      method: 'GET',
      path: `/trips/${enc(uuid(tripId, 'trip id'))}`,
    }),
    'trip',
  );
  return parseEngineTrip(json.trip);
};

/** One engine step. Never chained with another one. */
const tripAction = async (
  tripId: string,
  action: string,
  body?: Record<string, unknown>,
): Promise<EngineActionResult> =>
  parseActionResult(
    await getEngineClient().request({
      method: 'POST',
      path: `/trips/${enc(uuid(tripId, 'trip id'))}/${action}`,
      body,
    }),
  );

/** POST /trips/:id/arrive: the driver is at the pickup. */
export const arriveAtPickup = (tripId: string) => tripAction(tripId, 'arrive');

/**
 * POST /trips/:id/pickup/verify-otp. The engine reads the payment gate first: before the payment
 * backend allows the handover it answers 409 PAYMENT_REQUIRED and never checks the OTP.
 */
export const verifyPickupOtp = (tripId: string, otp: string) =>
  tripAction(tripId, 'pickup/verify-otp', { otp });

/** POST /trips/:id/start: only after a verified pickup. */
export const startTrip = (tripId: string) => tripAction(tripId, 'start');

/** POST /trips/:id/stop/arrive: at the current drop, or a retry of a failed delivery there. */
export const arriveAtStop = async (tripId: string, stopId: string) =>
  tripAction(tripId, 'stop/arrive', { stopId: uuid(stopId, 'stop id') });

/** POST /trips/:id/stop/verify-otp: only once the payment backend allows this drop's handover. */
export const verifyStopOtp = async (
  tripId: string,
  stopId: string,
  otp: string,
) =>
  tripAction(tripId, 'stop/verify-otp', {
    stopId: uuid(stopId, 'stop id'),
    otp,
  });

/** POST /trips/:id/stop/confirm-delivery: committed only once the payment backend accepts it. */
export const confirmStopDelivery = async (
  tripId: string,
  stopId: string,
  photoUri: string,
) =>
  tripAction(tripId, 'stop/confirm-delivery', {
    stopId: uuid(stopId, 'stop id'),
    photo: { uri: photoUri },
  });

/** POST /trips/:id/stop/fail: the receiver could not take the goods (reason 3-200 characters). */
export const failStop = async (
  tripId: string,
  stopId: string,
  reason: string,
) =>
  tripAction(tripId, 'stop/fail', {
    stopId: uuid(stopId, 'stop id'),
    reason,
  });

/**
 * POST /trips/:id/refresh: the engine re-reads the payment backend and follows what was decided
 * there (an admin's retry or closure of a failed drop, a cancellation).
 */
export const refreshTrip = async (tripId: string): Promise<EngineTrip> => {
  const json = record(
    await getEngineClient().request({
      method: 'POST',
      path: `/trips/${enc(uuid(tripId, 'trip id'))}/refresh`,
    }),
    'refresh',
  );
  return parseEngineTrip(json.trip);
};

/**
 * POST /trips/:id/complete: an explicit driver action once every drop is finished. 201
 * COMPLETED, or 202 PENDING while the payment backend has not confirmed the completion.
 */
export const completeTrip = (tripId: string) => tripAction(tripId, 'complete');

// ─── Mapping to the app's trip shape ───────────────────────────────────────

const ENGINE_TO_APP_TRIP_STATUS: Record<EngineTripStatus, TripStatus> = {
  DRIVER_ASSIGNED: 'en_route_pickup',
  DRIVER_ARRIVED: 'arrived_pickup',
  PICKUP_VERIFIED: 'pickup_verified',
  IN_TRANSIT: 'in_transit',
  DROP_PROGRESS: 'arrived_drop',
  DELIVERED: 'drop_verified',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};

/** Statuses after the trip left the pickup (it was started). */
const LEFT_PICKUP: ReadonlySet<EngineTripStatus> = new Set([
  'IN_TRANSIT',
  'DROP_PROGRESS',
  'DELIVERED',
  'COMPLETED',
]);

const timeOf = (iso: string | undefined): number | undefined => {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? ms : undefined;
};

/** Map an engine trip into the app's ActiveTrip: the pickup, then the drops in order. */
export const engineTripToActiveTrip = (t: EngineTrip): ActiveTrip => {
  const leftPickup = LEFT_PICKUP.has(t.status);
  const cancelled = t.status === 'CANCELLED';

  const pickupStop: TripStop = {
    id: `${t.id}-pickup`,
    type: 'pickup',
    label: 'Pickup',
    address: formatAddress(t.pickup),
    latitude: t.pickup.latitude,
    longitude: t.pickup.longitude,
    status: leftPickup ? 'completed' : cancelled ? 'pending' : 'current',
  };

  const drops: TripStop[] = t.stops.map((s, index) => ({
    id: s.id,
    type: 'drop',
    label: `Drop-off ${s.sequence}`,
    address: formatAddress(s.location),
    latitude: s.location.latitude,
    longitude: s.location.longitude,
    status: FINAL_STOP_STATUSES.has(s.status)
      ? 'completed'
      : leftPickup && index === t.currentStopIndex
      ? 'current'
      : 'pending',
    sequence: s.sequence,
    engineStatus: s.status,
    payablePaise: s.payablePaise,
    otpVerified: s.otpVerified,
    failureReason: s.failureReason,
  }));

  const stops = [pickupStop, ...drops];
  const currentStopIndex = leftPickup
    ? Math.min(t.currentStopIndex + 1, stops.length - 1)
    : 0;

  return {
    id: t.id,
    status: ENGINE_TO_APP_TRIP_STATUS[t.status],
    stops,
    currentStopIndex,
    estimatedEarning: t.fare ?? 0,
    currency: '₹',
    totalDistanceKm:
      t.totalDistanceKm ??
      Math.round(
        routeKm(
          t.pickup,
          t.stops.map(s => s.location),
        ) * 10,
      ) / 10,
    loadType: 'other',
    goodsType: 'other',
    vehicleId: 'unknown',
    vehicleRegistration: 'unknown',
    startedAt: timeOf(t.startedAt),
    completedAt: timeOf(t.completedAt),
    engineStatus: t.status,
    rideId: t.rideId,
    paymentTripId: t.paymentTripId,
    externalRef: t.externalRef,
    paymentMethod: t.paymentMethod,
    payablePaise: t.payablePaise,
    totalStops: t.stops.length,
    completedStops: t.completedStops,
    remainingStops: t.remainingStops,
    updatedAt: timeOf(t.updatedAt),
  };
};

const toRad = (deg: number): number => (deg * Math.PI) / 180;

const haversineKm = (a: EngineLocation, b: EngineLocation): number => {
  const R = 6371;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) *
      Math.cos(toRad(b.latitude)) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
};

/** Straight-line length of pickup -> drop 1 -> drop 2 ... (display only). */
const routeKm = (
  pickup: EngineLocation,
  drops: readonly EngineLocation[],
): number => {
  let total = 0;
  let from = pickup;
  for (const to of drops) {
    total += haversineKm(from, to);
    from = to;
  }
  return total;
};

const formatAddress = (loc: EngineLocation): string =>
  loc.address?.trim() ||
  `${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)}`;

/** Fallback offer lifetime when an older engine sends no expiresAt. */
const RIDE_TTL_MS = 15_000;

/** Map an engine ride request into the app's TripOffer. */
export const rideRequestToOffer = (r: EngineRideRequest): TripOffer => {
  const createdMs = Date.parse(r.createdAt);
  const expiresMs = r.expiresAt ? Date.parse(r.expiresAt) : NaN;
  const dropStops: TripStop[] = r.drops.map((d, index) => ({
    id: `${r.rideId}-drop-${index + 1}`,
    type: 'drop',
    label: r.drops.length > 1 ? `Drop-off ${index + 1}` : 'Drop-off',
    address: formatAddress(d),
    latitude: d.latitude,
    longitude: d.longitude,
    status: 'pending',
  }));

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
    dropStops,
    totalDistanceKm: Math.round(routeKm(r.pickup, r.drops) * 10) / 10,
    loadType: 'other',
    vehicleType: r.vehicleType ?? 'Mini Truck',
    // The engine's deadline is authoritative; the fallback only covers an older engine.
    expiresAt: Number.isFinite(expiresMs)
      ? expiresMs
      : (Number.isFinite(createdMs) ? createdMs : Date.now()) + RIDE_TTL_MS,
    demandLevel: 'medium',
  };
};

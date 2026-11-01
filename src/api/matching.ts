import { createRide, getRide, recoverRide } from './engine';
import { bookingOwner, bookingRevision, readPendingBooking, writePendingBooking } from '../state/pendingBooking';
import { ApiError } from './http';
import type { CreateRideInput, GeoPoint, NearbyDriver, Ride } from './types';

/** How often to ask the engine whether its dispatch has found a driver. */
const POLL_INTERVAL_MS = 2_000;

export class NoDriversAvailableError extends Error {
  constructor(message = 'No drivers are available near your pickup point.') {
    super(message);
    this.name = 'NoDriversAvailableError';
  }
}

class AbortError extends Error {
  constructor() {
    super('Aborted');
    this.name = 'AbortError';
  }
}

export const isAbortError = (error: unknown): boolean =>
  error instanceof AbortError || (error instanceof Error && error.name === 'AbortError');

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortError());
    const onAbort = () => { clearTimeout(timer); reject(new AbortError()); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });

const creationFlights = new Map<string, Promise<Ride>>();
const createOrRecover = async (input: CreateRideInput | undefined, signal?: AbortSignal, retryDispatch = false, onSaved?: (input: CreateRideInput) => void): Promise<Ride> => {
  const uid = bookingOwner();
  const active = creationFlights.get(uid);
  if (active) {
    const ride = await active;
    if (input && ride.quoteId !== input.quoteId) throw new Error('A different booking is already being confirmed.');
    return ride;
  }
  const revision = bookingRevision(uid);
  const flight = (async () => {
    const saved = await readPendingBooking(uid);
    if (saved && input && saved.input.quoteId !== input.quoteId) {
      throw new Error('Resolve your previous booking before starting another one.');
    }
    const intended = saved?.input ?? input;
    const existing = await recoverRide(intended?.quoteId, signal);
    if (signal?.aborted || bookingOwner() !== uid) throw new AbortError();
    if (existing && existing.status !== 'PENDING_REGISTRATION' && !(retryDispatch && existing.status === 'REJECTED')) {
      const canonical = intended ?? { quoteId: existing.quoteId!, paymentMethod: existing.paymentMethod! };
      await writePendingBooking(uid, { input: canonical, rideId: existing.id }, revision);
      return existing;
    }
    if (!intended) throw new Error('No saved booking could be confirmed. Return home and retry recovery.');
    // Persist BEFORE the mutation: a timeout/crash must retain its original quote identity.
    await writePendingBooking(uid, { input: intended, rideId: existing?.id }, revision);
    if (signal?.aborted || bookingOwner() !== uid) throw new AbortError();
    onSaved?.(intended);
    let ride: Ride;
    try { ride = await createRide(intended, signal); }
    catch (error) {
      // Only validation failures known to precede creation can safely release this draft.
      if (error instanceof ApiError && (error.status === 400 || ['QUOTE_EXPIRED', 'QUOTE_ROUTE_MISMATCH', 'QUOTE_NOT_FOUND'].includes(error.errorCode ?? ''))) {
        const confirmed = await recoverRide(intended.quoteId, signal);
        if (!confirmed) await writePendingBooking(uid, null);
      }
      throw error;
    }
    await writePendingBooking(uid, { input: intended, rideId: ride.id }, revision);
    return ride;
  })();
  creationFlights.set(uid, flight);
  try { return await flight; }
  finally { if (creationFlights.get(uid) === flight) creationFlights.delete(uid); }
};

export interface MatchResult {
  readonly ride: Ride;
}

export interface MatchOptions {
  readonly signal?: AbortSignal;
  readonly existingRide?: Ride;
  readonly retryDispatch?: boolean;
  readonly onRequestSaved?: (input: CreateRideInput) => void;
  /** Persist the ride as soon as the engine creates it so cancellation can reach the server. */
  readonly onRideCreated?: (ride: Ride) => void;
  /** Deprecated UI fields kept only until older screens are migrated; they are never used. */
  readonly searchCenter?: GeoPoint;
  readonly onProgress?: (progress: { readonly attempt: number; readonly totalCandidates: number; readonly driver: NearbyDriver }) => void;
}

/**
 * Confirms the quote, then observes dispatch performed entirely by the engine. The customer
 * app never lists available drivers, chooses a driver, or cancels one offer to try another.
 */
export const findDriverAndCreateRide = async (
  input: CreateRideInput | undefined,
  options: MatchOptions = {}
): Promise<MatchResult> => {
  const { signal, onRideCreated, existingRide } = options;
  const uid = bookingOwner();
  let ride = existingRide && existingRide.status !== 'PENDING_REGISTRATION' && !(options.retryDispatch && existingRide.status === 'REJECTED')
    ? await getRide(existingRide.id, signal) : await createOrRecover(input, signal, options.retryDispatch, options.onRequestSaved);
  if (signal?.aborted || bookingOwner() !== uid) throw new AbortError();
  onRideCreated?.(ride);

  while (ride.status === 'REQUESTED' || ride.status === 'PENDING_REGISTRATION') {
    await sleep(POLL_INTERVAL_MS, signal);
    ride = await getRide(ride.id, signal);
    if (signal?.aborted || bookingOwner() !== uid) throw new AbortError();
    onRideCreated?.(ride);
  }

  if (ride.status === 'ACCEPTED') return { ride };
  if (ride.status === 'REJECTED') throw new NoDriversAvailableError();
  if (ride.status === 'CANCELLED') {
    throw new ApiError('http', 'Your booking was cancelled before a driver was assigned.', 409);
  }
  throw new ApiError('http', 'The booking could not be dispatched.', 409);
};

export { ApiError };

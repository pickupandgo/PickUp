import { createRide, getRide } from './engine';
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
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new AbortError());
      },
      { once: true }
    );
  });

export interface MatchResult {
  readonly ride: Ride;
}

export interface MatchOptions {
  readonly signal?: AbortSignal;
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
  input: CreateRideInput,
  options: MatchOptions = {}
): Promise<MatchResult> => {
  const { signal, onRideCreated } = options;
  let ride = await createRide(input, signal);
  onRideCreated?.(ride);

  while (ride.status === 'REQUESTED' || ride.status === 'PENDING_REGISTRATION') {
    await sleep(POLL_INTERVAL_MS, signal);
    ride = await getRide(ride.id, signal);
  }

  if (ride.status === 'ACCEPTED') return { ride };
  if (ride.status === 'REJECTED') throw new NoDriversAvailableError();
  if (ride.status === 'CANCELLED') {
    throw new ApiError('http', 'Your booking was cancelled before a driver was assigned.', 409);
  }
  throw new ApiError('http', 'The booking could not be dispatched.', 409);
};

export { ApiError };

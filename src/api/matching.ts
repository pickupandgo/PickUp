import { cancelRide, createRide, getNearbyDrivers, getRide } from './engine';
import { ApiError, toApiError } from './http';
import type { CreateRideInput, GeoPoint, NearbyDriver, Ride } from './types';

/**
 * Driver matching lives in the client because the engine has no server-side
 * dispatch: `POST /rides` requires a specific `driverId`. So we fetch nearby
 * drivers and offer the ride to each in turn until one accepts.
 *
 * Two timing details from the backend that shape this:
 *  - It expires a REQUESTED ride after 15s, but only while the *driver* app is
 *    polling `/ride-requests/:driverId`. If no driver app is polling, the ride
 *    stays REQUESTED forever, so we enforce our own per-driver deadline.
 *  - `POST /rides/:id/cancel` only works while status is REQUESTED, which is
 *    exactly the window we use it in before moving to the next driver.
 */

/** How long to wait for one driver before giving up on them. */
const PER_DRIVER_TIMEOUT_MS = 20_000;
/** How often to re-check ride status. */
const POLL_INTERVAL_MS = 2_000;

export class NoDriversAvailableError extends Error {
  constructor(message = 'No drivers available nearby') {
    super(message);
    this.name = 'NoDriversAvailableError';
  }
}

export interface MatchProgress {
  /** 1-based position in the candidate list. */
  readonly attempt: number;
  readonly totalCandidates: number;
  readonly driver: NearbyDriver;
}

export interface MatchOptions {
  readonly radiusKm?: number;
  readonly perDriverTimeoutMs?: number;
  readonly onProgress?: (progress: MatchProgress) => void;
  readonly signal?: AbortSignal;
}

/**
 * Marker error used to signal cooperative cancellation.
 *
 * `DOMException` is a web-only global and is missing from Hermes, so it can't
 * be thrown at runtime on device. Callers check `error.name === 'AbortError'`
 * or use the `isAbortError` helper below.
 */
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
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new AbortError());
      },
      { once: true }
    );
  });

/**
 * Polls one ride until it leaves REQUESTED or the deadline passes.
 * Returns the final ride, or null if it timed out still REQUESTED.
 */
const awaitDriverDecision = async (
  rideId: string,
  deadlineMs: number,
  signal?: AbortSignal
): Promise<Ride | null> => {
  const deadline = Date.now() + deadlineMs;

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS, signal);
    const ride = await getRide(rideId, signal);
    if (ride.status !== 'REQUESTED') return ride;
  }
  return null;
};

/** Best-effort cleanup so an abandoned request doesn't linger as REQUESTED. */
const releaseRide = async (rideId: string): Promise<void> => {
  try {
    await cancelRide(rideId);
  } catch {
    // Already accepted, rejected or expired — nothing to release.
  }
};

export interface MatchResult {
  readonly ride: Ride;
  readonly driver: NearbyDriver;
}

/**
 * Offers the ride to nearby drivers, nearest first, until one accepts.
 *
 * @throws NoDriversAvailableError when nobody is online in range or everyone
 *         declined / timed out.
 * @throws ApiError for transport and server failures.
 */
export const findDriverAndCreateRide = async (
  input: Omit<CreateRideInput, 'driverId'>,
  options: MatchOptions = {}
): Promise<MatchResult> => {
  const {
    radiusKm = 20,
    perDriverTimeoutMs = PER_DRIVER_TIMEOUT_MS,
    onProgress,
    signal,
  } = options;

  const pickup: GeoPoint = input.pickup;
  const candidates = await getNearbyDrivers(pickup, radiusKm, signal);

  if (!candidates.length) {
    throw new NoDriversAvailableError(
      'No drivers are online near your pickup point right now.'
    );
  }

  for (let i = 0; i < candidates.length; i++) {
    const driver = candidates[i];
    if (signal?.aborted) throw new AbortError();

    onProgress?.({ attempt: i + 1, totalCandidates: candidates.length, driver });

    let ride: Ride;
    try {
      ride = await createRide({ ...input, driverId: driver.id }, signal);
    } catch (error) {
      const apiError = toApiError(error);
      // 400 here means this driver just went busy. Try the next one.
      if (apiError.kind === 'http' && apiError.status === 400) continue;
      throw apiError;
    }

    const decided = await awaitDriverDecision(ride.id, perDriverTimeoutMs, signal);

    if (decided?.status === 'ACCEPTED') {
      return { ride: decided, driver };
    }

    if (!decided) {
      // Still REQUESTED at our deadline: withdraw before moving on.
      await releaseRide(ride.id);
    }
    // REJECTED or CANCELLED: fall through to the next candidate.
  }

  throw new NoDriversAvailableError(
    'Nearby drivers did not accept the request. Please try again.'
  );
};

export { ApiError };

import { useCallback, useEffect, useRef, useState } from 'react';
import { getNearbyDrivers } from '../api/engine';
import { toApiError, type ApiError } from '../api/http';
import type { GeoPoint, NearbyDriver } from '../api/types';

/**
 * Polls the engine for available drivers around a point.
 *
 * The engine only returns drivers that are marked available AND have pinged
 * within the last 60s, so an empty list means nobody is online right now — the
 * loop keeps running so a driver going back online is picked up on the next
 * tick. No AppState pause, no abort dance: the previous versions were subtle
 * enough that a single glitch could freeze the loop after one empty response.
 */

const DEFAULT_INTERVAL_MS = 8_000;
const DEFAULT_RADIUS_KM = 20;

export interface UseNearbyDriversResult {
  readonly drivers: readonly NearbyDriver[];
  readonly error: ApiError | undefined;
  readonly isLoading: boolean;
  readonly refresh: () => void;
}

export const useNearbyDrivers = (
  point: GeoPoint | undefined,
  options: {
    readonly radiusKm?: number;
    readonly intervalMs?: number;
    readonly enabled?: boolean;
  } = {}
): UseNearbyDriversResult => {
  const {
    radiusKm = DEFAULT_RADIUS_KM,
    intervalMs = DEFAULT_INTERVAL_MS,
    enabled = true,
  } = options;

  const [drivers, setDrivers] = useState<readonly NearbyDriver[]>([]);
  const [error, setError] = useState<ApiError>();
  const [isLoading, setIsLoading] = useState(false);

  // Rounded position so tiny GPS jitter (metre-level) doesn't restart the loop.
  const lat = point ? Number(point.latitude.toFixed(3)) : undefined;
  const lng = point ? Number(point.longitude.toFixed(3)) : undefined;

  // Bumped every time a caller wants to force an immediate refetch. Keeping it
  // outside the poll effect keeps the poll loop stable across manual refreshes.
  const [refreshTick, setRefreshTick] = useState(0);
  const refresh = useCallback(() => setRefreshTick((n) => n + 1), []);

  // Latest params in a ref so the interval keeps using the current pickup even
  // if it moves. The effect only restarts when enabled/interval flip.
  const paramsRef = useRef({ lat, lng, radiusKm });
  paramsRef.current = { lat, lng, radiusKm };

  useEffect(() => {
    // No pickup yet, so nothing to search around. When the pickup lands, this
    // effect re-runs (lat/lng are in the dep list) and the loop starts.
    if (!enabled || lat === undefined || lng === undefined) return;

    let alive = true;

    const tick = async () => {
      const { lat: la, lng: ln, radiusKm: rk } = paramsRef.current;
      if (la === undefined || ln === undefined) return;
      setIsLoading(true);
      try {
        const found = await getNearbyDrivers({ latitude: la, longitude: ln }, rk);
        if (!alive) return;
        setDrivers(found);
        setError(undefined);
      } catch (caught) {
        if (!alive) return;
        setError(toApiError(caught));
      } finally {
        if (alive) setIsLoading(false);
      }
    };

    // Immediate first fetch, then a plain interval. `tick` is idempotent — if
    // one call runs long it doesn't matter that the next may overlap slightly.
    void tick();
    const id = setInterval(tick, intervalMs);

    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [enabled, intervalMs, refreshTick, lat, lng]);

  return { drivers, error, isLoading, refresh };
};

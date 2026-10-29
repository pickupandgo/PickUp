import { useCallback } from 'react';
import type { ApiError } from '../api/http';
import type { GeoPoint, NearbyDriver } from '../api/types';

/**
 * Compatibility hook for screens that previously showed a pre-dispatch driver count.
 *
 * The customer app must not discover, select, or use driver availability as an
 * assignment authority. Dispatch is owned by the engine after a ride request is
 * created, so this hook deliberately exposes no driver data and never calls a
 * driver-discovery endpoint. Consumers use the empty result to hide speculative
 * ETAs until the engine has assigned a driver.
 */

export interface UseNearbyDriversResult {
  readonly drivers: readonly NearbyDriver[];
  readonly error: ApiError | undefined;
  readonly isLoading: boolean;
  readonly refresh: () => void;
}

export const useNearbyDrivers = (
  _point: GeoPoint | undefined,
  _options: {
    readonly radiusKm?: number;
    readonly intervalMs?: number;
    readonly enabled?: boolean;
  } = {}
): UseNearbyDriversResult => {
  const refresh = useCallback(() => undefined, []);
  return { drivers: [], error: undefined, isLoading: false, refresh };
};


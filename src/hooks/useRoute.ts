import { useEffect, useState } from 'react';
import { getRoute, type RouteResult } from '../api/directions';
import type { GeoPoint } from '../api/types';

/**
 * Road-following route between two points, fetched from Google Directions.
 *
 * Refetches only when a coordinate crosses a ~10-metre boundary, so tiny GPS
 * jitter on the driver's location doesn't spend a Directions call per tick.
 * The endpoint pair is normally pickup + drop, which is stable across a trip,
 * so most rides make one Directions request.
 */

/** Rounding coordinates to 4 decimals is ~11m — well below map noise. */
const round = (n: number): number => Math.round(n * 1e4) / 1e4;

export const useRoute = (
  origin: GeoPoint | undefined,
  destination: GeoPoint | undefined
): readonly GeoPoint[] | undefined => {
  const [route, setRoute] = useState<readonly GeoPoint[]>();

  const originKey = origin ? `${round(origin.latitude)},${round(origin.longitude)}` : '';
  const destKey = destination ? `${round(destination.latitude)},${round(destination.longitude)}` : '';

  useEffect(() => {
    if (!origin || !destination) {
      setRoute(undefined);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    getRoute(origin, destination, { signal: controller.signal })
      .then((result: RouteResult) => {
        if (!cancelled) setRoute(result.polyline);
      })
      .catch(() => {
        // Fall back to no route on failure. Screens can then draw a straight
        // line as a last resort, or nothing at all — their choice.
        if (!cancelled) setRoute(undefined);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
    // Keying on the rounded strings avoids refetches for sub-11m movement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originKey, destKey]);

  return route;
};

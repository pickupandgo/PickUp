import { useEffect, useState } from 'react';
import { getRoute } from '../api/directions';
import type { GeoPoint } from '../api/types';
const keyFor = (p?: GeoPoint) =>
  p ? `${Math.round(p.latitude * 1e4)},${Math.round(p.longitude * 1e4)}` : '';
export const useRoadRoute = (
  origin: GeoPoint | undefined,
  destination: GeoPoint | undefined,
  waypoints: readonly GeoPoint[] = [],
) => {
  const key = [
    keyFor(origin),
    ...waypoints.map(keyFor),
    keyFor(destination),
  ].join('|');
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    key: string;
    polyline?: readonly GeoPoint[];
    status: 'idle' | 'loading' | 'ready' | 'error';
  }>({ key: '', status: 'idle' });
  useEffect(() => {
    if (!origin || !destination) {
      setState({ key, status: 'idle' });
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    setState({ key, status: 'loading' });
    getRoute(origin, destination, { waypoints, signal: controller.signal })
      .then((result) => {
        if (!cancelled)
          setState({ key, status: 'ready', polyline: result.polyline });
      })
      .catch(() => {
        if (!cancelled) setState({ key, status: 'error' });
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
    // Coordinate keys avoid refetches caused by object identity / small GPS jitter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);
  return {
    polyline: state.key === key ? state.polyline : undefined,
    status:
      !origin || !destination
        ? ('idle' as const)
        : state.key === key
          ? state.status
          : ('loading' as const),
    retry: () => setAttempt((n) => n + 1),
  };
};
export const useRoute = (
  origin: GeoPoint | undefined,
  destination: GeoPoint | undefined,
) => useRoadRoute(origin, destination).polyline;

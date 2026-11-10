import { useCallback, useEffect, useRef, useState } from 'react';
import { useDriverLocation } from '../location';
import { useTripResource } from './useActiveTrip';
import { EngineRoutingProvider } from '../services/routing/EngineRoutingProvider';
import {
  TripRoutePlanner,
  type RouteState,
} from '../services/routing/TripRoutePlanner';

export interface UseTripRouteConfig {
  tripId?: string;
  deviationThresholdMeters?: number;
  staleRouteThresholdMs?: number;
}
export type UseTripRouteResult = RouteState & { retry: () => void };
export function useTripRoute(config?: UseTripRouteConfig): UseTripRouteResult {
  const [retryAttempt, setRetryAttempt] = useState(0);
  const { currentLocation } = useDriverLocation();
  const resource = useTripResource(config?.tripId);
  const trip = resource.trip;
  const owner = `${resource.sessionUid ?? ''}:${trip?.id ?? ''}`;
  const planner = useRef<TripRoutePlanner | null>(null);
  if (!planner.current)
    planner.current = new TripRoutePlanner(
      new EngineRoutingProvider(),
      config?.deviationThresholdMeters,
      config?.staleRouteThresholdMs,
    );
  const retry = useCallback(() => {
    planner.current?.invalidate();
    setRetryAttempt(value => value + 1);
  }, []);
  const [state, setState] = useState<{ owner: string; value: RouteState }>({
    owner: '',
    value: { route: null, isLoading: false, error: null },
  });
  useEffect(() => {
    let active = true;
    const current = planner.current!;
    const tick = () => {
      const work = current.update(trip, currentLocation);
      setState({ owner, value: { ...current.state } });
      work.then(value => {
        if (active) setState({ owner, value: { ...value } });
      });
    };
    tick();
    const timer = setInterval(tick, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [trip, currentLocation, owner, retryAttempt]);
  useEffect(() => () => planner.current?.invalidate(), []);
  return {
    ...(state.owner === owner
      ? state.value
      : { route: null, isLoading: true, error: null }),
    retry,
  };
}

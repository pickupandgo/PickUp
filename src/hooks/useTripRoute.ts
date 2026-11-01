import { useEffect, useRef, useState } from 'react';
import { useDriverLocation } from '../location';
import { useActiveTrip } from './useActiveTrip';
import { EngineRoutingProvider } from '../services/routing/EngineRoutingProvider';
import { TripRoutePlanner, type RouteState } from '../services/routing/TripRoutePlanner';

export interface UseTripRouteConfig { deviationThresholdMeters?: number; staleRouteThresholdMs?: number }
export type UseTripRouteResult = RouteState;
export function useTripRoute(config?: UseTripRouteConfig): UseTripRouteResult {
  const { currentLocation } = useDriverLocation();
  const trip = useActiveTrip();
  const planner = useRef<TripRoutePlanner | null>(null);
  if (!planner.current) planner.current = new TripRoutePlanner(new EngineRoutingProvider(),
    config?.deviationThresholdMeters, config?.staleRouteThresholdMs);
  const [state, setState] = useState<RouteState>({ route: null, isLoading: false, error: null });
  useEffect(() => {
    let active = true;
    const current = planner.current!;
    const tick = () => {
      const work = current.update(trip, currentLocation);
      setState({ ...current.state });
      work.then(value => { if (active) setState({ ...value }); });
    };
    tick();
    const timer = setInterval(tick, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [trip, currentLocation]);
  useEffect(() => () => planner.current?.invalidate(), []);
  return state;
}

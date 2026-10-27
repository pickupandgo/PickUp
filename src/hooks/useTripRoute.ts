import { useState, useEffect, useRef, useMemo } from 'react';
import { useDriverLocation } from '../location';
import { useActiveTrip } from './useActiveTrip';
import { routingService } from '../services/routing';
import type { RoutingResponse, RoutingError } from '../services/routing';
import { pointToPolylineDistance } from '../services/routing/geometry';

export interface UseTripRouteConfig {
  tripId?: string;
  deviationThresholdMeters?: number;
  staleRouteThresholdMs?: number;
}

export interface UseTripRouteResult {
  route: RoutingResponse | null;
  isLoading: boolean;
  error: RoutingError | null;
}

export function useTripRoute(config?: UseTripRouteConfig): UseTripRouteResult {
  const { deviationThresholdMeters = 50, staleRouteThresholdMs = 60000, tripId } = config || {};
  
  const { currentLocation } = useDriverLocation();
  const trip = useActiveTrip(tripId);
  
  const [route, setRoute] = useState<RoutingResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<RoutingError | null>(null);
  
  const lastFetchTime = useRef<number>(0);
  const lastTargetStopIds = useRef<string>('');
  const lastOriginKey = useRef<string>('');
  const requestVersion = useRef<number>(0);

  // Compute remaining stops from current trip
  const remainingStops = useMemo(() => {
    if (!trip || !trip.stops.length) return [];
    // Only route to the current stop and subsequent stops
    return trip.stops.slice(trip.currentStopIndex).map(s => ({
      id: s.id,
      coordinate: { latitude: s.latitude, longitude: s.longitude }
    }));
  }, [trip, trip?.currentStopIndex]);

  // Determine origin: driver's live GPS if available, otherwise first stop
  const origin = useMemo(() => {
    if (currentLocation) return currentLocation;
    if (trip && trip.stops.length >= 2) {
      return {
        latitude: trip.stops[0].latitude,
        longitude: trip.stops[0].longitude,
      };
    }
    return null;
  }, [currentLocation, trip]);

  // Determine destinations
  const destinations = useMemo(() => {
    if (currentLocation && remainingStops.length > 0) {
      return remainingStops.map(s => s.coordinate);
    }
    if (!currentLocation && trip && trip.stops.length >= 2) {
      return trip.stops.slice(1).map(s => ({
        latitude: s.latitude,
        longitude: s.longitude,
      }));
    }
    return [];
  }, [currentLocation, remainingStops, trip]);

  useEffect(() => {
    if (!origin || destinations.length === 0) {
      if (route !== null) setRoute(null);
      return;
    }

    const currentStopIds = remainingStops.map(s => s.id).join(',');
    const originKey = `${origin.latitude.toFixed(4)},${origin.longitude.toFixed(4)}`;
    let needsRefresh = false;

    // 1. Destination/Sequence change
    if (currentStopIds !== lastTargetStopIds.current) {
      needsRefresh = true;
    }
    
    // 2. Origin changed significantly (e.g. from fallback stop to live GPS)
    if (lastOriginKey.current !== originKey && !route) {
      needsRefresh = true;
    }

    // 3. Stale Route
    if (!needsRefresh && Date.now() - lastFetchTime.current > staleRouteThresholdMs) {
      needsRefresh = true;
    }

    // 4. Route Deviation (if live GPS is present)
    if (!needsRefresh && currentLocation && route?.polylinePoints) {
      const dist = pointToPolylineDistance(currentLocation, route.polylinePoints);
      if (dist > deviationThresholdMeters) {
        needsRefresh = true;
      }
    }

    // 5. No route yet
    if (!route && !isLoading && !error) {
      needsRefresh = true;
    }

    if (needsRefresh) {
      const fetchRoute = async () => {
        const currentVersion = ++requestVersion.current;
        setIsLoading(true);
        setError(null);
        
        try {
          const response = await routingService.getRoute({
            origin,
            destinations,
          });
          
          // Stale response protection
          if (currentVersion === requestVersion.current) {
            setRoute(response);
            lastFetchTime.current = Date.now();
            lastTargetStopIds.current = currentStopIds;
            lastOriginKey.current = originKey;
            setError(null);
          }
        } catch (err: unknown) {
          if (currentVersion === requestVersion.current) {
            if ((err as any)?.code !== 'STALE') {
              setError(err as RoutingError);
            }
          }
        } finally {
          if (currentVersion === requestVersion.current) {
            setIsLoading(false);
          }
        }
      };

      fetchRoute();
    }
  }, [origin, destinations, remainingStops, currentLocation, route, deviationThresholdMeters, staleRouteThresholdMs, isLoading, error]);

  return { route, isLoading, error };
}

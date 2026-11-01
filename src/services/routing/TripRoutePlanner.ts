import type { ActiveTrip } from '../../types/trip';
import type { LocationResult } from '../../location/types';
import { isFreshFix } from '../../location/fixPolicy';
import { pointToPolylineDistance } from './geometry';
import { RoutingError, type RoutingProvider, type RoutingResponse } from './types';

export function navigationStops(trip: ActiveTrip | null) {
  if (!trip || ['COMPLETED', 'CANCELLED', 'DELIVERED'].includes(trip.engineStatus ?? '')) return [];
  if (['DRIVER_ASSIGNED', 'DRIVER_ARRIVED', 'PICKUP_VERIFIED'].includes(trip.engineStatus ?? '')) return trip.stops.slice(0, 1);
  return trip.stops.slice(trip.currentStopIndex).filter(stop => stop.status !== 'completed');
}

export interface RouteState { route: RoutingResponse | null; isLoading: boolean; error: RoutingError | null }
/** Per-consumer single flight with generation guards; no shared cross-screen request counter. */
export class TripRoutePlanner {
  state: RouteState = { route: null, isLoading: false, error: null };
  private key = '';
  private version = 0;
  private busy = false;
  private lastAttempt = -Infinity;
  private fetchedAt = -Infinity;
  constructor(private readonly provider: RoutingProvider, private readonly deviation = 50, private readonly staleMs = 60000) {}

  invalidate() { ++this.version; this.key = ''; this.state = { route: null, isLoading: false, error: null }; }

  async update(trip: ActiveTrip | null, fix: LocationResult | null, now = Date.now()): Promise<RouteState> {
    const stops = navigationStops(trip);
    const key = JSON.stringify([trip?.id, trip?.paymentTripId, stops.map(s => [s.id, s.latitude, s.longitude])]);
    if (key !== this.key) {
      ++this.version; this.key = key; this.lastAttempt = -Infinity;
      this.state = { route: null, isLoading: false, error: null };
    }
    if (!stops.length) { this.state = { route: null, isLoading: false, error: null }; return this.state; }
    if (!isFreshFix(fix, now)) {
      ++this.version;
      this.state = { route: null, isLoading: false, error: new RoutingError('A fresh GPS position is required.', 'GPS_UNAVAILABLE') };
      return this.state;
    }
    if (!trip?.paymentTripId) {
      this.state = { route: null, isLoading: false, error: new RoutingError('Trip assignment is not confirmed yet.', 'PROVIDER_ERROR') };
      return this.state;
    }
    const route = this.state.route;
    const refresh = !route || now - this.fetchedAt >= this.staleMs ||
      pointToPolylineDistance(fix, route.polylinePoints) > this.deviation;
    if (this.busy || !refresh || now - this.lastAttempt < 5000) return this.state;
    const version = this.version;
    this.busy = true; this.lastAttempt = now;
    this.state = { ...this.state, isLoading: true, error: null };
    try {
      const result = await this.provider.getRoute({ tripId: trip.paymentTripId, origin: fix,
        destinations: stops.map(s => ({ latitude: s.latitude, longitude: s.longitude })) });
      if (version === this.version) {
        this.fetchedAt = now;
        this.state = { route: result, isLoading: false, error: null };
      }
    } catch {
      if (version === this.version) this.state = { route: null, isLoading: false,
        error: new RoutingError('Road routing is unavailable. Check connectivity and retry.', 'PROVIDER_ERROR') };
    } finally { this.busy = false; }
    return this.state;
  }
}

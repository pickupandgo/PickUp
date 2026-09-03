import type { Coordinate } from '../../map/types';
import type { RoutingProvider, RoutingRequest, RoutingResponse } from './types';
import { RoutingError } from './types';
import { getRouteBounds, validateCoordinate } from './geometry';
import { getRoute as getEngineRoute } from '../engine/directions';
import { MockRoutingProvider } from './MockRoutingProvider';

/**
 * Routing provider backed by the engine's Google Directions call
 * (`services/engine/directions.getRoute`). This is what makes the map draw a
 * real road-following polyline instead of the straight interpolated line the
 * MockRoutingProvider produces.
 *
 * The last entry in `destinations` is the final destination; any earlier ones
 * are passed to Directions as ordered waypoints (multi-stop trips).
 *
 * Resilience: if the Directions request fails (network hiccup, quota, key not
 * yet propagated) we fall back to the mock provider so the driver still sees a
 * usable route rather than a blank map.
 */
export class EngineRoutingProvider implements RoutingProvider {
  private readonly fallback: MockRoutingProvider;

  constructor(fallback: MockRoutingProvider = new MockRoutingProvider({ averageSpeedKmh: 30 })) {
    this.fallback = fallback;
  }

  public async getRoute(request: RoutingRequest): Promise<RoutingResponse> {
    const { origin, destinations } = request;

    if (!validateCoordinate(origin)) {
      throw new RoutingError('Invalid origin coordinate', 'INVALID_COORDINATES');
    }
    if (destinations.length === 0) {
      throw new RoutingError('At least one destination is required', 'INVALID_COORDINATES');
    }
    for (const dest of destinations) {
      if (!validateCoordinate(dest)) {
        throw new RoutingError('Invalid destination coordinate', 'INVALID_COORDINATES');
      }
    }

    // Split: final stop is the destination, everything before it is a waypoint.
    const waypoints = destinations.slice(0, -1);
    const destination = destinations[destinations.length - 1];

    try {
      const result = await getEngineRoute(origin, destination, { waypoints });

      const polylinePoints: Coordinate[] = result.polyline.map((p) => ({
        latitude: p.latitude,
        longitude: p.longitude,
      }));

      const bounds = getRouteBounds(polylinePoints);
      if (!bounds) {
        throw new RoutingError('Directions returned an empty route', 'NO_ROUTE');
      }

      const totalDurationSeconds = result.durationSeconds;

      return {
        polylinePoints,
        totalDistanceMeters: result.distanceMeters,
        totalDurationSeconds,
        eta: new Date(Date.now() + totalDurationSeconds * 1000),
        bounds,
      };
    } catch (error) {
      // Invalid input is a real error worth surfacing; anything else (network,
      // config, quota) falls back to a drawable straight-line route.
      if (error instanceof RoutingError && error.code === 'INVALID_COORDINATES') {
        throw error;
      }
      console.warn('[EngineRoutingProvider] Directions failed, using mock route:', error);
      return this.fallback.getRoute(request);
    }
  }
}

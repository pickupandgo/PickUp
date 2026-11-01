import type { Coordinate } from '../../map/types';
import type { RoutingProvider, RoutingRequest, RoutingResponse } from './types';
import { RoutingError } from './types';
import { getRouteBounds, validateCoordinate } from './geometry';
import { getRoute as getEngineRoute } from '../engine/directions';

/** Legacy class name retained; routes now come from the authenticated server adapter.
 * Errors remain errors: production navigation never fabricates road geometry.
 */
export class EngineRoutingProvider implements RoutingProvider {
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
      const result = await getEngineRoute(origin, destination, { waypoints, tripId: request.tripId });

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
      if (error instanceof RoutingError && error.code === 'INVALID_COORDINATES') {
        throw error;
      }
      throw new RoutingError('Road routing is unavailable. Check connectivity and retry.', 'PROVIDER_ERROR');
    }
  }
}

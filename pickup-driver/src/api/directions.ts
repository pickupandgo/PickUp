import { env, hasGeocodingConfig } from '../config/env';
import { ApiError } from './http';
import type { GeoPoint } from './types';

/**
 * Google Directions — road-following polyline for two points.
 *
 * The engine only stores haversine distance, so without this every route drawn
 * on the map was a straight line through parks, buildings and railway tracks.
 *
 * Requires "Directions API" enabled on the same Cloud project the other Maps
 * calls use. The key ships in the app bundle: restrict it in Cloud Console.
 */

const DIRECTIONS_HOST = 'https://maps.googleapis.com/maps/api/directions/json';

interface DirectionsResponse {
  readonly status: string;
  readonly error_message?: string;
  readonly routes?: ReadonlyArray<{
    readonly overview_polyline?: { readonly points?: string };
    readonly legs?: ReadonlyArray<{
      readonly distance?: { readonly value?: number };
      readonly duration?: { readonly value?: number };
    }>;
  }>;
}

export interface RouteResult {
  readonly polyline: readonly GeoPoint[];
  readonly distanceMeters: number;
  readonly durationSeconds: number;
}

/**
 * Decodes Google's encoded polyline algorithm. The response is a stream of
 * variable-length base-64 offsets from the previous lat/lng, ~5x smaller than
 * a list of raw coordinates. Reference: developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
const decodePolyline = (encoded: string): GeoPoint[] => {
  const points: GeoPoint[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const dlat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const dlng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }

  return points;
};

/**
 * Fetches a driving route between two points and returns the decoded polyline.
 * Any waypoints go through the same route as ordered intermediate stops.
 */
export const getRoute = async (
  origin: GeoPoint,
  destination: GeoPoint,
  options: { readonly waypoints?: readonly GeoPoint[]; readonly signal?: AbortSignal } = {}
): Promise<RouteResult> => {
  if (!hasGeocodingConfig()) {
    throw new ApiError('config', 'Google Maps API key is not set.');
  }

  const params = new URLSearchParams({
    origin: `${origin.latitude},${origin.longitude}`,
    destination: `${destination.latitude},${destination.longitude}`,
    mode: 'driving',
    key: env.googleMapsApiKey,
  });

  if (options.waypoints?.length) {
    params.set(
      'waypoints',
      options.waypoints.map((p) => `${p.latitude},${p.longitude}`).join('|')
    );
  }

  let response: Response;
  try {
    response = await fetch(`${DIRECTIONS_HOST}?${params.toString()}`, { signal: options.signal });
  } catch {
    throw new ApiError('network', 'Could not reach the directions service');
  }

  if (!response.ok) {
    throw new ApiError('http', `Directions failed with ${response.status}`, response.status);
  }

  const data = (await response.json()) as DirectionsResponse;

  if (data.status !== 'OK') {
    const message = data.error_message ?? data.status;
    if (data.status === 'REQUEST_DENIED') {
      throw new ApiError(
        'config',
        `Directions denied: ${message} — enable "Directions API" on the project.`
      );
    }
    throw new ApiError('http', `Directions failed: ${message}`);
  }

  const route = data.routes?.[0];
  const encoded = route?.overview_polyline?.points;
  if (!encoded) throw new ApiError('parse', 'No polyline in directions response');

  // Sum the legs. For A→B there is one leg; with waypoints there are more.
  const legs = route?.legs ?? [];
  const distanceMeters = legs.reduce((sum, leg) => sum + (leg.distance?.value ?? 0), 0);
  const durationSeconds = legs.reduce((sum, leg) => sum + (leg.duration?.value ?? 0), 0);

  return {
    polyline: decodePolyline(encoded),
    distanceMeters,
    durationSeconds,
  };
};

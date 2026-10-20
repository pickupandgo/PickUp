import { env, hasGeocodingConfig } from '../../config/env';
import { ApiError } from './http';
import type { GeoPoint } from './types';

/**
 * Google Routes API — road-following polyline for two points.
 *
 * The engine only stores haversine distance, so without this every route drawn
 * on the map was a straight line through parks, buildings and railway tracks.
 *
 * Uses Routes API (v2), which replaced the legacy Directions API. The key ships
 * in the app bundle: restrict it in Cloud Console.
 */

const ROUTES_HOST = 'https://routes.googleapis.com/directions/v2:computeRoutes';

interface RoutesResponse {
  readonly routes?: ReadonlyArray<{
    readonly distanceMeters?: number;
    readonly duration?: string;
    readonly polyline?: { readonly encodedPolyline?: string };
    readonly legs?: ReadonlyArray<{
      readonly distanceMeters?: number;
      readonly duration?: string;
    }>;
  }>;
  readonly error?: {
    readonly code?: number;
    readonly message?: string;
    readonly status?: string;
  };
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
 * Parses ISO 8601 duration string to seconds (e.g. "123s" → 123, "2m30s" → 150).
 */
const parseDuration = (duration: string | undefined): number => {
  if (!duration) return 0;
  const match = duration.match(/^(\d+)s$/);
  return match ? parseInt(match[1], 10) : 0;
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

  const body: Record<string, unknown> = {
    origin: {
      location: {
        latLng: {
          latitude: origin.latitude,
          longitude: origin.longitude,
        },
      },
    },
    destination: {
      location: {
        latLng: {
          latitude: destination.latitude,
          longitude: destination.longitude,
        },
      },
    },
    travelMode: 'DRIVE',
    polylineEncoding: 'ENCODED_POLYLINE',
  };

  if (options.waypoints?.length) {
    body.intermediates = options.waypoints.map((p) => ({
      location: {
        latLng: {
          latitude: p.latitude,
          longitude: p.longitude,
        },
      },
    }));
  }

  let response: Response;
  try {
    response = await fetch(ROUTES_HOST, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': env.googleMapsApiKey as string,
        'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.legs.distanceMeters,routes.legs.duration',
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });
  } catch {
    throw new ApiError('network', 'Could not reach the directions service');
  }

  const raw = await response.text();
  let data: RoutesResponse;
  try {
    data = raw.length ? JSON.parse(raw) : {};
  } catch {
    throw new ApiError('parse', 'Malformed response from directions service');
  }

  if (!response.ok || data.error) {
    const message = data.error?.message ?? `HTTP ${response.status}`;
    const status = data.error?.status ?? '';
    if (status === 'PERMISSION_DENIED' || status === 'UNAUTHENTICATED') {
      throw new ApiError(
        'config',
        `Routes API denied: ${message} — check API key and enabled APIs.`
      );
    }
    throw new ApiError('http', `Routes API failed: ${message}`, response.status);
  }

  const route = data.routes?.[0];
  const encoded = route?.polyline?.encodedPolyline;
  if (!encoded) throw new ApiError('parse', 'No polyline in routes response');

  // Sum the legs. For A→B there is one leg; with intermediates there are more.
  const legs = route?.legs ?? [];
  const distanceMeters = legs.reduce((sum, leg) => sum + (leg.distanceMeters ?? 0), 0);
  const durationSeconds = legs.reduce((sum, leg) => sum + parseDuration(leg.duration), 0);

  return {
    polyline: decodePolyline(encoded),
    distanceMeters,
    durationSeconds,
  };
};

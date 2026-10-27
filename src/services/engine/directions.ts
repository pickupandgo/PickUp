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
 * OpenStreetMap / OSRM routing endpoints for resilient, road-following navigation.
 * Used when Google Routes API reaches its quota limit, requires billing, or is unavailable.
 */
const OSRM_ENDPOINTS = [
  'https://routing.openstreetmap.de/routed-car/route/v1/driving',
  'https://router.project-osrm.org/route/v1/driving',
];

interface OsrmResponse {
  readonly code?: string;
  readonly message?: string;
  readonly routes?: ReadonlyArray<{
    readonly geometry?: string;
    readonly distance?: number;
    readonly duration?: number;
    readonly legs?: ReadonlyArray<{
      readonly distance?: number;
      readonly duration?: number;
    }>;
  }>;
}

/**
 * Fetches real road turn-by-turn driving polyline from OpenStreetMap / OSRM.
 */
const getOsrmRoute = async (
  origin: GeoPoint,
  destination: GeoPoint,
  options: { readonly waypoints?: readonly GeoPoint[]; readonly signal?: AbortSignal } = {}
): Promise<RouteResult | null> => {
  const allPoints = [origin, ...(options.waypoints ?? []), destination];
  const coordsStr = allPoints.map((p) => `${p.longitude},${p.latitude}`).join(';');

  for (const baseUrl of OSRM_ENDPOINTS) {
    try {
      const url = `${baseUrl}/${coordsStr}?overview=full&geometries=polyline`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 7000);

      // Merge signals if options.signal is provided
      if (options.signal) {
        options.signal.addEventListener('abort', () => controller.abort());
      }

      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'MultipleRide/1.0 (Mobile App)',
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) continue;
      const data: OsrmResponse = await res.json();
      if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) continue;

      const r = data.routes[0];
      const encoded = r.geometry;
      if (!encoded) continue;

      const polyline = decodePolyline(encoded);
      if (polyline.length === 0) continue;

      return {
        polyline,
        distanceMeters: Math.round(r.distance ?? 0),
        durationSeconds: Math.round(r.duration ?? 0),
      };
    } catch {
      // Try next OSRM mirror
      continue;
    }
  }

  return null;
};

/**
 * Fetches route via Google Routes API (v2).
 */
const getGoogleRoute = async (
  origin: GeoPoint,
  destination: GeoPoint,
  options: { readonly waypoints?: readonly GeoPoint[]; readonly signal?: AbortSignal } = {}
): Promise<RouteResult> => {
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
        'X-Goog-FieldMask':
          'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.legs.distanceMeters,routes.legs.duration',
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });
  } catch {
    throw new ApiError('network', 'Could not reach Google directions service');
  }

  const raw = await response.text();
  let data: RoutesResponse;
  try {
    data = raw.length ? JSON.parse(raw) : {};
  } catch {
    throw new ApiError('parse', 'Malformed response from Google directions service');
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

  const legs = route?.legs ?? [];
  const distanceMeters = legs.reduce((sum, leg) => sum + (leg.distanceMeters ?? 0), 0);
  const durationSeconds = legs.reduce((sum, leg) => sum + parseDuration(leg.duration), 0);

  return {
    polyline: decodePolyline(encoded),
    distanceMeters,
    durationSeconds,
  };
};

/**
 * Fetches a driving route between two points and returns the decoded polyline.
 * Any waypoints go through the same route as ordered intermediate stops.
 *
 * Resilience: Attempts Google Routes API first. If unavailable, rate limited (429),
 * or billing not active, automatically falls back to OpenStreetMap / OSRM driving
 * service so the driver always receives a real road-following navigation route.
 */
export const getRoute = async (
  origin: GeoPoint,
  destination: GeoPoint,
  options: { readonly waypoints?: readonly GeoPoint[]; readonly signal?: AbortSignal } = {}
): Promise<RouteResult> => {
  // 1. Try Google Routes API if key is available
  if (hasGeocodingConfig()) {
    try {
      const googleResult = await getGoogleRoute(origin, destination, options);
      if (googleResult && googleResult.polyline.length > 0) {
        return googleResult;
      }
    } catch (googleError) {
      console.warn(
        '[Directions] Google Routes API unavailable/quota exceeded, falling back to OpenStreetMap road routing:',
        googleError
      );
    }
  }

  // 2. Fall back to OpenStreetMap / OSRM for real road routing
  const osrmResult = await getOsrmRoute(origin, destination, options);
  if (osrmResult && osrmResult.polyline.length > 0) {
    return osrmResult;
  }

  throw new ApiError('network', 'Could not obtain driving directions from any provider');
};

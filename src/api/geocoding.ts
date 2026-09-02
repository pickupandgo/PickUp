import * as Location from 'expo-location';
import { env, hasGeocodingConfig } from '../config/env';
import { ApiError } from './http';
import type { GeoPoint } from './types';

/**
 * Address search and coordinate lookup via Google Maps Platform.
 *
 * The engine works purely in latitude/longitude (haversine distance), so every
 * address the user picks must be resolved to coordinates before it can be sent.
 *
 * Uses **Places API (New)**: newer Cloud projects cannot enable the legacy
 * `maps/api/place/*` endpoints at all — they return
 * "You're calling a legacy API, which is not enabled for your project".
 *
 * Required on the Cloud project:
 *   - Places API (New)   → autocomplete + place details
 *   - Geocoding API      → reverse geocoding
 *   - Billing enabled    → all Maps Platform calls fail without it
 */

const PLACES_HOST = 'https://places.googleapis.com/v1';
const GEOCODE_HOST = 'https://maps.googleapis.com/maps/api/geocode/json';

/** Bias radius for autocomplete, in metres. */
const BIAS_RADIUS_M = 50_000;

export interface PlaceSuggestion {
  readonly placeId: string;
  /** Short name, e.g. "Shastri Nagar". */
  readonly primaryText: string;
  /** Context, e.g. "Jodhpur, Rajasthan, India". */
  readonly secondaryText: string;
  readonly description: string;
}

export interface ResolvedPlace extends GeoPoint {
  readonly address: string;
  readonly placeId?: string;
}

const assertKey = (): void => {
  if (!hasGeocodingConfig()) {
    throw new ApiError(
      'config',
      'EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is not set, so address search is unavailable.'
    );
  }
};

/** Shape of an error body from the Places (New) / Geocoding APIs. */
interface GoogleErrorBody {
  readonly error?: { readonly message?: string; readonly status?: string };
  readonly error_message?: string;
  readonly status?: string;
}

const describeGoogleError = (status: number, body: GoogleErrorBody | undefined): ApiError => {
  const message = body?.error?.message ?? body?.error_message ?? '';

  if (/billing/i.test(message)) {
    return new ApiError(
      'config',
      'Google Maps billing is not enabled on the project. Enable billing in Google Cloud Console.'
    );
  }
  if (/legacy API/i.test(message)) {
    return new ApiError('config', 'This project cannot use the legacy Places API. Enable "Places API (New)".');
  }
  if (status === 403 || body?.status === 'REQUEST_DENIED') {
    return new ApiError('config', `Google Maps rejected the request: ${message || 'check the API key and enabled APIs'}`);
  }
  if (status === 429 || body?.status === 'OVER_QUERY_LIMIT') {
    return new ApiError('http', 'Google Maps quota exceeded', 429);
  }
  return new ApiError('http', `Google Maps request failed: ${message || status}`, status, body);
};

const googleFetch = async <T>(
  url: string,
  init: RequestInit | undefined,
  signal: AbortSignal | undefined
): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal });
  } catch {
    throw new ApiError('network', 'Could not reach the address service');
  }

  const raw = await response.text();
  let body: unknown;
  if (raw.length) {
    try {
      body = JSON.parse(raw);
    } catch {
      throw new ApiError('parse', 'Malformed response from the address service');
    }
  }

  if (!response.ok) {
    throw describeGoogleError(response.status, body as GoogleErrorBody);
  }

  // Geocoding API returns 200 with a status field, unlike Places (New).
  const legacyStatus = (body as GoogleErrorBody | undefined)?.status;
  if (legacyStatus && legacyStatus !== 'OK' && legacyStatus !== 'ZERO_RESULTS') {
    throw describeGoogleError(response.status, body as GoogleErrorBody);
  }

  return body as T;
};

// ─── Autocomplete (New) ──────────────────────────────────────────────────────

interface AutocompleteResponse {
  readonly suggestions?: ReadonlyArray<{
    readonly placePrediction?: {
      readonly placeId?: string;
      readonly text?: { readonly text?: string };
      readonly structuredFormat?: {
        readonly mainText?: { readonly text?: string };
        readonly secondaryText?: { readonly text?: string };
      };
    };
  }>;
}

/**
 * Autocomplete suggestions for a partial address.
 *
 * `sessionToken` groups keystrokes plus the final Place Details call into one
 * billed session. It must be URL/filename-safe and at most 36 characters.
 * `origin` biases results toward the user, which matters for short queries.
 */
export const searchPlaces = async (
  query: string,
  options: { readonly sessionToken?: string; readonly origin?: GeoPoint; readonly signal?: AbortSignal } = {}
): Promise<readonly PlaceSuggestion[]> => {
  assertKey();
  const input = query.trim();
  if (input.length < 3) return [];

  const body: Record<string, unknown> = {
    input,
    // Restrict to India; widen or make configurable when expanding.
    includedRegionCodes: ['in'],
  };
  if (options.sessionToken) body.sessionToken = options.sessionToken;
  if (options.origin) {
    body.locationBias = {
      circle: {
        center: { latitude: options.origin.latitude, longitude: options.origin.longitude },
        radius: BIAS_RADIUS_M,
      },
    };
    body.origin = { latitude: options.origin.latitude, longitude: options.origin.longitude };
  }

  const data = await googleFetch<AutocompleteResponse>(
    `${PLACES_HOST}/places:autocomplete`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': env.googleMapsApiKey,
      },
      body: JSON.stringify(body),
    },
    options.signal
  );

  return (data.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => Boolean(p?.placeId))
    .map((p) => {
      const main = p.structuredFormat?.mainText?.text ?? p.text?.text ?? '';
      const secondary = p.structuredFormat?.secondaryText?.text ?? '';
      return {
        placeId: p.placeId as string,
        primaryText: main,
        secondaryText: secondary,
        description: p.text?.text ?? [main, secondary].filter(Boolean).join(', '),
      };
    });
};

// ─── Place Details (New) ─────────────────────────────────────────────────────

interface PlaceDetailsResponse {
  readonly id?: string;
  readonly formattedAddress?: string;
  readonly displayName?: { readonly text?: string };
  readonly location?: { readonly latitude?: number; readonly longitude?: number };
}

/** Resolves a suggestion into coordinates the engine can use. */
export const resolvePlaceId = async (
  placeId: string,
  options: { readonly sessionToken?: string; readonly signal?: AbortSignal } = {}
): Promise<ResolvedPlace> => {
  assertKey();

  const query = options.sessionToken
    ? `?sessionToken=${encodeURIComponent(options.sessionToken)}`
    : '';

  const data = await googleFetch<PlaceDetailsResponse>(
    `${PLACES_HOST}/places/${encodeURIComponent(placeId)}${query}`,
    {
      method: 'GET',
      headers: {
        'X-Goog-Api-Key': env.googleMapsApiKey,
        // Field mask is mandatory on Places (New); requesting less costs less.
        'X-Goog-FieldMask': 'id,location,formattedAddress,displayName',
      },
    },
    options.signal
  );

  const lat = data.location?.latitude;
  const lng = data.location?.longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    throw new ApiError('parse', 'That place has no coordinates');
  }

  return {
    latitude: lat,
    longitude: lng,
    address: data.formattedAddress ?? data.displayName?.text ?? '',
    placeId,
  };
};

// ─── Reverse geocoding ───────────────────────────────────────────────────────

interface GeocodeResponse {
  readonly results?: ReadonlyArray<{ readonly formatted_address?: string }>;
}

/** Human-readable address for a coordinate, for the "current location" label. */
export const reverseGeocode = async (
  point: GeoPoint,
  signal?: AbortSignal
): Promise<string> => {
  assertKey();

  const params = new URLSearchParams({
    latlng: `${point.latitude},${point.longitude}`,
    key: env.googleMapsApiKey,
  });

  const data = await googleFetch<GeocodeResponse>(
    `${GEOCODE_HOST}?${params.toString()}`,
    { method: 'GET' },
    signal
  );

  return data.results?.[0]?.formatted_address ?? '';
};

export class LocationPermissionDeniedError extends Error {
  constructor() {
    super('Location permission was denied');
    this.name = 'LocationPermissionDeniedError';
  }
}

/**
 * Current device position with a resolved address.
 *
 * Requests foreground permission on first call. Falls back to a coordinate-only
 * result if reverse geocoding fails, so a Maps outage cannot block booking.
 */
export const getCurrentPlace = async (signal?: AbortSignal): Promise<ResolvedPlace> => {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== Location.PermissionStatus.GRANTED) {
    throw new LocationPermissionDeniedError();
  }

  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });

  const point: GeoPoint = {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
  };

  // Label resolution is best-effort and must never block a booking:
  // Google Geocoding → OS geocoder → plain coordinates.
  try {
    const address = await reverseGeocode(point, signal);
    if (address) return { ...point, address };
  } catch {
    // Geocoding API may be disabled on the project; fall through.
  }

  try {
    const osResult = await Location.reverseGeocodeAsync(point);
    const first = osResult[0];
    if (first) {
      const label = [first.name, first.street, first.district, first.city, first.region]
        .filter((part): part is string => Boolean(part))
        // The OS often repeats the same value across fields.
        .filter((part, index, all) => all.indexOf(part) === index)
        .join(', ');
      if (label) return { ...point, address: label };
    }
  } catch {
    // No OS geocoder available (common on Android without Play Services).
  }

  return { ...point, address: 'Current location' };
};

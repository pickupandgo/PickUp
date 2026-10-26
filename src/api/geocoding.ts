import Geolocation from '@react-native-community/geolocation';

Geolocation.setRNConfiguration({
  skipPermissionRequests: false,
  authorizationLevel: 'whenInUse',
  locationProvider: 'playServices',
});
import { PermissionsAndroid, Platform } from 'react-native';
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
  readonly receiverName?: string;
  readonly receiverPhone?: string;
  readonly instructions?: string;
}

const assertKey = (): void => {
  if (!hasGeocodingConfig()) {
    console.warn('EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is not set; falling back to open location services.');
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

// ─── Open Provider (Photon + OpenStreetMap Nominatim) Fallbacks ─────────────

const openSearchPlaces = async (
  query: string,
  options: { readonly origin?: GeoPoint; readonly signal?: AbortSignal } = {}
): Promise<readonly PlaceSuggestion[]> => {
  const input = query.trim();
  if (input.length < 3) return [];

  // 1. Try Photon (fast, typo-tolerant, OSM-backed)
  try {
    const originParam = options.origin
      ? `&lat=${options.origin.latitude}&lon=${options.origin.longitude}`
      : '';
    const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(input)}&limit=10${originParam}`;
    const resp = await fetch(photonUrl, { signal: options.signal });
    if (resp.ok) {
      const data = (await resp.json()) as {
        features?: Array<{
          properties?: {
            name?: string;
            street?: string;
            district?: string;
            city?: string;
            state?: string;
            country?: string;
          };
          geometry?: { coordinates?: [number, number] };
        }>;
      };
      const features = data.features ?? [];
      if (features.length > 0) {
        return features
          .filter((f) => {
            const coords = f.geometry?.coordinates;
            return (
              Array.isArray(coords) &&
              coords.length === 2 &&
              typeof coords[0] === 'number' &&
              typeof coords[1] === 'number'
            );
          })
          .map((f) => {
            const p = f.properties ?? {};
            const name = p.name ?? p.street ?? p.city ?? input;
            const parts = [p.street, p.district, p.city, p.state, p.country].filter(Boolean) as string[];
            const secondary = Array.from(new Set(parts)).filter((x) => x !== name).join(', ');
            const [lon, lat] = f.geometry!.coordinates!;
            const fullDesc = [name, secondary].filter(Boolean).join(', ');
            return {
              placeId: `osm:${lat}:${lon}:${encodeURIComponent(fullDesc || name)}`,
              primaryText: name,
              secondaryText: secondary,
              description: fullDesc,
            };
          });
      }
    }
  } catch (err: any) {
    if (err?.name === 'AbortError') throw err;
  }

  // 2. Fallback to Nominatim search
  try {
    const nominatimUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(input)}&format=json&addressdetails=1&limit=10&countrycodes=in`;
    const resp = await fetch(nominatimUrl, {
      signal: options.signal,
      headers: { 'User-Agent': 'MultipleRideCustomerApp/1.0 (support@multipleride.com)' },
    });
    if (resp.ok) {
      const list = (await resp.json()) as Array<{
        place_id: number;
        lat: string;
        lon: string;
        display_name: string;
        name?: string;
      }>;
      if (Array.isArray(list) && list.length > 0) {
        return list.map((item) => {
          const name = item.name ?? item.display_name.split(',')[0].trim();
          const rest = item.display_name.replace(name, '').replace(/^,\s*/, '').trim();
          return {
            placeId: `osm:${item.lat}:${item.lon}:${encodeURIComponent(item.display_name)}`,
            primaryText: name,
            secondaryText: rest,
            description: item.display_name,
          };
        });
      }
    }
  } catch (err: any) {
    if (err?.name === 'AbortError') throw err;
  }

  return [];
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
 * Uses configured Google Places (New) autocomplete as primary, seamlessly falling
 * back to open providers (Photon / Nominatim) if Google Maps Platform returns an
 * authorization, billing, or configuration error.
 */
export const searchPlaces = async (
  query: string,
  options: { readonly sessionToken?: string; readonly origin?: GeoPoint; readonly signal?: AbortSignal } = {}
): Promise<readonly PlaceSuggestion[]> => {
  const input = query.trim();
  if (input.length < 3) return [];

  // Primary: Google Places (New)
  if (hasGeocodingConfig()) {
    try {
      const body: Record<string, unknown> = {
        input,
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

      const suggestions = (data.suggestions ?? [])
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

      if (suggestions.length > 0) {
        return suggestions;
      }
    } catch (caught: any) {
      if (caught?.name === 'AbortError' || caught?.message?.includes('aborted')) {
        throw caught;
      }
      console.warn('[searchPlaces] Google Places request failed, falling back to open provider:', caught?.message);
    }
  }

  // Fallback: OpenStreetMap / Photon provider
  return openSearchPlaces(input, options);
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
  // Check if place was provided by open geocoding provider
  if (placeId.startsWith('osm:')) {
    const parts = placeId.split(':');
    const lat = parseFloat(parts[1]);
    const lng = parseFloat(parts[2]);
    const address = decodeURIComponent(parts.slice(3).join(':'));
    if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
      return {
        latitude: lat,
        longitude: lng,
        address: address || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        placeId,
      };
    }
  }

  if (hasGeocodingConfig()) {
    try {
      const query = options.sessionToken
        ? `?sessionToken=${encodeURIComponent(options.sessionToken)}`
        : '';

      const data = await googleFetch<PlaceDetailsResponse>(
        `${PLACES_HOST}/places/${encodeURIComponent(placeId)}${query}`,
        {
          method: 'GET',
          headers: {
            'X-Goog-Api-Key': env.googleMapsApiKey,
            'X-Goog-FieldMask': 'id,location,formattedAddress,displayName',
          },
        },
        options.signal
      );

      const lat = data.location?.latitude;
      const lng = data.location?.longitude;
      if (typeof lat === 'number' && typeof lng === 'number') {
        return {
          latitude: lat,
          longitude: lng,
          address: data.formattedAddress ?? data.displayName?.text ?? '',
          placeId,
        };
      }
    } catch (caught: any) {
      if (caught?.name === 'AbortError') throw caught;
      console.warn('[resolvePlaceId] Google Place Details failed:', caught?.message);
    }
  }

  throw new ApiError('parse', 'That place has no coordinates');
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
  // 1. Primary: Google Maps Geocoding API
  if (hasGeocodingConfig()) {
    try {
      const params = new URLSearchParams({
        latlng: `${point.latitude},${point.longitude}`,
        key: env.googleMapsApiKey,
      });

      const data = await googleFetch<GeocodeResponse>(
        `${GEOCODE_HOST}?${params.toString()}`,
        { method: 'GET' },
        signal
      );

      const googleAddress = data.results?.[0]?.formatted_address;
      if (googleAddress && googleAddress.trim().length > 0) {
        return googleAddress;
      }
    } catch (caught: any) {
      if (caught?.name === 'AbortError') throw caught;
      console.warn('[reverseGeocode] Google reverse geocode failed, falling back:', caught?.message);
    }
  }

  // 2. Fallback: OpenStreetMap Nominatim reverse geocode
  try {
    const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${point.latitude}&lon=${point.longitude}&addressdetails=1`;
    const resp = await fetch(nominatimUrl, {
      signal,
      headers: { 'User-Agent': 'MultipleRideCustomerApp/1.0 (support@multipleride.com)' },
    });
    if (resp.ok) {
      const data = (await resp.json()) as {
        display_name?: string;
        address?: Record<string, string>;
      };
      if (data.display_name && data.display_name.trim().length > 0) {
        return data.display_name;
      }
    }
  } catch (caught: any) {
    if (caught?.name === 'AbortError') throw caught;
    console.warn('[reverseGeocode] Nominatim reverse geocode failed:', caught?.message);
  }

  // 3. Fallback: Formatted coordinate string (never empty, never 'Dropped pin', never 'Current location')
  return `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`;
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
 * Requests foreground permission on first call. Reverse geocodes the coordinates into a
 * readable address, falling back to clean coordinate notation if geocoding is unavailable.
 */
export const getCurrentPlace = async (signal?: AbortSignal): Promise<ResolvedPlace> => {
  console.log('[CUSTOMER_LOCATION] getCurrentPosition started');
  if (Platform.OS === 'android') {
    console.log('[CUSTOMER_LOCATION] permission status: requesting');
    console.log('[CUSTOMER_LOCATION] requesting permission: ACCESS_FINE_LOCATION');
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
    );
    console.log('[CUSTOMER_LOCATION] permission result:', granted);
    if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
      throw new ApiError('location_permission', 'Location permission is required to detect your pickup location.');
    }
  }

  const position = await new Promise<any>((resolve, reject) => {
    Geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      (err) => {
        // Fallback for indoors / slow GPS: try cell/WiFi/network fused location
        if (err?.code === 2 || err?.code === 3) {
          console.log('[CUSTOMER_LOCATION] High accuracy failed, trying network fallback...');
          Geolocation.getCurrentPosition(
            (fallbackPos) => resolve(fallbackPos),
            () => reject(err),
            { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
          );
        } else {
          reject(err);
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 10000 }
    );
  }).catch((err) => {
    console.log('[CUSTOMER_LOCATION] error code:', err?.code);
    console.log('[CUSTOMER_LOCATION] error message:', err?.message);
    if (err?.code === 1) throw new ApiError('location_permission', 'Location permission is required to detect your pickup location.');
    if (err?.code === 2) throw new ApiError('location_unavailable', 'GPS position unavailable. Please ensure location services are enabled.');
    if (err?.code === 3) throw new ApiError('location_timeout', 'Location detection timed out. Please try again.');
    throw new ApiError('location_unavailable', 'Unable to determine your current location. Please try again.');
  });


  if (
    !Number.isFinite(position.coords.latitude) ||
    !Number.isFinite(position.coords.longitude) ||
    Math.abs(position.coords.latitude) > 90 ||
    Math.abs(position.coords.longitude) > 180
  ) {
    throw new ApiError('location_unavailable', 'Invalid coordinates received from GPS.');
  }

  const point: GeoPoint = {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
  };

  try {
    const address = await reverseGeocode(point, signal);
    if (address && address.trim().length > 0) {
      return { ...point, address };
    }
  } catch {
    // Reverse geocoding failed; fall back to coordinate string.
  }

  return { ...point, address: `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}` };
};



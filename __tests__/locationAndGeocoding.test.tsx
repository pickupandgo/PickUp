import {
  searchPlaces,
  resolvePlaceId,
  reverseGeocode,
  getCurrentPlace,
  type PlaceSuggestion,
  type ResolvedPlace,
} from '../src/api/geocoding';
import { ApiError } from '../src/api/http';
import { BookingProvider, useBooking } from '../src/state/BookingContext';
import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import Geolocation from '@react-native-community/geolocation';
import { PermissionsAndroid } from 'react-native';

jest.mock('../src/config/env', () => ({
  env: {
    apiBaseUrl: 'https://engine.test',
    paymentsApiBaseUrl: 'https://pay.test',
    googleMapsApiKey: 'mock-google-key',
  },
  hasApiConfig: () => true,
  hasPaymentsConfig: () => true,
  hasGeocodingConfig: () => true,
  assertApiConfig: () => undefined,
}));

jest.mock('@react-native-firebase/auth', () => ({
  __esModule: true,
  getAuth: () => ({ currentUser: { uid: 'uid-test' } }),
  onAuthStateChanged: jest.fn(() => () => {}),
}));

describe('Location Search & Autocomplete', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('returns mapped suggestions when Google Places autocomplete succeeds', async () => {
    const mockGoogleResponse = {
      suggestions: [
        {
          placePrediction: {
            placeId: 'places/ChIJ123',
            text: { text: 'Shastri Nagar, Jodhpur, Rajasthan, India' },
            structuredFormat: {
              mainText: { text: 'Shastri Nagar' },
              secondaryText: { text: 'Jodhpur, Rajasthan, India' },
            },
          },
        },
      ],
    };

    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(mockGoogleResponse),
      json: async () => mockGoogleResponse,
    })) as unknown as typeof fetch;

    const results = await searchPlaces('Shastri Nagar');
    expect(results).toHaveLength(1);
    expect(results[0].placeId).toBe('places/ChIJ123');
    expect(results[0].primaryText).toBe('Shastri Nagar');
    expect(results[0].secondaryText).toBe('Jodhpur, Rajasthan, India');
    expect(results[0].description).toBe('Shastri Nagar, Jodhpur, Rajasthan, India');
  });

  it('returns empty array when query is less than 3 characters', async () => {
    const fetchSpy = jest.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const results = await searchPlaces('Sh');
    expect(results).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('falls back to open provider (Photon) when Google Places returns 403 PERMISSION_DENIED', async () => {
    const mockPhotonResponse = {
      features: [
        {
          properties: {
            name: 'Clock Tower',
            city: 'Jodhpur',
            state: 'Rajasthan',
            country: 'India',
          },
          geometry: {
            coordinates: [73.0243, 26.2389],
          },
        },
      ],
    };

    globalThis.fetch = jest.fn(async (url: string) => {
      if (url.includes('places.googleapis.com')) {
        return {
          ok: false,
          status: 403,
          text: async () =>
            JSON.stringify({
              error: { code: 403, message: 'The caller does not have permission', status: 'PERMISSION_DENIED' },
            }),
        } as Response;
      }
      if (url.includes('photon.komoot.io')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockPhotonResponse),
          json: async () => mockPhotonResponse,
        } as Response;
      }
      return { ok: false, status: 404, text: async () => '' } as Response;
    }) as unknown as typeof fetch;

    const results = await searchPlaces('Clock Tower');
    expect(results).toHaveLength(1);
    expect(results[0].primaryText).toBe('Clock Tower');
    expect(results[0].secondaryText).toContain('Jodhpur');
    expect(results[0].placeId).toMatch(/^osm:26\.2389:73\.0243:/);
  });

  it('handles empty results gracefully when search finds nothing', async () => {
    globalThis.fetch = jest.fn(async (url: string) => {
      if (url.includes('places.googleapis.com')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ suggestions: [] }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ features: [] }),
      } as Response;
    }) as unknown as typeof fetch;

    const results = await searchPlaces('nonexistentplaceXYZ123');
    expect(results).toEqual([]);
  });
});

describe('Place Details Resolution (resolvePlaceId)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('resolves osm-encoded placeId directly to coordinates and address without network call', async () => {
    const fetchSpy = jest.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const placeId = 'osm:26.2389:73.0243:' + encodeURIComponent('Clock Tower, Jodhpur, Rajasthan, India');
    const resolved = await resolvePlaceId(placeId);

    expect(resolved.latitude).toBeCloseTo(26.2389);
    expect(resolved.longitude).toBeCloseTo(73.0243);
    expect(resolved.address).toBe('Clock Tower, Jodhpur, Rajasthan, India');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('resolves Google Place Details with coordinates and address', async () => {
    const mockDetails = {
      id: 'places/ChIJ123',
      formattedAddress: 'Shastri Nagar, Jodhpur, Rajasthan 342003, India',
      location: { latitude: 26.27, longitude: 73.01 },
    };

    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(mockDetails),
    })) as unknown as typeof fetch;

    const resolved = await resolvePlaceId('places/ChIJ123');
    expect(resolved.latitude).toBe(26.27);
    expect(resolved.longitude).toBe(73.01);
    expect(resolved.address).toBe('Shastri Nagar, Jodhpur, Rajasthan 342003, India');
  });
});

describe('Reverse Geocoding (reverseGeocode)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns formatted address when Google Geocoding succeeds', async () => {
    const mockGeocode = {
      status: 'OK',
      results: [
        { formatted_address: 'Main Pal Road, Shastri Nagar, Jodhpur, Rajasthan, India' },
      ],
    };

    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(mockGeocode),
    })) as unknown as typeof fetch;

    const address = await reverseGeocode({ latitude: 26.27, longitude: 73.01 });
    expect(address).toBe('Main Pal Road, Shastri Nagar, Jodhpur, Rajasthan, India');
  });

  it('falls back to Nominatim reverse geocode when Google Geocoding returns REQUEST_DENIED / billing error', async () => {
    const mockNominatim = {
      display_name: 'AIIMS Road, Basni, Jodhpur, Rajasthan, 342005, India',
    };

    globalThis.fetch = jest.fn(async (url: string) => {
      if (url.includes('maps.googleapis.com')) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              status: 'REQUEST_DENIED',
              error_message: 'You must enable Billing on the Google Cloud Project',
            }),
        } as Response;
      }
      if (url.includes('nominatim.openstreetmap.org')) {
        return {
          ok: true,
          status: 200,
          json: async () => mockNominatim,
        } as Response;
      }
      return { ok: false, status: 500, text: async () => '' } as Response;
    }) as unknown as typeof fetch;

    const address = await reverseGeocode({ latitude: 26.2399, longitude: 73.0067 });
    expect(address).toBe('AIIMS Road, Basni, Jodhpur, Rajasthan, 342005, India');
  });

  it('falls back to readable coordinates (never Dropped pin or Current location) when all geocoding fails', async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new Error('Network offline');
    }) as unknown as typeof fetch;

    const address = await reverseGeocode({ latitude: 26.2389, longitude: 73.0243 });
    expect(address).toBe('26.23890, 73.02430');
    expect(address).not.toBe('Dropped pin');
    expect(address).not.toBe('Current location');
  });
});

describe('Current Location Resolution (getCurrentPlace)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('reverse geocodes GPS coordinates and returns readable address instead of Current location', async () => {
    jest.spyOn(Geolocation, 'getCurrentPosition').mockImplementation((success: any) => {
      success({
        coords: { latitude: 26.2389, longitude: 73.0243, accuracy: 10 },
      });
    });

    globalThis.fetch = jest.fn(async (url: string) => {
      if (url.includes('nominatim.openstreetmap.org')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ display_name: 'Clock Tower, Jodhpur, Rajasthan, India' }),
        } as Response;
      }
      return {
        ok: false,
        status: 403,
        text: async () => JSON.stringify({ status: 'REQUEST_DENIED' }),
      } as Response;
    }) as unknown as typeof fetch;

    const place = await getCurrentPlace();
    expect(place.latitude).toBe(26.2389);
    expect(place.longitude).toBe(73.0243);
    expect(place.address).toBe('Clock Tower, Jodhpur, Rajasthan, India');
    expect(place.address).not.toBe('Current location');
  });

  it('distinguishes location permission errors', async () => {
    jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(PermissionsAndroid.RESULTS.DENIED);

    await expect(getCurrentPlace()).rejects.toThrow(ApiError);
    await expect(getCurrentPlace()).rejects.toMatchObject({
      kind: 'location_permission',
    });
  });

  it('distinguishes GPS unavailable errors (services off)', async () => {
    jest.spyOn(Geolocation, 'getCurrentPosition').mockImplementation((_success: any, error: any) => {
      error({ code: 2, message: 'Position unavailable' });
    });

    await expect(getCurrentPlace()).rejects.toMatchObject({
      kind: 'location_unavailable',
    });
  });

  it('distinguishes GPS timeout errors', async () => {
    jest.spyOn(Geolocation, 'getCurrentPosition').mockImplementation((_success: any, error: any) => {
      error({ code: 3, message: 'Timeout' });
    });

    await expect(getCurrentPlace()).rejects.toMatchObject({
      kind: 'location_timeout',
    });
  });
});

describe('BookingContext Address & Coordinate Persistence', () => {
  let context: ReturnType<typeof useBooking>;
  const Capture: React.FC = () => {
    context = useBooking();
    return null;
  };

  const mountContext = () => {
    let renderer: ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <BookingProvider>
          <Capture />
        </BookingProvider>
      );
    });
    return () => act(() => renderer.unmount());
  };

  it('preserves exact coordinates and readable address across navigation and draft resets', () => {
    const unmount = mountContext();

    const pickupPlace: ResolvedPlace = {
      latitude: 26.2389,
      longitude: 73.0243,
      address: 'Clock Tower, Jodhpur, Rajasthan, India',
    };

    const dropPlace: ResolvedPlace = {
      latitude: 26.2723,
      longitude: 73.0025,
      address: 'Shastri Nagar, Jodhpur, Rajasthan, India',
    };

    act(() => {
      context.setPickup(pickupPlace);
      context.setPendingDrop(dropPlace);
      context.commitPendingDrop();
    });

    expect(context.draft.pickup).toEqual(pickupPlace);
    expect(context.draft.drops).toHaveLength(1);
    expect(context.draft.drops[0]).toEqual(dropPlace);

    // Starting new booking preserves pickup
    act(() => {
      context.startNewBooking();
    });

    expect(context.draft.pickup).toEqual(pickupPlace);
    expect(context.draft.drops).toHaveLength(0);

    unmount();
  });
});

describe('ApiError userMessage formatting', () => {
  it('does not mask config error with generic message when detailed message is provided', () => {
    const err = new ApiError('config', 'Google Maps billing is not enabled on the project.');
    expect(err.userMessage).toBe('Google Maps billing is not enabled on the project.');
  });

  it('formats server rejection messages properly', () => {
    const err = new ApiError('http', 'Request rejected', 400, { message: 'Invalid stop coordinates' });
    expect(err.userMessage).toBe('Invalid stop coordinates');
  });
});

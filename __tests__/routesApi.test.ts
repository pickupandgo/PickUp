/**
 * Routes API unit test — verifies migration from legacy Directions API.
 * Mocks the fetch call to avoid needing a real API key in CI.
 */

jest.mock('../src/config/env', () => ({
  env: { googleMapsApiKey: 'test-key' },
  hasGeocodingConfig: () => true,
}));

import { getRoute } from '../src/api/directions';

const pickup = { latitude: 26.2389, longitude: 73.0243 };
const drop1 = { latitude: 26.208427, longitude: 73.024591 };
const drop2 = { latitude: 26.236281, longitude: 73.01559 };

type FetchCall = { url: string; init: RequestInit };
const calls: FetchCall[] = [];
const bodyOf = (c: FetchCall): any => JSON.parse(String(c.init.body ?? '{}'));

beforeEach(() => {
  calls.length = 0;
});

// Minimal Routes API response with encoded polyline for Jodhpur ~2km route
const ROUTES_RESPONSE = {
  routes: [{
    distanceMeters: 2064,
    duration: '123s',
    polyline: { encodedPolyline: 'oashCsvmuMnAf@' }, // Short sample polyline
    legs: [{
      distanceMeters: 2064,
      duration: '123s',
    }],
  }],
};

const MULTI_DROP_RESPONSE = {
  routes: [{
    distanceMeters: 10350,
    duration: '420s',
    polyline: { encodedPolyline: 'oashCsvmuMnAf@xBrA' },
    legs: [
      { distanceMeters: 2064, duration: '123s' },
      { distanceMeters: 3236, duration: '150s' },
      { distanceMeters: 5050, duration: '147s' },
    ],
  }],
};

describe('Routes API (getRoute)', () => {
  it('sends POST request to Routes API v2 with correct structure', async () => {
    globalThis.fetch = jest.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(ROUTES_RESPONSE),
      } as Response;
    }) as unknown as typeof fetch;

    await getRoute(pickup, drop1);

    expect(calls[0].url).toBe('https://routes.googleapis.com/directions/v2:computeRoutes');
    expect(calls[0].init.method).toBe('POST');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['X-Goog-Api-Key']).toBe('test-key');
    expect(headers['X-Goog-FieldMask']).toContain('routes.polyline.encodedPolyline');
    
    const body = bodyOf(calls[0]);
    expect(body.origin.location.latLng).toEqual({ latitude: pickup.latitude, longitude: pickup.longitude });
    expect(body.destination.location.latLng).toEqual({ latitude: drop1.latitude, longitude: drop1.longitude });
    expect(body.travelMode).toBe('DRIVE');
    expect(body.polylineEncoding).toBe('ENCODED_POLYLINE');
  });

  it('returns route with polyline, distance and duration', async () => {
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(ROUTES_RESPONSE),
    } as Response)) as unknown as typeof fetch;

    const result = await getRoute(pickup, drop1);

    expect(result.polyline).toBeDefined();
    expect(result.polyline.length).toBeGreaterThan(0);
    expect(result.distanceMeters).toBe(2064);
    expect(result.durationSeconds).toBe(123);
  });

  it('supports multi-drop routes with intermediates', async () => {
    globalThis.fetch = jest.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(MULTI_DROP_RESPONSE),
      } as Response;
    }) as unknown as typeof fetch;

    const result = await getRoute(pickup, drop2, { waypoints: [drop1] });

    const body = bodyOf(calls[0]);
    expect(body.intermediates).toBeDefined();
    expect(body.intermediates).toHaveLength(1);
    expect(body.intermediates[0].location.latLng).toEqual({
      latitude: drop1.latitude,
      longitude: drop1.longitude,
    });

    expect(result.distanceMeters).toBe(10350);
    expect(result.durationSeconds).toBe(420);
  });

  it('decodes polyline into coordinates', async () => {
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(ROUTES_RESPONSE),
    } as Response)) as unknown as typeof fetch;

    const result = await getRoute(pickup, drop1);

    expect(result.polyline.length).toBeGreaterThan(0);
    result.polyline.forEach((point) => {
      expect(typeof point.latitude).toBe('number');
      expect(typeof point.longitude).toBe('number');
    });
  });

  it('throws on API error with status', async () => {
    globalThis.fetch = jest.fn(async () => ({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({
        error: { status: 'INVALID_ARGUMENT', message: 'Bad request' },
      }),
    } as Response)) as unknown as typeof fetch;

    await expect(getRoute(pickup, drop1)).rejects.toThrow('Routes API failed');
  });

  it('respects abort signal', async () => {
    globalThis.fetch = jest.fn(async (_url, init) => {
      // Simulate the signal being checked during fetch
      await new Promise<void>((resolve) => setTimeout(() => resolve(), 10));
      if (init?.signal?.aborted) {
        throw new Error('AbortError: Aborted');
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(ROUTES_RESPONSE),
      } as Response;
    }) as unknown as typeof fetch;

    const controller = new AbortController();
    const promise = getRoute(pickup, drop1, { signal: controller.signal });
    
    // Abort immediately
    controller.abort();
    
    await expect(promise).rejects.toThrow();
  });
});

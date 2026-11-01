import { env } from '../../config/env';
import { createPaymentsClient } from '../payments/paymentsClient';
import { getFirebaseIdToken } from '../payments/firebaseToken';
import type { GeoPoint } from './types';

export interface RouteResult {
  readonly polyline: readonly GeoPoint[];
  readonly distanceMeters: number;
  readonly durationSeconds: number;
}

async function routingToken(refresh: boolean): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([getFirebaseIdToken(refresh), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Routing authentication timed out')), 10000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
export const decodeRoadPolyline = (encoded: string): GeoPoint[] => {
  const points: GeoPoint[] = [];
  let index = 0, latitude = 0, longitude = 0;
  const component = () => {
    let shift = 0, value = 0, byte: number;
    do {
      if (index >= encoded.length || shift > 30) throw new Error('Invalid road geometry');
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) throw new Error('Invalid road geometry');
      value += (byte % 32) * 2 ** shift; shift += 5;
    } while (byte >= 32);
    return value % 2 ? -(value + 1) / 2 : value / 2;
  };
  while (index < encoded.length) {
    latitude += component(); longitude += component();
    if (Math.abs(latitude / 1e5) > 90 || Math.abs(longitude / 1e5) > 180) throw new Error('Invalid road geometry');
    points.push({ latitude: latitude / 1e5, longitude: longitude / 1e5 });
  }
  return points;
};

/** Uses the existing Firebase-authenticated server adapter. No Google server credential in JS. */
export const getRoute = async (
  origin: GeoPoint, destination: GeoPoint,
  options: { readonly waypoints?: readonly GeoPoint[]; readonly tripId?: string; readonly signal?: AbortSignal } = {},
): Promise<RouteResult> => {
  const baseUrl = env.PAYMENTS_API_BASE_URL;
  if (!baseUrl || !/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/.test(baseUrl) ||
      !options.tripId || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(options.tripId)) {
    throw new Error('An authenticated assigned trip and HTTPS routing service are required.');
  }
  for (const point of [origin, ...(options.waypoints ?? []), destination]) {
    if (!Number.isFinite(point.latitude) || Math.abs(point.latitude) > 90 ||
        !Number.isFinite(point.longitude) || Math.abs(point.longitude) > 180) throw new Error('Invalid route coordinates');
  }
  const clean = (p: GeoPoint) => ({ latitude: p.latitude, longitude: p.longitude });
  const result = await createPaymentsClient({ baseUrl, getToken: routingToken, timeoutMs: 12000, maxAttempts: 1 })
    .request({ method: 'POST', path: '/v1/driver/routes/road', body: {
      tripId: options.tripId, origin: clean(origin), destination: clean(destination),
      waypoints: (options.waypoints ?? []).map(clean),
    } }) as { encodedPolyline: string; distanceMeters: number; durationSeconds: number };
  if (options.signal?.aborted) throw new Error('Route request cancelled');
  if (!result || typeof result.encodedPolyline !== 'string' || result.encodedPolyline.length > 500000 ||
      !Number.isFinite(result.distanceMeters) || result.distanceMeters < 0 ||
      !Number.isFinite(result.durationSeconds) || result.durationSeconds < 0) throw new Error('Invalid road route response');
  const polyline = decodeRoadPolyline(result.encodedPolyline);
  if (polyline.length < 2) throw new Error('No usable road route geometry');
  return { polyline, distanceMeters: result.distanceMeters, durationSeconds: result.durationSeconds };
};

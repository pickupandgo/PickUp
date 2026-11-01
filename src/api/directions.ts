import { paymentsRequest } from './payments';
import { ApiError } from './http';
import type { GeoPoint } from './types';

export interface RouteResult {
  readonly polyline: readonly GeoPoint[];
  readonly distanceMeters: number;
  readonly durationSeconds: number;
}

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
      if (index >= encoded.length || shift > 30)
        throw new ApiError('parse', 'Invalid road route geometry');
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63)
        throw new ApiError('parse', 'Invalid road route geometry');
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const dlat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      if (index >= encoded.length || shift > 30)
        throw new ApiError('parse', 'Invalid road route geometry');
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63)
        throw new ApiError('parse', 'Invalid road route geometry');
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const dlng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    if (Math.abs(lat / 1e5) > 90 || Math.abs(lng / 1e5) > 180)
      throw new ApiError('parse', 'Invalid road route geometry');
    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }

  return points;
};

/** Display route only. The backend owns provider credentials; this never sets a fare. */
export const getRoute = async (
  origin: GeoPoint,
  destination: GeoPoint,
  options: {
    readonly waypoints?: readonly GeoPoint[];
    readonly signal?: AbortSignal;
  } = {},
): Promise<RouteResult> => {
  const points = [origin, ...(options.waypoints ?? []), destination];
  if (
    points.some(
      (p) =>
        !Number.isFinite(p.latitude) ||
        !Number.isFinite(p.longitude) ||
        Math.abs(p.latitude) > 90 ||
        Math.abs(p.longitude) > 180,
    )
  )
    throw new ApiError('config', 'Invalid route coordinates');
  const clean = (p: GeoPoint) => ({
    latitude: p.latitude,
    longitude: p.longitude,
  });
  const result = await paymentsRequest<{
    encodedPolyline: string;
    distanceMeters: number;
    durationSeconds: number;
  }>('/v1/routes/road', {
    method: 'POST',
    body: {
      origin: clean(origin),
      destination: clean(destination),
      waypoints: (options.waypoints ?? []).map(clean),
    },
    signal: options.signal,
    timeoutMs: 12000,
  });
  if (
    typeof result?.encodedPolyline !== 'string' ||
    result.encodedPolyline.length > 500000 ||
    !Number.isFinite(result.distanceMeters) ||
    result.distanceMeters < 0 ||
    !Number.isFinite(result.durationSeconds) ||
    result.durationSeconds < 0
  )
    throw new ApiError('parse', 'Invalid road route response');
  const polyline = decodePolyline(result.encodedPolyline);
  if (polyline.length < 2)
    throw new ApiError('parse', 'No usable road route geometry');
  return {
    polyline,
    distanceMeters: result.distanceMeters,
    durationSeconds: result.durationSeconds,
  };
};

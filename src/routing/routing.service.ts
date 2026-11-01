import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import type { RoadRouteRequest, RoadRouteResponse } from './routing.dto';
const HOST = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const fail = (code: ErrorCode, status: HttpStatus, message: string) =>
  new AppError(code, status, message);
@Injectable()
export class RoutingService {
  // Coalesce concurrent identical requests, without persisting Google results or location history.
  private readonly inflight = new Map<string, Promise<RoadRouteResponse>>();
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}
  async route(input: RoadRouteRequest): Promise<RoadRouteResponse> {
    if (!this.config.googleRoutes?.apiKey)
      throw fail(
        ErrorCode.ROUTING_NOT_CONFIGURED,
        HttpStatus.SERVICE_UNAVAILABLE,
        'Road routing is not configured.',
      );
    const point = (p: RoadRouteRequest['origin']) => ({
      latitude: p.latitude,
      longitude: p.longitude,
    });
    const clean = {
      origin: point(input.origin),
      destination: point(input.destination),
      waypoints: (input.waypoints ?? []).map(point),
    };
    const key = JSON.stringify(clean);
    const existing = this.inflight.get(key);
    if (existing) return existing;
    if (this.inflight.size >= 8)
      throw fail(
        ErrorCode.ROUTING_BUSY,
        HttpStatus.SERVICE_UNAVAILABLE,
        'Road routing is busy. Please retry shortly.',
      );
    const work = this.compute(clean);
    this.inflight.set(key, work);
    try {
      const value = await work;
      return value;
    } finally {
      this.inflight.delete(key);
    }
  }
  private async compute(input: RoadRouteRequest): Promise<RoadRouteResponse> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(
          fail(
            ErrorCode.ROUTING_TIMEOUT,
            HttpStatus.GATEWAY_TIMEOUT,
            'Road routing timed out. Please retry.',
          ),
        );
      }, 8000);
    });
    try {
      return await Promise.race([this.fetchRoute(input, controller.signal), timeout]);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw fail(
        ErrorCode.ROUTING_UNAVAILABLE,
        HttpStatus.BAD_GATEWAY,
        'Road routing is temporarily unavailable.',
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  private async fetchRoute(
    input: RoadRouteRequest,
    signal: AbortSignal,
  ): Promise<RoadRouteResponse> {
    const location = (p: RoadRouteRequest['origin']) => ({
      location: { latLng: { latitude: p.latitude, longitude: p.longitude } },
    });
    const response = await fetch(HOST, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': this.config.googleRoutes!.apiKey,
        'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline',
      },
      body: JSON.stringify({
        origin: location(input.origin),
        destination: location(input.destination),
        intermediates: (input.waypoints ?? []).map(location),
        travelMode: 'DRIVE',
        polylineQuality: 'HIGH_QUALITY',
        polylineEncoding: 'ENCODED_POLYLINE',
      }),
    });
    // Never return or log upstream payloads: they may contain project/credential metadata.
    if (response.status === 401 || response.status === 403)
      throw fail(
        ErrorCode.ROUTING_PROVIDER_DENIED,
        HttpStatus.SERVICE_UNAVAILABLE,
        'Road routing is unavailable. Please try again later.',
      );
    if (!response.ok)
      throw fail(
        ErrorCode.ROUTING_UNAVAILABLE,
        HttpStatus.BAD_GATEWAY,
        'Road routing is temporarily unavailable.',
      );
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object' || !('routes' in body))
      throw fail(
        ErrorCode.ROUTE_NOT_FOUND,
        HttpStatus.UNPROCESSABLE_ENTITY,
        'No driving route was found for these locations.',
      );
    const routes = (body as { routes?: unknown }).routes;
    if (!Array.isArray(routes) || !routes.length)
      throw fail(
        ErrorCode.ROUTE_NOT_FOUND,
        HttpStatus.UNPROCESSABLE_ENTITY,
        'No driving route was found for these locations.',
      );
    const route = routes[0] as {
      distanceMeters?: unknown;
      duration?: unknown;
      polyline?: { encodedPolyline?: unknown };
    };
    const encodedPolyline = route?.polyline?.encodedPolyline;
    const distanceMeters = route?.distanceMeters;
    const duration =
      typeof route?.duration === 'string' ? route.duration.match(/^(\d+(?:\.\d+)?)s$/) : null;
    if (
      typeof encodedPolyline !== 'string' ||
      !encodedPolyline.length ||
      encodedPolyline.length > 500000 ||
      !/^[?-~]+$/.test(encodedPolyline) ||
      typeof distanceMeters !== 'number' ||
      !Number.isSafeInteger(distanceMeters) ||
      distanceMeters < 0 ||
      !duration ||
      !Number.isFinite(Number(duration[1]))
    )
      throw fail(
        ErrorCode.ROUTING_UNAVAILABLE,
        HttpStatus.BAD_GATEWAY,
        'Road routing returned an invalid response.',
      );
    return { encodedPolyline, distanceMeters, durationSeconds: Number(duration[1]) };
  }
}

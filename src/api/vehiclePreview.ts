import { request, ApiError } from './http';
import type { GeoPoint } from './types';
export const PREVIEW_CATEGORIES = ['TWO_WHEELER', 'THREE_WHEELER', 'MINI_TRUCK', 'PICKUP_TRUCK'] as const;
export interface PreviewVehicle extends GeoPoint { key: string; vehicleCategory: string; capturedAt: number; expiresAt: number; }
export const getVehiclePreview = async (point: GeoPoint, category: string, signal: AbortSignal): Promise<PreviewVehicle[]> => {
  const started = Date.now();
  const response = await request<{ success: boolean; generatedAt: number; vehicles: Omit<PreviewVehicle, 'expiresAt'>[] }>(
    `/drivers/preview?lat=${point.latitude}&lng=${point.longitude}&radius=5&vehicleCategory=${encodeURIComponent(category)}`,
    { signal, timeoutMs: 10_000, retries: 0 },
  );
  if (!response.success || !Number.isFinite(response.generatedAt) || !Array.isArray(response.vehicles)) throw new ApiError('parse', 'Vehicle preview response was invalid.');
  const received = Date.now();
  return response.vehicles.slice(0, 30).flatMap(vehicle => {
    if (!vehicle || typeof vehicle.key !== 'string' || !/^[a-f0-9]{20}$/.test(vehicle.key) || vehicle.vehicleCategory !== category || !Number.isFinite(vehicle.latitude) || Math.abs(vehicle.latitude) > 90 || !Number.isFinite(vehicle.longitude) || Math.abs(vehicle.longitude) > 180 || !Number.isFinite(vehicle.capturedAt)) return [];
    const age = response.generatedAt - vehicle.capturedAt;
    const ttl = 60_000 - Math.max(0, age) - (received - started);
    if (age < -5_000 || ttl <= 0) return [];
    return [{ ...vehicle, expiresAt: received + ttl }];
  });
};

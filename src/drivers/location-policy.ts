import { BadRequestException } from '@nestjs/common';

export const LOCATION_TTL_MS = 60_000;
export const MAX_FIX_AGE_MS = 30_000;
export const MAX_CLOCK_SKEW_MS = 5_000;

export interface DriverFix {
  latitude: number;
  longitude: number;
  capturedAt: number;
  accuracy: number;
  tripId?: string;
}

export function validateFix(input: DriverFix, now = Date.now()): void {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (key) =>
        !['latitude', 'longitude', 'capturedAt', 'accuracy', 'tripId'].includes(
          key,
        ),
    )
  ) {
    throw new BadRequestException('Invalid location request');
  }
  if (
    !Number.isFinite(input.latitude) ||
    Math.abs(input.latitude) > 90 ||
    !Number.isFinite(input.longitude) ||
    Math.abs(input.longitude) > 180 ||
    !Number.isSafeInteger(input.capturedAt) ||
    input.capturedAt < now - MAX_FIX_AGE_MS ||
    input.capturedAt > now + MAX_CLOCK_SKEW_MS ||
    !Number.isFinite(input.accuracy) ||
    input.accuracy < 0 ||
    input.accuracy > 100 ||
    (input.tripId !== undefined &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        input.tripId,
      ))
  ) {
    throw new BadRequestException('A recent, accurate GPS fix is required');
  }
}

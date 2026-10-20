/**
 * Locations and distances for pricing. Coordinates are fixed to 6 decimals (about 0.1 m) before
 * anything is calculated, and distances are whole metres, so a stored quote can always be
 * explained from the coordinates it stores. Distance is a measurement, not money: the money
 * arithmetic that uses it is integer-only.
 */

export interface Coordinates {
  readonly latitude: number;
  readonly longitude: number;
}

const MICRO_DEGREES = 1_000_000;
/** Mean Earth radius used for the straight-line (haversine) distance. */
export const EARTH_RADIUS_METERS = 6_371_000;

/** The coordinate rounded to 6 decimals, as a number. */
export function normalizeCoordinate(value: number): number {
  return Math.round(value * MICRO_DEGREES) / MICRO_DEGREES;
}

export function normalizeCoordinates(point: Coordinates): Coordinates {
  return {
    latitude: normalizeCoordinate(point.latitude),
    longitude: normalizeCoordinate(point.longitude),
  };
}

/** The coordinate as the 6-decimal string stored in NUMERIC(9,6) columns. */
export function coordinateText(value: number): string {
  return normalizeCoordinate(value).toFixed(6);
}

/** Straight-line distance between two points, in whole metres (rounded half up). */
export function haversineMeters(from: Coordinates, to: Coordinates): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLatitude = toRadians(to.latitude - from.latitude);
  const deltaLongitude = toRadians(to.longitude - from.longitude);
  const h =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) *
      Math.cos(toRadians(to.latitude)) *
      Math.sin(deltaLongitude / 2) ** 2;
  const meters = 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
  return Math.round(meters);
}

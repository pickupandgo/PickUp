import type { Coordinate, RouteData } from './types';
export interface MapInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
export const validCoordinate = (point?: Coordinate): point is Coordinate =>
  !!point &&
  Number.isFinite(point.latitude) &&
  Math.abs(point.latitude) <= 90 &&
  Number.isFinite(point.longitude) &&
  Math.abs(point.longitude) <= 180;
export function routeCameraPoints(route?: RouteData): Coordinate[] {
  return [
    ...(route?.polylinePoints ?? []),
    ...(route?.stops.map(stop => stop.coordinate) ?? []),
    ...(route?.bounds ? [route.bounds.northeast, route.bounds.southwest] : []),
  ].filter(validCoordinate);
}
export function geometryKey(points: readonly Coordinate[]): string {
  if (!points.length) return 'empty';
  return JSON.stringify(
    points.reduce(
      (box, point) => [
        Math.min(box[0], point.latitude),
        Math.min(box[1], point.longitude),
        Math.max(box[2], point.latitude),
        Math.max(box[3], point.longitude),
      ],
      [90, 180, -90, -180],
    ),
  );
}
/** Leave a usable viewport even during transient layout/rotation measurements. */
export function viewportInsets(
  width: number,
  height: number,
  inset?: Partial<MapInsets>,
): MapInsets {
  const safe = (value?: number) =>
    Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
  const top = safe(inset?.top),
    bottom = safe(inset?.bottom);
  const verticalScale = Math.min(
    1,
    Math.max(0, height - 80) / Math.max(1, top + bottom),
  );
  const left = safe(inset?.left),
    right = safe(inset?.right);
  const horizontalScale = Math.min(
    1,
    Math.max(0, width - 80) / Math.max(1, left + right),
  );
  return {
    top: Math.round(top * verticalScale),
    bottom: Math.round(bottom * verticalScale),
    left: Math.round(left * horizontalScale),
    right: Math.round(right * horizontalScale),
  };
}

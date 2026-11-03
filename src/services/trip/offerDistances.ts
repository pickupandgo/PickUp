import { isFreshFix } from '../../location/fixPolicy';
import type { LocationResult } from '../../location/types';
import type { TripOffer } from '../../types/trip';
import type { OfferRoadRoutes } from './OfferRoadRoutes';

type Point = { latitude: number; longitude: number };
/** Displacement only: a trigger to refresh Google routing, never a road-distance fallback. */
export function displacementKm(from: Point, to: Point): number | null {
  if (![from, to].every(p => Number.isFinite(p.latitude) && Math.abs(p.latitude) <= 90 &&
    Number.isFinite(p.longitude) && Math.abs(p.longitude) <= 180)) return null;
  const rad = Math.PI / 180;
  const a = Math.sin((to.latitude - from.latitude) * rad / 2) ** 2 +
    Math.cos(from.latitude * rad) * Math.cos(to.latitude * rad) *
    Math.sin((to.longitude - from.longitude) * rad / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, a)));
}
export function offerDistances(offer: TripOffer, fix: LocationResult | null, now = Date.now(), road?: OfferRoadRoutes | null) {
  const valid = !!road && isFreshFix(fix, now) && offer.expiresAt > now;
  return {
    pickupKm: valid ? road.toPickup.distanceMeters / 1000 : null,
    deliveryKm: valid ? road.delivery.distanceMeters / 1000 : null,
  };
}

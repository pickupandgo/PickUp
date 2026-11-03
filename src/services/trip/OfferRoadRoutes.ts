import { getCurrentDriverId } from '../engine/dispatch';
import { getEngineClient } from '../engine/engineClient';
import { isFreshFix } from '../../location/fixPolicy';
import type { LocationResult } from '../../location/types';
import type { TripOffer } from '../../types/trip';

export interface RoadLeg { distanceMeters: number; durationSeconds: number }
export interface OfferRoadRoutes { toPickup: RoadLeg; delivery: RoadLeg }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const leg = (value: unknown): RoadLeg => {
  const input = value as RoadLeg;
  if (!input || !Number.isFinite(input.distanceMeters) || input.distanceMeters < 0 ||
    !Number.isFinite(input.durationSeconds) || input.durationSeconds < 0) throw new Error('Invalid road route');
  return { distanceMeters: input.distanceMeters, durationSeconds: input.durationSeconds };
};
/** Same backend Google Routes DRIVE service as assigned-trip navigation. No aerial fallback. */
export async function fetchOfferRoadRoutes(offer: TripOffer, fix: LocationResult): Promise<OfferRoadRoutes> {
  const uid = getCurrentDriverId();
  if (!uid || !uuid.test(offer.id) || !isFreshFix(fix) || offer.expiresAt <= Date.now()) throw new Error('Current offer and location required');
  const response = await getEngineClient().request({ method: 'POST',
    path: `/rides/${offer.id}/offer-road-route`, retry: false,
    body: { latitude: fix.latitude, longitude: fix.longitude, capturedAt: fix.timestamp, accuracy: fix.accuracy } });
  const data = response as { rideId?: string; offerId?: string; expiresAt?: string; routes?: OfferRoadRoutes };
  if (getCurrentDriverId() !== uid || data.rideId !== offer.id ||
    (offer.dispatchOfferId && data.offerId !== offer.dispatchOfferId) ||
    !data.expiresAt || Date.parse(data.expiresAt) <= Date.now() || !data.routes) throw new Error('Offer changed');
  return { toPickup: leg(data.routes.toPickup), delivery: leg(data.routes.delivery) };
}

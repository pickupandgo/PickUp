import { NativeModules, Platform } from 'react-native';
import type { ActiveTrip, TripOffer } from '../../types/trip';
import type { OfferRoadRoutes } from '../trip/OfferRoadRoutes';

const native = () => Platform.OS === 'android' ? NativeModules.PartnerFloatingPanel : null;
let routeState: { offer: string; expiry: number; at: number; routes: OfferRoadRoutes } | null = null;
export const floatingPanel = {
  status: async (): Promise<{ enabled: boolean; permission: boolean }> => native()?.status() ?? { enabled: false, permission: false },
  enable: async (enabled: boolean) => { await native()?.enable(enabled); },
  permission: async () => { await native()?.permission(); },
  clear: () => native()?.clear(),
  takeAction: async (): Promise<{ offerId: string; action: 'accept' | 'decline' } | null> => native()?.takeAction() ?? null,
  update(offer: TripOffer | null, trip: ActiveTrip | null, routes?: OfferRoadRoutes) {
    if (offer) {
      if (routes) routeState = { offer: offer.id, expiry: offer.expiresAt, at: Date.now(), routes };
      else if (routeState?.offer === offer.id && routeState.expiry === offer.expiresAt && Date.now() - routeState.at < 30000)
        routes = routeState.routes;
      const amount = offer.partnerAmount === undefined ? '' : `₹${offer.partnerAmount.toLocaleString('en-IN')}\n`;
      const road = routes ? `Pickup ${(routes.toPickup.distanceMeters / 1000).toFixed(1)} km · ${Math.ceil(routes.toPickup.durationSeconds / 60)} min\nDrops ${(routes.delivery.distanceMeters / 1000).toFixed(1)} km · ${Math.ceil(routes.delivery.durationSeconds / 60)} min` : 'Road distances unavailable';
      native()?.state('NEW TRIP REQUEST', `${amount}${offer.vehicleType} · ${offer.dropStops.length} drops\n${road}`, offer.id, offer.expiresAt);
    } else if (trip && !['completed', 'cancelled', 'expired'].includes(trip.status)) {
      native()?.state('Active trip', `${(trip.engineStatus ?? trip.status).replace(/_/g, ' ')}\n${trip.stops[trip.currentStopIndex]?.label ?? 'Next stop unavailable'}`, null, 0);
    } else native()?.state('MultipleRide Partner', 'Tap Open to return to Partner.', null, 0);
  },
};

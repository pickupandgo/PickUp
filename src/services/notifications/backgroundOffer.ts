import { getAuth } from '@react-native-firebase/auth';
import { NativeLocationModule } from '../../location/NativeLocationModule';
import { fetchRideRequests, rideRequestToOffer } from '../engine/dispatch';
import { floatingPanel } from '../tracking/FloatingPanel';
import { fetchOfferRoadRoutes } from '../trip/OfferRoadRoutes';

/** A push is only a hint. Details come from the targeted authenticated offer endpoint. */
export async function updateBackgroundOffer(message: { data?: Record<string, unknown> }) {
  if (message.data?.role !== 'DRIVER' || !['RIDE_OFFER','OFFER_CANCELLED'].includes(String(message.data?.notificationType))) return;
  const uid = getAuth().currentUser?.uid;
  if (!uid || !await NativeLocationModule.getOnlinePreference()) return;
  const requests = await fetchRideRequests(uid);
  if (uid !== getAuth().currentUser?.uid || !await NativeLocationModule.getOnlinePreference()) return;
  const request = requests.find(item => item.status === 'REQUESTED' && !!item.expiresAt && Date.parse(item.expiresAt) > Date.now());
  const offer = request ? rideRequestToOffer(request) : null;
  floatingPanel.update(offer, null);
  if (offer) {
    try {
      const fix = await NativeLocationModule.getCurrentLocation();
      const routes = await fetchOfferRoadRoutes(offer, fix);
      if (uid === getAuth().currentUser?.uid && await NativeLocationModule.getOnlinePreference() && offer.expiresAt > Date.now())
        floatingPanel.update(offer, null, routes);
    } catch { /* The offer remains usable with honest unavailable route labels. */ }
  }
}

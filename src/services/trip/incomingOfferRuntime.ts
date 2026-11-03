import { fetchRideRequests, getCurrentDriverId, rideRequestToOffer } from '../engine/dispatch';
import { TripController } from './TripController';
import { TripService } from './TripService';
import { IncomingOffers } from './IncomingOffers';

export const incomingOffers = new IncomingOffers({
  uid: getCurrentDriverId,
  fetch: async uid => (await fetchRideRequests(uid))
    .filter(request => request.status === 'REQUESTED')
    .map(rideRequestToOffer),
  // Explicit availability transitions belong to TrackingService, never a polling timer.
  availability: async () => {},
  accept: id => TripController.getInstance().acceptOffer(id),
  decline: id => TripService.getInstance().declineTrip(id),
  now: Date.now,
});

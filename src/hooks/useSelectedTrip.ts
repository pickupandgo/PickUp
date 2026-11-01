import type { Trip } from '../api/types';
import { useTripStatus } from './useTripStatus';
/** Explicit historical identity never falls back to an unrelated active trip. */
export const useSelectedTrip = (params: { trip?: Trip; tripId?: string; paymentBookingId?: string; bookingId?: string } | undefined, context?: Trip) => {
  const explicit = !!params && ('trip' in params || 'tripId' in params || 'paymentBookingId' in params || 'bookingId' in params);
  const provided = params?.trip && (!params.tripId || params.trip.id === params.tripId) ? params.trip : undefined;
  const selected = provided ?? (params?.tripId ? context?.id === params.tripId ? context : undefined : !explicit ? context : undefined);
  const { trip: loaded } = useTripStatus(params?.tripId, { enabled: !!params?.tripId && !selected });
  return selected ?? loaded;
};

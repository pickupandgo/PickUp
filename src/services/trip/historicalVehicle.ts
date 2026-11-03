import type { TripHistoryRecord } from '../../types/tripHistory';
import type { VehicleCategory } from '../onboarding/DriverOnboardingService';
import { historyVehicle } from './tripHistoryPresentation';

/** One source for all three trip vehicle displays. No current-vehicle lookup is permitted.
 * EngineTrip has no vehicle relation/snapshot; its only verified field is booked category.
 */
export function historicalVehicle(trip: Pick<TripHistoryRecord, 'vehicleCategory'>) {
  const category = historyVehicle(trip.vehicleCategory);
  const suppliedArtwork = new Set(['TWO_WHEELER', 'THREE_WHEELER', 'MINI_TRUCK', 'PICKUP_TRUCK']);
  return { title: category.label, icon: category.icon, model: null, registration: null,
    detailsNote: 'Model and registration were not recorded for this trip.',
    artworkCategory: trip.vehicleCategory && suppliedArtwork.has(trip.vehicleCategory) ? trip.vehicleCategory as VehicleCategory : null };
}

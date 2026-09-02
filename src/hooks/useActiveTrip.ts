import { useState, useEffect } from 'react';
import { TripController } from '../services/trip/TripController';
import type { ActiveTrip } from '../types/trip';

/**
 * Subscribes to the current active trip.
 *
 * When a `tripId` is provided (e.g. the trip the driver just accepted), that
 * specific trip is loaded from the engine. Otherwise the driver's current
 * active trip is loaded as a fallback.
 */
export function useActiveTrip(tripId?: string) {
  const [activeTrip, setActiveTrip] = useState<ActiveTrip | null>(null);

  useEffect(() => {
    const controller = TripController.getInstance();

    if (tripId) {
      controller.loadTrip(tripId);
    } else if (!controller.getTrip()) {
      controller.loadInitialTrip();
    }

    const unsubscribe = controller.subscribe(setActiveTrip);

    return () => {
      unsubscribe();
    };
  }, [tripId]);

  return activeTrip;
}

import { useState, useEffect, useCallback } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
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

/**
 * The trip a pickup or drop screen acts on, re-read from the engine whenever the screen is shown
 * and whenever the app comes back to the foreground (e.g. after a lost connection), so a screen
 * never acts on stale state. Null until the engine's answer for this trip id is in.
 */
export function useLiveTrip(tripId: string): ActiveTrip | null {
  const trip = useActiveTrip(tripId);

  useFocusEffect(
    useCallback(() => {
      TripController.getInstance().loadTrip(tripId);
    }, [tripId]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        TripController.getInstance().loadTrip(tripId);
      }
    });
    return () => subscription.remove();
  }, [tripId]);

  return trip && trip.id === tripId ? trip : null;
}

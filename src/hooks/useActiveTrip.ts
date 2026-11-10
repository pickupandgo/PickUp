import { useState, useEffect, useCallback } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { TripController, type TripResource } from '../services/trip/TripController';
import type { ActiveTrip } from '../types/trip';

/**
 * Subscribes to the current active trip.
 *
 * When a `tripId` is provided (e.g. the trip the driver just accepted), that
 * specific trip is loaded from the engine. Otherwise the driver's current
 * active trip is loaded as a fallback.
 */
export function useTripResource(tripId?: string, loadOnMount = true): TripResource {
  const [resource, setResource] = useState<TripResource>(() => TripController.getInstance().getResource(tripId));

  useEffect(() => {
    const controller = TripController.getInstance();

    const unsubscribe = controller.subscribe(() => setResource(controller.getResource(tripId)));
    if (loadOnMount) {
      const read = tripId ? controller.loadTrip(tripId) : controller.loadInitialTrip();
      read.catch(() => {}); // The controller exposes the error to the retry UI.
    }

    return () => {
      unsubscribe();
    };
  }, [tripId, loadOnMount]);

  // A route change must not briefly render the previous id before the effect runs.
  const sessionUid = TripController.getInstance().getSessionUid();
  return resource.sessionUid !== sessionUid || (resource.trip && tripId && resource.trip.id !== tripId)
    ? { sessionUid, trip: null, status: 'loading', error: null } : resource;
}

export function useActiveTrip(tripId?: string) {
  return useTripResource(tripId).trip;
}

/**
 * The trip a pickup or drop screen acts on, re-read from the engine whenever the screen is shown
 * and whenever the app comes back to the foreground (e.g. after a lost connection), so a screen
 * never acts on stale state. Null until the engine's answer for this trip id is in.
 */
export function useLiveTrip(tripId: string): ActiveTrip | null {
  const resource = useTripResource(tripId);
  const trip = resource.status === 'error' ? null : resource.trip;

  useFocusEffect(
    useCallback(() => {
      TripController.getInstance().loadTrip(tripId).catch(() => {});
    }, [tripId]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        TripController.getInstance().loadTrip(tripId).catch(() => {});
      }
    });
    return () => subscription.remove();
  }, [tripId]);

  return trip && trip.id === tripId ? trip : null;
}

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getAuth, onAuthStateChanged } from '@react-native-firebase/auth';
import { TripService } from '../services/trip/TripService';
import { TripController } from '../services/trip/TripController';
import { TripHistoryStore } from '../services/trip/TripHistoryStore';
import { tripHistoryEvents } from '../services/trip/tripHistoryEvents';

/** Focus/resume/mutation/push refresh plus a 30s fallback only while visible and foregrounded. */
export function useTripHistory(tripId?: string) {
  const store = useMemo(() => new TripHistoryStore(TripService.getHistorySource(), tripId), [tripId]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const focused = useRef(false);
  useEffect(() => {
    store.setSession(getAuth().currentUser?.uid ?? null);
    return onAuthStateChanged(getAuth(), user => {
      const uid = user?.uid ?? null;
      if (store.getSnapshot().uid !== uid) {
        store.setSession(uid);
        if (focused.current) store.refresh().catch(() => {});
      }
    });
  }, [store]);
  useFocusEffect(useCallback(() => {
    focused.current = true; store.setSession(getAuth().currentUser?.uid ?? null); store.setActive(true);
    store.refresh().catch(() => {});
    const app = AppState.addEventListener('change', next => {
      store.setActive(next === 'active');
      if (next === 'active') store.refresh().catch(() => {});
    });
    const invalidate = tripHistoryEvents.subscribe(() => store.invalidate());
    let previousTrip = '';
    let observedInitialTrip = false;
    const trip = TripController.getInstance().subscribe(current => {
      const key = current ? `${current.id}:${current.engineStatus ?? current.status}:${current.updatedAt ?? ''}` : '';
      if (observedInitialTrip && key !== previousTrip) store.invalidate();
      previousTrip = key;
      observedInitialTrip = true;
    });
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') store.refresh().catch(() => {});
    }, 30_000);
    return () => { focused.current = false; store.setActive(false); app.remove(); invalidate(); trip(); clearInterval(timer); };
  }, [store]));
  // Never render a previous user's records while Firebase's observer callback is pending.
  const uid = getAuth().currentUser?.uid ?? null;
  return state.uid === uid ? { ...state, refresh: store.refresh } : {
    ...state, items: [], counts: null, ready: false, loading: true, error: null, financeError: null, refresh: store.refresh,
  };
}

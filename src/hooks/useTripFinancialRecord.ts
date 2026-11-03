import { useCallback, useEffect, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { getAuth, onAuthStateChanged } from '@react-native-firebase/auth';
import { getPaymentsApi } from '../services/payments';
import type { DriverTripDto } from '../services/payments/collectionsDto';
import type { EarningDto } from '../services/payments/earningsDto';
import { MAX_EARNING_LOOKUP_PAGES } from '../services/trip/TripHistoryService';
import { historyError } from '../services/trip/TripHistoryStore';

/** Existing Earnings route uses a PAYMENT trip UUID, not an engine trip UUID. */
export function useTripFinancialRecord(tripId: string) {
  const focused = useIsFocused();
  const [attempt, setAttempt] = useState(0);
  const refresh = useCallback(() => setAttempt(value => value + 1), []);
  const [state, setState] = useState<{ uid: string | null; trip: DriverTripDto | null; earning: EarningDto | null; loading: boolean; error: string | null }>({
    uid: null, trip: null, earning: null, loading: true, error: null,
  });
  useEffect(() => {
    if (!focused) return;
    let alive = true;
    const uid = getAuth().currentUser?.uid ?? null;
    const current = () => alive && (getAuth().currentUser?.uid ?? null) === uid;
    setState({ uid, trip: null, earning: null, loading: true, error: null });
    const stopAuth = onAuthStateChanged(getAuth(), user => {
      if ((user?.uid ?? null) !== uid) { alive = false; setState({ uid: user?.uid ?? null, trip: null, earning: null, loading: false, error: 'Please sign in again to view your trips.' }); }
    });
    const load = async () => {
      try {
        if (!uid) throw new Error('Please sign in again to view your trips.');
        const api = getPaymentsApi();
        if (!api) throw new Error('Earnings are currently unavailable.');
        const trip = await api.getTrip(tripId);
        if (!current()) return;
        if (trip.tripId !== tripId) throw new Error('Trip reference could not be verified.');
        setState({ uid, trip, earning: null, loading: true, error: null });
        if (trip.status !== 'COMPLETED') { setState({ uid, trip, earning: null, loading: false, error: null }); return; }
        let cursor: string | undefined;
        const seen = new Set<string>();
        for (let pageIndex = 0; pageIndex < MAX_EARNING_LOOKUP_PAGES; pageIndex++) {
          if (!current()) return;
          const page = await api.listEarnings({ limit: 100, cursor });
          if (!current()) return;
          const earning = page.items.find(item => item.tripId === trip.tripId && item.bookingId === trip.bookingId);
          if (earning || page.nextCursor === null) { setState({ uid, trip, earning: earning ?? null, loading: false, error: null }); return; }
          if (seen.has(page.nextCursor)) throw new Error('Earnings could not be verified. Please retry.');
          seen.add(page.nextCursor); cursor = page.nextCursor;
        }
        throw new Error('Earnings are unavailable in this trip view. View Earnings for your full financial history.');
      } catch (error) {
        if (current()) setState({ uid, trip: null, earning: null, loading: false, error: historyError(error) });
      }
    };
    load().catch(() => {});
    return () => { alive = false; stopAuth(); };
  }, [tripId, attempt, focused]);
  return state.uid === (getAuth().currentUser?.uid ?? null) ? { ...state, refresh } : { ...state, trip: null, earning: null, error: 'Please sign in again to view your trips.', refresh };
}

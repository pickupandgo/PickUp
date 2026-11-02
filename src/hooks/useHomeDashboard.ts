import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getAuth, onAuthStateChanged } from '@react-native-firebase/auth';
import { HomeDashboardService, businessDate, type DailyEarnings } from '../services/dashboard/HomeDashboardService';
import type { DriverOnboardingSummary } from '../services/onboarding/DriverOnboardingService';
import type { WalletBalance } from '../types/wallet';
import { describePaymentsError, PaymentsApiError } from '../services/payments/paymentsErrors';

export interface DashboardResource<T> {
  readonly data: T | null;
  readonly loading: boolean;
  readonly error: string | null;
}
const initial = <T>(): DashboardResource<T> => ({ data: null, loading: true, error: null });
const service = new HomeDashboardService();

/** Refresh at focus, app resume, trip transition, pull-to-refresh and the IST date boundary. */
export function useHomeDashboard(tripKey: string) {
  const [vehicle, setVehicle] = useState(initial<DriverOnboardingSummary>);
  const [today, setToday] = useState(initial<DailyEarnings>);
  const [wallet, setWallet] = useState(initial<WalletBalance>);
  const generation = useRef(0);
  const focused = useRef(false);
  const inFlight = useRef<Promise<void> | null>(null);
  const observedTrip = useRef(tripKey);

  const refresh = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current;
    const request = ++generation.current;
    const user = getAuth().currentUser;
    const uid = user?.uid;
    const date = businessDate();
    const current = () => focused.current && request === generation.current && getAuth().currentUser?.uid === uid;
    setVehicle(initial()); setToday(initial()); setWallet(initial());
    async function load<T>(fetch: () => Promise<T>, set: (next: DashboardResource<T>) => void) {
      try {
        if (!user) throw new Error('Please sign in again to continue.');
        const data = await fetch();
        if (current()) set({ data, loading: false, error: null });
      } catch (cause) {
        if (current()) set({ data: null, loading: false, error: cause instanceof PaymentsApiError
          ? describePaymentsError(cause) : cause instanceof Error ? cause.message : 'Unable to load. Please retry.' });
      }
    }
    const work = Promise.all([
      load(() => service.getVehicles(), setVehicle),
      load(async () => {
        const data = await service.getToday(date);
        if (businessDate() !== date) throw new Error('A new day has started. Pull to refresh today’s earnings.');
        return data;
      }, setToday),
      load(() => service.getWallet(), setWallet),
    ]).then(() => undefined).finally(() => {
      if (request === generation.current) inFlight.current = null;
    });
    inFlight.current = work;
    return work;
  }, []);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    refresh().catch(() => undefined);
    const appState = AppState.addEventListener('change', state => {
      if (state === 'active') refresh().catch(() => undefined);
    });
    let focusUid = getAuth().currentUser?.uid;
    const unsubscribe = onAuthStateChanged(getAuth(), user => {
      if (!user || user.uid !== focusUid) {
        ++generation.current;
        inFlight.current = null;
        const expired = { data: null, loading: false, error: 'Please sign in again to continue.' };
        setVehicle(expired); setToday(expired); setWallet(expired);
        focusUid = user?.uid;
        if (user) refresh().catch(() => undefined);
      }
    });
    let midnight: ReturnType<typeof setTimeout>;
    const scheduleMidnight = () => {
      const nextMidnight = Date.parse(`${businessDate()}T00:00:00+05:30`) + 86_400_000;
      midnight = setTimeout(() => {
        ++generation.current; inFlight.current = null;
        refresh().catch(() => undefined);
        scheduleMidnight();
      }, Math.max(1, nextMidnight - Date.now()));
    };
    scheduleMidnight();
    return () => {
      focused.current = false; ++generation.current; inFlight.current = null;
      appState.remove(); unsubscribe(); clearTimeout(midnight);
    };
  }, [refresh]));

  useEffect(() => {
    if (observedTrip.current === tripKey) return;
    observedTrip.current = tripKey;
    if (focused.current) {
      // Discard an older in-flight snapshot when the trip lifecycle changes.
      ++generation.current; inFlight.current = null;
      refresh().catch(() => undefined);
    }
  }, [tripKey, refresh]);

  return { vehicle, today, wallet, refresh };
}

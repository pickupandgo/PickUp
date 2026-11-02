import { useCallback, useEffect, useRef, useState } from 'react';
import { getAuth, onAuthStateChanged } from '@react-native-firebase/auth';
import {
  DriverOnboardingService,
  type DriverOnboardingSummary,
} from '../services/onboarding/DriverOnboardingService';

export const useDriverOnboarding = () => {
  const [summary, setSummary] = useState<DriverOnboardingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const mounted = useRef(false);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    const uid = getAuth().currentUser?.uid;
    const current = () => mounted.current && generation.current === request && getAuth().currentUser?.uid === uid;
    setLoading(true);
    setError(null);
    try {
      const next = await DriverOnboardingService.getInstance().getSummary();
      if (current()) setSummary(next);
    } catch (cause) {
      if (!current()) return;
      setSummary(null);
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load verification status.',
      );
    } finally {
      if (current()) setLoading(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const cancel = () => { mounted.current = false; ++generation.current; };
    let uid = getAuth().currentUser?.uid;
    const stop = onAuthStateChanged(getAuth(), user => {
      if (uid === user?.uid) return;
      uid = user?.uid; ++generation.current; setSummary(null);
      if (user) refresh().catch(() => undefined);
      else { setLoading(false); setError('Please sign in again to view documents.'); }
    });
    refresh().catch(() => undefined);
    return () => { cancel(); stop(); };
  }, [refresh]);
  return { summary, loading, error, refresh };
};

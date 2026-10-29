import { useCallback, useEffect, useState } from 'react';
import {
  DriverOnboardingService,
  type DriverOnboardingSummary,
} from '../services/onboarding/DriverOnboardingService';

export const useDriverOnboarding = () => {
  const [summary, setSummary] = useState<DriverOnboardingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSummary(await DriverOnboardingService.getInstance().getSummary());
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load verification status.',
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { summary, loading, error, refresh };
};

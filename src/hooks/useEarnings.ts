import { useState, useCallback, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAuth } from '@react-native-firebase/auth';
import { EarningsService } from '../services/earnings/EarningsService';
import type { EarningsSummary } from '../types/wallet';

const EARNINGS_CACHE_KEY_PREFIX = 'driver.earnings.';

export function useEarnings() {
  const [summary, setSummary] = useState<EarningsSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const uid = getAuth().currentUser?.uid;
  const cacheKey = uid ? `${EARNINGS_CACHE_KEY_PREFIX}${uid}` : null;

  useEffect(() => {
    mounted.current = true;
    if (!cacheKey) return;
    AsyncStorage.getItem(cacheKey)
      .then((raw) => {
        if (!mounted.current || !raw) return;
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed.netEarnings === 'number') {
            setSummary(parsed);
          }
        } catch {
          // ignore cache parse error
        }
      })
      .catch(() => {});

    return () => {
      mounted.current = false;
    };
  }, [cacheKey]);

  const fetchSummary = useCallback(async (timeframe: 'day' | 'week' | 'month' = 'day') => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await EarningsService.getInstance().getSummary(timeframe);
      if (mounted.current) {
        setSummary(data);
        if (cacheKey && data) {
          AsyncStorage.setItem(cacheKey, JSON.stringify(data)).catch(() => {});
        }
      }
    } catch (err: unknown) {
      if (mounted.current) {
        setError((err instanceof Error ? err.message : 'Unknown error') || 'Failed to fetch earnings summary');
      }
    } finally {
      if (mounted.current) {
        setIsLoading(false);
      }
    }
  }, [cacheKey]);

  useEffect(() => {
    fetchSummary('day');
  }, [fetchSummary]);

  return { summary, isLoading, error, fetchSummary };
}

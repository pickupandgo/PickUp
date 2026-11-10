import { useState, useCallback, useRef, useEffect } from 'react';
import { getCurrentDriverId } from '../services/engine/dispatch';
import { getPaymentsApi } from '../services/payments';
import type { EarningDto } from '../services/payments/earningsDto';

export function useTripEarning(tripId?: string | null) {
  const uid = getCurrentDriverId(),
    key = `${uid}:${tripId ?? ''}`;
  const [state, setState] = useState({
    key,
    earning: null as EarningDto | null,
    loading: !!tripId,
    error: null as string | null,
  });
  const sequence = useRef(0);
  const reload = useCallback(async () => {
    const request = ++sequence.current;
    setState({ key, earning: null, loading: !!tripId, error: null });
    if (!tripId || !uid) return;
    try {
      const api = getPaymentsApi();
      if (!api) throw new Error('Earnings unavailable');
      const earning = await api.getTripEarning(tripId);
      if (request !== sequence.current || getCurrentDriverId() !== uid) return;
      if (earning && earning.tripId !== tripId)
        throw new Error('Earning trip mismatch');
      setState({ key, earning, loading: false, error: null });
    } catch {
      if (request === sequence.current && getCurrentDriverId() === uid)
        setState({
          key,
          earning: null,
          loading: false,
          error: 'Earnings could not be loaded. Please retry.',
        });
    }
  }, [uid, key, tripId]);
  useEffect(() => {
    void reload();
    const fence = sequence;
    return () => {
      ++fence.current;
    };
  }, [reload]);
  return {
    earning: state.key === key ? state.earning : null,
    loading: state.key !== key || state.loading,
    error: state.key === key ? state.error : null,
    reload,
  };
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { useBooking, toGeoPoint } from '../state/BookingContext';
import { vehicleCategoryFor } from '../data/mockData';
import { createFareQuote } from '../api/payments';
import { quoteMatchesDraft } from '../state/quoteValidation';
import { toApiError } from '../api/http';
export function useBookingFareQuote(enabled = true) {
  const { draft, setQuote, customerId } = useBooking();
  const latest = useRef({ draft, customerId }); latest.current = { draft, customerId };
  const request = useRef<AbortController | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const category = vehicleCategoryFor(draft.vehicleType);
  const { pickup, drops } = draft;
  const weightKg = draft.weightKg ?? 10;
  const refresh = useCallback(async () => {
    if (!enabled) return;
    request.current?.abort();
    if (!pickup || !drops.length || !category) {
      setLoading(false); setError('Choose pickup, drop and a vehicle to get a fare.'); return;
    }
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setError(undefined);
    try {
      const quote = await createFareQuote({ pickup: toGeoPoint(pickup), drops: drops.map(toGeoPoint), vehicleCategory: category, weightKg }, controller.signal);
      if (controller.signal.aborted || request.current !== controller || latest.current.customerId !== customerId || !quoteMatchesDraft(quote, latest.current.draft)) return;
      setQuote(quote);
    } catch (caught) {
      if (controller.signal.aborted || request.current !== controller || latest.current.customerId !== customerId) return;
      setError(toApiError(caught).userMessage);
    } finally { if (!controller.signal.aborted && request.current === controller) setLoading(false); }
  }, [pickup, drops, category, weightKg, customerId, setQuote, enabled]);
  useEffect(() => {
    if (!enabled) return;
    const quote = latest.current.draft.quote;
    if (!quote || !quoteMatchesDraft(quote, latest.current.draft)) void refresh();
    return () => request.current?.abort();
  }, [refresh]);
  return { loading, error, refresh };
}

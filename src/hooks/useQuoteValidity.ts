import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import type { FareQuote } from '../api/types';
import { isQuoteBookable } from '../api/payments';

/** Re-render at server expiry and recheck after background/clock changes. */
export const useQuoteValidity = (quote?: FareQuote): boolean => {
  const [, tick] = useState(0);
  useEffect(() => {
    const check = () => tick(n => n + 1);
    const remaining = quote ? Date.parse(quote.expiresAt) - Date.now() : 0;
    const timer = remaining > 0 && Number.isFinite(remaining)
      ? setTimeout(check, Math.min(remaining + 1, 2147483647)) : undefined;
    const sub = AppState.addEventListener('change', check);
    return () => { if (timer !== undefined) clearTimeout(timer); sub.remove(); };
  }, [quote]);
  return !!quote && isQuoteBookable(quote);
};

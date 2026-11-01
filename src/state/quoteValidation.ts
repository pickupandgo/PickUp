import type { FareQuote } from '../api/types';
import type { BookingDraft } from './BookingContext';
import { vehicleCategoryFor } from '../data/mockData';

export const quoteMatchesDraft = (quote: FareQuote, draft: BookingDraft): boolean => {
  const same = (a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) =>
    Math.abs(a.latitude - b.latitude) < 0.000001 && Math.abs(a.longitude - b.longitude) < 0.000001;
  return !!draft.pickup && same(quote.pickup, draft.pickup) &&
    quote.vehicleCategory === vehicleCategoryFor(draft.vehicleType) &&
    Math.abs(quote.weightKg - (draft.weightKg ?? 10)) < 0.000001 &&
    quote.drops.length === draft.drops.length &&
    [...quote.drops].sort((a, b) => a.sequence - b.sequence).every((drop, i) => same(drop, draft.drops[i]));
};

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { searchPlaces, resolvePlaceId, type PlaceSuggestion, type ResolvedPlace } from '../api/geocoding';
import { ApiError, toApiError } from '../api/http';
import type { GeoPoint } from '../api/types';

/**
 * Debounced Google Places autocomplete.
 *
 * Google bills autocomplete per request, so this:
 *  - waits for a typing pause before querying
 *  - reuses one session token across a search session, which groups the
 *    keystrokes plus the final Place Details call into a single billed session
 *  - aborts superseded requests so results can't arrive out of order
 */

const DEBOUNCE_MS = 350;
const MIN_QUERY_LENGTH = 3;

const newSessionToken = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export interface UsePlaceSearchResult {
  readonly query: string;
  readonly setQuery: (next: string) => void;
  readonly suggestions: readonly PlaceSuggestion[];
  readonly isSearching: boolean;
  readonly error: ApiError | undefined;
  /** Resolves a suggestion to coordinates and ends the billing session. */
  readonly resolve: (suggestion: PlaceSuggestion) => Promise<ResolvedPlace>;
  readonly clear: () => void;
}

export const usePlaceSearch = (origin?: GeoPoint): UsePlaceSearchResult => {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<readonly PlaceSuggestion[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<ApiError>();

  const sessionRef = useRef(newSessionToken());
  const abortRef = useRef<AbortController | undefined>(undefined);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Keep origin stable so it can't retrigger the effect every render.
  const originKey = origin ? `${origin.latitude},${origin.longitude}` : '';
  const stableOrigin = useMemo(
    () => (origin ? { latitude: origin.latitude, longitude: origin.longitude } : undefined),
    [originKey] // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    abortRef.current?.abort();

    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setIsSearching(false);
      setError(undefined);
      return;
    }

    setIsSearching(true);
    timerRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const results = await searchPlaces(trimmed, {
          sessionToken: sessionRef.current,
          origin: stableOrigin,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setSuggestions(results);
        setError(undefined);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setSuggestions([]);
        setError(toApiError(caught));
      } finally {
        if (!controller.signal.aborted) setIsSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, stableOrigin]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  const resolve = useCallback(async (suggestion: PlaceSuggestion): Promise<ResolvedPlace> => {
    const place = await resolvePlaceId(suggestion.placeId, {
      sessionToken: sessionRef.current,
    });
    // Details call closes the session; start a fresh one for the next search.
    sessionRef.current = newSessionToken();
    return place;
  }, []);

  const clear = useCallback(() => {
    setQuery('');
    setSuggestions([]);
    setError(undefined);
  }, []);

  return { query, setQuery, suggestions, isSearching, error, resolve, clear };
};

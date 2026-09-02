import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { getTrip } from '../api/engine';
import { ApiError, toApiError } from '../api/http';
import { isTripTerminal, type Trip } from '../api/types';

/**
 * Polls a trip until it reaches a terminal state.
 *
 * The engine exposes no WebSocket or push channel, so live tracking has to poll.
 * This hook keeps that honest:
 *  - stops once the trip is COMPLETED or CANCELLED
 *  - pauses while the app is backgrounded, so we don't burn battery or quota
 *  - aborts the in-flight request on unmount
 *  - surfaces transient errors without tearing down polling
 */

const DEFAULT_INTERVAL_MS = 4_000;

/**
 * Pause polling only when the OS reports the app is really backgrounded.
 * Android often reports `'unknown'` on first render, so treating anything
 * other than `'background'` or `'inactive'` as foreground avoids a hook that
 * silently never starts.
 */
const isForeground = (state: AppStateStatus | string): boolean =>
  state !== 'background' && state !== 'inactive';

export interface UseTripStatusResult {
  readonly trip: Trip | undefined;
  readonly error: ApiError | undefined;
  readonly isLoading: boolean;
  readonly refresh: () => void;
}

export const useTripStatus = (
  tripId: string | undefined,
  options: { readonly intervalMs?: number; readonly enabled?: boolean } = {}
): UseTripStatusResult => {
  const { intervalMs = DEFAULT_INTERVAL_MS, enabled = true } = options;

  const [trip, setTrip] = useState<Trip>();
  const [error, setError] = useState<ApiError>();
  const [isLoading, setIsLoading] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const isMountedRef = useRef(true);
  const [appActive, setAppActive] = useState(() => isForeground(AppState.currentState));

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) =>
      setAppActive(isForeground(state))
    );
    return () => sub.remove();
  }, []);

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = undefined;
  };

  const fetchOnce = useCallback(
    async (id: string): Promise<Trip | undefined> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const next = await getTrip(id, controller.signal);
        if (!isMountedRef.current) return undefined;
        setTrip(next);
        setError(undefined);
        return next;
      } catch (caught) {
        if (!isMountedRef.current || controller.signal.aborted) return undefined;
        setError(toApiError(caught));
        return undefined;
      }
    },
    []
  );

  useEffect(() => {
    isMountedRef.current = true;

    if (!tripId || !enabled || !appActive) {
      clearTimer();
      return () => {
        clearTimer();
      };
    }

    let cancelled = false;

    const loop = async () => {
      if (cancelled) return;
      setIsLoading(true);
      const next = await fetchOnce(tripId);
      if (cancelled || !isMountedRef.current) return;
      setIsLoading(false);

      // Stop polling once there is nothing left to observe.
      if (next && isTripTerminal(next.status)) return;

      timerRef.current = setTimeout(loop, intervalMs);
    };

    void loop();

    return () => {
      cancelled = true;
      clearTimer();
      abortRef.current?.abort();
    };
  }, [tripId, enabled, appActive, intervalMs, fetchOnce]);

  useEffect(
    () => () => {
      isMountedRef.current = false;
      abortRef.current?.abort();
    },
    []
  );

  const refresh = useCallback(() => {
    if (tripId) void fetchOnce(tripId);
  }, [tripId, fetchOnce]);

  return { trip, error, isLoading, refresh };
};

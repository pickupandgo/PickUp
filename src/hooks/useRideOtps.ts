import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { getRideOtps } from '../api/engine';
import { ApiError, toApiError } from '../api/http';
import type { RideOtps } from '../api/types';

/**
 * Polls the gated handover OTPs for a ride (engine GET /rides/:id/otps). The pickup / drop code
 * is withheld by the server until the payment backend allows that handover, so the app never
 * shows an OTP before authorization; it just displays whatever the server releases. OTPs are
 * never logged.
 */

const DEFAULT_INTERVAL_MS = 3_000;

const isForeground = (state: AppStateStatus | string): boolean =>
  state !== 'background' && state !== 'inactive';

export interface UseRideOtpsResult {
  readonly otps: RideOtps | undefined;
  readonly error: ApiError | undefined;
  readonly refresh: () => void;
}

export const useRideOtps = (
  rideId: string | undefined,
  options: { readonly intervalMs?: number; readonly enabled?: boolean } = {}
): UseRideOtpsResult => {
  const { intervalMs = DEFAULT_INTERVAL_MS, enabled = true } = options;

  const [otps, setOtps] = useState<RideOtps>();
  const [error, setError] = useState<ApiError>();

  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const isMountedRef = useRef(true);
  const [appActive, setAppActive] = useState(() => isForeground(AppState.currentState));

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setAppActive(isForeground(state)));
    return () => sub.remove();
  }, []);

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = undefined;
  };

  const fetchOnce = useCallback(async (id: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const next = await getRideOtps(id, controller.signal);
      if (!isMountedRef.current) return;
      setOtps(next);
      setError(undefined);
    } catch (caught) {
      if (!isMountedRef.current || controller.signal.aborted) return;
      // Keep the last good OTP state; surface the error but keep polling.
      setError(toApiError(caught));
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    if (!rideId || !enabled || !appActive) {
      clearTimer();
      return () => clearTimer();
    }
    let cancelled = false;
    const loop = async () => {
      if (cancelled) return;
      await fetchOnce(rideId);
      if (cancelled || !isMountedRef.current) return;
      timerRef.current = setTimeout(loop, intervalMs);
    };
    void loop();
    return () => {
      cancelled = true;
      clearTimer();
      abortRef.current?.abort();
    };
  }, [rideId, enabled, appActive, intervalMs, fetchOnce]);

  useEffect(
    () => () => {
      isMountedRef.current = false;
      abortRef.current?.abort();
    },
    []
  );

  const refresh = useCallback(() => {
    if (rideId) void fetchOnce(rideId);
  }, [rideId, fetchOnce]);

  return { otps, error, refresh };
};

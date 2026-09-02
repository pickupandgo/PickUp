import { useCallback, useEffect, useRef } from 'react';
import {
  fetchRideRequests,
  getCurrentDriverId,
  rideRequestToOffer,
  setDriverAvailability,
  updateDriverLocation,
} from '../services/engine/dispatch';
import type { TripOffer } from '../types/trip';

/** How often we heartbeat location + poll for ride requests. */
const POLL_INTERVAL_MS = 3000;

export interface UseDriverDispatchParams {
  /** True while the driver is ONLINE / searching. */
  readonly enabled: boolean;
  /** Latest known driver location, or null if not available yet. */
  readonly getLocation: () => { latitude: number; longitude: number } | null | undefined;
  /** Called once per incoming ride request while online. */
  readonly onOffer: (offer: TripOffer, driverId: string) => void;
}

export interface UseDriverDispatchResult {
  /**
   * Resume polling after an offer was dispatched (e.g. when the Home screen
   * regains focus after the driver declined or the offer expired).
   */
  readonly resume: () => void;
}

/**
 * Keeps the driver advertised as available on the engine while online and
 * polls for incoming ride requests. On the first pending request it invokes
 * `onOffer` and pauses further offering until `resume()` is called.
 */
export function useDriverDispatch({
  enabled,
  getLocation,
  onOffer,
}: UseDriverDispatchParams): UseDriverDispatchResult {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pausedRef = useRef<boolean>(false);
  const handledRideRef = useRef<string | null>(null);

  const onOfferRef = useRef(onOffer);
  const getLocationRef = useRef(getLocation);
  onOfferRef.current = onOffer;
  getLocationRef.current = getLocation;

  const clearTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const resume = useCallback(() => {
    pausedRef.current = false;
    handledRideRef.current = null;
  }, []);

  useEffect(() => {
    if (!enabled) {
      clearTimer();
      return;
    }

    const driverId = getCurrentDriverId();
    if (!driverId) {
      console.warn('[useDriverDispatch] No driver id available; cannot go online.');
      return;
    }

    let cancelled = false;
    pausedRef.current = false;
    handledRideRef.current = null;

    const pingLocation = () => {
      const loc = getLocationRef.current?.();
      if (loc && typeof loc.latitude === 'number' && typeof loc.longitude === 'number') {
        updateDriverLocation(driverId, loc.latitude, loc.longitude).catch(() => {});
      }
    };

    // Announce availability immediately, then start heartbeat + polling.
    setDriverAvailability(driverId, true).catch((e) =>
      console.warn('[useDriverDispatch] Failed to set availability:', e),
    );
    pingLocation();

    const tick = async () => {
      if (cancelled) return;
      pingLocation();
      if (pausedRef.current) return;
      // Re-assert availability every tick so we self-heal if the initial call
      // failed (e.g. backend cold start). Skipped while paused so a driver who
      // just accepted a trip stays marked busy.
      setDriverAvailability(driverId, true).catch(() => {});
      try {
        const requests = await fetchRideRequests(driverId);
        if (cancelled || pausedRef.current) return;
        const req = requests[0];
        if (req && req.rideId !== handledRideRef.current) {
          handledRideRef.current = req.rideId;
          pausedRef.current = true;
          onOfferRef.current(rideRequestToOffer(req), driverId);
        }
      } catch {
        // Transient poll errors are ignored; next tick retries.
      }
    };

    const kickoff = setTimeout(tick, 800);
    intervalRef.current = setInterval(tick, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearTimeout(kickoff);
      clearTimer();
      // Best-effort: mark offline when leaving the online state.
      setDriverAvailability(driverId, false).catch(() => {});
    };
  }, [enabled, clearTimer]);

  return { resume };
}

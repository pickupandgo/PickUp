import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { TripController } from '../services/trip/TripController';
import {
  fetchRideRequests,
  getCurrentDriverId,
  rideRequestToOffer,
  setDriverAvailability,
} from '../services/engine/dispatch';
import type { TripOffer } from '../types/trip';

/** Dispatch only. The session-owned native service publishes GPS independently. */
const POLL_INTERVAL_MS = 3000;

export interface UseDriverDispatchParams {
  /** True while the driver is ONLINE / searching. */
  readonly enabled: boolean;
  /** Latest known driver location, or null if not available yet. */
  readonly getLocation: () => { latitude: number; longitude: number } | null | undefined;
  /** Called once per incoming ride request while online. */
  readonly onOffer: (offer: TripOffer, driverId: string) => void;
  readonly onAvailabilityError?: (error: unknown) => void;
}

export interface UseDriverDispatchResult {
  /**
   * Resume polling after an offer was dispatched (e.g. when the Home screen
   * regains focus after the driver declined or the offer expired).
   */
  readonly resume: () => void;
  readonly error: string | null;
}

/**
 * Keeps the driver advertised as available on the engine while online and
 * polls for incoming ride requests. On the first pending request it invokes
 * `onOffer` and pauses further offering until `resume()` is called.
 */
export function useDriverDispatch({
  enabled,
  onOffer,
  onAvailabilityError,
}: UseDriverDispatchParams): UseDriverDispatchResult {
  const [error, setError] = useState<string | null>(null);
  const resumeRef = useRef<() => void>(() => {});
  const onOfferRef = useRef(onOffer);
  onOfferRef.current = onOffer;
  const availabilityErrorRef = useRef(onAvailabilityError);
  availabilityErrorRef.current = onAvailabilityError;
  const resume = useCallback(() => resumeRef.current(), []);

  useEffect(() => {
    if (!enabled) return;
    const driverId = getCurrentDriverId();
    if (!driverId) return;
    let cancelled = false;
    let paused = false, inFlight = false, epoch = 0, lastAck = -Infinity;
    let interval: ReturnType<typeof setInterval> | undefined;
    const seen = new Map<string, number>();
    const foreground = () => AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
    const owns = (requestEpoch: number) => !cancelled && epoch === requestEpoch && foreground() && getCurrentDriverId() === driverId;
    const clear = () => { if (interval) clearInterval(interval); interval = undefined; };
    const tick = async () => {
      if (cancelled || paused || inFlight || !foreground() || getCurrentDriverId() !== driverId) return;
      const controller = TripController.getInstance();
      if (controller.getTrip() || controller.hasPendingAcceptance()) return;
      const requestEpoch = epoch;
      inFlight = true;
      try {
        // Rebuild process-local presence after an Engine restart, but await its real answer.
        if (Date.now() - lastAck >= 15_000) {
          try { await setDriverAvailability(driverId, true); }
          catch (cause) {
            if (owns(requestEpoch)) {
              setError('Availability could not be confirmed. Please retry.');
              availabilityErrorRef.current?.(cause);
            }
            return;
          }
          if (!owns(requestEpoch) || controller.getTrip() || controller.hasPendingAcceptance()) return;
          lastAck = Date.now();
        }
        const requests = await fetchRideRequests(driverId);
        if (!owns(requestEpoch) || paused || controller.getTrip() || controller.hasPendingAcceptance()) return;
        setError(null);
        for (const [key, expiry] of seen) if (expiry <= Date.now()) seen.delete(key);
        let missingDeadline = false;
        for (const request of requests) {
          const offer = rideRequestToOffer(request);
          if (!Number.isFinite(offer.expiresAt) || offer.expiresAt <= 0) { missingDeadline = true; continue; }
          if (offer.expiresAt <= Date.now()) continue;
          const key = offer.offerId ?? `${offer.id}:${offer.expiresAt}`;
          if (seen.has(key)) continue;
          seen.set(key, offer.expiresAt);
          paused = true;
          onOfferRef.current(offer, driverId);
          break;
        }
        if (missingDeadline && !paused) setError('Offer timing is unavailable. Please retry.');
      } catch {
        if (owns(requestEpoch)) setError('Offers could not be refreshed. Please retry.');
      } finally { inFlight = false; }
    };
    const start = () => {
      clear();
      if (!foreground()) return;
      void tick(); interval = setInterval(() => { void tick(); }, POLL_INTERVAL_MS);
    };
    resumeRef.current = () => { paused = false; lastAck = -Infinity; ++epoch; start(); };
    const subscription = AppState.addEventListener('change', state => {
      ++epoch;
      if (state === 'active') { lastAck = -Infinity; start(); } else clear();
    });
    start();
    return () => {
      cancelled = true; ++epoch; clear(); subscription.remove(); resumeRef.current = () => {};
      // Availability transitions belong to the acknowledged Home/logout path, not screen cleanup.
    };
  }, [enabled]);

  return { resume, error };
}

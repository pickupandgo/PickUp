import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { env } from '../config/env';
import { getPaymentsApi } from '../services/payments';
import type {
  CollectionMethodDto,
  DriverTripDto,
  PaymentGateDto,
} from '../services/payments/collectionsDto';
import {
  describePaymentsError,
  PaymentsApiError,
} from '../services/payments/paymentsErrors';
import type { ActiveTrip } from '../types/trip';

/*
 * The payment gate of the driver's current trip, read from the payment backend
 * (GET /v1/trips/:tripId) every 3 s while a pickup or drop screen is shown (review G). The gate is
 * the only source of whether an OTP can be entered and what can be collected. Errors back off;
 * returning to the app (e.g. after a lost connection) reads it again at once. Nothing is ever
 * assumed: until the gate is read, handovers stay locked.
 */

export type PaymentGateView =
  | { readonly kind: 'loading' }
  /** This build has no payment backend configured: handovers stay locked. */
  | { readonly kind: 'unavailable' }
  /** The payment backend has not confirmed the trip's assignment yet. */
  | { readonly kind: 'syncing' }
  | {
      readonly kind: 'ready';
      /** The engine trip this gate was read for. */
      readonly engineTripId: string;
      /** The payment backend's trip (its tripId is the one collections use). */
      readonly trip: DriverTripDto;
      readonly gate: PaymentGateDto;
    }
  /** Mock mode (no trip engine configured): a local demo trip, nothing to gate. */
  | { readonly kind: 'mock' };

export interface UsePaymentGateResult {
  readonly view: PaymentGateView;
  /** The gate, once read; null otherwise. */
  readonly gate: PaymentGateDto | null;
  /** The last read failed (the last gate read, if any, is still shown). */
  readonly error: string | null;
  /** How the confirmed payment was taken (CASH or ONLINE_QR), once known. */
  readonly paidWith: CollectionMethodDto | null;
  /** Read again now (e.g. a REFRESH button, or after a collection). */
  readonly refresh: () => void;
}

const POLL_INTERVAL_MS = 3_000;
const MAX_BACKOFF_MS = 30_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Engine trip -> payment backend trip: the engine's paymentTripId, falling back to the booking
 * reference (externalRef) among the driver's running trips.
 */
async function resolveBackendTripId(
  trip: ActiveTrip,
  api: NonNullable<ReturnType<typeof getPaymentsApi>>,
): Promise<string | null> {
  if (trip.paymentTripId && UUID_PATTERN.test(trip.paymentTripId)) {
    return trip.paymentTripId;
  }
  if (!trip.externalRef) {
    return null;
  }
  const running = await api.listActiveTrips();
  return running.find(t => t.externalRef === trip.externalRef)?.tripId ?? null;
}

export function usePaymentGate(
  trip: ActiveTrip | null,
  options: { readonly enabled?: boolean } = {},
): UsePaymentGateResult {
  const enabled = options.enabled ?? true;
  const [view, setView] = useState<PaymentGateView>(
    env.IS_MOCK_MODE ? { kind: 'mock' } : { kind: 'loading' },
  );
  const [error, setError] = useState<string | null>(null);
  const [paidWith, setPaidWith] = useState<CollectionMethodDto | null>(null);
  const [focused, setFocused] = useState(false);
  const [nonce, setNonce] = useState(0);

  const tripRef = useRef(trip);
  tripRef.current = trip;
  const backendTripId = useRef<{ engineId: string; id: string } | null>(null);
  const paidWithFor = useRef<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  // Back in the app (reconnected, unlocked): read the authoritative gate at once.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        setNonce(n => n + 1);
      }
    });
    return () => subscription.remove();
  }, []);

  const refresh = useCallback(() => setNonce(n => n + 1), []);

  const tripId = trip?.id ?? null;
  // Re-read as soon as the engine moves the trip (arrival, a new drop, ...).
  const progress = `${trip?.engineStatus ?? trip?.status ?? ''}:${
    trip?.currentStopIndex ?? ''
  }:${trip?.paymentTripId ?? ''}:${
    trip?.stops[trip?.currentStopIndex ?? 0]?.engineStatus ?? ''
  }`;

  useEffect(() => {
    if (env.IS_MOCK_MODE || !enabled || !focused || !tripId) {
      return undefined;
    }
    const api = getPaymentsApi();
    if (!api) {
      setView({ kind: 'unavailable' });
      return undefined;
    }
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;

    const schedule = () => {
      if (!active) {
        return;
      }
      const wait =
        failures === 0
          ? POLL_INTERVAL_MS
          : Math.min(MAX_BACKOFF_MS, POLL_INTERVAL_MS * 2 ** failures);
      timer = setTimeout(read, wait);
    };

    const read = async () => {
      const current = tripRef.current;
      if (!active || !current || current.id !== tripId) {
        return;
      }
      try {
        let id =
          backendTripId.current?.engineId === current.id
            ? backendTripId.current.id
            : null;
        if (!id) {
          id = await resolveBackendTripId(current, api);
          if (id) {
            backendTripId.current = { engineId: current.id, id };
          }
        }
        if (!active) {
          return;
        }
        if (!id) {
          setView({ kind: 'syncing' });
          setError(null);
          failures = 0;
          schedule();
          return;
        }
        const backendTrip = await api.getTrip(id);
        if (!active) {
          return;
        }
        const gate = backendTrip.payment.paymentGate;
        setView({
          kind: 'ready',
          engineTripId: current.id,
          trip: backendTrip,
          gate,
        });
        setError(null);
        failures = 0;
        if (
          gate.paymentState === 'PAYMENT_CONFIRMED' &&
          gate.collectionId &&
          paidWithFor.current !== gate.collectionId
        ) {
          const collectionId = gate.collectionId;
          paidWithFor.current = collectionId;
          api
            .getCollection(id, collectionId)
            .then(collection => {
              if (active) {
                setPaidWith(collection.method);
              }
            })
            .catch(() => {
              paidWithFor.current = null; // try again on a later read
            });
        } else if (gate.paymentState !== 'PAYMENT_CONFIRMED') {
          paidWithFor.current = null;
          setPaidWith(null);
        }
      } catch (e) {
        if (!active) {
          return;
        }
        failures += 1;
        setError(describePaymentsError(e));
        // A malformed gate is never used: handovers stay locked until a good read.
        const malformed =
          e instanceof PaymentsApiError && e.code === 'INVALID_RESPONSE';
        setView(previous =>
          previous.kind === 'ready' && !malformed
            ? previous
            : { kind: 'loading' },
        );
      }
      schedule();
    };

    read();
    return () => {
      active = false;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [enabled, focused, tripId, progress, nonce]);

  // A gate read for another trip is never shown for this one.
  const shown: PaymentGateView =
    view.kind === 'ready' && view.engineTripId !== tripId
      ? { kind: 'loading' }
      : view;
  return {
    view: shown,
    gate: shown.kind === 'ready' ? shown.gate : null,
    error,
    paidWith: shown.kind === 'ready' ? paidWith : null,
    refresh,
  };
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, BackHandler, AppState } from 'react-native';
import { CommonActions, useFocusEffect } from '@react-navigation/native';
import type { Ride } from '../api/types';
import { useBooking } from '../state/BookingContext';
import { findDriverAndCreateRide, NoDriversAvailableError } from '../api/matching';
import { collectionInstructions } from '../state/collectionPreference';
import { quoteMatchesDraft } from '../state/quoteValidation';
import { isQuoteBookable } from '../api/payments';
import { toApiError } from '../api/http';
import { leaveFailedSearch } from '../services/leaveFailedSearch';
import { resetBookingDestination } from '../services/bookingNavigation';
export function useBookingSearch(enabled: boolean, navigation: any, retrySearch = false) {
  const { draft, primaryDrop, customerId, setRide, ride: currentRide, pendingInput, rememberPendingInput, recoverBooking, clearActiveRide } = useBooking();
  const [retryKey, setRetryKey] = useState(0);
  const [failure, setFailure] = useState<string>();
  const [noDrivers, setNoDrivers] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const actionFlight = useRef(false);
  const restartPending = useRef(false);
  const retryRequested = useRef(false);
  const routeRetryConsumed = useRef(false);
  const alive = useRef(true);
  const leaveRequest = useRef<AbortController | undefined>(undefined);
  useEffect(() => { alive.current = true; return () => { alive.current = false; leaveRequest.current?.abort(); }; }, []);
  const [observation, setObservation] = useState<{ ride: Ride; receivedAt: number }>();
  const [active, setActive] = useState(() => AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  useEffect(() => { const sub = AppState.addEventListener('change', state => setActive(state !== 'background' && state !== 'inactive')); return () => sub.remove(); }, []);
  const [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  const pausedForCancellation = useRef(false);
  const abortRef = useRef<AbortController | undefined>(undefined);
  useEffect(() => navigation?.addListener?.('focus', () => {
    if (pausedForCancellation.current) { pausedForCancellation.current = false; setFailure(undefined); setRetryKey(n => n + 1); }
  }), [navigation]);
  /**
   * Creates or recovers one booking, then observes server-owned dispatch.
   */
  useEffect(() => {
    if (!enabled || !focused || !active) return;
    setObservation(undefined);
    setNoDrivers(false);
    setActionError(undefined);
    setFailure(undefined);
    const retryDispatch = retryRequested.current || (retrySearch && !routeRetryConsumed.current);
    retryRequested.current = false; routeRetryConsumed.current = true;
    const pickup = draft.pickup;
    const quote = draft.quote;
    const paymentMethod = draft.paymentMethod;
    if (!currentRide && !pendingInput && (!pickup || !primaryDrop || !customerId)) {
      restartPending.current = false;
      setFailure('Pickup and drop are required before booking.');
      return;
    }
    // The server fare quote and a chosen payment method are mandatory: no quote, no booking,
    // and the client never sends a fare. A stale quote is refused rather than silently booked.
    if (!currentRide && !pendingInput && (!quote || !isQuoteBookable(quote) || !quoteMatchesDraft(quote, draft) || !paymentMethod)) {
      restartPending.current = false;
      setFailure('Your fare has expired. Go back and get a new one.');
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    let cancelled = false;


    (async () => {
      try {
        const { ride } = await findDriverAndCreateRide(
          pendingInput ?? (quote && pickup && paymentMethod && !currentRide ? {
            quoteId: quote.quoteId,
            paymentMethod,
            metadata: {
              goodsType: draft.goodsType, goodsDescription: draft.goodsDescription,
              declaredValue: draft.declaredValue, specialInstructions: collectionInstructions(draft.specialInstructions, draft.collectionPreference),
              sender: { name: draft.senderName, phone: draft.senderPhone },
              pickupInstructions: draft.pickupInstructions,
            },
            pickup: { latitude: pickup.latitude, longitude: pickup.longitude, address: pickup.address },
            // Receiver details per drop, in the quote's order. Coordinates come from the quote.
            drops: draft.drops.map((d) => ({
              latitude: d.latitude, longitude: d.longitude,
              address: d.address,
              instructions: d.instructions,
              receiver:
                d.receiverName || d.receiverPhone
                  ? { name: d.receiverName, phone: d.receiverPhone }
                  : draft.receiverName || draft.receiverPhone
                    ? { name: draft.receiverName, phone: draft.receiverPhone }
                    : undefined,
            })),
          } : undefined),
          {
            existingRide: currentRide,
            onRequestSaved: input => { if (!cancelled && !controller.signal.aborted) rememberPendingInput?.(input); },
            retryDispatch,
            onRideCreated: current => { if (!cancelled && !controller.signal.aborted) { setObservation({ ride: current, receivedAt: Date.now() }); setRide(current); } },
            signal: controller.signal,
            searchCenter: pickup,

          }
        );

        if (cancelled || controller.signal.aborted) return;
        setRide(ride);
        // 5. Driver found has priority - immediately go to next screen
        resetBookingDestination(navigation, 'ActiveTripStack', 'DriverAssignedExpandedScreen');
      } catch (caught) {
        // 2. Handle AbortError Explicitly
        if (
          cancelled ||
          controller.signal.aborted ||
          (caught instanceof Error && caught.name === 'AbortError')
        ) {
          return;
        }

        // 1. NEVER classify network errors as No Driver
        if (!(caught instanceof NoDriversAvailableError)) {
          void recoverBooking?.();
          setFailure(toApiError(caught).userMessage);
          return;
        }

        setObservation(undefined);
        setNoDrivers(true);
      }
    })().finally(() => { if (!cancelled) restartPending.current = false; });

    return () => {
      cancelled = true;
      controller.abort();
      restartPending.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, retryKey, retrySearch, enabled, focused, active]);

  const handleCancel = useCallback(() => {
    pausedForCancellation.current = true;
    abortRef.current?.abort();
    resetBookingDestination(navigation, 'ActiveTripStack', 'CancellationReasonScreen', undefined, true);
  }, [navigation]);

  const leave = useCallback(async (destination: 'home' | 'vehicle') => {
    if (actionFlight.current || restartPending.current) return;
    actionFlight.current = true; setLeaving(true); setActionError(undefined);
    const controller = new AbortController(); leaveRequest.current = controller;
    try {
      const result = await leaveFailedSearch(customerId, currentRide, pendingInput, controller.signal);
      if (!alive.current || controller.signal.aborted) return;
      if (result.kind === 'active') {
        setRide(result.ride);
        if (result.ride.status === 'ACCEPTED') Alert.alert('Driver already assigned', 'Keep the booking or review cancellation.', [
          { text: 'Keep booking', style: 'cancel', onPress: () => resetBookingDestination(navigation, 'ActiveTripStack', 'DriverAssignedExpandedScreen') },
          { text: 'Review cancellation', onPress: () => resetBookingDestination(navigation, 'ActiveTripStack', 'CancellationReasonScreen', undefined, true) },
        ]);
        else { retryRequested.current = false; setNoDrivers(false); setRetryKey(n => n + 1); }
        return;
      }
      clearActiveRide(destination === 'vehicle' ? { preserveDraft: true } : undefined);
      if (destination === 'vehicle') resetBookingDestination(navigation, 'BookingStack', 'SelectVehicleScreen', { returnToReview: true });
      else (navigation?.getParent?.() ?? navigation)?.dispatch?.(CommonActions.reset({ index: 0, routes: [{ name: 'MainTabs', params: { screen: 'HomeScreen' } }] }));
    } catch (error) { if (alive.current && !controller.signal.aborted) setActionError(toApiError(error).userMessage); }
    finally { actionFlight.current = false; if (alive.current) setLeaving(false); }
  }, [customerId, currentRide, pendingInput, clearActiveRide, setRide, navigation]);
  const handleBackPress = useCallback(() => {
    if (noDrivers || (failure && !currentRide && !pendingInput)) { void leave('home'); return; }
    if (leaving) return;
    Alert.alert(
      'Cancel Booking?',
      'Are you sure you want to cancel the booking?',
      [
        {
          text: 'Keep Searching',
          style: 'cancel',
        },
        {
          text: 'Cancel Booking',
          style: 'destructive',
          onPress: () => {
            handleCancel();
          },
        },
      ],
      { cancelable: true }
    );
  }, [handleCancel, noDrivers, failure, currentRide, pendingInput, leave, leaving]);

  useFocusEffect(useCallback(() => {
    if (!enabled) return;
    const subscription = BackHandler?.addEventListener?.('hardwareBackPress', () => { handleBackPress(); return true; });
    const remove = navigation?.addListener?.('beforeRemove', (event: any) => {
      if (['GO_BACK', 'POP', 'POP_TO_TOP'].includes(event.data.action.type)) { event.preventDefault(); handleBackPress(); }
    });
    return () => { subscription?.remove?.(); remove?.(); };
  }, [handleBackPress, enabled, navigation]));

  const retry = useCallback(() => {
    if (actionFlight.current || restartPending.current) return;
    restartPending.current = true;
    retryRequested.current = noDrivers;
    setActionError(undefined); setFailure(undefined); setNoDrivers(false); setRetryKey(n => n + 1);
  }, [noDrivers]);
  return { failure, noDrivers, leaving, actionError, leave, retry, requestBack: handleBackPress, observation: enabled && focused && active && !failure && !noDrivers && !leaving ? observation : undefined };
}

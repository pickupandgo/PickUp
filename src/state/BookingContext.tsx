import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, useRef } from 'react';
import { getAuth, onAuthStateChanged } from '@react-native-firebase/auth';
import { recoverRide, getRideTrip } from '../api/engine';
import { bookingRevision, readPendingBooking, writePendingBooking } from './pendingBooking';
import type { CreateRideInput, FareQuote, GeoPoint, NearbyDriver, PaymentMethod, Ride, Trip } from '../api/types';
import { quoteMatchesDraft } from './quoteValidation';
import type { ResolvedPlace } from '../api/geocoding';

/**
 * Shared booking state.
 *
 * Screens previously read hardcoded mock data, so nothing a user chose survived a navigation.
 * The booking flow now prices the route with a server fare quote and confirms it with the
 * engine using {quoteId, paymentMethod}: those choices live here.
 *
 * The customer identity is the signed-in Firebase user (the token subject). It is never a
 * random local id and never a fare: the server owns every amount.
 */

export interface BookingDraft {
  readonly pickup?: ResolvedPlace;
  readonly drops: readonly ResolvedPlace[];
  /** Chosen in address search, not yet confirmed on the map step. */
  readonly pendingDrop?: ResolvedPlace;
  readonly vehicleType?: string;
  readonly weightKg?: number;
  readonly goodsDescription?: string;
  readonly declaredValue?: string;
  readonly goodsType?: string;
  readonly weightUnit?: 'kg' | 'lbs';
  readonly specialInstructions?: string;
  readonly insured?: boolean;
  readonly senderName?: string;
  readonly senderPhone?: string;
  readonly pickupInstructions?: string;
  readonly receiverName?: string;
  readonly receiverPhone?: string;
  /** The server fare quote. Discarded whenever the route, vehicle or weight changes. */
  readonly quote?: FareQuote;
  /** Exactly PAY_AT_PICKUP or PAY_AT_DELIVERY. No prepaid. */
  readonly paymentMethod?: PaymentMethod;
  /** Preferred collection channel; actual payment is confirmed only by the backend. */
  readonly collectionPreference?: 'CASH' | 'UPI';
}

const EMPTY_DRAFT: BookingDraft = { drops: [], paymentMethod: 'PAY_AT_DELIVERY', collectionPreference: 'CASH' };

interface BookingContextValue {
  readonly pendingInput?: CreateRideInput;
  readonly rememberPendingInput?: (input: CreateRideInput) => void;
  readonly recoveringBooking?: boolean;
  readonly bookingRecoveryError?: string;
  readonly recoverBooking?: () => Promise<void>;
  /** The signed-in customer's id (Firebase uid), or undefined when signed out. */
  readonly customerId: string | undefined;
  readonly draft: BookingDraft;
  /** First drop — used by the single-drop summary screens. */
  readonly primaryDrop: ResolvedPlace | undefined;
  /** True when pickup + at least one drop are set. */
  readonly canEstimate: boolean;

  readonly setPickup: (place: ResolvedPlace) => void;
  readonly setPendingDrop: (place: ResolvedPlace | undefined) => void;
  /** Moves the pending drop into the confirmed list. Returns it, or undefined. */
  readonly commitPendingDrop: () => ResolvedPlace | undefined;
  readonly addDrop: (place: ResolvedPlace) => void;
  readonly replaceDrop: (index: number, place: ResolvedPlace) => void;
  readonly removeDrop: (index: number) => void;
  readonly setVehicleType: (vehicleType: string) => void;
  readonly setGoods: (goods: {
    readonly weightKg?: number;
    readonly goodsDescription?: string;
    readonly declaredValue?: string;
    readonly goodsType?: string;
    readonly weightUnit?: 'kg' | 'lbs';
    readonly specialInstructions?: string;
  }) => void;
  readonly setInsured: (insured: boolean) => void;
  readonly setSender: (sender: { readonly name?: string; readonly phone?: string; readonly instructions?: string }) => void;
  readonly setReceiver: (receiver: { readonly name: string; readonly phone: string }) => void;
  /** Store a fresh server quote. */
  readonly setQuote: (quote: FareQuote | undefined) => void;
  readonly setPaymentMethod: (method: PaymentMethod | undefined) => void;
  readonly setCollectionPreference: (preference: 'CASH' | 'UPI') => void;
  readonly resetDraft: () => void;
  readonly startNewBooking: () => void;

  // Active ride / trip
  readonly ride: Ride | undefined;
  readonly trip: Trip | undefined;
  readonly assignedDriver: NearbyDriver | undefined;
  readonly setRide: (ride: Ride | undefined) => void;
  readonly setTrip: (trip: Trip | undefined) => void;
  readonly setAssignedDriver: (driver: NearbyDriver | undefined) => void;
  readonly clearActiveRide: (options?: { readonly preserveDraft?: boolean }) => void;
}

export const BookingContext = createContext<BookingContextValue | undefined>(undefined);

export const BookingProvider: React.FC<{ readonly children: React.ReactNode }> = ({ children }) => {
  const [customerId, setCustomerId] = useState<string | undefined>(() => getAuth().currentUser?.uid);
  useEffect(() => onAuthStateChanged(getAuth(), user => setCustomerId(user?.uid)), []);
  return <AccountBookingProvider key={customerId ?? 'signed-out'} customerId={customerId}>{children}</AccountBookingProvider>;
};

// Remount the entire state owner, including consumers, on every identity transition.
// Old async callbacks retain setters for an unmounted owner and cannot update the next account.
const AccountBookingProvider: React.FC<{ children: React.ReactNode; customerId?: string }> = ({ children, customerId }) => {
  const [draft, setDraft] = useState<BookingDraft>(EMPTY_DRAFT);
  const recoveryVersion = useRef(0);
  const [ride, storeRide] = useState<Ride>();
  const setRide = useCallback((next: Ride | undefined) => {
    recoveryVersion.current += 1;
    storeRide(next);
    setRecoveringBooking(false);
    setBookingRecoveryError(undefined);
  }, []);
  const [trip, setTrip] = useState<Trip>();
  const [assignedDriver, setAssignedDriver] = useState<NearbyDriver>();

  const [pendingInput, setPendingInput] = useState<CreateRideInput>();
  const [recoveringBooking, setRecoveringBooking] = useState(true);
  const [bookingRecoveryError, setBookingRecoveryError] = useState<string>();
  const alive = useRef(true);
  const recoveryFlight = useRef<Promise<void> | null>(null);
  const recoverBooking = useCallback((): Promise<void> => {
    if (!customerId) { setRecoveringBooking(false); return Promise.resolve(); }
    if (recoveryFlight.current) return recoveryFlight.current;
    setRecoveringBooking(true);
    const journalRevision = bookingRevision(customerId);
    const version = ++recoveryVersion.current;
    const current = () => alive.current && version === recoveryVersion.current && bookingRevision(customerId) === journalRevision;
    const controller = new AbortController();
    const task = (async () => {
      try {
        const saved = await readPendingBooking(customerId);
        if (!current()) return;
        setPendingInput(saved?.input);
        const found = await recoverRide(saved?.input.quoteId, controller.signal);
        if (!current()) return;
        const detail = found ?? saved?.input;
        if (detail?.pickup && typeof detail.pickup.latitude === 'number' && typeof detail.pickup.longitude === 'number') {
          const pickup = { latitude: detail.pickup.latitude, longitude: detail.pickup.longitude, address: detail.pickup.address ?? '' };
          const drops = detail.drops?.filter(drop => typeof drop.latitude === 'number' && typeof drop.longitude === 'number').map(drop => ({
            latitude: drop.latitude!, longitude: drop.longitude!, address: drop.address ?? '',
            receiverName: drop.receiver?.name, receiverPhone: drop.receiver?.phone, instructions: drop.instructions,
          })) ?? [];
          const metadata = detail.metadata;
          setDraft(previous => ({ ...previous, pickup, drops, quote: undefined,
            vehicleType: found?.vehicleType ?? previous.vehicleType,
            weightKg: found?.weight ?? previous.weightKg,
            goodsType: metadata?.goodsType, goodsDescription: metadata?.goodsDescription,
            declaredValue: metadata?.declaredValue, specialInstructions: metadata?.specialInstructions,
            senderName: metadata?.sender?.name, senderPhone: metadata?.sender?.phone,
            pickupInstructions: metadata?.pickupInstructions, paymentMethod: detail.paymentMethod,
          }));
        }
        if (!found && !saved && current()) { storeRide(undefined); setTrip(undefined); setAssignedDriver(undefined); }
        if (found) {
          if (found.status === 'CANCELLED' || found.bookingStatus === 'COMPLETED') {
            await writePendingBooking(customerId, null, journalRevision, { value: saved });
            if (alive.current && version === recoveryVersion.current && bookingRevision(customerId) === journalRevision + 1) { setPendingInput(undefined); storeRide(undefined); setTrip(undefined); setAssignedDriver(undefined); setRecoveringBooking(false); setBookingRecoveryError(undefined); }
          } else {
            const input = saved?.input ?? (found.quoteId && found.paymentMethod ? { quoteId: found.quoteId, paymentMethod: found.paymentMethod } : undefined);
            if (input) await writePendingBooking(customerId, { input, rideId: found.id }, journalRevision);
            if (!current()) return;
            setPendingInput(input); storeRide(found);
            if (found.status === 'ACCEPTED') {
              const restoredTrip = await getRideTrip(found.id, controller.signal);
              if (current() && restoredTrip) setTrip(restoredTrip);
            }
          }
        }
        if (current()) setBookingRecoveryError(saved && !found ? 'Your booking outcome is unconfirmed. Resume to retry using the same booking reference.' : undefined);
      } catch {
        if (current()) setBookingRecoveryError('Could not check your previous booking. Retry before starting another booking.');
      } finally { if (current()) setRecoveringBooking(false); }
    })();
    recoveryFlight.current = task;
    void task.finally(() => { if (recoveryFlight.current === task) recoveryFlight.current = null; });
    return task;
  }, [customerId]);
  useEffect(() => {
    alive.current = true;
    void recoverBooking();
    return () => { alive.current = false; };
  }, [recoverBooking]);

  const setPickup = useCallback((pickup: ResolvedPlace) => {
    setDraft((d) => ({ ...d, pickup, quote: undefined }));
  }, []);

  const addDrop = useCallback((place: ResolvedPlace) => {
    setDraft((d) => {
      if (d.drops.length >= 5) return d;
      return { ...d, drops: [...d.drops, place], quote: undefined };
    });
  }, []);

  const setPendingDrop = useCallback((pendingDrop: ResolvedPlace | undefined) => {
    setDraft((d) => ({ ...d, pendingDrop }));
  }, []);

  const commitPendingDrop = useCallback((): ResolvedPlace | undefined => {
    let committed: ResolvedPlace | undefined;
    setDraft((d) => {
      if (!d.pendingDrop || d.drops.length >= 5) return d;
      committed = d.pendingDrop;
      return {
        ...d,
        drops: [...d.drops, d.pendingDrop],
        pendingDrop: undefined,
        // A new drop changes the route, so any quote is stale.
        quote: undefined,
      };
    });
    return committed;
  }, []);

  const replaceDrop = useCallback((index: number, place: ResolvedPlace) => {
    setDraft((d) => {
      const drops = [...d.drops];
      if (index < 0 || index >= drops.length) return d;
      drops[index] = place;
      return { ...d, drops, quote: undefined };
    });
  }, []);

  const removeDrop = useCallback((index: number) => {
    setDraft((d) => ({ ...d, drops: d.drops.filter((_, i) => i !== index), quote: undefined }));
  }, []);

  const setVehicleType = useCallback((vehicleType: string) => {
    // Changing vehicle invalidates any quote already priced.
    setDraft((d) => ({ ...d, vehicleType, quote: undefined }));
  }, []);

  const setGoods = useCallback(
    (goods: {
      weightKg?: number;
      goodsDescription?: string;
      declaredValue?: string;
      goodsType?: string;
      weightUnit?: 'kg' | 'lbs';
      specialInstructions?: string;
    }) => {
      // Weight feeds the fare, so a change invalidates the quote.
      setDraft((d) => ({ ...d, ...goods, quote: goods.weightKg !== undefined && goods.weightKg !== d.weightKg ? undefined : d.quote }));
    },
    []
  );

  const setInsured = useCallback((insured: boolean) => {
    setDraft((d) => ({ ...d, insured }));
  }, []);

  const setSender = useCallback((sender: { name?: string; phone?: string; instructions?: string }) => {
    setDraft((d) => ({
      ...d,
      senderName: sender.name,
      senderPhone: sender.phone,
      pickupInstructions: sender.instructions,
    }));
  }, []);

  const setReceiver = useCallback((receiver: { name: string; phone: string }) => {
    setDraft((d) => ({ ...d, receiverName: receiver.name, receiverPhone: receiver.phone }));
  }, []);

  const setQuote = useCallback((quote: FareQuote | undefined) => {
    setDraft((d) => !quote || quoteMatchesDraft(quote, d) ? ({ ...d, quote }) : d);
  }, []);

  const setPaymentMethod = useCallback((paymentMethod: PaymentMethod | undefined) => {
    setDraft((d) => ({ ...d, paymentMethod }));
  }, []);

  const setCollectionPreference = useCallback((collectionPreference: 'CASH' | 'UPI') => {
    setDraft(d => ({ ...d, collectionPreference }));
  }, []);

  const resetDraft = useCallback(() => setDraft(EMPTY_DRAFT), []);

  const startNewBooking = useCallback(() => {
    setDraft((d) => ({
      ...EMPTY_DRAFT,
      pickup: d.pickup,
    }));
    setTrip((currentTrip) => {
      if (
        currentTrip &&
        currentTrip.status !== 'DELIVERED' &&
        currentTrip.status !== 'COMPLETED' &&
        currentTrip.status !== 'CANCELLED'
      ) {
        return currentTrip;
      }
      return undefined;
    });
  }, []);

  const clearActiveRide = useCallback((options?: { readonly preserveDraft?: boolean }) => {
    setRide(undefined);
    setTrip(undefined);
    setAssignedDriver(undefined);
    setDraft(current => options?.preserveDraft ? { ...current, quote: undefined, pendingDrop: undefined } : EMPTY_DRAFT);
    recoveryVersion.current += 1;
    setRecoveringBooking(false);
    setPendingInput(undefined);
    setBookingRecoveryError(undefined);
  }, []);

  const primaryDrop = draft.drops[0];

  const value = useMemo<BookingContextValue>(
    () => ({
      customerId, pendingInput, rememberPendingInput: setPendingInput, recoveringBooking, bookingRecoveryError, recoverBooking,
      draft,
      primaryDrop,
      canEstimate: Boolean(draft.pickup && draft.drops.length > 0),
      setPickup,
      setPendingDrop,
      commitPendingDrop,
      addDrop,
      replaceDrop,
      removeDrop,
      setVehicleType,
      setGoods,
      setInsured,
      setSender,
      setReceiver,
      setQuote,
      setPaymentMethod,
      setCollectionPreference,
      resetDraft,
      startNewBooking,
      ride,
      trip,
      assignedDriver,
      setRide,
      setTrip,
      setAssignedDriver,
      clearActiveRide,
    }),
    [
      customerId, pendingInput, recoveringBooking, bookingRecoveryError, recoverBooking,
      draft,
      primaryDrop,
      setPickup,
      setPendingDrop,
      commitPendingDrop,
      addDrop,
      replaceDrop,
      removeDrop,
      setVehicleType,
      setGoods,
      setInsured,
      setSender,
      setReceiver,
      setQuote,
      setPaymentMethod,
      setCollectionPreference,
      resetDraft,
      startNewBooking,
      ride,
      trip,
      assignedDriver,
      clearActiveRide,
    ]
  );

  return <BookingContext.Provider value={value}>{children}</BookingContext.Provider>;
};

export const useBooking = (): BookingContextValue => {
  const ctx = useContext(BookingContext);
  if (!ctx) {
    throw new Error('useBooking must be used inside <BookingProvider>. Check App.tsx.');
  }
  return ctx;
};

/** Coordinates only, for sending to the engine. */
export const toGeoPoint = (place: ResolvedPlace): GeoPoint => ({
  latitude: place.latitude,
  longitude: place.longitude,
  address: place.address,
});

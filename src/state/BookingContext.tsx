import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getAuth, onAuthStateChanged } from '@react-native-firebase/auth';
import type { FareQuote, GeoPoint, NearbyDriver, PaymentMethod, Ride, Trip } from '../api/types';
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
}

const EMPTY_DRAFT: BookingDraft = { drops: [] };

interface BookingContextValue {
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
  }) => void;
  readonly setInsured: (insured: boolean) => void;
  readonly setSender: (sender: { readonly name?: string; readonly phone?: string; readonly instructions?: string }) => void;
  readonly setReceiver: (receiver: { readonly name: string; readonly phone: string }) => void;
  /** Store a fresh server quote. */
  readonly setQuote: (quote: FareQuote | undefined) => void;
  readonly setPaymentMethod: (method: PaymentMethod | undefined) => void;
  readonly resetDraft: () => void;
  readonly startNewBooking: () => void;

  // Active ride / trip
  readonly ride: Ride | undefined;
  readonly trip: Trip | undefined;
  readonly assignedDriver: NearbyDriver | undefined;
  readonly setRide: (ride: Ride | undefined) => void;
  readonly setTrip: (trip: Trip | undefined) => void;
  readonly setAssignedDriver: (driver: NearbyDriver | undefined) => void;
  readonly clearActiveRide: () => void;
}

const BookingContext = createContext<BookingContextValue | undefined>(undefined);

export const BookingProvider: React.FC<{ readonly children: React.ReactNode }> = ({ children }) => {
  const [customerId, setCustomerId] = useState<string>();
  const [draft, setDraft] = useState<BookingDraft>(EMPTY_DRAFT);
  const [ride, setRide] = useState<Ride>();
  const [trip, setTrip] = useState<Trip>();
  const [assignedDriver, setAssignedDriver] = useState<NearbyDriver>();

  // The engine identifies the customer by the Firebase token; mirror its uid here for the
  // customer-scoped reads (GET /trips/active|history/customer/:id, which must be this user).
  useEffect(() => {
    const auth = getAuth();
    setCustomerId(auth.currentUser?.uid ?? undefined);
    return onAuthStateChanged(auth, (user) => setCustomerId(user?.uid ?? undefined));
  }, []);

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
    (goods: { weightKg?: number; goodsDescription?: string; declaredValue?: string }) => {
      // Weight feeds the fare, so a change invalidates the quote.
      setDraft((d) => ({ ...d, ...goods, quote: undefined }));
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
    setDraft((d) => ({ ...d, quote }));
  }, []);

  const setPaymentMethod = useCallback((paymentMethod: PaymentMethod | undefined) => {
    setDraft((d) => ({ ...d, paymentMethod }));
  }, []);

  const resetDraft = useCallback(() => setDraft(EMPTY_DRAFT), []);

  const startNewBooking = useCallback(() => {
    setDraft((d) => ({
      ...EMPTY_DRAFT,
      pickup: d.pickup,
    }));
    setRide(undefined);
    setTrip(undefined);
    setAssignedDriver(undefined);
  }, []);

  const clearActiveRide = useCallback(() => {
    setRide(undefined);
    setTrip(undefined);
    setAssignedDriver(undefined);
    setDraft(EMPTY_DRAFT);
  }, []);

  const primaryDrop = draft.drops[0];

  const value = useMemo<BookingContextValue>(
    () => ({
      customerId,
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
      customerId,
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

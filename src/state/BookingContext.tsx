import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { FareEstimate, GeoPoint, NearbyDriver, Ride, Trip } from '../api/types';
import type { ResolvedPlace } from '../api/geocoding';
import { getCustomerId } from './identity';

/**
 * Shared booking state.
 *
 * Screens previously read hardcoded mock data, so nothing a user chose survived
 * a navigation. The engine needs real coordinates, weight and vehicle type at
 * `POST /rides`, which means those choices have to live in one place.
 *
 * Scope note: the engine models a single pickup + single drop per ride. The
 * multi-drop screens stay in the UI for the future, but `drops` is capped at one
 * entry for anything sent to the backend — see `primaryDrop`.
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
  readonly receiverName?: string;
  readonly receiverPhone?: string;
  readonly fareEstimate?: FareEstimate;
}

const EMPTY_DRAFT: BookingDraft = { drops: [] };

interface BookingContextValue {
  readonly customerId: string | undefined;
  readonly draft: BookingDraft;
  /** First drop — the only one the engine supports today. */
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
  readonly setReceiver: (receiver: { readonly name: string; readonly phone: string }) => void;
  readonly setFareEstimate: (estimate: FareEstimate | undefined) => void;
  readonly resetDraft: () => void;

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

  useEffect(() => {
    let active = true;
    getCustomerId().then((id) => {
      if (active) setCustomerId(id);
    });
    return () => {
      active = false;
    };
  }, []);

  const setPickup = useCallback((pickup: ResolvedPlace) => {
    setDraft((d) => ({ ...d, pickup }));
  }, []);

  const addDrop = useCallback((place: ResolvedPlace) => {
    setDraft((d) => ({ ...d, drops: [...d.drops, place] }));
  }, []);

  const setPendingDrop = useCallback((pendingDrop: ResolvedPlace | undefined) => {
    setDraft((d) => ({ ...d, pendingDrop }));
  }, []);

  const commitPendingDrop = useCallback((): ResolvedPlace | undefined => {
    let committed: ResolvedPlace | undefined;
    setDraft((d) => {
      if (!d.pendingDrop) return d;
      committed = d.pendingDrop;
      return {
        ...d,
        drops: [...d.drops, d.pendingDrop],
        pendingDrop: undefined,
        // A new drop changes distance, so any quoted fare is stale.
        fareEstimate: undefined,
      };
    });
    return committed;
  }, []);

  const replaceDrop = useCallback((index: number, place: ResolvedPlace) => {
    setDraft((d) => {
      const drops = [...d.drops];
      if (index < 0 || index >= drops.length) return d;
      drops[index] = place;
      return { ...d, drops };
    });
  }, []);

  const removeDrop = useCallback((index: number) => {
    setDraft((d) => ({ ...d, drops: d.drops.filter((_, i) => i !== index) }));
  }, []);

  const setVehicleType = useCallback((vehicleType: string) => {
    // Changing vehicle invalidates any fare already quoted.
    setDraft((d) => ({ ...d, vehicleType, fareEstimate: undefined }));
  }, []);

  const setGoods = useCallback(
    (goods: { weightKg?: number; goodsDescription?: string; declaredValue?: string }) => {
      // Weight feeds the fare multiplier, so a change invalidates the quote.
      setDraft((d) => ({ ...d, ...goods, fareEstimate: undefined }));
    },
    []
  );

  const setInsured = useCallback((insured: boolean) => {
    setDraft((d) => ({ ...d, insured }));
  }, []);

  const setReceiver = useCallback((receiver: { name: string; phone: string }) => {
    setDraft((d) => ({ ...d, receiverName: receiver.name, receiverPhone: receiver.phone }));
  }, []);

  const setFareEstimate = useCallback((fareEstimate: FareEstimate | undefined) => {
    setDraft((d) => ({ ...d, fareEstimate }));
  }, []);

  const resetDraft = useCallback(() => setDraft(EMPTY_DRAFT), []);

  const clearActiveRide = useCallback(() => {
    setRide(undefined);
    setTrip(undefined);
    setAssignedDriver(undefined);
  }, []);

  const primaryDrop = draft.drops[0];

  const value = useMemo<BookingContextValue>(
    () => ({
      customerId,
      draft,
      primaryDrop,
      canEstimate: Boolean(draft.pickup && primaryDrop),
      setPickup,
      setPendingDrop,
      commitPendingDrop,
      addDrop,
      replaceDrop,
      removeDrop,
      setVehicleType,
      setGoods,
      setInsured,
      setReceiver,
      setFareEstimate,
      resetDraft,
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
      setReceiver,
      setFareEstimate,
      resetDraft,
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

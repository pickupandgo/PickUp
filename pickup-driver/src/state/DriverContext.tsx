import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getActiveTripForDriver,
  getPendingRequests,
  setDriverAvailability,
  updateDriverLocation,
  type RideRequestSummary,
} from '../api/driver';
import { toApiError, type ApiError } from '../api/http';
import type { GeoPoint, Trip } from '../api/types';

/**
 * Driver session.
 *
 * Staying online requires three things running together, which is why they all
 * live here rather than inside a screen:
 *   1. `PATCH /drivers/:id/availability` once, to mark the driver available
 *   2. `PATCH /drivers/:id/location` repeatedly, so the customer map can move
 *   3. `GET /ride-requests/:id` every few seconds — the engine's 60s staleness
 *      heartbeat, and also the request inbox
 *
 * Stop polling and the driver silently disappears from `/drivers/nearby`.
 */

const DRIVER_ID_KEY = 'pickupDriver.driverId';
/** Must stay well under the engine's 60s staleness window. */
const HEARTBEAT_MS = 3_000;
/** GPS push cadence. Frequent enough for the customer map to feel live. */
const LOCATION_PUSH_MS = 5_000;

interface DriverContextValue {
  readonly driverId: string;
  readonly setDriverId: (id: string) => void;
  readonly isOnline: boolean;
  readonly isBusy: boolean;
  readonly goOnline: () => Promise<void>;
  readonly goOffline: () => Promise<void>;
  readonly location: GeoPoint | undefined;
  readonly error: ApiError | undefined;
  /** Newest unanswered request. The engine only ever surfaces one. */
  readonly pendingRequest: RideRequestSummary | undefined;
  readonly dismissRequest: (rideId: string) => void;
  readonly activeTrip: Trip | undefined;
  readonly setActiveTrip: (trip: Trip | undefined) => void;
  readonly refreshActiveTrip: () => Promise<void>;
}

const DriverContext = createContext<DriverContextValue | undefined>(undefined);

export const DriverProvider: React.FC<{ readonly children: React.ReactNode }> = ({ children }) => {
  // Random default so multiple test phones don't collide. Range is wide
  // enough that ten testers together still have <1% collision odds. Override
  // via the Driver ID field on the home screen if you want a specific id.
  const [driverId, setDriverIdState] = useState(
    () => `D${Math.floor(1000 + Math.random() * 9000)}`
  );
  const [isOnline, setIsOnline] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [location, setLocation] = useState<GeoPoint>();
  const [error, setError] = useState<ApiError>();
  const [pendingRequest, setPendingRequest] = useState<RideRequestSummary>();
  const [activeTrip, setActiveTrip] = useState<Trip>();

  // Rides already answered or expired, so the popup won't reappear for them.
  const handledRef = useRef<Set<string>>(new Set());
  const watcherRef = useRef<Location.LocationSubscription | undefined>(undefined);
  const lastPushRef = useRef(0);

  useEffect(() => {
    AsyncStorage.getItem(DRIVER_ID_KEY)
      .then((stored) => {
        if (stored) setDriverIdState(stored);
      })
      .catch(() => undefined);
  }, []);

  const setDriverId = useCallback((id: string) => {
    const trimmed = id.trim() || 'D1';
    setDriverIdState(trimmed);
    void AsyncStorage.setItem(DRIVER_ID_KEY, trimmed).catch(() => undefined);
  }, []);

  const refreshActiveTrip = useCallback(async () => {
    try {
      setActiveTrip((await getActiveTripForDriver(driverId)) ?? undefined);
    } catch (caught) {
      setError(toApiError(caught));
    }
  }, [driverId]);

  /** Streams GPS and pushes it to the engine on a throttle. */
  const startLocationWatch = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== Location.PermissionStatus.GRANTED) {
      throw new Error('Location permission is required to go online.');
    }

    const first = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const startPoint: GeoPoint = {
      latitude: first.coords.latitude,
      longitude: first.coords.longitude,
    };
    setLocation(startPoint);
    await updateDriverLocation(driverId, startPoint);
    lastPushRef.current = Date.now();

    watcherRef.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, distanceInterval: 10, timeInterval: LOCATION_PUSH_MS },
      (position) => {
        const point: GeoPoint = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        setLocation(point);

        // watchPositionAsync can fire far more often than we want to POST.
        if (Date.now() - lastPushRef.current < LOCATION_PUSH_MS) return;
        lastPushRef.current = Date.now();
        void updateDriverLocation(driverId, point).catch(() => undefined);
      }
    );
  }, [driverId]);

  const stopLocationWatch = useCallback(() => {
    watcherRef.current?.remove();
    watcherRef.current = undefined;
  }, []);

  const goOnline = useCallback(async () => {
    setIsBusy(true);
    setError(undefined);
    try {
      await startLocationWatch();
      await setDriverAvailability(driverId, true);
      setIsOnline(true);
      await refreshActiveTrip();
    } catch (caught) {
      stopLocationWatch();
      setError(toApiError(caught));
      setIsOnline(false);
    } finally {
      setIsBusy(false);
    }
  }, [driverId, startLocationWatch, stopLocationWatch, refreshActiveTrip]);

  const goOffline = useCallback(async () => {
    setIsBusy(true);
    try {
      stopLocationWatch();
      await setDriverAvailability(driverId, false);
      setIsOnline(false);
      setPendingRequest(undefined);
    } catch (caught) {
      setError(toApiError(caught));
    } finally {
      setIsBusy(false);
    }
  }, [driverId, stopLocationWatch]);

  // Heartbeat + inbox. This is what keeps the driver visible to customers.
  useEffect(() => {
    if (!isOnline) return;
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      try {
        const requests = await getPendingRequests(driverId);
        if (cancelled) return;
        setError(undefined);

        const next = requests.find((r) => !handledRef.current.has(r.rideId));
        // Only swap when it's a different ride, so the countdown isn't reset
        // on every poll.
        setPendingRequest((existing) =>
          existing && next && existing.rideId === next.rideId ? existing : next
        );
      } catch (caught) {
        if (!cancelled) setError(toApiError(caught));
      }
    };

    void tick();
    const id = setInterval(tick, HEARTBEAT_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [isOnline, driverId]);

  // Active-trip watchdog. If the driver comes online with a trip already in
  // flight — e.g. because Metro reloaded mid-trip, or the engine outlived the
  // driver app — this catches it and repopulates `activeTrip` so the trip
  // screen can take over. Slower than the request inbox because trips move
  // less often, and it uses the same effective ping.
  useEffect(() => {
    if (!isOnline) return;
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      try {
        const trip = await getActiveTripForDriver(driverId);
        if (cancelled) return;
        setActiveTrip((existing) => {
          const next = trip ?? undefined;
          // Prefer the local value when it's the same trip already at the same
          // status — avoids reference-equality reshuffles that trigger re-renders
          // and camera refits downstream.
          if (existing && next && existing.id === next.id && existing.status === next.status) {
            return existing;
          }
          return next;
        });
      } catch {
        // Silent: the request inbox effect already surfaces network errors.
      }
    };

    void tick();
    const id = setInterval(tick, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [isOnline, driverId]);

  // Availability watchdog. The engine flips `isAvailable` to false the moment a
  // ride is accepted and does NOT flip it back when the trip finishes, so a
  // driver who finishes one trip stays invisible to customers until they toggle
  // offline+online. Once we see the active trip land in a terminal state, put
  // the driver back in the nearby pool.
  const lastRestoredForTripRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!isOnline || !activeTrip) return;
    const s = activeTrip.status;
    const isDone = s === 'COMPLETED' || s === 'CANCELLED' || s === 'DELIVERED';
    if (!isDone) return;
    // Guard so we only issue one restore call per trip.
    if (lastRestoredForTripRef.current === activeTrip.id) return;
    lastRestoredForTripRef.current = activeTrip.id;
    void setDriverAvailability(driverId, true).catch(() => undefined);
  }, [activeTrip, isOnline, driverId]);

  // Release the GPS watcher if the provider unmounts while online.
  useEffect(() => stopLocationWatch, [stopLocationWatch]);

  const dismissRequest = useCallback((rideId: string) => {
    handledRef.current.add(rideId);
    setPendingRequest((existing) => (existing?.rideId === rideId ? undefined : existing));
  }, []);

  const value = useMemo<DriverContextValue>(
    () => ({
      driverId,
      setDriverId,
      isOnline,
      isBusy,
      goOnline,
      goOffline,
      location,
      error,
      pendingRequest,
      dismissRequest,
      activeTrip,
      setActiveTrip,
      refreshActiveTrip,
    }),
    [
      driverId,
      setDriverId,
      isOnline,
      isBusy,
      goOnline,
      goOffline,
      location,
      error,
      pendingRequest,
      dismissRequest,
      activeTrip,
      refreshActiveTrip,
    ]
  );

  return <DriverContext.Provider value={value}>{children}</DriverContext.Provider>;
};

export const useDriver = (): DriverContextValue => {
  const ctx = useContext(DriverContext);
  if (!ctx) throw new Error('useDriver must be used inside <DriverProvider>.');
  return ctx;
};

import type { ActiveTrip } from '../../types/trip';
import { ArrivalDetectionService } from './ArrivalDetectionService';
import { TripService, type TripActionResult } from './TripService';
import { isOutcomeUnknown } from './tripErrors';

/**
 * The driver's current trip, as the engine last reported it, and the driver's trip actions.
 *
 * Contract G rules enforced here:
 *   - one engine step per action: arrive, pickup OTP and start are separate; a delivery never
 *     completes the trip (completeTrip is its own explicit action);
 *   - the trip shown is always the engine's answer, never a local guess; after any failure the
 *     trip is re-read so the screen shows where it really stands;
 *   - a second tap while the same action is running reuses the running request (no duplicate);
 *   - an older answer (a slow poll) never replaces a newer one.
 */
export class TripController {
  private static instance: TripController;
  private currentTrip: ActiveTrip | null = null;
  private listeners = new Set<(trip: ActiveTrip | null) => void>();
  private inFlight = new Map<string, Promise<unknown>>();

  private constructor() {}

  static getInstance(): TripController {
    if (!TripController.instance) {
      TripController.instance = new TripController();
    }
    return TripController.instance;
  }

  setTrip(trip: ActiveTrip | null) {
    this.currentTrip = trip;
    this.notifyListeners();
    ArrivalDetectionService.getInstance().syncTripState(trip);
  }

  getTrip(): ActiveTrip | null {
    return this.currentTrip;
  }

  subscribe(listener: (trip: ActiveTrip | null) => void) {
    this.listeners.add(listener);
    listener(this.currentTrip);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners() {
    this.listeners.forEach(listener => listener(this.currentTrip));
  }

  /** Applies a trip the engine returned, unless it is older than the one already shown. */
  private applyServerTrip(trip: ActiveTrip) {
    const current = this.currentTrip;
    if (
      current &&
      current.id === trip.id &&
      current.updatedAt !== undefined &&
      trip.updatedAt !== undefined &&
      trip.updatedAt < current.updatedAt
    ) {
      return;
    }
    this.setTrip(trip);
  }

  /** Runs `work` once per key at a time: a duplicate tap gets the running request's outcome. */
  private once<T>(key: string, work: () => Promise<T>): Promise<T> {
    const running = this.inFlight.get(key);
    if (running) {
      return running as Promise<T>;
    }
    const promise = work().finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, promise);
    return promise;
  }

  /** One engine step. On failure the trip is re-read and the error is passed on unchanged. */
  private act(
    key: string,
    tripId: string,
    work: () => Promise<TripActionResult>,
  ): Promise<TripActionResult> {
    return this.once(`${key}:${tripId}`, async () => {
      try {
        const result = await work();
        this.applyServerTrip(result.trip);
        return result;
      } catch (error) {
        // Never move forward on a failure: show what the engine has now.
        this.loadTrip(tripId).catch(() => undefined);
        throw error;
      }
    });
  }

  // ─── Driver actions ──────────────────────────────────────────────────────

  /**
   * Accept a ride offer. Returns the engine's trip (the same one for a repeated accept). With no
   * answer (timeout, network) the acceptance is never assumed: the driver's active trip is read,
   * and only a trip for this very ride counts.
   */
  acceptOffer(rideId: string): Promise<ActiveTrip> {
    return this.once(`accept:${rideId}`, async () => {
      const service = TripService.getInstance();
      let trip: ActiveTrip;
      try {
        trip = await service.acceptTrip(rideId);
      } catch (error) {
        if (!isOutcomeUnknown(error)) {
          throw error;
        }
        const active = await service.getActiveTrip().catch(() => null);
        if (!active || active.rideId !== rideId) {
          throw error;
        }
        trip = active;
      }
      this.applyServerTrip(trip);
      return trip;
    });
  }

  arriveAtPickup(tripId: string) {
    return this.act('arrive', tripId, () =>
      TripService.getInstance().arriveAtPickup(tripId),
    );
  }

  /** Pickup OTP only: the trip is started separately, by startTrip. */
  verifyPickupOTP(tripId: string, otp: string) {
    return this.act('pickup-otp', tripId, () =>
      TripService.getInstance().verifyPickupOTP(tripId, otp),
    );
  }

  startTrip(tripId: string) {
    return this.act('start', tripId, () =>
      TripService.getInstance().startTrip(tripId),
    );
  }

  /** Arrived at the current drop, or a retry of a failed delivery there. */
  arriveAtDrop(tripId: string, stopId: string) {
    return this.act(`stop-arrive:${stopId}`, tripId, () =>
      TripService.getInstance().arriveAtDrop(tripId, stopId),
    );
  }

  verifyDropOTP(tripId: string, stopId: string, otp: string) {
    return this.act(`stop-otp:${stopId}`, tripId, () =>
      TripService.getInstance().verifyDropOTP(tripId, stopId, otp),
    );
  }

  /**
   * Delivery with photo proof. Never completes the trip: when every drop is finished the engine
   * answers DELIVERED and the driver completes the trip with completeTrip.
   */
  confirmDropDelivery(tripId: string, stopId: string, photoUri: string) {
    return this.act(`stop-deliver:${stopId}`, tripId, () =>
      TripService.getInstance().confirmDropDelivery(tripId, stopId, photoUri),
    );
  }

  /** The receiver could not take the goods. The reason is required (3-200 characters). */
  failDrop(tripId: string, stopId: string, reason: string) {
    const text = reason.trim();
    if (text.length < 3 || text.length > 200) {
      return Promise.reject(
        new RangeError('A reason of 3-200 characters is required'),
      );
    }
    return this.act(`stop-fail:${stopId}`, tripId, () =>
      TripService.getInstance().failDrop(tripId, stopId, text),
    );
  }

  /** The explicit end of the trip. PENDING while the payment backend has not confirmed it. */
  completeTrip(tripId: string) {
    return this.act('complete', tripId, () =>
      TripService.getInstance().completeTrip(tripId),
    );
  }

  /**
   * Re-reads the trip through the engine, which follows what the payment backend decided (an
   * admin's retry or closure of a failed drop, a cancellation). Throws on failure.
   */
  refreshTrip(tripId: string): Promise<ActiveTrip> {
    return this.once(`refresh:${tripId}`, async () => {
      const trip = await TripService.getInstance().refreshTrip(tripId);
      this.applyServerTrip(trip);
      return trip;
    });
  }

  /** Clear the current trip (e.g. after returning home post-completion). */
  clearTrip() {
    this.setTrip(null);
  }

  async loadInitialTrip() {
    try {
      const trip = await TripService.getInstance().getActiveTrip();
      if (trip) {
        this.applyServerTrip(trip);
      }
    } catch (e) {
      console.warn('Failed to load initial active trip', e);
    }
  }

  /** Load a specific trip by id (e.g. the one the driver just accepted). Failures are silent. */
  async loadTrip(tripId: string) {
    try {
      await this.once(`load:${tripId}`, async () => {
        const trip = await TripService.getInstance().getTripById(tripId);
        if (trip) {
          this.applyServerTrip(trip);
        }
      });
    } catch (e) {
      console.warn('Failed to load trip', tripId, e);
    }
  }

  // Expose this for development/testing if needed, but primarily we rely on loadInitialTrip
  async loadMockTrip() {
    await this.loadInitialTrip();
  }
}

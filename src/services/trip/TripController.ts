import type { ActiveTrip } from '../../types/trip';
import { ArrivalDetectionService } from './ArrivalDetectionService';
import { TripService, type TripActionResult } from './TripService';
import { isOutcomeUnknown } from './tripErrors';
import { getAuth } from '@react-native-firebase/auth';
import { isTerminalTrip } from './tripLifecycle';

export interface TripResource {
  sessionUid: string | null;
  trip: ActiveTrip | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: unknown;
}

const signedInUid = (): string | null => {
  try { return getAuth().currentUser?.uid ?? null; } catch { return null; }
};

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
  private uid: string | null = null;
  private generation = 0;
  private revision = 0;
  private trips = new Map<string, ActiveTrip>();
  private loads = new Map<string, Pick<TripResource, 'status' | 'error'>>();
  private tripRevisions = new Map<string, number>();

  private constructor() {}

  static getInstance(): TripController {
    if (!TripController.instance) {
      TripController.instance = new TripController();
    }
    return TripController.instance;
  }

  /** Called synchronously at the Firebase identity boundary, before token restoration. */
  setSession(uid: string | null) {
    if (uid === this.uid) return;
    this.uid = uid;
    this.reset();
  }

  /** Compatibility for native/session teardown; clears every identity-scoped resource. */
  resetSession() { this.reset(); }

  private reset() {
    ++this.generation;
    ++this.revision;
    this.currentTrip = null;
    this.trips.clear();
    this.loads.clear();
    this.tripRevisions.clear();
    this.inFlight.clear();
    this.notifyListeners();
  }

  getSessionUid() {
    this.setSession(signedInUid());
    return this.uid;
  }

  private context() {
    this.getSessionUid();
    return { uid: this.uid, generation: this.generation };
  }

  private current(context: { uid: string | null; generation: number }) {
    this.getSessionUid();
    return context.uid !== null && context.uid === this.uid && context.generation === this.generation;
  }

  private assertCurrent(context: { uid: string | null; generation: number }) {
    if (!this.current(context)) throw new Error('Your sign-in session changed. Reload your trip.');
  }

  setTrip(trip: ActiveTrip | null) {
    this.getSessionUid();
    if (!this.uid) return;
    if (trip) this.applyServerTrip(trip, true);
    else this.retireActive();
  }

  getTrip(): ActiveTrip | null {
    this.getSessionUid();
    return this.currentTrip;
  }

  hasPendingAcceptance(): boolean {
    this.getSessionUid();
    return [...this.inFlight.keys()].some(key => key.startsWith('accept:'));
  }

  getResource(tripId?: string): TripResource {
    this.getSessionUid();
    const trip = tripId ? this.trips.get(tripId) ?? null : this.currentTrip;
    const load = this.loads.get(tripId ?? 'active');
    return { sessionUid: this.uid, trip, status: load?.status ?? (trip ? 'ready' : 'idle'), error: load?.error ?? null };
  }

  subscribe(listener: (trip: ActiveTrip | null) => void) {
    this.getSessionUid();
    this.listeners.add(listener);
    listener(this.currentTrip);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners() {
    this.listeners.forEach(listener => listener(this.currentTrip));
    void ArrivalDetectionService.getInstance().syncTripState(this.currentTrip).catch(() => {});
  }

  /** Applies a trip the engine returned, unless it is older than the one already shown. */
  private applyServerTrip(trip: ActiveTrip, activate = false) {
    const current = this.trips.get(trip.id);
    if (
      current &&
      current.id === trip.id &&
      current.updatedAt !== undefined &&
      trip.updatedAt !== undefined &&
      trip.updatedAt < current.updatedAt
    ) {
      return;
    }
    if (current && isTerminalTrip(current) && !isTerminalTrip(trip)) return;
    this.trips.set(trip.id, trip);
    this.loads.set(trip.id, { status: 'ready', error: null });
    ++this.revision;
    if (isTerminalTrip(trip)) {
      if (this.currentTrip?.id === trip.id) this.currentTrip = null;
    } else if (activate || this.currentTrip?.id === trip.id) {
      this.currentTrip = trip;
    }
    this.notifyListeners();
  }

  private retireActive() {
    if (this.currentTrip) {
      const id = this.currentTrip.id;
      this.tripRevisions.set(id, (this.tripRevisions.get(id) ?? 0) + 1);
      this.trips.delete(id);
      this.loads.set(id, { status: 'ready', error: null });
    }
    this.currentTrip = null;
    ++this.revision;
    this.notifyListeners();
  }

  /** Runs `work` once per key at a time: a duplicate tap gets the running request's outcome. */
  private once<T>(key: string, work: () => Promise<T>): Promise<T> {
    const context = this.context();
    if (!context.uid) return Promise.reject(new Error('Please sign in to load your trip.'));
    const running = this.inFlight.get(key);
    if (running) {
      return running as Promise<T>;
    }
    const promise = Promise.resolve().then(() => {
      this.assertCurrent(context);
      return work();
    }).then(result => {
      this.assertCurrent(context);
      return result;
    }).finally(() => {
      if (this.inFlight.get(key) === promise) this.inFlight.delete(key);
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
    const context = this.context();
    const tripRevision = this.tripRevisions.get(tripId);
    return this.once(`${key}:${tripId}`, async () => {
      try {
        const result = await work();
        this.assertCurrent(context);
        if (this.tripRevisions.get(tripId) !== tripRevision) throw new Error('This trip view was cleared. Reload it.');
        if (result.trip.id !== tripId) throw new Error('The server returned a different trip. Please retry.');
        this.applyServerTrip(result.trip, this.currentTrip === null);
        return result;
      } catch (error) {
        // Never move forward on a failure: show what the engine has now.
        if (this.current(context) && this.tripRevisions.get(tripId) === tripRevision)
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
    const context = this.context();
    return this.once(`accept:${rideId}`, async () => {
      const service = TripService.getInstance();
      let trip: ActiveTrip;
      try {
        trip = await service.acceptTrip(rideId);
      } catch (error) {
        this.assertCurrent(context);
        if (!isOutcomeUnknown(error)) {
          throw error;
        }
        const active = await service.getActiveTrip().catch(() => null);
        if (!active || active.rideId !== rideId) {
          throw error;
        }
        trip = active;
      }
      this.assertCurrent(context);
      if (trip.rideId && trip.rideId !== rideId) throw new Error('The server returned a different booking. Please reload.');
      this.applyServerTrip(trip, true);
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
    const context = this.context();
    const tripRevision = this.tripRevisions.get(tripId);
    return this.once(`refresh:${tripId}`, async () => {
      const trip = await TripService.getInstance().refreshTrip(tripId);
      this.assertCurrent(context);
      if (this.tripRevisions.get(tripId) !== tripRevision) throw new Error('This trip view was cleared. Reload it.');
      if (trip.id !== tripId) throw new Error('The server returned a different trip. Please retry.');
      this.applyServerTrip(trip, this.currentTrip === null);
      return trip;
    });
  }

  /** Clear the current trip (e.g. after returning home post-completion). */
  clearTrip(tripId?: string) {
    this.getSessionUid();
    if (!tripId) { this.reset(); return; }
    this.tripRevisions.set(tripId, (this.tripRevisions.get(tripId) ?? 0) + 1);
    this.trips.delete(tripId);
    this.loads.set(tripId, { status: 'ready', error: null });
    if (this.currentTrip?.id === tripId) this.currentTrip = null;
    ++this.revision;
    this.notifyListeners();
  }

  loadInitialTrip(): Promise<ActiveTrip | null> {
    return this.read();
  }

  /** Exact-id reads do not replace a different active trip. Errors remain retryable UI state. */
  loadTrip(tripId: string): Promise<ActiveTrip | null> {
    return this.read(tripId);
  }

  private read(tripId?: string): Promise<ActiveTrip | null> {
    const context = this.context();
    const key = tripId ?? 'active';
    return this.once(`read:${key}`, async () => {
      const revision = this.revision;
      const tripRevision = tripId ? this.tripRevisions.get(tripId) : undefined;
      this.loads.set(key, { status: 'loading', error: null });
      this.notifyListeners();
      try {
        const service = TripService.getInstance();
        const trip = await (tripId ? service.getTripById(tripId) : service.getActiveTrip());
        this.assertCurrent(context);
        if (tripId && this.tripRevisions.get(tripId) !== tripRevision) return null;
        if (tripId && trip && trip.id !== tripId) throw new Error('The server returned a different trip. Please retry.');
        // A response started before acceptance, completion or explicit clearing is obsolete.
        if (!tripId && revision !== this.revision) {
          this.loads.set(key, { status: 'ready', error: null });
          this.notifyListeners();
          return this.currentTrip;
        }
        if (trip) this.applyServerTrip(trip, !tripId);
        else if (!tripId) this.retireActive();
        else {
          this.trips.delete(tripId);
          if (this.currentTrip?.id === tripId) this.retireActive();
        }
        this.loads.set(key, { status: 'ready', error: null });
        this.notifyListeners();
        return trip;
      } catch (error) {
        if (this.current(context) && (!tripId || this.tripRevisions.get(tripId) === tripRevision)) {
          this.loads.set(key, { status: 'error', error });
          this.notifyListeners();
        }
        throw error;
      }
    });
  }

  // Expose this for development/testing if needed, but primarily we rely on loadInitialTrip
  async loadMockTrip() {
    await this.loadInitialTrip();
  }
}

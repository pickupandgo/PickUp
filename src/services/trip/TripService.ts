import * as engine from '../engine/dispatch';
import { env } from '../../config/env';
import type { ActiveTrip, HistoricalTrip, TripOffer } from '../../types/trip';
import { mockActiveTrip, mockHistoricalTrip } from '../../data/mockData';

/** What an engine action answered: the trip as the engine has it now. */
export interface TripActionResult {
  readonly trip: ActiveTrip;
  /** False when the engine had already recorded this step (a repeat changes nothing). */
  readonly changed: boolean;
  /** completeTrip only: COMPLETED, or PENDING while the payment backend has not confirmed. */
  readonly completion?: 'COMPLETED' | 'PENDING';
  /** completeTrip only: what the completion is waiting for. */
  readonly waitingFor?: string | null;
}

/**
 * The driver's trip actions. Each method is exactly one engine step (Contract G: never chain
 * arrive, OTP and start; never auto-complete). Results are the engine's state, never a local
 * guess; a failure always throws.
 */
export interface ITripService {
  getOffer(): Promise<TripOffer | null>;
  /** Accept a ride offer: the engine's trip for it (the same one if accepted before). */
  acceptTrip(rideId: string): Promise<ActiveTrip>;
  declineTrip(rideId: string): Promise<void>;
  arriveAtPickup(tripId: string): Promise<TripActionResult>;
  verifyPickupOTP(tripId: string, otp: string): Promise<TripActionResult>;
  startTrip(tripId: string): Promise<TripActionResult>;
  /** Arrived at the current drop, or a retry of a failed delivery there. */
  arriveAtDrop(tripId: string, stopId: string): Promise<TripActionResult>;
  verifyDropOTP(
    tripId: string,
    stopId: string,
    otp: string,
  ): Promise<TripActionResult>;
  confirmDropDelivery(
    tripId: string,
    stopId: string,
    photoUri: string,
  ): Promise<TripActionResult>;
  /** The receiver could not take the goods: reason required (3-200 characters). */
  failDrop(
    tripId: string,
    stopId: string,
    reason: string,
  ): Promise<TripActionResult>;
  /** Re-reads the trip through the engine, following what the payment backend decided. */
  refreshTrip(tripId: string): Promise<ActiveTrip>;
  completeTrip(tripId: string): Promise<TripActionResult>;
  getHistory(): Promise<HistoricalTrip[]>;
  getActiveTrip(): Promise<ActiveTrip | null>;
  getTripById(tripId: string): Promise<ActiveTrip | null>;
}

function delay(ms: number): Promise<void> {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

/** The mock trip as an engine trip, so mock mode follows the same one-step-per-action rules. */
function mockEngineTrip(): engine.EngineTrip {
  const [pickup, ...drops] = mockActiveTrip.stops;
  return {
    id: mockActiveTrip.id,
    rideId: `${mockActiveTrip.id}-ride`,
    driverId: 'mock-driver',
    externalRef: mockActiveTrip.id,
    paymentTripId: null,
    paymentMethod: 'PAY_AT_DELIVERY',
    pickup: {
      latitude: pickup.latitude,
      longitude: pickup.longitude,
      address: pickup.address,
    },
    stops: drops.map((drop, index) => ({
      id: drop.id,
      sequence: index + 1,
      location: {
        latitude: drop.latitude,
        longitude: drop.longitude,
        address: drop.address,
      },
      status: 'PENDING',
      otpVerified: false,
    })),
    currentStopIndex: 0,
    status: 'DRIVER_ASSIGNED',
    fare: mockActiveTrip.estimatedEarning,
    totalDistanceKm: mockActiveTrip.totalDistanceKm,
  };
}

/** Mock mode (no engine configured): a local simulation of the engine's rules. */
export class MockTripService implements ITripService {
  private trip: engine.EngineTrip = mockEngineTrip();

  private result(changed: boolean): TripActionResult {
    return { trip: engine.engineTripToActiveTrip(this.trip), changed };
  }

  private refuse(message: string): never {
    throw new Error(message);
  }

  private update(
    patch: Partial<engine.EngineTrip>,
    stopPatch?: Partial<engine.EngineStop>,
  ) {
    const stops = stopPatch
      ? this.trip.stops.map((stop, index) =>
          index === this.trip.currentStopIndex
            ? { ...stop, ...stopPatch }
            : stop,
        )
      : this.trip.stops;
    this.trip = { ...this.trip, ...patch, stops };
  }

  private currentStop(stopId: string): engine.EngineStop {
    const stop = this.trip.stops[this.trip.currentStopIndex];
    if (!stop || stop.id !== stopId) {
      return this.refuse('Stop ID mismatch');
    }
    return stop;
  }

  async getOffer(): Promise<TripOffer | null> {
    await delay(500);
    return null;
  }

  async acceptTrip(_rideId: string): Promise<ActiveTrip> {
    await delay(500);
    this.trip = mockEngineTrip();
    return engine.engineTripToActiveTrip(this.trip);
  }

  async declineTrip(_rideId: string): Promise<void> {
    await delay(500);
  }

  async arriveAtPickup(_tripId: string): Promise<TripActionResult> {
    await delay(500);
    if (this.trip.status !== 'DRIVER_ASSIGNED') {
      return this.result(false);
    }
    this.update({ status: 'DRIVER_ARRIVED' });
    return this.result(true);
  }

  async verifyPickupOTP(
    _tripId: string,
    otp: string,
  ): Promise<TripActionResult> {
    await delay(800);
    if (this.trip.status !== 'DRIVER_ARRIVED') {
      return this.trip.status === 'DRIVER_ASSIGNED'
        ? this.refuse('Invalid trip state transition')
        : this.result(false);
    }
    if (!/^\d{4}$/.test(otp)) {
      return this.refuse('Invalid OTP');
    }
    this.update({ status: 'PICKUP_VERIFIED' });
    return this.result(true);
  }

  async startTrip(_tripId: string): Promise<TripActionResult> {
    await delay(500);
    if (this.trip.status !== 'PICKUP_VERIFIED') {
      return this.trip.status === 'IN_TRANSIT'
        ? this.result(false)
        : this.refuse('startTrip requires PICKUP_VERIFIED status');
    }
    this.update({ status: 'IN_TRANSIT' }, { status: 'IN_TRANSIT' });
    return this.result(true);
  }

  async arriveAtDrop(
    _tripId: string,
    stopId: string,
  ): Promise<TripActionResult> {
    await delay(500);
    const stop = this.currentStop(stopId);
    if (stop.status === 'ARRIVED') {
      return this.result(false);
    }
    if (stop.status !== 'IN_TRANSIT' && stop.status !== 'DELIVERY_FAILED') {
      return this.refuse(`Stop ${stop.sequence} cannot be arrived at`);
    }
    this.update(
      { status: 'DROP_PROGRESS' },
      { status: 'ARRIVED', otpVerified: false },
    );
    return this.result(true);
  }

  async verifyDropOTP(
    _tripId: string,
    stopId: string,
    otp: string,
  ): Promise<TripActionResult> {
    await delay(800);
    const stop = this.currentStop(stopId);
    if (stop.status !== 'ARRIVED') {
      return this.refuse(`Stop ${stop.sequence} is not ready for its OTP`);
    }
    if (!/^\d{4}$/.test(otp)) {
      return this.refuse('Invalid OTP');
    }
    if (stop.otpVerified) {
      return this.result(false);
    }
    this.update({}, { otpVerified: true });
    return this.result(true);
  }

  async confirmDropDelivery(
    _tripId: string,
    stopId: string,
    photoUri: string,
  ): Promise<TripActionResult> {
    await delay(800);
    const delivered = this.trip.stops.find(stop => stop.id === stopId);
    if (delivered?.status === 'DELIVERED') {
      return this.result(false);
    }
    const stop = this.currentStop(stopId);
    if (stop.status !== 'ARRIVED' || !stop.otpVerified || !photoUri) {
      return this.refuse(`Stop ${stop.sequence} cannot be delivered yet`);
    }
    this.update({}, { status: 'DELIVERED' });
    const next = this.trip.stops.findIndex(
      s => !engine.FINAL_STOP_STATUSES.has(s.status),
    );
    if (next === -1) {
      this.update({ status: 'DELIVERED' });
    } else {
      this.trip = {
        ...this.trip,
        status: 'IN_TRANSIT',
        currentStopIndex: next,
        stops: this.trip.stops.map((s, index) =>
          index === next && s.status === 'PENDING'
            ? { ...s, status: 'IN_TRANSIT' }
            : s,
        ),
      };
    }
    return this.result(true);
  }

  async failDrop(
    _tripId: string,
    stopId: string,
    reason: string,
  ): Promise<TripActionResult> {
    await delay(500);
    const stop = this.currentStop(stopId);
    if (stop.status === 'DELIVERY_FAILED') {
      return this.result(false);
    }
    if (stop.status !== 'ARRIVED') {
      return this.refuse(`Stop ${stop.sequence} must be ARRIVED`);
    }
    this.update(
      {},
      { status: 'DELIVERY_FAILED', failureReason: reason, otpVerified: false },
    );
    return this.result(true);
  }

  async refreshTrip(_tripId: string): Promise<ActiveTrip> {
    await delay(300);
    return engine.engineTripToActiveTrip(this.trip);
  }

  async completeTrip(_tripId: string): Promise<TripActionResult> {
    await delay(800);
    if (this.trip.status === 'COMPLETED') {
      return { ...this.result(false), completion: 'COMPLETED' };
    }
    if (this.trip.status !== 'DELIVERED') {
      return this.refuse('Cannot complete trip: stops still pending delivery');
    }
    this.update({ status: 'COMPLETED' });
    return { ...this.result(true), completion: 'COMPLETED' };
  }

  async getHistory(): Promise<HistoricalTrip[]> {
    await delay(800);
    return [mockHistoricalTrip];
  }

  async getActiveTrip(): Promise<ActiveTrip | null> {
    await delay(500);
    return engine.engineTripToActiveTrip(this.trip);
  }

  async getTripById(_tripId: string): Promise<ActiveTrip | null> {
    await delay(500);
    return engine.engineTripToActiveTrip(this.trip);
  }
}

function requireDriverId(): string {
  const driverId = engine.getCurrentDriverId();
  if (!driverId) {
    throw new Error('Driver is not signed in');
  }
  return driverId;
}

const toResult = (result: engine.EngineActionResult): TripActionResult => ({
  trip: engine.engineTripToActiveTrip(result.trip),
  changed: result.changed,
  completion: result.completion,
  waitingFor: result.waitingFor,
});

/**
 * Trip service backed by the trip engine (Phase 8 contract). Offers come from the dispatch
 * polling layer (useDriverDispatch), so getOffer() is a no-op. Every action is one engine call,
 * authenticated as the signed-in driver.
 */
export class ApiTripService implements ITripService {
  async getOffer(): Promise<TripOffer | null> {
    return null;
  }

  async acceptTrip(rideId: string): Promise<ActiveTrip> {
    const accepted = await engine.acceptRideRequest(rideId);
    const trip =
      accepted ?? (await engine.getActiveTripForDriver(requireDriverId()));
    if (!trip) {
      throw new Error('Trip not found after accepting');
    }
    return engine.engineTripToActiveTrip(trip);
  }

  async declineTrip(rideId: string): Promise<void> {
    await engine.rejectRideRequest(rideId).catch(() => undefined);
  }

  async arriveAtPickup(tripId: string): Promise<TripActionResult> {
    return toResult(await engine.arriveAtPickup(tripId));
  }

  async verifyPickupOTP(
    tripId: string,
    otp: string,
  ): Promise<TripActionResult> {
    return toResult(await engine.verifyPickupOtp(tripId, otp));
  }

  async startTrip(tripId: string): Promise<TripActionResult> {
    return toResult(await engine.startTrip(tripId));
  }

  async arriveAtDrop(
    tripId: string,
    stopId: string,
  ): Promise<TripActionResult> {
    return toResult(await engine.arriveAtStop(tripId, stopId));
  }

  async verifyDropOTP(
    tripId: string,
    stopId: string,
    otp: string,
  ): Promise<TripActionResult> {
    return toResult(await engine.verifyStopOtp(tripId, stopId, otp));
  }

  async confirmDropDelivery(
    tripId: string,
    stopId: string,
    photoUri: string,
  ): Promise<TripActionResult> {
    return toResult(await engine.confirmStopDelivery(tripId, stopId, photoUri));
  }

  async failDrop(
    tripId: string,
    stopId: string,
    reason: string,
  ): Promise<TripActionResult> {
    return toResult(await engine.failStop(tripId, stopId, reason));
  }

  async refreshTrip(tripId: string): Promise<ActiveTrip> {
    return engine.engineTripToActiveTrip(await engine.refreshTrip(tripId));
  }

  async completeTrip(tripId: string): Promise<TripActionResult> {
    return toResult(await engine.completeTrip(tripId));
  }

  async getHistory(): Promise<HistoricalTrip[]> {
    const driverId = engine.getCurrentDriverId();
    if (!driverId) {
      return [];
    }
    return engine.getDriverTripHistory(driverId);
  }

  async getActiveTrip(): Promise<ActiveTrip | null> {
    const driverId = engine.getCurrentDriverId();
    if (!driverId) {
      return null;
    }
    const trip = await engine.getActiveTripForDriver(driverId);
    return trip ? engine.engineTripToActiveTrip(trip) : null;
  }

  async getTripById(tripId: string): Promise<ActiveTrip | null> {
    return engine.engineTripToActiveTrip(await engine.getTripById(tripId));
  }
}

export class TripService {
  private static instance: ITripService;

  static getInstance(): ITripService {
    if (!TripService.instance) {
      TripService.instance = env.IS_MOCK_MODE
        ? new MockTripService()
        : new ApiTripService();
    }
    return TripService.instance;
  }
}

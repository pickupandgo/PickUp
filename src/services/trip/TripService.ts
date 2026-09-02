import * as engine from '../engine/dispatch';
import { env } from '../../config/env';
import type { ActiveTrip, HistoricalTrip, TripOffer } from '../../types/trip';
import { mockActiveTrip, mockHistoricalTrip } from '../../data/mockData';

export interface UpdateStatePayload {
  otp?: string;
  [key: string]: unknown;
}

export interface ITripService {
  getOffer(): Promise<TripOffer | null>;
  acceptTrip(tripId: string): Promise<ActiveTrip>;
  declineTrip(tripId: string): Promise<void>;
  updateState(tripId: string, state: ActiveTrip['status'], payload?: UpdateStatePayload): Promise<ActiveTrip>;
  getHistory(): Promise<HistoricalTrip[]>;
  getActiveTrip(): Promise<ActiveTrip | null>;
  getTripById(tripId: string): Promise<ActiveTrip | null>;
}

function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export class MockTripService implements ITripService {
  async getOffer(): Promise<TripOffer | null> {
    await delay(500);
    return null;
  }

  async acceptTrip(_tripId: string): Promise<ActiveTrip> {
    await delay(500);
    return { ...mockActiveTrip, status: 'en_route_pickup' };
  }

  async declineTrip(_tripId: string): Promise<void> {
    await delay(500);
  }

  async updateState(_tripId: string, state: ActiveTrip['status'], _payload?: UpdateStatePayload): Promise<ActiveTrip> {
    await delay(800);
    return { ...mockActiveTrip, status: state };
  }

  async getHistory(): Promise<HistoricalTrip[]> {
    await delay(800);
    return [mockHistoricalTrip];
  }

  async getActiveTrip(): Promise<ActiveTrip | null> {
    await delay(500);
    return mockActiveTrip;
  }

  async getTripById(_tripId: string): Promise<ActiveTrip | null> {
    await delay(500);
    return mockActiveTrip;
  }
}

/**
 * Real trip service backed by the Pickup-Go Core Engine.
 *
 * Offers are surfaced by the polling layer (useDriverDispatch), so getOffer()
 * is a no-op here. Accept/decline and the post-accept lifecycle map onto the
 * engine's /rides and /trips endpoints.
 */
export class ApiTripService implements ITripService {
  async getOffer(): Promise<TripOffer | null> {
    // Incoming offers are delivered via the dispatch polling layer.
    return null;
  }

  async acceptTrip(rideId: string): Promise<ActiveTrip> {
    const driverId = engine.getCurrentDriverId();
    if (!driverId) throw new Error('Driver is not authenticated');
    await engine.acceptRideRequest(rideId, driverId);
    const trip = await engine.getActiveTripForDriver(driverId);
    if (!trip) throw new Error('Trip not found after accepting');
    return engine.engineTripToActiveTrip(trip);
  }

  async declineTrip(rideId: string): Promise<void> {
    const driverId = engine.getCurrentDriverId();
    if (driverId) {
      await engine.rejectRideRequest(rideId, driverId).catch(() => {});
    }
  }

  async updateState(
    tripId: string,
    state: ActiveTrip['status'],
    payload?: UpdateStatePayload,
  ): Promise<ActiveTrip> {
    const driverId = engine.getCurrentDriverId();
    if (!driverId) throw new Error('Driver is not authenticated');

    const targetByState: Partial<Record<ActiveTrip['status'], string>> = {
      arrived_pickup: 'DRIVER_ARRIVED',
      pickup_verified: 'PICKUP_VERIFIED',
      in_transit: 'IN_TRANSIT',
      arrived_drop: 'DROP_PROGRESS',
      drop_verified: 'DELIVERED',
      completed: 'COMPLETED',
    };

    const target = targetByState[state];
    let trip: engine.EngineTrip;
    if (target) {
      trip = await engine.advanceTripTo(tripId, driverId, target, payload?.otp);
    } else {
      const current = await engine.getTripById(tripId);
      if (!current) throw new Error('Trip not found');
      trip = current;
    }
    return engine.engineTripToActiveTrip(trip);
  }

  async getHistory(): Promise<HistoricalTrip[]> {
    // The engine has no driver trip-history endpoint yet.
    return [];
  }

  async getActiveTrip(): Promise<ActiveTrip | null> {
    const driverId = engine.getCurrentDriverId();
    if (!driverId) return null;
    const trip = await engine.getActiveTripForDriver(driverId);
    return trip ? engine.engineTripToActiveTrip(trip) : null;
  }

  async getTripById(tripId: string): Promise<ActiveTrip | null> {
    const trip = await engine.getTripById(tripId);
    return trip ? engine.engineTripToActiveTrip(trip) : null;
  }
}

export class TripService {
  private static instance: ITripService;

  static getInstance(): ITripService {
    if (!TripService.instance) {
      TripService.instance = env.IS_MOCK_MODE ? new MockTripService() : new ApiTripService();
    }
    return TripService.instance;
  }
}
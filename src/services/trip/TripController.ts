import type { ActiveTrip } from '../../types/trip';
import { ArrivalDetectionService } from './ArrivalDetectionService';
import { TripService } from './TripService';

export class TripController {
  private static instance: TripController;
  private currentTrip: ActiveTrip | null = null;
  private listeners = new Set<(trip: ActiveTrip | null) => void>();

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
    this.listeners.forEach((listener) => listener(this.currentTrip));
  }

  // Application actions
  async acceptOffer(tripId: string) {
    const activeTrip = await TripService.getInstance().acceptTrip(tripId);
    this.setTrip(activeTrip);
  }

  async verifyPickupOTP(tripId: string, otp: string) {
    const updatedTrip = await TripService.getInstance().updateState(tripId, 'in_transit', { otp });
    this.setTrip(updatedTrip);
  }

  /** Driver reached / started the drop (engine: IN_TRANSIT -> DROP_PROGRESS). */
  async startDrop(tripId: string) {
    const updatedTrip = await TripService.getInstance().updateState(tripId, 'arrived_drop');
    this.setTrip(updatedTrip);
  }

  /** Finish the trip (engine drives drop-progress -> delivered -> completed). */
  async completeTrip(tripId: string) {
    const updatedTrip = await TripService.getInstance().updateState(tripId, 'completed');
    this.setTrip(updatedTrip);
  }

  /** Clear the current trip (e.g. after returning home post-completion). */
  clearTrip() {
    this.setTrip(null);
  }

  async loadInitialTrip() {
    try {
      const trip = await TripService.getInstance().getActiveTrip();
      if (trip) {
        this.setTrip(trip);
      }
    } catch (e) {
      console.warn('Failed to load initial active trip', e);
    }
  }

  /** Load a specific trip by id (the one the driver just accepted). */
  async loadTrip(tripId: string) {
    try {
      const trip = await TripService.getInstance().getTripById(tripId);
      if (trip) {
        this.setTrip(trip);
      }
    } catch (e) {
      console.warn('Failed to load trip', tripId, e);
    }
  }

  // Expose this for development/testing if needed, but primarily we rely on loadInitialTrip
  async loadMockTrip() {
    await this.loadInitialTrip();
  }
}

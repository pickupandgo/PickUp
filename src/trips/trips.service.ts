import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { Trip, TripStatus, TripStop, TripStopPublic } from './trips.types';
import { TripStateService } from './trip-state.service';
import { DriversService } from '../drivers/drivers.service';

@Injectable()
export class TripsService {
  private trips: Trip[] = [];
  private tripCounter = 0;
  private stopCounter = 0;
  private tripHistory: Trip[] = []; // Completed + Cancelled trips for history

  constructor(
    private tripStateService: TripStateService,
    private driversService: DriversService
  ) {}

  private generateOtp(): string {
    return Math.floor(1000 + Math.random() * 9000).toString();
  }

  createTrip(ride: any): Trip {
    this.tripCounter++;
    const now = new Date().toISOString();

    // Build stops from ride.drops (or fallback to single ride.drop)
    const dropLocations = ride.drops && ride.drops.length > 0 ? ride.drops : [ride.drop];
    
    const stops: TripStop[] = dropLocations.map((loc: any, index: number) => {
      this.stopCounter++;
      
      let legInfo = {};
      if (ride.legs && ride.legs[index]) {
        legInfo = {
          distanceFromPreviousStopKm: ride.legs[index].distanceKm,
          fareFromPreviousStop: ride.legs[index].fare,
        };
      }
      
      return {
        id: `S${this.stopCounter}`,
        sequence: index + 1,
        location: {
          latitude: loc.latitude,
          longitude: loc.longitude,
          address: loc.address,
        },
        // Preserve per-stop receiver details (INVARIANT: each stop owns its own receiver)
        receiver: loc.receiver ? { name: loc.receiver.name, phone: loc.receiver.phone } : undefined,
        status: 'PENDING' as const,
        otp: ride.stopOtps && ride.stopOtps[index] ? ride.stopOtps[index] : this.generateOtp(),
        ...legInfo
      };
    });

    const trip: Trip = {
      id: `T${this.tripCounter}`,
      rideId: ride.id,
      customerId: ride.customerId,
      driverId: ride.assignedDriverId,
      pickup: ride.pickup,
      drop: dropLocations[0],  // backward compat: first drop
      stops,
      currentStopIndex: 0,
      status: 'DRIVER_ASSIGNED',
      weight: ride.weight,
      fare: ride.fare,
      totalDistanceKm: ride.totalDistanceKm,
      otp: ride.otp,           // legacy pickup OTP
      createdAt: now,
      updatedAt: now,
    };
    this.trips.push(trip);
    return trip;
  }

  /**
   * Sanitize a trip for public API responses:
   * - Strips all stop.otp values (never expose OTPs to clients)
   * - Strips internal pickup OTP (trip.otp)
   * - Adds derived summary stats:
   *     totalStops, completedStops, remainingStops
   * - Returns structured currentStop without OTP
   */
  sanitizeTrip(trip: Trip) {
    const sanitizedStops: TripStopPublic[] = trip.stops.map(stop => ({
      id: stop.id,
      sequence: stop.sequence,
      location: stop.location,
      receiver: stop.receiver,
      status: stop.status,
      distanceFromPreviousStopKm: stop.distanceFromPreviousStopKm,
      fareFromPreviousStop: stop.fareFromPreviousStop,
      arrivedAt: stop.arrivedAt,
      deliveredAt: stop.deliveredAt,
      otpVerified: stop.otpVerified,
      deliveryProof: stop.deliveryProof,
      // otp intentionally omitted
    }));

    const completedStops = trip.stops.filter(s => s.status === 'DELIVERED').length;
    const currentStop = sanitizedStops[trip.currentStopIndex] || null;

    return {
      id: trip.id,
      rideId: trip.rideId,
      customerId: trip.customerId,
      driverId: trip.driverId,
      pickup: trip.pickup,
      drop: trip.drop,           // backward compat
      stops: sanitizedStops,
      currentStopIndex: trip.currentStopIndex,
      currentStop,
      // Summary stats (derived — no new source of truth)
      totalStops: trip.stops.length,
      completedStops,
      remainingStops: trip.stops.length - completedStops,
      status: trip.status,
      weight: trip.weight,
      fare: trip.fare,
      totalDistanceKm: trip.totalDistanceKm,
      // otp intentionally omitted — driver must enter OTP from customer verbally
      createdAt: trip.createdAt,
      updatedAt: trip.updatedAt,
      arrivedAt: trip.arrivedAt,
      pickupVerifiedAt: trip.pickupVerifiedAt,
      startedAt: trip.startedAt,
      deliveredAt: trip.deliveredAt,
      completedAt: trip.completedAt,
      cancelledAt: trip.cancelledAt,
      cancelledBy: trip.cancelledBy,
      cancellationReason: trip.cancellationReason,
    };
  }

  getTrip(tripId: string): Trip {
    const trip = this.trips.find(t => t.id === tripId);
    if (!trip) {
      throw new NotFoundException(`Trip with ID ${tripId} not found`);
    }
    return trip;
  }

  getTripByRideId(rideId: string): Trip {
    const trip = this.trips.find(t => t.rideId === rideId);
    if (!trip) {
      throw new NotFoundException(`Trip for ride ${rideId} not found`);
    }
    return trip;
  }

  getActiveTripForCustomer(customerId: string): Trip | undefined {
    return this.trips.find(t => t.customerId === customerId && !['COMPLETED', 'CANCELLED'].includes(t.status));
  }

  getActiveTripForDriver(driverId: string): Trip | undefined {
    return this.trips.find(t => t.driverId === driverId && !['COMPLETED', 'CANCELLED'].includes(t.status));
  }

  getCurrentStop(tripId: string): TripStopPublic {
    const trip = this.getTrip(tripId);
    if (trip.currentStopIndex >= trip.stops.length) {
      throw new BadRequestException('All stops have been completed');
    }
    const stop = trip.stops[trip.currentStopIndex];
    // Return sanitized stop (no OTP)
    return this.sanitizeTrip(trip).stops[trip.currentStopIndex];
  }

  getStopProgress(tripId: string) {
    const trip = this.getTrip(tripId);
    const sanitized = this.sanitizeTrip(trip);
    return {
      current: trip.currentStopIndex + 1,
      total: trip.stops.length,
      completedStops: sanitized.completedStops,
      remainingStops: sanitized.remainingStops,
      stops: sanitized.stops,
      currentStop: sanitized.currentStop,
    };
  }

  private assertDriver(trip: Trip, driverId: string) {
    if (trip.driverId !== driverId) {
      throw new ForbiddenException('Only the assigned driver can perform this action');
    }
  }

  private transition(tripId: string, driverId: string, nextStatus: TripStatus, timestampField: keyof Trip): Trip {
    const trip = this.getTrip(tripId);
    this.assertDriver(trip, driverId);
    this.tripStateService.validateTransition(trip.status, nextStatus);
    
    trip.status = nextStatus;
    trip.updatedAt = new Date().toISOString();
    (trip as any)[timestampField] = trip.updatedAt;
    
    if (nextStatus === 'COMPLETED') {
      this.driversService.updateAvailability(trip.driverId, true);
    }
    
    return trip;
  }

  // ──── PRE-PICKUP ACTIONS (unchanged) ────

  arrive(tripId: string, driverId: string) { 
    return this.transition(tripId, driverId, 'DRIVER_ARRIVED', 'arrivedAt'); 
  }
  
  confirmPickupWithOtp(tripId: string, driverId: string, otp: string) {
    const trip = this.getTrip(tripId);
    this.assertDriver(trip, driverId);

    if (trip.otp && trip.otp !== otp) {
      throw new BadRequestException('Invalid OTP. Please ask the customer for the correct code.');
    }
    
    return this.transition(tripId, driverId, 'PICKUP_VERIFIED', 'pickupVerifiedAt');
  }

  confirmPickup(tripId: string, driverId: string) { 
    return this.transition(tripId, driverId, 'PICKUP_VERIFIED', 'pickupVerifiedAt'); 
  }

  // ──── MULTI-STOP DROP ACTIONS ────

  /**
   * Start heading to the current stop.
   * Sets trip to IN_TRANSIT and current stop to IN_TRANSIT.
   */
  startTrip(tripId: string, driverId: string) {
    const trip = this.getTrip(tripId);
    this.assertDriver(trip, driverId);

    if (trip.status !== 'PICKUP_VERIFIED') {
      throw new BadRequestException(`startTrip requires PICKUP_VERIFIED status, current: ${trip.status}`);
    }

    // Validate that the first stop is still PENDING
    const firstStop = trip.stops[0];
    if (!firstStop) {
      throw new BadRequestException('Trip has no stops');
    }
    if (firstStop.status !== 'PENDING') {
      throw new BadRequestException(`First stop is already ${firstStop.status}`);
    }

    this.tripStateService.validateTransition(trip.status, 'IN_TRANSIT');
    trip.status = 'IN_TRANSIT';
    trip.updatedAt = new Date().toISOString();
    if (!trip.startedAt) trip.startedAt = trip.updatedAt;

    // Activate first stop only
    this.tripStateService.validateStopTransition(firstStop.status, 'IN_TRANSIT');
    firstStop.status = 'IN_TRANSIT';

    return trip;
  }

  /**
   * Driver arrives at current stop.
   * INVARIANT: Only the current stop can be arrived at.
   * INVARIANT: Duplicate arrive is rejected (stop already ARRIVED).
   * Optional stopId validation: if provided, must match current stop.
   */
  arriveAtStop(tripId: string, driverId: string, stopId?: string) {
    const trip = this.getTrip(tripId);
    this.assertDriver(trip, driverId);

    // Validate trip is in correct state for arriving at a stop
    if (trip.status !== 'IN_TRANSIT') {
      throw new BadRequestException(`Cannot arrive at stop: trip is ${trip.status}, expected IN_TRANSIT`);
    }

    const currentStop = trip.stops[trip.currentStopIndex];
    if (!currentStop) {
      throw new BadRequestException('No active stop to arrive at');
    }

    // INVARIANT: stopId must match current stop if provided
    if (stopId && stopId !== currentStop.id) {
      throw new BadRequestException(
        `Stop ID mismatch: requested ${stopId} but current active stop is ${currentStop.id} (sequence ${currentStop.sequence})`
      );
    }

    // INVARIANT: Duplicate arrive protection
    if (currentStop.status === 'ARRIVED') {
      throw new BadRequestException(`Already arrived at Stop ${currentStop.sequence}. Submit OTP to confirm delivery.`);
    }
    if (currentStop.status === 'DELIVERED') {
      throw new BadRequestException(`Stop ${currentStop.sequence} is already delivered.`);
    }
    if (currentStop.status !== 'IN_TRANSIT') {
      throw new BadRequestException(`Stop ${currentStop.sequence} must be IN_TRANSIT to arrive (current: ${currentStop.status})`);
    }

    this.tripStateService.validateTransition(trip.status, 'DROP_PROGRESS');
    trip.status = 'DROP_PROGRESS';
    trip.updatedAt = new Date().toISOString();

    this.tripStateService.validateStopTransition(currentStop.status, 'ARRIVED');
    currentStop.status = 'ARRIVED';
    currentStop.arrivedAt = trip.updatedAt;

    return trip;
  }

  /**
   * Verify per-stop OTP.
   * INVARIANT: Only current stop can have OTP verified.
   * INVARIANT: Wrong OTP is rejected; stop remains unchanged.
   * INVARIANT: Duplicate OTP verify is rejected.
   * INVARIANT: Does NOT mark stop as delivered; requires photo proof.
   * Optional stopId validation: if provided, must match current stop.
   */
  verifyStopOtp(tripId: string, driverId: string, otp: string, stopId?: string) {
    const trip = this.getTrip(tripId);
    this.assertDriver(trip, driverId);

    // Validate trip state
    if (trip.status !== 'DROP_PROGRESS') {
      throw new BadRequestException(`Cannot verify stop OTP: trip is ${trip.status}, expected DROP_PROGRESS`);
    }

    const currentStop = trip.stops[trip.currentStopIndex];
    if (!currentStop) {
      throw new BadRequestException('No active stop to confirm');
    }

    // INVARIANT: stopId must match current stop if provided
    if (stopId && stopId !== currentStop.id) {
      throw new BadRequestException(
        `Stop ID mismatch: requested ${stopId} but current active stop is ${currentStop.id} (sequence ${currentStop.sequence})`
      );
    }

    // INVARIANT: Duplicate delivery protection
    if (currentStop.status === 'DELIVERED') {
      throw new BadRequestException(`Stop ${currentStop.sequence} is already delivered. Cannot verify OTP again.`);
    }
    if (currentStop.status !== 'ARRIVED') {
      throw new BadRequestException(`Stop ${currentStop.sequence} must be ARRIVED before OTP verification (current: ${currentStop.status}). Did you call arrive first?`);
    }
    if (currentStop.otpVerified) {
      throw new BadRequestException(`OTP for Stop ${currentStop.sequence} is already verified. Please submit delivery photo proof.`);
    }

    // INVARIANT: Per-stop OTP must match — wrong OTP does NOT advance state
    if (currentStop.otp !== otp) {
      throw new BadRequestException(
        `Invalid OTP for Stop ${currentStop.sequence}. Ask the receiver for the correct code. (currentStopIndex unchanged)`
      );
    }

    // Mark OTP as verified
    currentStop.otpVerified = true;
    trip.updatedAt = new Date().toISOString();

    return trip;
  }

  /**
   * Confirm delivery by submitting photo proof.
   * INVARIANT: OTP must be verified first.
   * INVARIANT: Photo must be provided.
   */
  confirmStopDeliveryWithProof(tripId: string, driverId: string, stopId: string | undefined, photo: { uri: string }) {
    const trip = this.getTrip(tripId);
    this.assertDriver(trip, driverId);

    if (trip.status !== 'DROP_PROGRESS') {
      throw new BadRequestException(`Cannot confirm delivery: trip is ${trip.status}, expected DROP_PROGRESS`);
    }

    const currentStop = trip.stops[trip.currentStopIndex];
    if (!currentStop) {
      throw new BadRequestException('No active stop to confirm');
    }

    if (stopId && stopId !== currentStop.id) {
      throw new BadRequestException(
        `Stop ID mismatch: requested ${stopId} but current active stop is ${currentStop.id}`
      );
    }

    if (currentStop.status === 'DELIVERED') {
      throw new BadRequestException(`Stop ${currentStop.sequence} is already delivered.`);
    }
    if (currentStop.status !== 'ARRIVED') {
      throw new BadRequestException(`Stop ${currentStop.sequence} must be ARRIVED before delivery confirmation.`);
    }
    if (!currentStop.otpVerified) {
      throw new BadRequestException(`OTP for Stop ${currentStop.sequence} must be verified before submitting photo proof.`);
    }
    if (!photo || !photo.uri) {
      throw new BadRequestException(`A valid delivery photo is required to complete Stop ${currentStop.sequence}.`);
    }

    // Attach proof
    currentStop.deliveryProof = {
      type: 'PHOTO',
      uri: photo.uri,
      submittedAt: new Date().toISOString()
    };

    // Mark stop as DELIVERED
    this.tripStateService.validateStopTransition(currentStop.status, 'DELIVERED');
    currentStop.status = 'DELIVERED';
    currentStop.deliveredAt = currentStop.deliveryProof.submittedAt;
    trip.updatedAt = currentStop.deliveredAt;

    // ── NEXT STOP PROGRESSION ──────────────────────────────────────────────
    const nextIndex = trip.currentStopIndex + 1;
    const hasMoreStops = nextIndex < trip.stops.length;

    if (hasMoreStops) {
      // INVARIANT: currentStopIndex advances by exactly 1
      trip.currentStopIndex = nextIndex;

      // Next stop becomes IN_TRANSIT (driver is already on their way)
      const nextStop = trip.stops[nextIndex];
      // INVARIANT: Next stop must be PENDING; guard against corrupt state
      if (nextStop.status !== 'PENDING') {
        throw new BadRequestException(
          `Unexpected state: next stop (sequence ${nextStop.sequence}) is ${nextStop.status}, expected PENDING`
        );
      }
      this.tripStateService.validateStopTransition(nextStop.status, 'IN_TRANSIT');
      nextStop.status = 'IN_TRANSIT';

      // Trip returns to IN_TRANSIT for the next leg
      trip.status = 'IN_TRANSIT';

      // Update backward-compat drop field to the new active stop location
      trip.drop = nextStop.location;
    } else {
      // All stops delivered → trip → DELIVERED (driver calls complete separately)
      trip.status = 'DELIVERED';
      trip.deliveredAt = currentStop.deliveredAt;
    }

    return trip;
  }

  // Legacy single-drop methods (kept for backward compat, internally use multi-stop)
  startDrop(tripId: string, driverId: string) { 
    return this.arriveAtStop(tripId, driverId);
  }
  
  confirmDrop(tripId: string, driverId: string): Trip { 
    // For legacy single-drop, verify OTP and confirm proof sequentially
    // wait, single drop regression says "existing one-drop flow still works". 
    // But since confirmDrop is just a legacy wrapper, if we leave it requiring photo, old apps will fail. 
    // However, the prompt says "One-stop trip must work: ... OTP -> Photo -> Deliver ... No special permanent single-drop implementation. Use the same proof workflow."
    // So for legacy single drop, we'll throw an error if this old endpoint is used directly without photo? 
    // Actually, confirmDrop is only hit if they call `/drop/confirm`. The driver app calls `actionConfirmDrop` which calls `tripApi.confirmDrop`.
    // Wait, `actionConfirmDrop` in driver-app calls `tripApi.confirmDrop`. 
    // In M16, I need to make sure the driver app uses the multi-drop APIs consistently, even for single drop. 
    throw new BadRequestException('Single drop confirm Drop is deprecated. Use stop OTP verification followed by photo proof submission.');
  }

  // ──── COMPLETION ────

  complete(tripId: string, driverId: string) {
    const trip = this.getTrip(tripId);
    this.assertDriver(trip, driverId);

    // Verify all stops are delivered
    const undelivered = trip.stops.filter(s => s.status !== 'DELIVERED');
    if (undelivered.length > 0) {
      throw new BadRequestException(`Cannot complete trip: ${undelivered.length} stop(s) still pending delivery`);
    }

    const completed = this.transition(tripId, driverId, 'COMPLETED', 'completedAt');
    // Save to history
    this.tripHistory.push({ ...completed });
    return completed;
  }

  // ──── CANCELLATION ────

  cancelTrip(tripId: string, initiator: 'CUSTOMER' | 'DRIVER', initiatorId: string, reason?: string) {
    const trip = this.getTrip(tripId);
    
    if (trip.status === 'CANCELLED') {
      throw new BadRequestException('Trip is already cancelled');
    }
    
    if (initiator === 'DRIVER' && trip.driverId !== initiatorId) {
       throw new ForbiddenException('Only the assigned driver can cancel');
    }
    if (initiator === 'CUSTOMER' && trip.customerId !== initiatorId) {
       throw new ForbiddenException('Only the requested customer can cancel');
    }

    this.tripStateService.validateTransition(trip.status, 'CANCELLED');
    
    trip.status = 'CANCELLED';
    trip.updatedAt = new Date().toISOString();
    trip.cancelledAt = trip.updatedAt;
    trip.cancelledBy = initiator;
    trip.cancellationReason = reason;
    
    this.driversService.updateAvailability(trip.driverId, true);
    // Save to history
    this.tripHistory.push({ ...trip });
    return trip;
  }

  // ──── HISTORY ────

  getCustomerHistory(customerId: string) {
    return this.tripHistory
      .filter(t => t.customerId === customerId)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .map(t => this.sanitizeTrip(t));
  }

  getDriverHistory(driverId: string) {
    return this.tripHistory
      .filter(t => t.driverId === driverId)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .map(t => this.sanitizeTrip(t));
  }
}

import { Controller, Get, Param, Post, Body, BadRequestException } from '@nestjs/common';
import { TripsService } from './trips.service';

@Controller('trips')
export class TripsController {
  constructor(private readonly tripsService: TripsService) {}

  // ──── READ ENDPOINTS (all return OTP-scrubbed sanitized trip) ────

  @Get(':tripId')
  getTrip(@Param('tripId') tripId: string) {
    const trip = this.tripsService.getTrip(tripId);
    return { success: true, trip: this.tripsService.sanitizeTrip(trip) };
  }

  @Get('active/customer/:customerId')
  getActiveForCustomer(@Param('customerId') customerId: string) {
    const trip = this.tripsService.getActiveTripForCustomer(customerId);
    return { success: true, trip: trip ? this.tripsService.sanitizeTrip(trip) : null };
  }

  @Get('active/driver/:driverId')
  getActiveForDriver(@Param('driverId') driverId: string) {
    const trip = this.tripsService.getActiveTripForDriver(driverId);
    return { success: true, trip: trip ? this.tripsService.sanitizeTrip(trip) : null };
  }

  @Get('history/customer/:customerId')
  getCustomerHistory(@Param('customerId') customerId: string) {
    const trips = this.tripsService.getCustomerHistory(customerId);
    return { success: true, trips };
  }

  @Get('history/driver/:driverId')
  getDriverHistory(@Param('driverId') driverId: string) {
    const trips = this.tripsService.getDriverHistory(driverId);
    return { success: true, trips };
  }

  // ──── STOP PROGRESS ────

  @Get(':tripId/stops')
  getStops(@Param('tripId') tripId: string) {
    const progress = this.tripsService.getStopProgress(tripId);
    return { success: true, ...progress };
  }

  @Get(':tripId/current-stop')
  getCurrentStop(@Param('tripId') tripId: string) {
    const stop = this.tripsService.getCurrentStop(tripId);
    return { success: true, stop };
  }

  // ──── PRE-PICKUP ────

  @Post(':tripId/arrive')
  arrive(@Param('tripId') tripId: string, @Body('driverId') driverId: string) {
    if (!driverId) throw new BadRequestException('driverId is required');
    const trip = this.tripsService.arrive(tripId, driverId);
    return { success: true, tripStatus: trip.status, trip: this.tripsService.sanitizeTrip(trip) };
  }

  @Post(':tripId/pickup/confirm')
  confirmPickup(@Param('tripId') tripId: string, @Body('driverId') driverId: string) {
    if (!driverId) throw new BadRequestException('driverId is required');
    const trip = this.tripsService.confirmPickup(tripId, driverId);
    return { success: true, tripStatus: trip.status, trip: this.tripsService.sanitizeTrip(trip) };
  }

  @Post(':tripId/pickup/verify-otp')
  confirmPickupWithOtp(
    @Param('tripId') tripId: string,
    @Body('driverId') driverId: string,
    @Body('otp') otp: string,
  ) {
    if (!driverId) throw new BadRequestException('driverId is required');
    if (!otp) throw new BadRequestException('otp is required');
    const trip = this.tripsService.confirmPickupWithOtp(tripId, driverId, otp);
    return { success: true, tripStatus: trip.status, trip: this.tripsService.sanitizeTrip(trip) };
  }

  // ──── MULTI-STOP DROP ACTIONS ────

  @Post(':tripId/start')
  startTrip(@Param('tripId') tripId: string, @Body('driverId') driverId: string) {
    if (!driverId) throw new BadRequestException('driverId is required');
    const trip = this.tripsService.startTrip(tripId, driverId);
    const sanitized = this.tripsService.sanitizeTrip(trip);
    return {
      success: true,
      tripStatus: trip.status,
      currentStopIndex: trip.currentStopIndex,
      currentStop: sanitized.currentStop,
      trip: sanitized,
    };
  }

  @Post(':tripId/stop/arrive')
  arriveAtStop(
    @Param('tripId') tripId: string,
    @Body('driverId') driverId: string,
    @Body('stopId') stopId?: string,
  ) {
    if (!driverId) throw new BadRequestException('driverId is required');
    const trip = this.tripsService.arriveAtStop(tripId, driverId, stopId);
    const sanitized = this.tripsService.sanitizeTrip(trip);
    return {
      success: true,
      tripStatus: trip.status,
      currentStopIndex: trip.currentStopIndex,
      stop: sanitized.currentStop,
      trip: sanitized,
    };
  }

  @Post(':tripId/stop/verify-otp')
  confirmStopWithOtp(
    @Param('tripId') tripId: string,
    @Body('driverId') driverId: string,
    @Body('otp') otp: string,
    @Body('stopId') stopId?: string,
  ) {
    if (!driverId) throw new BadRequestException('driverId is required');
    if (!otp) throw new BadRequestException('otp is required');
    const trip = this.tripsService.verifyStopOtp(tripId, driverId, otp, stopId);
    const sanitized = this.tripsService.sanitizeTrip(trip);
    return {
      success: true,
      tripStatus: trip.status,
      currentStopIndex: trip.currentStopIndex,
      currentStop: sanitized.currentStop,
      trip: sanitized,
    };
  }

  @Post(':tripId/stop/confirm-delivery')
  confirmStopDeliveryWithProof(
    @Param('tripId') tripId: string,
    @Body('driverId') driverId: string,
    @Body('photo') photo: { uri: string },
    @Body('stopId') stopId?: string,
  ) {
    if (!driverId) throw new BadRequestException('driverId is required');
    if (!photo || !photo.uri) throw new BadRequestException('Photo proof is required');
    const trip = this.tripsService.confirmStopDeliveryWithProof(tripId, driverId, stopId, photo);
    const sanitized = this.tripsService.sanitizeTrip(trip);
    return {
      success: true,
      tripStatus: trip.status,
      currentStopIndex: trip.currentStopIndex,
      completedStops: sanitized.completedStops,
      remainingStops: sanitized.remainingStops,
      currentStop: sanitized.currentStop,   // null when all stops done
      trip: sanitized,
    };
  }

  // Legacy endpoints (backward compat — internally delegate to multi-stop methods)
  @Post(':tripId/drop/start')
  startDrop(@Param('tripId') tripId: string, @Body('driverId') driverId: string) {
    if (!driverId) throw new BadRequestException('driverId is required');
    const trip = this.tripsService.startDrop(tripId, driverId);
    return { success: true, trip: this.tripsService.sanitizeTrip(trip) };
  }

  @Post(':tripId/drop/confirm')
  confirmDrop(@Param('tripId') tripId: string, @Body('driverId') driverId: string) {
    if (!driverId) throw new BadRequestException('driverId is required');
    const trip = this.tripsService.confirmDrop(tripId, driverId);
    return { success: true, trip: this.tripsService.sanitizeTrip(trip) };
  }

  // ──── COMPLETION ────

  @Post(':tripId/complete')
  complete(@Param('tripId') tripId: string, @Body('driverId') driverId: string) {
    if (!driverId) throw new BadRequestException('driverId is required');
    const trip = this.tripsService.complete(tripId, driverId);
    return {
      success: true,
      tripStatus: trip.status,
      completedAt: trip.completedAt,
      trip: this.tripsService.sanitizeTrip(trip),
    };
  }

  @Post(':tripId/cancel')
  cancelTrip(
    @Param('tripId') tripId: string,
    @Body('customerId') customerId?: string,
    @Body('driverId') driverId?: string,
    @Body('reason') reason?: string
  ) {
    if (customerId) {
       const trip = this.tripsService.cancelTrip(tripId, 'CUSTOMER', customerId, reason);
       return { success: true, tripStatus: trip.status, trip: this.tripsService.sanitizeTrip(trip) };
    } else if (driverId) {
       const trip = this.tripsService.cancelTrip(tripId, 'DRIVER', driverId, reason);
       return { success: true, tripStatus: trip.status, trip: this.tripsService.sanitizeTrip(trip) };
    }
    throw new BadRequestException('customerId or driverId is required to cancel');
  }
}

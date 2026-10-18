import {
  Controller,
  Get,
  Param,
  Post,
  Body,
  BadRequestException,
  HttpStatus,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentSubject } from '../auth/decorators';
import { assertSameIdentity } from '../auth/identity';
import { TripsService } from './trips.service';

/** Reasons for a cancellation or a failed delivery: sent to the payment backend (3-200 chars). */
function requireReason(reason: unknown): string {
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (text.length < 3 || text.length > 200) {
    throw new BadRequestException('reason is required (3-200 characters)');
  }
  return text;
}

/**
 * Trip routes for the Driver and Customer apps. Every route needs a verified Firebase token; the
 * caller is the token's subject. A driverId / customerId in the body or path is accepted only
 * if it is that subject (compatibility with the current apps), and never used otherwise.
 * No response ever carries an OTP.
 */
@Controller('trips')
export class TripsController {
  constructor(private readonly tripsService: TripsService) {}

  // ──── READ ENDPOINTS (OTP-scrubbed) ────

  @Get(':tripId')
  async getTrip(
    @CurrentSubject() subject: string,
    @Param('tripId') tripId: string,
  ) {
    return {
      success: true,
      trip: await this.tripsService.getTrip(tripId, subject),
    };
  }

  @Get('active/customer/:customerId')
  async getActiveForCustomer(
    @CurrentSubject() subject: string,
    @Param('customerId') customerId: string,
  ) {
    assertSameIdentity(subject, customerId, 'customerId');
    return {
      success: true,
      trip: await this.tripsService.getActiveTripForCustomer(subject),
    };
  }

  @Get('active/driver/:driverId')
  async getActiveForDriver(
    @CurrentSubject() subject: string,
    @Param('driverId') driverId: string,
  ) {
    assertSameIdentity(subject, driverId, 'driverId');
    return {
      success: true,
      trip: await this.tripsService.getActiveTripForDriver(subject),
    };
  }

  @Get('history/customer/:customerId')
  async getCustomerHistory(
    @CurrentSubject() subject: string,
    @Param('customerId') customerId: string,
  ) {
    assertSameIdentity(subject, customerId, 'customerId');
    return {
      success: true,
      trips: await this.tripsService.getCustomerHistory(subject),
    };
  }

  @Get('history/driver/:driverId')
  async getDriverHistory(
    @CurrentSubject() subject: string,
    @Param('driverId') driverId: string,
  ) {
    assertSameIdentity(subject, driverId, 'driverId');
    return {
      success: true,
      trips: await this.tripsService.getDriverHistory(subject),
    };
  }

  // ──── STOP PROGRESS ────

  @Get(':tripId/stops')
  async getStops(
    @CurrentSubject() subject: string,
    @Param('tripId') tripId: string,
  ) {
    const progress = await this.tripsService.getStopProgress(tripId, subject);
    return { success: true, ...progress };
  }

  @Get(':tripId/current-stop')
  async getCurrentStop(
    @CurrentSubject() subject: string,
    @Param('tripId') tripId: string,
  ) {
    return {
      success: true,
      stop: await this.tripsService.getCurrentStop(tripId, subject),
    };
  }

  // ──── PRE-PICKUP ────

  @Post(':tripId/arrive')
  async arrive(
    @CurrentSubject() subject: string,
    @Param('tripId') tripId: string,
    @Body('driverId') driverId?: string,
  ) {
    assertSameIdentity(subject, driverId, 'driverId');
    const result = await this.tripsService.arrive(tripId, subject);
    return { success: true, tripStatus: result.trip.status, ...result };
  }

  // POST :tripId/pickup/confirm (pickup without the OTP) was removed: the pickup is confirmed
  // only with the customer's OTP, behind the payment gate (review F).

  @Post(':tripId/pickup/verify-otp')
  async confirmPickupWithOtp(
    @CurrentSubject() subject: string,
    @Param('tripId') tripId: string,
    @Body('otp') otp: string,
    @Body('driverId') driverId?: string,
  ) {
    assertSameIdentity(subject, driverId, 'driverId');
    if (!otp) throw new BadRequestException('otp is required');
    const result = await this.tripsService.confirmPickupWithOtp(
      tripId,
      subject,
      otp,
    );
    return { success: true, tripStatus: result.trip.status, ...result };
  }

  // ──── MULTI-STOP DROP ACTIONS ────

  @Post(':tripId/start')
  async startTrip(
    @CurrentSubject() subject: string,
    @Param('tripId') tripId: string,
    @Body('driverId') driverId?: string,
  ) {
    assertSameIdentity(subject, driverId, 'driverId');
    const result = await this.tripsService.startTrip(tripId, subject);
    return {
      success: true,
      tripStatus: result.trip.status,
      currentStopIndex: result.trip.currentStopIndex,
      currentStop: result.trip.currentStop,
      ...result,
    };
  }

  @Post(':tripId/stop/arrive')
  async arriveAtStop(
    @CurrentSubject() subject: string,
    @Param('tripId') tripId: string,
    @Body('driverId') driverId?: string,
    @Body('stopId') stopId?: string,
  ) {
    assertSameIdentity(subject, driverId, 'driverId');
    const result = await this.tripsService.arriveAtStop(
      tripId,
      subject,
      stopId,
    );
    return {
      success: true,
      tripStatus: result.trip.status,
      currentStopIndex: result.trip.currentStopIndex,
      stop: result.trip.currentStop,
      ...result,
    };
  }

  @Post(':tripId/stop/verify-otp')
  async confirmStopWithOtp(
    @CurrentSubject() subject: string,
    @Param('tripId') tripId: string,
    @Body('otp') otp: string,
    @Body('driverId') driverId?: string,
    @Body('stopId') stopId?: string,
  ) {
    assertSameIdentity(subject, driverId, 'driverId');
    if (!otp) throw new BadRequestException('otp is required');
    const result = await this.tripsService.verifyStopOtp(
      tripId,
      subject,
      otp,
      stopId,
    );
    return {
      success: true,
      tripStatus: result.trip.status,
      currentStopIndex: result.trip.currentStopIndex,
      currentStop: result.trip.currentStop,
      ...result,
    };
  }

  @Post(':tripId/stop/confirm-delivery')
  async confirmStopDeliveryWithProof(
    @CurrentSubject() subject: string,
    @Param('tripId') tripId: string,
    @Body('photo') photo: { uri: string },
    @Body('driverId') driverId?: string,
    @Body('stopId') stopId?: string,
  ) {
    assertSameIdentity(subject, driverId, 'driverId');
    if (!photo || typeof photo.uri !== 'string' || !photo.uri) {
      throw new BadRequestException('Photo proof is required');
    }
    const result = await this.tripsService.confirmStopDeliveryWithProof(
      tripId,
      subject,
      stopId,
      photo,
    );
    return {
      success: true,
      tripStatus: result.trip.status,
      currentStopIndex: result.trip.currentStopIndex,
      completedStops: result.trip.completedStops,
      remainingStops: result.trip.remainingStops,
      currentStop: result.trip.currentStop, // null when all stops done
      ...result,
    };
  }

  /** The receiver could not take the goods. The payment backend decides retry or resolution. */
  @Post(':tripId/stop/fail')
  async failStop(
    @CurrentSubject() subject: string,
    @Param('tripId') tripId: string,
    @Body('reason') reason: unknown,
    @Body('driverId') driverId?: string,
    @Body('stopId') stopId?: string,
  ) {
    assertSameIdentity(subject, driverId, 'driverId');
    const result = await this.tripsService.failStop(
      tripId,
      subject,
      requireReason(reason),
      stopId,
    );
    return {
      success: true,
      tripStatus: result.trip.status,
      currentStopIndex: result.trip.currentStopIndex,
      stop: result.trip.currentStop,
      ...result,
    };
  }

  /** Re-reads the payment backend: follows an admin's resolution of a failed drop. */
  @Post(':tripId/refresh')
  async refresh(
    @CurrentSubject() subject: string,
    @Param('tripId') tripId: string,
  ) {
    const result = await this.tripsService.refresh(tripId, subject);
    return { success: true, tripStatus: result.trip.status, ...result };
  }

  // Legacy endpoints (backward compat — internally delegate to multi-stop methods)
  @Post(':tripId/drop/start')
  async startDrop(
    @CurrentSubject() subject: string,
    @Param('tripId') tripId: string,
    @Body('driverId') driverId?: string,
  ) {
    assertSameIdentity(subject, driverId, 'driverId');
    const result = await this.tripsService.arriveAtStop(tripId, subject);
    return { success: true, trip: result.trip };
  }

  @Post(':tripId/drop/confirm')
  confirmDrop() {
    throw new BadRequestException(
      'Single drop confirm Drop is deprecated. Use stop OTP verification followed by photo proof submission.',
    );
  }

  // ──── COMPLETION ────

  /**
   * 201 COMPLETED once the payment backend confirmed it. 202 while it waits for the payment to
   * be confirmed (or for an answer): the outbox keeps retrying, and the trip completes then.
   */
  @Post(':tripId/complete')
  async complete(
    @CurrentSubject() subject: string,
    @Param('tripId') tripId: string,
    @Res({ passthrough: true }) response: Response,
    @Body('driverId') driverId?: string,
  ) {
    assertSameIdentity(subject, driverId, 'driverId');
    const result = await this.tripsService.complete(tripId, subject);
    if (result.completion === 'PENDING') {
      response.status(HttpStatus.ACCEPTED);
    }
    return {
      success: true,
      tripStatus: result.trip.status,
      completedAt: result.trip.completedAt,
      ...result,
    };
  }

  @Post(':tripId/cancel')
  async cancelTrip(
    @CurrentSubject() subject: string,
    @Param('tripId') tripId: string,
    @Body('reason') reason: unknown,
    @Body('customerId') customerId?: string,
    @Body('driverId') driverId?: string,
  ) {
    assertSameIdentity(subject, customerId, 'customerId');
    assertSameIdentity(subject, driverId, 'driverId');
    const result = await this.tripsService.cancelTrip(
      tripId,
      subject,
      requireReason(reason),
    );
    return { success: true, tripStatus: result.trip.status, ...result };
  }
}

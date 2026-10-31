import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentSubject } from '../auth/decorators';
import { RidesService } from './rides.service';

/**
 * Bookings ("rides") for the Customer and Driver apps. Every route needs a verified Firebase
 * token; the customer or driver is the token's subject.
 *
 * POST /rides/:rideId/verify-otp was removed: it told anyone whether a pickup OTP was right
 * without the payment gate. The pickup OTP is checked only by POST /trips/:id/pickup/verify-otp,
 * after the payment backend allows the handover.
 */
@Controller()
export class RidesController {
  constructor(private readonly ridesService: RidesService) {}

  /** The customer confirms a fare quote: registered with the payment backend, then offered. */
  @Post('rides')
  async createRide(@CurrentSubject() subject: string, @Body() body: unknown) {
    return {
      success: true,
      ride: await this.ridesService.createRide(subject, body),
    };
  }

  /** Read-only recovery; identity always comes from the verified token. */
  @Get('rides/recovery')
  async recoverRide(
    @CurrentSubject() subject: string,
    @Query('quoteId') quoteId?: string,
  ) {
    return {
      success: true,
      ride: await this.ridesService.recoverRide(subject, quoteId),
    };
  }

  @Get('rides/:rideId')
  async getRideStatus(
    @CurrentSubject() subject: string,
    @Param('rideId') rideId: string,
  ) {
    return {
      success: true,
      ride: await this.ridesService.getRide(subject, rideId),
    };
  }

  @Get('rides/:rideId/trip')
  async getRideTrip(
    @CurrentSubject() subject: string,
    @Param('rideId') rideId: string,
  ) {
    return {
      success: true,
      trip: await this.ridesService.getRideTrip(subject, rideId),
    };
  }

  /** The handover OTPs for the customer, withheld until the payment backend allows each handover. */
  @Get('rides/:rideId/otps')
  async getOtps(
    @CurrentSubject() subject: string,
    @Param('rideId') rideId: string,
  ) {
    return {
      success: true,
      ...(await this.ridesService.getOtps(subject, rideId)),
    };
  }

  @Get('ride-requests/:driverId')
  async getPendingRequests(
    @CurrentSubject() subject: string,
    @Param('driverId') driverId: string,
  ) {
    return {
      success: true,
      requests: await this.ridesService.findPendingForDriver(subject, driverId),
    };
  }

  @Post('rides/:rideId/accept')
  async acceptRide(
    @CurrentSubject() subject: string,
    @Param('rideId') rideId: string,
    @Body('driverId') driverId?: string,
  ) {
    return {
      success: true,
      ...(await this.ridesService.acceptRide(subject, rideId, driverId)),
    };
  }

  @Post('rides/:rideId/cancel')
  async cancelRide(
    @CurrentSubject() subject: string,
    @Param('rideId') rideId: string,
    @Body() body: unknown,
  ) {
    return {
      success: true,
      ride: await this.ridesService.cancelRide(subject, rideId, body),
    };
  }

  @Post('rides/:rideId/reject')
  async rejectRide(
    @CurrentSubject() subject: string,
    @Param('rideId') rideId: string,
    @Body('driverId') driverId?: string,
  ) {
    return {
      success: true,
      ride: await this.ridesService.rejectRide(subject, rideId, driverId),
    };
  }
}

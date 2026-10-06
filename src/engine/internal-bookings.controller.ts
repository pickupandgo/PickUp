import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { InternalOnly } from '../auth/decorators';
import {
  AssignDriverRequest,
  CancelBookingRequest,
  EXTERNAL_REF_PATTERN,
  InternalBookingResponse,
  RegisterBookingRequest,
  TripStatusRequest,
} from '../bookings/bookings.dto';
import { toInternalBookingResponse } from '../bookings/bookings.mapper';
import { type BookingWithTrip, BookingsService } from '../bookings/bookings.service';
import { CollectionsService } from '../collections/collections.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { numberToPaise } from '../common/money';

const uuid = new ParseUUIDPipe({ version: '4' });

/**
 * Server-to-server API for the trip engine (dispatch and stop progression live there). The
 * engine reports what happens to a booking; this backend owns the money: confirmed fare, fee
 * rule, payment gate, collections, earnings. Authenticated with X-Internal-Api-Key.
 */
@ApiExcludeController()
@InternalOnly()
@Throttle({ default: { limit: 1_200, ttl: 60_000 } })
@Controller({ path: 'internal', version: '1' })
export class InternalBookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly collections: CollectionsService,
  ) {}

  /** Registers a confirmed booking. 201 when created, 200 when the ref was already registered. */
  @Post('bookings')
  async register(
    @Body() body: RegisterBookingRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<InternalBookingResponse> {
    const result = await this.bookings.register({
      externalRef: body.externalRef,
      customerSubject: body.customerSubject,
      vehicleCategory: body.vehicleCategory ?? null,
      paymentMethod: body.paymentMethod,
      confirmedFarePaise: numberToPaise(body.confirmedFarePaise),
    });
    response.status(result.created ? HttpStatus.CREATED : HttpStatus.OK);
    return this.view(result);
  }

  @Get('bookings/by-ref/:externalRef')
  async getByRef(@Param('externalRef') externalRef: string): Promise<InternalBookingResponse> {
    if (!EXTERNAL_REF_PATTERN.test(externalRef)) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        HttpStatus.BAD_REQUEST,
        'externalRef is invalid',
      );
    }
    return this.view(await this.bookings.getByExternalRef(externalRef));
  }

  @Get('bookings/:bookingId')
  async get(@Param('bookingId', uuid) bookingId: string): Promise<InternalBookingResponse> {
    return this.view(await this.bookings.getById(bookingId));
  }

  @Post('bookings/:bookingId/searching')
  @HttpCode(HttpStatus.OK)
  async searching(@Param('bookingId', uuid) bookingId: string): Promise<InternalBookingResponse> {
    return this.view(await this.bookings.markSearching(bookingId));
  }

  /** Creates the booking's trip for the assigned driver. Idempotent for the same driver. */
  @Post('bookings/:bookingId/assign')
  @HttpCode(HttpStatus.OK)
  async assign(
    @Param('bookingId', uuid) bookingId: string,
    @Body() body: AssignDriverRequest,
  ): Promise<InternalBookingResponse> {
    return this.view(await this.bookings.assignDriver(bookingId, body.driverSubject));
  }

  /** Cancels the booking and its trip, and closes any open payment QR at Razorpay. */
  @Post('bookings/:bookingId/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Param('bookingId', uuid) bookingId: string,
    @Body() body: CancelBookingRequest,
  ): Promise<InternalBookingResponse> {
    const result = await this.bookings.cancel(bookingId, body.reason);
    await this.collections.closeOpenCollections(bookingId, 'BOOKING_CANCELLED');
    return this.view(result);
  }

  /**
   * Trip lifecycle update, strictly in M6 order. Repeats are no-ops. COMPLETED is refused with
   * PAYMENT_REQUIRED until the payment is confirmed, and creates the driver earning.
   */
  @Post('trips/:tripId/status')
  @HttpCode(HttpStatus.OK)
  async tripStatus(
    @Param('tripId', uuid) tripId: string,
    @Body() body: TripStatusRequest,
  ): Promise<InternalBookingResponse> {
    return this.view(await this.bookings.updateTripStatus(tripId, body.status));
  }

  private async view(result: BookingWithTrip): Promise<InternalBookingResponse> {
    return toInternalBookingResponse(
      result.booking,
      result.trip,
      await this.bookings.paidWith(result.booking),
    );
  }
}

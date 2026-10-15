import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { InternalOnly } from '../auth/decorators';
import { BookingStopsService } from '../bookings/booking-stops.service';
import {
  AssignDriverRequest,
  CancelBookingRequest,
  EXTERNAL_REF_PATTERN,
  InternalBookingResponse,
  RegisterBookingRequest,
  StopStatusRequest,
  TripStatusRequest,
} from '../bookings/bookings.dto';
import { toInternalBookingResponse } from '../bookings/bookings.mapper';
import { type BookingWithTrip, BookingsService } from '../bookings/bookings.service';
import { CollectionsService } from '../collections/collections.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';

const uuid = new ParseUUIDPipe({ version: '4' });

/**
 * Server-to-server API for the trip engine (dispatch and stop progression live there). The
 * engine reports what happens to a booking; this backend owns the money: confirmed fare, fee
 * rule, payment gate, collections, earnings. Every booking view carries `paymentGate`, which the
 * engine reads before the pickup OTP and before every drop OTP. Authenticated with
 * X-Internal-Api-Key.
 */
@ApiExcludeController()
@InternalOnly()
@Throttle({ default: { limit: 1_200, ttl: 60_000 } })
@Controller({ path: 'internal', version: '1' })
export class InternalBookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly stops: BookingStopsService,
    private readonly collections: CollectionsService,
  ) {}

  /**
   * Registers a confirmed booking from its fare quote. 201 when created, 200 when the same ref,
   * quote and method were already registered. No amount is accepted: they all come from the quote.
   */
  @Post('bookings')
  async register(
    @Body() body: RegisterBookingRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<InternalBookingResponse> {
    const result = await this.bookings.register({
      externalRef: body.externalRef,
      customerSubject: body.customerSubject,
      quoteId: body.quoteId,
      paymentMethod: body.paymentMethod,
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
   * PICKUP_VERIFIED of an unpaid PAY_AT_PICKUP booking is refused with PAYMENT_REQUIRED (pickup
   * gate). A booking priced per drop moves through its drops instead: DROP_PROGRESS is refused
   * with STOP_REQUIRED, DELIVERED with STOPS_PENDING until every drop is finished.
   */
  @Post('trips/:tripId/status')
  @HttpCode(HttpStatus.OK)
  async tripStatus(
    @Param('tripId', uuid) tripId: string,
    @Body() body: TripStatusRequest,
  ): Promise<InternalBookingResponse> {
    return this.view(await this.bookings.updateTripStatus(tripId, body.status));
  }

  /**
   * A drop of a booking priced per drop: ARRIVED (also the retry of a failed attempt), DELIVERED
   * (refused with PAYMENT_REQUIRED until what is owed for the drop is paid) or DELIVERY_FAILED
   * (with a reason). Drops are handled in order, one at a time. Repeats are no-ops.
   */
  @Post('trips/:tripId/stops/:sequence/status')
  @HttpCode(HttpStatus.OK)
  async stopStatus(
    @Param('tripId', uuid) tripId: string,
    @Param('sequence', ParseIntPipe) sequence: number,
    @Body() body: StopStatusRequest,
  ): Promise<InternalBookingResponse> {
    const failure = body.status === 'DELIVERY_FAILED';
    if (failure !== (body.reason !== undefined)) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        HttpStatus.BAD_REQUEST,
        'Request validation failed',
        {
          fields: [
            {
              field: 'reason',
              issues: [
                failure
                  ? 'reason is required for DELIVERY_FAILED'
                  : 'reason is only accepted with DELIVERY_FAILED',
              ],
            },
          ],
        },
      );
    }
    const result = await this.stops.report(tripId, sequence, body.status, body.reason ?? null);
    if (body.status === 'DELIVERY_FAILED' && result.changed) {
      // Nothing is taken for an attempt that failed: the drop's open QR is closed at Razorpay. A
      // retry shows a new one; a payment that raced the close is still recorded for this drop.
      await this.collections.closeOpenCollections(
        result.booking.id,
        'DROP_DELIVERY_FAILED',
        result.stop.id,
      );
    }
    return this.view(result);
  }

  private async view(result: BookingWithTrip): Promise<InternalBookingResponse> {
    const [paidWith, context] = await Promise.all([
      this.bookings.paidWith(result.booking),
      this.bookings.paymentContext(result.booking, result.trip),
    ]);
    return toInternalBookingResponse(result.booking, result.trip, { ...context, paidWith });
  }
}

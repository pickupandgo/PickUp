import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentPrincipal, CustomerOnly } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { toCustomerBookingResponse } from '../bookings/bookings.mapper';
import { BookingsService } from '../bookings/bookings.service';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { IDEMPOTENCY_KEY_HEADER, IdempotencyKey } from '../common/http/idempotency-key.decorator';
import { BookingPaymentService } from './booking-payment.service';
import { toBookingPaymentResponse } from './payment.mapper';
import {
  BookingPaymentResponse,
  BookingPaymentStateResponse,
  VerifyBookingPaymentResponse,
  VerifyTopUpRequest,
} from './payments.dto';

const uuid = new ParseUUIDPipe({ version: '4' });

/** Customer App online payment for PREPAID bookings, through Razorpay Checkout. */
@ApiTags('bookings')
@CustomerOnly()
@Controller({ path: 'bookings/:bookingId/payment', version: '1' })
export class BookingPaymentsController {
  constructor(
    private readonly payments: BookingPaymentService,
    private readonly bookings: BookingsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Starts the payment and returns the Razorpay Checkout parameters. Safe to retry. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiHeader({ name: IDEMPOTENCY_KEY_HEADER, required: true })
  async start(
    @CurrentPrincipal() principal: Principal,
    @Param('bookingId', uuid) bookingId: string,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<BookingPaymentResponse> {
    const payment = await this.payments.start(principal, bookingId, idempotencyKey);
    return toBookingPaymentResponse(payment, this.config.razorpay.keyId);
  }

  @Get()
  async get(
    @CurrentPrincipal() principal: Principal,
    @Param('bookingId', uuid) bookingId: string,
  ): Promise<BookingPaymentStateResponse> {
    const state = await this.payments.getState(principal, bookingId);
    const { trip, ...booking } = state.booking;
    return {
      booking: toCustomerBookingResponse(
        booking,
        trip,
        await this.bookings.paymentContext(booking, trip),
      ),
      payment: state.payment
        ? toBookingPaymentResponse(state.payment, this.config.razorpay.keyId)
        : null,
    };
  }

  /**
   * Submit the Razorpay Checkout success values. The server verifies the signature and checks the
   * payment with Razorpay before marking the booking paid. Safe to call more than once.
   */
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async verify(
    @CurrentPrincipal() principal: Principal,
    @Param('bookingId', uuid) bookingId: string,
    @Body() body: VerifyTopUpRequest,
  ): Promise<VerifyBookingPaymentResponse> {
    const result = await this.payments.verify(principal, bookingId, body);
    const { trip, ...booking } = result.booking;
    return {
      booking: toCustomerBookingResponse(
        booking,
        trip,
        await this.bookings.paymentContext(booking, trip),
      ),
      payment: toBookingPaymentResponse(result.payment, this.config.razorpay.keyId),
      providerStatus: result.providerStatus,
    };
  }
}

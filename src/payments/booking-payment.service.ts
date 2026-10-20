import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Principal } from '../auth/principal';
import { requireCustomer } from '../auth/require-driver';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import type { Booking, Payment, Trip } from '../generated/prisma/client';

type BookingWithTrip = Booking & { trip: Trip | null };
import { isUniqueViolation } from '../prisma/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import { isValidCheckoutSignature } from '../razorpay/razorpay-signatures';
import { ANOMALY_OUTCOMES, PaymentPurpose } from './payment.constants';
import { PaymentConfirmationService } from './payment-confirmation.service';
import { PaymentOrderService } from './payment-orders.service';
import type { VerifyTopUpRequest } from './payments.dto';
import { toProviderAppError } from './provider-errors';

export interface BookingPaymentState {
  readonly booking: BookingWithTrip;
  readonly payment: Payment | null;
}

export interface BookingVerifyResult extends BookingPaymentState {
  readonly payment: Payment;
  readonly providerStatus: string;
}

/**
 * Customer App online payment for PREPAID bookings: the backend creates a Razorpay order for the
 * booking's confirmed fare (never an amount from the app), the customer pays in Razorpay
 * Checkout, and the booking is marked paid only after the backend verifies the payment with
 * Razorpay (verify call, webhook or admin sync). The money goes to Nikhil Enterprises.
 */
@Injectable()
export class BookingPaymentService {
  private readonly logger = new Logger(BookingPaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: PaymentOrderService,
    private readonly confirmation: PaymentConfirmationService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Starts (or resumes) the booking's payment. A booking has at most one live payment, so every
   * retry, from any device, returns the same Razorpay order.
   */
  async start(principal: Principal, bookingId: string, idempotencyKey: string): Promise<Payment> {
    const booking = await this.findOwnedBooking(principal, bookingId);
    this.assertPayable(booking);

    let payment: Payment;
    let created = false;
    const live = await this.findLivePayment(booking.id);
    if (live) {
      payment = live;
    } else {
      try {
        payment = await this.prisma.payment.create({
          data: {
            userId: principal.userId,
            bookingId: booking.id,
            purpose: PaymentPurpose.BOOKING,
            amountPaise: booking.finalFareMinor,
            idempotencyKey,
          },
        });
        created = true;
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }
        payment = await this.resolveConflict(principal.userId, idempotencyKey, booking.id);
      }
    }

    if (payment.amountPaise !== booking.finalFareMinor) {
      throw new Error(`Booking payment ${payment.id} does not match the booking fare`);
    }
    if (payment.razorpayOrderId) {
      return payment;
    }
    if (payment.status !== 'PENDING') {
      throw new AppError(
        ErrorCode.PAYMENT_PROVIDER_ERROR,
        HttpStatus.BAD_GATEWAY,
        'This payment could not be started. Retry with a new Idempotency-Key',
        { paymentId: payment.id },
      );
    }

    const current = await this.orders.ensureOrder(payment, !created, {
      payment_id: payment.id,
      purpose: payment.purpose,
      booking_id: booking.id,
    });
    this.logger.log(
      { paymentId: current.id, bookingId, orderId: current.razorpayOrderId },
      'Booking payment order created',
    );
    return current;
  }

  /** The booking and its latest payment attempt. */
  async getState(principal: Principal, bookingId: string): Promise<BookingPaymentState> {
    const booking = await this.findOwnedBooking(principal, bookingId);
    const payment = await this.prisma.payment.findFirst({
      where: { bookingId: booking.id, purpose: PaymentPurpose.BOOKING },
      orderBy: { createdAt: 'desc' },
    });
    return { booking, payment };
  }

  /**
   * Checks the Checkout signature, then confirms the payment with Razorpay before marking the
   * booking paid. The app's success callback alone never marks anything paid.
   */
  async verify(
    principal: Principal,
    bookingId: string,
    body: VerifyTopUpRequest,
  ): Promise<BookingVerifyResult> {
    const booking = await this.findOwnedBooking(principal, bookingId);
    this.assertLegacyPrepaid(booking);
    const payment = await this.prisma.payment.findFirst({
      where: {
        bookingId: booking.id,
        purpose: PaymentPurpose.BOOKING,
        razorpayOrderId: body.razorpayOrderId,
      },
    });
    if (!payment?.razorpayOrderId) {
      throw new AppError(
        ErrorCode.PAYMENT_ORDER_MISMATCH,
        HttpStatus.BAD_REQUEST,
        'This payment does not belong to this booking',
      );
    }

    const signatureValid = isValidCheckoutSignature({
      orderId: payment.razorpayOrderId, // from our database, never from the request
      paymentId: body.razorpayPaymentId,
      signature: body.razorpaySignature,
      keySecret: this.config.razorpay.keySecret,
    });
    if (!signatureValid) {
      this.logger.warn(
        { bookingId, userId: principal.userId },
        'Rejected booking payment verification with an invalid signature',
      );
      throw new AppError(
        ErrorCode.INVALID_PAYMENT_SIGNATURE,
        HttpStatus.BAD_REQUEST,
        'Payment signature is invalid',
      );
    }

    let result;
    try {
      result = await this.confirmation.confirm(payment.id, body.razorpayPaymentId, {
        source: 'CHECKOUT_VERIFY',
      });
    } catch (error) {
      throw toProviderAppError(error);
    }
    if (ANOMALY_OUTCOMES.has(result.outcome)) {
      throw new AppError(
        ErrorCode.PAYMENT_VERIFICATION_FAILED,
        HttpStatus.CONFLICT,
        'This payment could not be applied automatically. Support has been alerted',
        { paymentId: payment.id, outcome: result.outcome },
      );
    }

    const [fresh, freshBooking] = await Promise.all([
      this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } }),
      this.prisma.booking.findUniqueOrThrow({ where: { id: booking.id }, include: { trip: true } }),
    ]);
    return { booking: freshBooking, payment: fresh, providerStatus: result.providerStatus };
  }

  /**
   * In-app payment exists only for historical PREPAID_UPI bookings, so they can still be paid
   * and verified. Every other booking pays the driver at pickup or at delivery. The database
   * enforces the same rule on every booking payment row (trg_payments_booking_insert_guard).
   */
  private assertLegacyPrepaid(booking: Booking): void {
    if (booking.paymentMethod !== 'PREPAID_UPI') {
      throw new AppError(
        ErrorCode.BOOKING_NOT_PAYABLE,
        HttpStatus.CONFLICT,
        'This booking is paid to the driver at pickup or delivery',
        { paymentMethod: booking.paymentMethod },
      );
    }
    if (booking.paymentModel !== 'LEGACY_BOOKING_LEVEL') {
      throw new AppError(
        ErrorCode.BOOKING_NOT_PAYABLE,
        HttpStatus.CONFLICT,
        'In-app payment is available only for bookings made before pay at pickup',
        { paymentModel: booking.paymentModel },
      );
    }
  }

  private assertPayable(booking: Booking): void {
    this.assertLegacyPrepaid(booking);
    if (booking.paymentStatus !== 'UNPAID') {
      throw new AppError(
        ErrorCode.BOOKING_ALREADY_PAID,
        HttpStatus.CONFLICT,
        'This booking is already paid',
      );
    }
    if (booking.status === 'CANCELLED' || booking.status === 'COMPLETED') {
      throw new AppError(ErrorCode.BOOKING_CLOSED, HttpStatus.CONFLICT, 'This booking is closed', {
        status: booking.status,
      });
    }
  }

  private findLivePayment(bookingId: string): Promise<Payment | null> {
    return this.prisma.payment.findFirst({
      where: { bookingId, purpose: PaymentPurpose.BOOKING, status: { not: 'FAILED' } },
    });
  }

  /** A unique violation means a concurrent start, or a reused Idempotency-Key. */
  private async resolveConflict(
    userId: string,
    idempotencyKey: string,
    bookingId: string,
  ): Promise<Payment> {
    const byKey = await this.prisma.payment.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
    });
    if (byKey) {
      if (byKey.purpose !== PaymentPurpose.BOOKING || byKey.bookingId !== bookingId) {
        throw new AppError(
          ErrorCode.IDEMPOTENCY_KEY_REUSED,
          HttpStatus.CONFLICT,
          'This idempotency key was already used for a different request',
        );
      }
      return byKey;
    }
    const live = await this.findLivePayment(bookingId);
    if (!live) {
      throw new Error('Booking payment conflict without a conflicting row');
    }
    return live;
  }

  private async findOwnedBooking(
    principal: Principal,
    bookingId: string,
  ): Promise<BookingWithTrip> {
    const customer = requireCustomer(principal);
    // Ownership is part of the query, so another customer's booking behaves like a missing one.
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, customerId: customer.id },
      include: { trip: true },
    });
    if (!booking) {
      throw new AppError(ErrorCode.BOOKING_NOT_FOUND, HttpStatus.NOT_FOUND, 'Booking not found');
    }
    return booking;
  }
}

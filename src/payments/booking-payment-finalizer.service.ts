import { Injectable, Logger } from '@nestjs/common';
import { applyBookingPaid } from '../bookings/booking-payment-state';
import { lockBooking, lockTripOfBooking } from '../bookings/booking-locks';
import type { PaymentStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import type { RazorpayPayment } from '../razorpay/razorpay.types';
import {
  type ConfirmationOutcome,
  ConfirmationOutcome as Outcome,
  PaymentPurpose,
} from './payment.constants';
import type { FinalizeContext } from './top-up-finalizer.service';
import { normalizeMethod } from './payment-method';

interface LockedPaymentRow {
  readonly id: string;
  readonly status: PaymentStatus;
  readonly amount_paise: bigint;
  readonly currency: string;
  readonly razorpay_order_id: string | null;
  readonly razorpay_payment_id: string | null;
}

/**
 * Applies a captured, already-verified Razorpay payment to a customer's PREPAID booking exactly
 * once. One transaction, with the shared lock order:
 *
 *   lock booking -> lock trip -> lock payment -> re-check -> payment PAID -> booking PAID
 *   (-> trip PAYMENT_CONFIRMED if it was already delivered)
 *
 * The money goes to Nikhil Enterprises' Razorpay account. The driver's share becomes a
 * driver earning when the trip completes; nothing here touches the driver wallet.
 */
@Injectable()
export class BookingPaymentFinalizerService {
  private readonly logger = new Logger(BookingPaymentFinalizerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async finalizeCapturedBookingPayment(
    paymentId: string,
    providerPayment: RazorpayPayment,
    context: FinalizeContext,
  ): Promise<ConfirmationOutcome> {
    const owner = await this.prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: { purpose: true, bookingId: true },
    });
    if (owner.purpose !== PaymentPurpose.BOOKING || !owner.bookingId) {
      throw new Error('Payment is not a booking payment');
    }
    const bookingId = owner.bookingId;

    const outcome = await this.prisma.runInTransaction(async (tx) => {
      const booking = await lockBooking(tx, bookingId);
      if (!booking) {
        throw new Error('Booking disappeared during finalization');
      }
      const trip = await lockTripOfBooking(tx, bookingId);
      const [locked] = await tx.$queryRaw<LockedPaymentRow[]>`
        SELECT id, status, amount_paise, currency, razorpay_order_id, razorpay_payment_id
        FROM payments
        WHERE id = ${paymentId}::uuid
        FOR UPDATE`;
      if (!locked) {
        throw new Error('Payment disappeared during finalization');
      }
      const orderAmount = BigInt(locked.amount_paise);

      if (locked.status === 'PAID') {
        return locked.razorpay_payment_id === providerPayment.id
          ? Outcome.ALREADY_APPLIED
          : Outcome.DUPLICATE_ORDER_PAYMENT;
      }
      if (locked.status !== 'PENDING') {
        return Outcome.PAYMENT_NOT_PENDING;
      }
      if (!locked.razorpay_order_id || locked.razorpay_order_id !== providerPayment.orderId) {
        return Outcome.ORDER_MISMATCH;
      }
      if (
        providerPayment.currency !== locked.currency ||
        BigInt(providerPayment.amount) !== orderAmount ||
        orderAmount !== booking.finalFareMinor
      ) {
        return Outcome.AMOUNT_MISMATCH;
      }
      if (booking.paymentStatus !== 'UNPAID') {
        // Unreachable while the one-live-payment-per-booking index holds; refuse to double count.
        return Outcome.DUPLICATE_BOOKING_PAYMENT;
      }

      await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: 'PAID',
          razorpayPaymentId: providerPayment.id,
          paymentMethod: normalizeMethod(providerPayment.method),
        },
      });
      // The customer's money was received; the booking records it even if it was cancelled
      // meanwhile, so the refund review (D-22) sees an accurate state.
      await applyBookingPaid(tx, booking, trip, new Date());
      return booking.status === 'CANCELLED' ? Outcome.PAID_AFTER_CANCELLATION : Outcome.APPLIED;
    });

    if (outcome === Outcome.APPLIED || outcome === Outcome.PAID_AFTER_CANCELLATION) {
      this.logger.log(
        { paymentId, bookingId, providerPaymentId: providerPayment.id, source: context.source },
        'Booking payment applied',
      );
    }
    return outcome;
  }
}

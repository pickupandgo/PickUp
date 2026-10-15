import type { Booking, BookingStop, PaymentCollection, Trip } from '../generated/prisma/client';
import type { Tx } from '../prisma/prisma.service';
import { collectedPaymentStatus } from './booking-payment-status';

export interface BookingPaidResult {
  /** True when this call moved the trip from DELIVERED to PAYMENT_CONFIRMED. */
  readonly paymentConfirmed: boolean;
}

/**
 * True for a historical PREPAID_UPI booking (registered before fare quotes): the only bookings
 * that may be paid in the app through Razorpay Checkout. Every new booking pays at pickup or at
 * delivery. The database enforces the same rule on payment rows (trg_payments_booking_insert_guard).
 */
export function isHistoricalPrepaid(
  booking: Pick<Booking, 'paymentMethod' | 'paymentModel'>,
): boolean {
  return booking.paymentMethod === 'PREPAID_UPI' && booking.paymentModel === 'LEGACY_BOOKING_LEVEL';
}

/**
 * Records that the customer's money for a booking has been received and verified (prepaid
 * payment, QR collection or cash). The caller must hold the booking and trip locks.
 *
 * If the trip is already DELIVERED, its payment is confirmed in the same transaction (M6 payment
 * gate). Otherwise the trip is confirmed later, when the engine reports DELIVERED.
 */
export async function applyBookingPaid(
  tx: Tx,
  booking: Booking,
  trip: Trip | null,
  now: Date,
): Promise<BookingPaidResult> {
  if (booking.paymentStatus === 'UNPAID') {
    await tx.booking.update({ where: { id: booking.id }, data: { paymentStatus: 'PAID' } });
  }
  if (trip?.status === 'DELIVERED') {
    await tx.trip.update({
      where: { id: trip.id },
      data: { status: 'PAYMENT_CONFIRMED', paymentConfirmedAt: now },
    });
    return { paymentConfirmed: true };
  }
  return { paymentConfirmed: false };
}

export interface CollectionCompletedResult {
  /** The drop the collection paid for, after the change; null for the whole booking. */
  readonly stop: BookingStop | null;
}

/**
 * The effects of a collection that has just completed, in its transaction. The caller holds the
 * locks in the documented order: booking -> trip -> stops (payment flow review, section J).
 *
 *   The whole booking (pickup, historical delivery): the booking is PAID (applyBookingPaid).
 *   A drop: the drop's payment is confirmed (ARRIVED -> PAYMENT_CONFIRMED), and the booking is
 *     PARTIALLY_PAID or PAID, as its completed collections say. A drop that failed meanwhile keeps
 *     its status (its paid retry confirms the payment), and so does one cancelled with its
 *     booking or resolved as undelivered: the money is recorded either way.
 *
 * A DELIVERED trip moves to PAYMENT_CONFIRMED. The database checks the same effects at commit
 * (trg_collections_effects), so no collection completes without them.
 */
export async function applyCollectionCompleted(
  tx: Tx,
  booking: Booking,
  trip: Trip | null,
  stops: readonly BookingStop[],
  collection: Pick<PaymentCollection, 'bookingStopId'>,
  now: Date,
): Promise<CollectionCompletedResult> {
  if (collection.bookingStopId === null) {
    await applyBookingPaid(tx, booking, trip, now);
    return { stop: null };
  }
  const stop = stops.find((candidate) => candidate.id === collection.bookingStopId);
  if (!stop) {
    throw new Error(
      `Drop ${collection.bookingStopId} is not a locked drop of booking ${booking.id}`,
    );
  }
  const paidStop =
    stop.status === 'ARRIVED'
      ? await tx.bookingStop.update({
          where: { id: stop.id },
          data: { status: 'PAYMENT_CONFIRMED', paymentConfirmedAt: now },
        })
      : stop;

  const completed = await tx.paymentCollection.findMany({
    where: { bookingId: booking.id, status: 'COMPLETED' },
    select: { bookingStopId: true },
  });
  const status = collectedPaymentStatus({
    perDrop: true,
    stopIds: stops.map((candidate) => candidate.id),
    completed,
  });
  if (
    status !== booking.paymentStatus &&
    (booking.paymentStatus === 'UNPAID' || booking.paymentStatus === 'PARTIALLY_PAID')
  ) {
    await tx.booking.update({ where: { id: booking.id }, data: { paymentStatus: status } });
  }
  if (trip?.status === 'DELIVERED' && status !== 'UNPAID') {
    // Every drop is finished already (one paid late, after a cancellation or a resolution).
    await tx.trip.update({
      where: { id: trip.id },
      data: { status: 'PAYMENT_CONFIRMED', paymentConfirmedAt: now },
    });
  }
  return { stop: paidStop };
}

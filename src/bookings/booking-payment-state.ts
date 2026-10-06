import type { Booking, Trip } from '../generated/prisma/client';
import type { Tx } from '../prisma/prisma.service';

export interface BookingPaidResult {
  /** True when this call moved the trip from DELIVERED to PAYMENT_CONFIRMED. */
  readonly paymentConfirmed: boolean;
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

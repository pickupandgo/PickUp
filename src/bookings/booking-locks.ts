import type { Booking, Trip } from '../generated/prisma/client';
import type { Tx } from '../prisma/prisma.service';

/**
 * Row locks for booking-level money movements. Every code path takes them in the same order
 * (PW 3.3, D-07):
 *
 *   booking -> trip -> driver wallet -> payment / collection / earning -> payout rows
 *
 * Each helper locks with SELECT ... FOR UPDATE, then reads the typed row; the lock is held until
 * the caller's transaction ends.
 */
export async function lockBooking(tx: Tx, bookingId: string): Promise<Booking | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM bookings WHERE id = ${bookingId}::uuid FOR UPDATE`;
  if (rows.length === 0) {
    return null;
  }
  return tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
}

/** Locks the booking's trip, if it has one. Call after lockBooking. */
export async function lockTripOfBooking(tx: Tx, bookingId: string): Promise<Trip | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM trips WHERE booking_id = ${bookingId}::uuid FOR UPDATE`;
  const [row] = rows;
  if (!row) {
    return null;
  }
  return tx.trip.findUniqueOrThrow({ where: { id: row.id } });
}

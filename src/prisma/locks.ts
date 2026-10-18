import { Prisma } from '../generated/prisma/client';
import type { Tx } from './prisma.service';

/**
 * Locks a booking row for the rest of the transaction. The booking is the single serialization
 * point for everything about it (offers, trip, stops, outbox), so API requests, the outbox sender
 * and concurrent duplicates always take locks in the same order and never deadlock.
 * Returns false when the booking does not exist.
 */
export async function lockBooking(tx: Tx, bookingId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM engine_bookings WHERE id = ${bookingId}::uuid FOR UPDATE`;
  return rows.length > 0;
}

/** True for a unique-constraint violation (Prisma P2002). */
export function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

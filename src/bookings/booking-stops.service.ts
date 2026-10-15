import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { recordAdminAction } from '../audit/admin-actions';
import type { Principal } from '../auth/principal';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { paiseToNumber } from '../common/money';
import type { Booking, BookingStop, Prisma, Trip } from '../generated/prisma/client';
import type { BookingStopStatus } from '../generated/prisma/enums';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { lockBooking, lockStopsOfBooking, lockTripOfBooking } from './booking-locks';
import {
  decideEngineStopRequest,
  decideStopResolution,
  type EngineStopStatus,
  focusStop,
  type StopContext,
  type StopDecision,
  type StopRefusal,
  type StopResolution,
  type StopState,
  tripAdvanceAfterStops,
} from './stop-lifecycle';
import { FINAL_TRIP_STATUSES, tripLifecycleUpdate } from './trip-lifecycle';

export interface StopUpdateResult {
  readonly booking: Booking;
  readonly trip: Trip | null;
  readonly stop: BookingStop;
  /** False when the drop was already where the request would take it (a repeat). */
  readonly changed: boolean;
}

/** The booking, its trip and its drops, locked in that order. */
interface LockedStops {
  readonly booking: Booking;
  readonly trip: Trip | null;
  readonly stops: readonly BookingStop[];
  readonly stop: BookingStop;
  /** Drops with a completed collection of their own (pay-at-delivery drops, Phase 4). */
  readonly paidStopIds: ReadonlySet<string>;
}

/** The facts a move records besides its timestamp. */
interface StopFacts {
  readonly failureReason?: string | null;
  readonly resolvedByUserId?: string;
  readonly resolutionReason?: string;
}

const REFUSAL_MESSAGES: Readonly<
  Record<'TRIP_NOT_UNDER_WAY' | 'OUT_OF_ORDER' | 'INVALID_TRANSITION', string>
> = {
  TRIP_NOT_UNDER_WAY: 'A drop is reached only while the trip is under way',
  OUT_OF_ORDER: 'Drops are handled in order: the current or an earlier drop is not finished yet',
  INVALID_TRANSITION: 'This drop cannot make that move now',
};

/**
 * The stop lifecycle of bookings priced per drop (payment flow Phase 3): drops reported by the
 * trip engine, and failed attempts resolved by an admin. Each change is one transaction that
 * locks booking -> trip -> stops, moves the drop, then moves the trip with it: DROP_PROGRESS when
 * a drop is first reached, DELIVERED once every drop is finished, and PAYMENT_CONFIRMED straight
 * away when the booking is already paid. The database checks every move again
 * (guard_booking_stop_update, guard_trip_change). A drop's payment is confirmed by its own
 * collection, which comes with per-drop collection (Phase 4); nothing here confirms a payment.
 */
@Injectable()
export class BookingStopsService {
  private readonly logger = new Logger(BookingStopsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * A drop's status reported by the trip engine. Repeats, and statuses the drop has already
   * passed, change nothing. ARRIVED on a failed attempt is its retry.
   */
  async report(
    tripId: string,
    sequence: number,
    requested: EngineStopStatus,
    reason: string | null,
  ): Promise<StopUpdateResult> {
    const located = await this.prisma.trip.findUnique({
      where: { id: tripId },
      select: { bookingId: true },
    });
    if (!located) {
      throw tripNotFound();
    }
    return this.prisma.runInTransaction(async (tx) => {
      const locked = await this.lock(tx, located.bookingId, sequence);
      if (!locked.trip || locked.trip.id !== tripId) {
        throw tripNotFound();
      }
      const decision = decideEngineStopRequest(
        contextOf(locked),
        stateOf(locked, locked.stop),
        requested,
      );
      return this.apply(tx, locked, decision, requested, { failureReason: reason });
    });
  }

  /**
   * An admin's decision on a failed delivery attempt: RETRY makes the drop current again,
   * UNDELIVERED closes it without delivery. Both are audited in the same transaction (the
   * database requires the record for UNDELIVERED). Repeating a decision changes nothing.
   */
  async resolve(
    admin: Principal,
    bookingId: string,
    sequence: number,
    resolution: StopResolution,
    reason: string,
  ): Promise<StopUpdateResult> {
    return this.prisma.runInTransaction(async (tx) => {
      const locked = await this.lock(tx, bookingId, sequence);
      const decision = decideStopResolution(
        contextOf(locked),
        stateOf(locked, locked.stop),
        resolution,
      );
      if (decision.kind === 'MOVE') {
        await recordAdminAction(tx, {
          actorUserId: admin.userId,
          action: resolution === 'UNDELIVERED' ? 'BOOKING_STOP_UNDELIVERED' : 'BOOKING_STOP_RETRY',
          targetType: 'BOOKING_STOP',
          targetId: locked.stop.id,
          reason,
          details: {
            bookingId,
            sequence,
            from: locked.stop.status,
            to: decision.to,
            failureReason: locked.stop.failureReason,
          },
        });
      }
      return this.apply(tx, locked, decision, resolution, {
        resolvedByUserId: admin.userId,
        resolutionReason: reason,
      });
    });
  }

  private async lock(tx: Tx, bookingId: string, sequence: number): Promise<LockedStops> {
    const booking = await lockBooking(tx, bookingId);
    if (!booking) {
      throw new AppError(ErrorCode.BOOKING_NOT_FOUND, HttpStatus.NOT_FOUND, 'Booking not found');
    }
    const trip = await lockTripOfBooking(tx, bookingId);
    const stops = await lockStopsOfBooking(tx, bookingId);
    const stop = stops.find((candidate) => candidate.sequence === sequence);
    if (!stop) {
      // Historical bookings have no drops at all.
      throw new AppError(
        ErrorCode.STOP_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This booking has no such drop',
        {
          sequence,
        },
      );
    }
    const paid = await tx.paymentCollection.findMany({
      where: { bookingId, bookingStopId: { not: null }, status: 'COMPLETED' },
      select: { bookingStopId: true },
    });
    return {
      booking,
      trip,
      stops,
      stop,
      paidStopIds: new Set(paid.flatMap((row) => (row.bookingStopId ? [row.bookingStopId] : []))),
    };
  }

  private async apply(
    tx: Tx,
    locked: LockedStops,
    decision: StopDecision,
    requested: string,
    facts: StopFacts,
  ): Promise<StopUpdateResult> {
    const { booking, stop } = locked;
    if (decision.kind === 'NO_CHANGE') {
      return { booking, trip: locked.trip, stop, changed: false };
    }
    if (decision.kind === 'REFUSE') {
      throw refusalError(decision.refusal, locked, requested);
    }

    const now = new Date();
    const moved = await tx.bookingStop.update({
      where: { id: stop.id },
      data: stopUpdate(stop, decision.to, now, facts),
    });
    const stops = locked.stops.map((candidate) => (candidate.id === moved.id ? moved : candidate));
    let trip = locked.trip;
    if (trip) {
      for (const status of tripAdvanceAfterStops(trip.status, stops)) {
        trip = await tx.trip.update({
          where: { id: trip.id },
          data: tripLifecycleUpdate(status, now),
        });
      }
      if (trip.status === 'DELIVERED' && booking.paymentStatus !== 'UNPAID') {
        // Already paid (at pickup): delivering the last drop confirms the payment gate.
        trip = await tx.trip.update({
          where: { id: trip.id },
          data: tripLifecycleUpdate('PAYMENT_CONFIRMED', now),
        });
      }
    }
    this.logger.log(
      {
        bookingId: booking.id,
        tripId: trip?.id,
        sequence: stop.sequence,
        from: stop.status,
        to: moved.status,
        tripStatus: trip?.status,
      },
      'Drop moved',
    );
    return { booking, trip, stop: moved, changed: true };
  }
}

function contextOf(locked: LockedStops): StopContext {
  const { booking, trip } = locked;
  return {
    paymentMethod: booking.paymentMethod,
    bookingPaid: booking.paymentStatus !== 'UNPAID',
    closed:
      booking.status === 'CANCELLED' ||
      booking.status === 'COMPLETED' ||
      (trip !== null && FINAL_TRIP_STATUSES.has(trip.status)),
    tripStatus: trip?.status ?? null,
    stops: locked.stops.map((stop) => stateOf(locked, stop)),
  };
}

function stateOf(locked: LockedStops, stop: BookingStop): StopState {
  return {
    sequence: stop.sequence,
    status: stop.status,
    paid: locked.paidStopIds.has(stop.id),
    failedAt: stop.failedAt,
  };
}

/** The row change for a move: the new status and the fact that records it. */
function stopUpdate(
  stop: Pick<BookingStop, 'paymentConfirmedAt'>,
  to: BookingStopStatus,
  now: Date,
  facts: StopFacts,
): Prisma.BookingStopUncheckedUpdateInput {
  switch (to) {
    case 'ARRIVED':
      // Reached, or reached again after a failed attempt.
      return { status: to, arrivedAt: now };
    case 'PAYMENT_CONFIRMED':
      // Reached again after a failed attempt, already paid: the drop stays paid. A payment that
      // arrived while the attempt had failed is confirmed now (payment flow Phase 4).
      return {
        status: to,
        arrivedAt: now,
        ...(stop.paymentConfirmedAt ? {} : { paymentConfirmedAt: now }),
      };
    case 'DELIVERED':
      return { status: to, deliveredAt: now };
    case 'DELIVERY_FAILED':
      if (!facts.failureReason) {
        throw new Error('A failed delivery attempt needs its reason');
      }
      return { status: to, failedAt: now, failureReason: facts.failureReason };
    case 'UNDELIVERED':
      if (!facts.resolvedByUserId || !facts.resolutionReason) {
        throw new Error('An undelivered drop needs the resolving admin and the reason');
      }
      return {
        status: to,
        resolvedAt: now,
        resolvedByUserId: facts.resolvedByUserId,
        resolutionReason: facts.resolutionReason,
      };
    default:
      throw new Error(`The stop lifecycle never moves a drop to ${to} here`);
  }
}

function refusalError(refusal: StopRefusal, locked: LockedStops, requested: string): AppError {
  const { booking, trip, stop } = locked;
  switch (refusal) {
    case 'BOOKING_CLOSED':
      return new AppError(ErrorCode.BOOKING_CLOSED, HttpStatus.CONFLICT, 'This booking is closed', {
        status: booking.status,
        tripStatus: trip?.status ?? null,
      });
    case 'PAYMENT_REQUIRED':
      return booking.paymentMethod === 'PAY_AT_PICKUP'
        ? new AppError(
            ErrorCode.PAYMENT_REQUIRED,
            HttpStatus.CONFLICT,
            'Payment is required before the pickup handover',
            { stage: 'PICKUP', amountPaise: paiseToNumber(booking.finalFareMinor) },
          )
        : new AppError(
            ErrorCode.PAYMENT_REQUIRED,
            HttpStatus.CONFLICT,
            'This drop must be paid before its goods are handed over',
            {
              stage: 'DROP',
              stopSequence: stop.sequence,
              amountPaise: paiseToNumber(stop.payablePaise),
            },
          );
    default:
      return new AppError(
        ErrorCode.INVALID_STOP_TRANSITION,
        HttpStatus.CONFLICT,
        REFUSAL_MESSAGES[refusal],
        {
          from: stop.status,
          to: requested,
          currentStop: focusStop(locked.stops)?.sequence ?? null,
          tripStatus: trip?.status ?? null,
          reason: refusal,
        },
      );
  }
}

function tripNotFound(): AppError {
  return new AppError(ErrorCode.TRIP_NOT_FOUND, HttpStatus.NOT_FOUND, 'Trip not found');
}

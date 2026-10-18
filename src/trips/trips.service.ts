import {
  BadRequestException,
  ForbiddenException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { otpMatches } from '../common/otp';
import { engineError, paymentBackendUnavailable } from '../common/errors';
import { DriversService } from '../drivers/drivers.service';
import type {
  EngineOutbox,
  EngineTripStatus,
} from '../generated/prisma/client';
import { OutboxService } from '../outbox/outbox.service';
import { PaymentBackendClient } from '../payment-backend/payment-backend.client';
import type { InternalBooking } from '../payment-backend/payment-backend.types';
import { lockBooking } from '../prisma/locks';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { paymentRequired, refusedCommand } from './payment-gate';
import {
  FINAL_STOP_STATUSES,
  FINAL_TRIP_STATUSES,
  nextStopIndex,
  tripReached,
} from './trip-progress';
import { type TripBundle, type TripView, tripView } from './trip-views';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Trip statuses a trip may be cancelled from (unchanged engine rule). */
const CANCELLABLE: ReadonlySet<EngineTripStatus> = new Set([
  'DRIVER_ASSIGNED',
  'DRIVER_ARRIVED',
  'PICKUP_VERIFIED',
]);

export interface ActionResult {
  /** False when the step was already done (a repeat changes nothing). */
  readonly changed: boolean;
  readonly trip: TripView;
  /** The payment gate the payment backend returned with this report, when it answered. */
  readonly paymentGate?: InternalBooking['paymentGate'] | null;
  /** Whether this report has reached the payment backend: DELIVERED, PENDING (retried) or NONE. */
  readonly paymentSync?: 'DELIVERED' | 'PENDING' | 'REFUSED' | 'NONE';
}

export interface CompletionResult extends ActionResult {
  /** COMPLETED, or PENDING while the payment backend has not confirmed the completion. */
  readonly completion: 'COMPLETED' | 'PENDING';
  readonly waitingFor?: string | null;
}

/**
 * The engine's operational trip lifecycle, persisted, with the payment backend's authority over
 * money (review F, engine contract):
 *
 *   arrive (pickup)        committed, reported through the outbox (DRIVER_ARRIVED)
 *   pickup OTP             payment gate read first (handoverAllowed); then PICKUP_VERIFIED backend
 *                          first: committed only once the payment backend accepted it
 *   start                  IN_TRANSIT backend first
 *   stop arrive            committed, reported through the outbox (stop ARRIVED); also the retry of
 *                          a failed delivery
 *   stop OTP               payment gate read first (that drop's handoverAllowed)
 *   stop delivered         DELIVERED backend first: an unpaid drop is never delivered
 *   stop failed            committed with its reason, reported through the outbox
 *   complete               COMPLETED backend first, retried by the outbox while payment is pending
 *   cancel                 committed with its reason, reported through the outbox
 *
 * Every caller is the verified driver (or customer) of the trip: identity is the token subject.
 */
@Injectable()
export class TripsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly backend: PaymentBackendClient,
    private readonly drivers: DriversService,
  ) {}

  // ──── READS ────

  async getTrip(tripId: string, subject: string): Promise<TripView> {
    const bundle = await this.load(tripId);
    this.assertParticipant(bundle, subject);
    return tripView(bundle);
  }

  async viewForBooking(bookingId: string): Promise<TripView | null> {
    const trip = await this.prisma.engineTrip.findFirst({
      where: { bookingId },
      orderBy: [{ createdAt: 'desc' }],
    });
    return trip ? tripView(await this.load(trip.id)) : null;
  }

  async getActiveTripForCustomer(subject: string): Promise<TripView | null> {
    const trip = await this.prisma.engineTrip.findFirst({
      where: {
        booking: { customerSubject: subject },
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    return trip ? tripView(await this.load(trip.id)) : null;
  }

  async getActiveTripForDriver(subject: string): Promise<TripView | null> {
    const trip = await this.prisma.engineTrip.findFirst({
      where: {
        driverSubject: subject,
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    return trip ? tripView(await this.load(trip.id)) : null;
  }

  async getCustomerHistory(subject: string): Promise<TripView[]> {
    const trips = await this.prisma.engineTrip.findMany({
      where: {
        booking: { customerSubject: subject },
        status: { in: ['COMPLETED', 'CANCELLED'] },
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: { id: true },
    });
    return Promise.all(
      trips.map(async (trip) => tripView(await this.load(trip.id))),
    );
  }

  async getDriverHistory(subject: string): Promise<TripView[]> {
    const trips = await this.prisma.engineTrip.findMany({
      where: {
        driverSubject: subject,
        status: { in: ['COMPLETED', 'CANCELLED'] },
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: { id: true },
    });
    return Promise.all(
      trips.map(async (trip) => tripView(await this.load(trip.id))),
    );
  }

  async getCurrentStop(tripId: string, subject: string) {
    const view = await this.getTrip(tripId, subject);
    if (!view.currentStop) {
      throw new BadRequestException('All stops have been completed');
    }
    return view.currentStop;
  }

  async getStopProgress(tripId: string, subject: string) {
    const view = await this.getTrip(tripId, subject);
    return {
      current: Math.min(view.currentStopIndex + 1, view.totalStops),
      total: view.totalStops,
      completedStops: view.completedStops,
      remainingStops: view.remainingStops,
      stops: view.stops,
      currentStop: view.currentStop,
    };
  }

  // ──── PRE-PICKUP ────

  async arrive(tripId: string, subject: string): Promise<ActionResult> {
    const { bookingId } = await this.locate(tripId);
    const outboxId = await this.mutate(
      tripId,
      subject,
      async (tx, { trip }) => {
        if (FINAL_TRIP_STATUSES.has(trip.status)) {
          throw invalidTransition(trip.status, 'DRIVER_ARRIVED');
        }
        if (trip.status !== 'DRIVER_ASSIGNED') {
          return null; // already arrived: a repeat changes nothing
        }
        await tx.engineTrip.update({
          where: { id: tripId },
          data: { status: 'DRIVER_ARRIVED', arrivedAt: new Date() },
        });
        return this.outbox.enqueue(tx, {
          bookingId,
          mode: 'EVENT',
          kind: 'TRIP_STATUS',
          payload: { tripId, status: 'DRIVER_ARRIVED' },
        });
      },
    );
    return this.reported(tripId, bookingId, outboxId);
  }

  async confirmPickupWithOtp(
    tripId: string,
    subject: string,
    otp: string,
  ): Promise<ActionResult> {
    const { bookingId } = await this.locate(tripId);
    let bundle = await this.loadForDriver(tripId, subject);
    if (tripReached(bundle.trip.status, 'PICKUP_VERIFIED')) {
      return this.repeatWithOtp(bundle, otp, bundle.booking.pickupOtp);
    }
    if (bundle.trip.status !== 'DRIVER_ARRIVED') {
      throw invalidTransition(bundle.trip.status, 'PICKUP_VERIFIED');
    }
    // The payment backend must know the driver is there before it can allow a handover.
    await this.requireSynced(bookingId);
    bundle = await this.loadForDriver(tripId, subject);
    if (tripReached(bundle.trip.status, 'PICKUP_VERIFIED')) {
      return this.repeatWithOtp(bundle, otp, bundle.booking.pickupOtp);
    }
    // Pickup gate, read fresh: no OTP is even checked before the handover is allowed.
    const gate = await this.readGate(bundle);
    if (gate.stage !== 'PICKUP' || !gate.handoverAllowed) {
      throw paymentRequired('Payment is required before the pickup handover', {
        ...gate,
        stage: 'PICKUP',
      });
    }
    const commandId = await this.mutate(
      tripId,
      subject,
      async (tx, current) => {
        if (tripReached(current.trip.status, 'PICKUP_VERIFIED')) {
          // A duplicate request was confirmed meanwhile: same answer, nothing new.
          if (!otpMatches(current.booking.pickupOtp, otp)) {
            throw new BadRequestException(
              'Invalid OTP. Please ask the customer for the correct code.',
            );
          }
          return null;
        }
        if (current.trip.status !== 'DRIVER_ARRIVED') {
          throw invalidTransition(current.trip.status, 'PICKUP_VERIFIED');
        }
        if (!otpMatches(current.booking.pickupOtp, otp)) {
          throw new BadRequestException(
            'Invalid OTP. Please ask the customer for the correct code.',
          );
        }
        const pending = await this.outbox.findPending(
          tx,
          bookingId,
          'TRIP_STATUS',
          {
            status: 'PICKUP_VERIFIED',
          },
        );
        return (
          pending?.id ??
          this.outbox.enqueue(tx, {
            bookingId,
            mode: 'COMMAND',
            kind: 'TRIP_STATUS',
            payload: { tripId, status: 'PICKUP_VERIFIED' },
          })
        );
      },
    );
    return this.awaitCommand(
      tripId,
      bookingId,
      commandId,
      'the pickup handover',
    );
  }

  // ──── MULTI-STOP DROP ACTIONS ────

  async startTrip(tripId: string, subject: string): Promise<ActionResult> {
    const { bookingId } = await this.locate(tripId);
    const bundle = await this.loadForDriver(tripId, subject);
    if (tripReached(bundle.trip.status, 'IN_TRANSIT')) {
      return { changed: false, trip: tripView(bundle), paymentSync: 'NONE' };
    }
    if (bundle.trip.status !== 'PICKUP_VERIFIED') {
      throw new BadRequestException(
        `startTrip requires PICKUP_VERIFIED status, current: ${bundle.trip.status}`,
      );
    }
    const commandId = await this.mutate(
      tripId,
      subject,
      async (tx, current) => {
        if (tripReached(current.trip.status, 'IN_TRANSIT')) {
          return null; // started by a duplicate request meanwhile
        }
        if (current.trip.status !== 'PICKUP_VERIFIED') {
          throw new BadRequestException(
            `startTrip requires PICKUP_VERIFIED status, current: ${current.trip.status}`,
          );
        }
        const first = current.stops[0];
        if (!first) {
          throw new BadRequestException('Trip has no stops');
        }
        if (first.status !== 'PENDING') {
          throw new BadRequestException(
            `First stop is already ${first.status}`,
          );
        }
        const pending = await this.outbox.findPending(
          tx,
          bookingId,
          'TRIP_STATUS',
          {
            status: 'IN_TRANSIT',
          },
        );
        return (
          pending?.id ??
          this.outbox.enqueue(tx, {
            bookingId,
            mode: 'COMMAND',
            kind: 'TRIP_STATUS',
            payload: { tripId, status: 'IN_TRANSIT' },
          })
        );
      },
    );
    return this.awaitCommand(
      tripId,
      bookingId,
      commandId,
      'the start of the trip',
    );
  }

  /**
   * The driver reached the current drop (or tries a failed drop again). Committed here and
   * reported through the outbox: the drop's payment can then be collected at the backend.
   */
  async arriveAtStop(
    tripId: string,
    subject: string,
    stopId?: string,
  ): Promise<ActionResult> {
    const { bookingId } = await this.locate(tripId);
    const outboxId = await this.mutate(
      tripId,
      subject,
      async (tx, { trip, stops }) => {
        const current = stops[trip.currentStopIndex];
        if (trip.status === 'DROP_PROGRESS' && current) {
          assertCurrentStop(current, stopId);
          if (current.status === 'ARRIVED') {
            return null; // already there: a repeat changes nothing
          }
          if (current.status !== 'DELIVERY_FAILED') {
            throw new BadRequestException(
              `Stop ${current.sequence} must be IN_TRANSIT to arrive (current: ${current.status})`,
            );
          }
          // Retry of a failed delivery: the backend makes the drop current again.
          await tx.engineStop.update({
            where: { id: current.id },
            data: {
              status: 'ARRIVED',
              arrivedAt: new Date(),
              otpVerified: false,
            },
          });
          return this.enqueueStop(
            tx,
            bookingId,
            tripId,
            current.sequence,
            'ARRIVED',
          );
        }
        if (trip.status !== 'IN_TRANSIT') {
          throw new BadRequestException(
            `Cannot arrive at stop: trip is ${trip.status}, expected IN_TRANSIT`,
          );
        }
        if (!current) {
          throw new BadRequestException('No active stop to arrive at');
        }
        assertCurrentStop(current, stopId);
        if (current.status === 'DELIVERED') {
          throw new BadRequestException(
            `Stop ${current.sequence} is already delivered.`,
          );
        }
        if (current.status !== 'IN_TRANSIT') {
          throw new BadRequestException(
            `Stop ${current.sequence} must be IN_TRANSIT to arrive (current: ${current.status})`,
          );
        }
        const now = new Date();
        await tx.engineStop.update({
          where: { id: current.id },
          data: { status: 'ARRIVED', arrivedAt: now },
        });
        await tx.engineTrip.update({
          where: { id: tripId },
          data: { status: 'DROP_PROGRESS' },
        });
        return this.enqueueStop(
          tx,
          bookingId,
          tripId,
          current.sequence,
          'ARRIVED',
        );
      },
    );
    return this.reported(tripId, bookingId, outboxId);
  }

  /** Drop OTP: only once the payment backend allows this drop's handover. */
  async verifyStopOtp(
    tripId: string,
    subject: string,
    otp: string,
    stopId?: string,
  ): Promise<ActionResult> {
    const { bookingId } = await this.locate(tripId);
    let bundle = await this.loadForDriver(tripId, subject);
    let stop = assertOtpStop(bundle, stopId);
    if (stop.otpVerified) {
      return this.repeatWithOtp(
        bundle,
        otp,
        stop.otp,
        `OTP for Stop ${stop.sequence} is already verified. Please submit delivery photo proof.`,
      );
    }
    // The payment backend must know the driver is at this drop before it can allow its handover.
    await this.requireSynced(bookingId);
    bundle = await this.loadForDriver(tripId, subject);
    stop = assertOtpStop(bundle, stopId);
    const gate = await this.readGate(bundle);
    if (
      gate.stage !== 'DROP' ||
      gate.stopSequence !== stop.sequence ||
      !gate.handoverAllowed
    ) {
      throw paymentRequired(
        `Payment is required before the handover at Stop ${stop.sequence}`,
        {
          ...gate,
          stage: 'DROP',
          stopSequence: stop.sequence,
        },
      );
    }
    const changed = await this.mutate(tripId, subject, async (tx, current) => {
      const target = assertOtpStop(current, stopId);
      if (!otpMatches(target.otp, otp)) {
        throw new BadRequestException(
          `Invalid OTP for Stop ${target.sequence}. Ask the receiver for the correct code. (currentStopIndex unchanged)`,
        );
      }
      if (target.otpVerified) {
        return false; // verified by a duplicate request meanwhile
      }
      await tx.engineStop.update({
        where: { id: target.id },
        data: { otpVerified: true },
      });
      return true;
    });
    return {
      changed,
      trip: tripView(await this.load(tripId)),
      paymentSync: 'NONE',
    };
  }

  /** Delivered, backend first: the drop is committed only once the payment backend accepts. */
  async confirmStopDeliveryWithProof(
    tripId: string,
    subject: string,
    stopId: string | undefined,
    photo: { uri: string },
  ): Promise<ActionResult> {
    const { bookingId } = await this.locate(tripId);
    const bundle = await this.loadForDriver(tripId, subject);
    const already = stopId
      ? bundle.stops.find((stop) => stop.id === stopId)
      : undefined;
    if (already?.status === 'DELIVERED') {
      return { changed: false, trip: tripView(bundle), paymentSync: 'NONE' };
    }
    const commandId = await this.mutate(
      tripId,
      subject,
      async (tx, current) => {
        const delivered = stopId
          ? current.stops.find((stop) => stop.id === stopId)
          : undefined;
        if (delivered?.status === 'DELIVERED') {
          return null; // delivered by a duplicate request meanwhile
        }
        const stop = assertDeliverableStop(current, stopId);
        if (!photo.uri) {
          throw new BadRequestException(
            `A valid delivery photo is required to complete Stop ${stop.sequence}.`,
          );
        }
        const pending = await this.outbox.findPending(
          tx,
          bookingId,
          'STOP_STATUS',
          {
            status: 'DELIVERED',
            sequence: stop.sequence,
          },
        );
        return (
          pending?.id ??
          this.outbox.enqueue(tx, {
            bookingId,
            mode: 'COMMAND',
            kind: 'STOP_STATUS',
            payload: {
              tripId,
              sequence: stop.sequence,
              status: 'DELIVERED',
              proofUri: photo.uri,
            },
          })
        );
      },
    );
    return this.awaitCommand(tripId, bookingId, commandId, 'the delivery');
  }

  /** The receiver could not take the goods: a reason is required; retry or admin resolution follow. */
  async failStop(
    tripId: string,
    subject: string,
    reason: string,
    stopId?: string,
  ): Promise<ActionResult> {
    const { bookingId } = await this.locate(tripId);
    const outboxId = await this.mutate(
      tripId,
      subject,
      async (tx, { trip, stops }) => {
        if (trip.status !== 'DROP_PROGRESS') {
          throw new BadRequestException(
            `Cannot report a failed delivery: trip is ${trip.status}, expected DROP_PROGRESS`,
          );
        }
        const current = stops[trip.currentStopIndex];
        if (!current) {
          throw new BadRequestException('No active stop');
        }
        assertCurrentStop(current, stopId);
        if (current.status === 'DELIVERY_FAILED') {
          return null; // already reported
        }
        if (current.status !== 'ARRIVED') {
          throw new BadRequestException(
            `Stop ${current.sequence} must be ARRIVED to report a failed delivery (current: ${current.status})`,
          );
        }
        const confirming = await this.outbox.findPending(
          tx,
          bookingId,
          'STOP_STATUS',
          {
            status: 'DELIVERED',
            sequence: current.sequence,
          },
        );
        if (confirming) {
          throw engineError(
            HttpStatus.CONFLICT,
            'DELIVERY_BEING_CONFIRMED',
            `The delivery of Stop ${current.sequence} is still being confirmed with the payment backend`,
          );
        }
        await tx.engineStop.update({
          where: { id: current.id },
          data: {
            status: 'DELIVERY_FAILED',
            failedAt: new Date(),
            failureReason: reason,
            otpVerified: false,
          },
        });
        return this.enqueueStop(
          tx,
          bookingId,
          tripId,
          current.sequence,
          'DELIVERY_FAILED',
          reason,
        );
      },
    );
    return this.reported(tripId, bookingId, outboxId);
  }

  /**
   * Follows what the payment backend decided on its own side: an admin's resolution of a failed
   * drop (UNDELIVERED closes it, RETRY makes it current again) or a cancellation.
   */
  async refresh(tripId: string, subject: string) {
    const { bookingId } = await this.locate(tripId);
    const before = await this.load(tripId);
    this.assertParticipant(before, subject);
    await this.outbox.flushBooking(bookingId);
    const backend = await this.readBackend(before);
    const freed = await this.prisma.runInTransaction(async (tx) => {
      await lockBooking(tx, bookingId);
      const { trip, booking, stops } = await this.loadIn(tx, tripId);
      const now = new Date();
      if (
        backend.status === 'CANCELLED' &&
        !FINAL_TRIP_STATUSES.has(trip.status)
      ) {
        const reason = (
          backend.cancellationReason ?? 'Cancelled by the payment backend'
        ).slice(0, 200);
        await tx.engineTrip.update({
          where: { id: tripId },
          data: {
            status: 'CANCELLED',
            cancelledAt: now,
            cancelledBy: 'SYSTEM',
            cancellationReason: reason,
          },
        });
        await tx.engineBooking.update({
          where: { id: booking.id },
          data: {
            status: 'CANCELLED',
            cancelledAt: now,
            cancelledBy: 'SYSTEM',
            cancellationReason: reason,
          },
        });
        await tx.engineStop.updateMany({
          where: {
            bookingId: booking.id,
            status: { notIn: [...FINAL_STOP_STATUSES] },
          },
          data: { status: 'CANCELLED' },
        });
        return trip.driverSubject;
      }
      const current = stops[trip.currentStopIndex];
      const remote = current
        ? backend.stops.find((stop) => stop.sequence === current.sequence)
        : undefined;
      if (
        trip.status === 'DROP_PROGRESS' &&
        current?.status === 'DELIVERY_FAILED' &&
        remote
      ) {
        if (remote.status === 'UNDELIVERED') {
          await tx.engineStop.update({
            where: { id: current.id },
            data: { status: 'UNDELIVERED', resolvedAt: now },
          });
          const resolved = stops.map((stop) =>
            stop.id === current.id ? { status: 'UNDELIVERED' as const } : stop,
          );
          const next = nextStopIndex(resolved, trip.currentStopIndex);
          if (next === null) {
            await tx.engineTrip.update({
              where: { id: tripId },
              data: {
                status: 'DELIVERED',
                deliveredAt: now,
                currentStopIndex: stops.length,
              },
            });
          } else {
            const nextStop = stops[next];
            if (nextStop?.status === 'PENDING') {
              await tx.engineStop.update({
                where: { id: nextStop.id },
                data: { status: 'IN_TRANSIT' },
              });
            }
            await tx.engineTrip.update({
              where: { id: tripId },
              data: { status: 'IN_TRANSIT', currentStopIndex: next },
            });
          }
        } else if (
          remote.status === 'ARRIVED' ||
          remote.status === 'PAYMENT_CONFIRMED'
        ) {
          await tx.engineStop.update({
            where: { id: current.id },
            data: {
              status: 'ARRIVED',
              arrivedAt: now,
              otpVerified: false,
              resolvedAt: now,
            },
          });
        }
      }
      return null;
    });
    if (freed) {
      this.drivers.markAvailable(freed);
    }
    return {
      trip: tripView(await this.load(tripId)),
      paymentGate: backend.paymentGate,
      paymentStops: backend.stops.map((stop) => ({
        sequence: stop.sequence,
        status: stop.status,
      })),
    };
  }

  // ──── COMPLETION ────

  async complete(tripId: string, subject: string): Promise<CompletionResult> {
    const { bookingId } = await this.locate(tripId);
    const bundle = await this.loadForDriver(tripId, subject);
    if (bundle.trip.status === 'COMPLETED') {
      return {
        changed: false,
        trip: tripView(bundle),
        completion: 'COMPLETED',
        paymentSync: 'NONE',
      };
    }
    const commandId = await this.mutate(
      tripId,
      subject,
      async (tx, current) => {
        if (current.trip.status === 'COMPLETED') {
          return null; // completed by a duplicate request meanwhile
        }
        const open = current.stops.filter(
          (stop) => !FINAL_STOP_STATUSES.has(stop.status),
        );
        if (open.length > 0) {
          throw new BadRequestException(
            `Cannot complete trip: ${open.length} stop(s) still pending delivery`,
          );
        }
        if (current.trip.status !== 'DELIVERED') {
          throw invalidTransition(current.trip.status, 'COMPLETED');
        }
        const pending = await this.outbox.findPending(
          tx,
          bookingId,
          'TRIP_STATUS',
          {
            status: 'COMPLETED',
          },
        );
        if (pending) {
          return pending.id;
        }
        await tx.engineTrip.update({
          where: { id: tripId },
          data: { completionRequestedAt: new Date() },
        });
        return this.outbox.enqueue(tx, {
          bookingId,
          mode: 'COMMAND',
          kind: 'TRIP_STATUS',
          payload: { tripId, status: 'COMPLETED' },
        });
      },
    );
    if (commandId === null) {
      return {
        changed: false,
        trip: tripView(await this.load(tripId)),
        completion: 'COMPLETED',
        paymentSync: 'NONE',
      };
    }
    const record = await this.outbox.flushBooking(bookingId, commandId);
    const trip = tripView(await this.load(tripId));
    if (!record || record.status === 'DELIVERED') {
      return {
        changed: true,
        trip,
        completion: trip.status === 'COMPLETED' ? 'COMPLETED' : 'PENDING',
        paymentSync: 'DELIVERED',
      };
    }
    if (record.status === 'REFUSED') {
      throw refusedCommand(record, 'the completion');
    }
    // Not confirmed yet (payment pending, or no answer): the outbox keeps retrying with backoff.
    return {
      changed: false,
      trip,
      completion: 'PENDING',
      waitingFor: record.lastErrorCode,
      paymentSync: 'PENDING',
    };
  }

  // ──── CANCELLATION ────

  async cancelTrip(
    tripId: string,
    subject: string,
    reason: string,
  ): Promise<ActionResult> {
    const { bookingId } = await this.locate(tripId);
    const outboxId = await this.prisma.runInTransaction(async (tx) => {
      await lockBooking(tx, bookingId);
      const { trip, booking } = await this.loadIn(tx, tripId);
      const initiator =
        trip.driverSubject === subject
          ? 'DRIVER'
          : booking.customerSubject === subject
            ? 'CUSTOMER'
            : null;
      if (!initiator) {
        throw new ForbiddenException(
          'Only the requested customer or the assigned driver can cancel',
        );
      }
      if (trip.status === 'CANCELLED') {
        return null;
      }
      if (!CANCELLABLE.has(trip.status)) {
        throw invalidTransition(trip.status, 'CANCELLED');
      }
      const now = new Date();
      await tx.engineTrip.update({
        where: { id: tripId },
        data: {
          status: 'CANCELLED',
          cancelledAt: now,
          cancelledBy: initiator,
          cancellationReason: reason,
        },
      });
      await tx.engineBooking.update({
        where: { id: bookingId },
        data: {
          status: 'CANCELLED',
          cancelledAt: now,
          cancelledBy: initiator,
          cancellationReason: reason,
        },
      });
      await tx.engineStop.updateMany({
        where: { bookingId, status: { notIn: [...FINAL_STOP_STATUSES] } },
        data: { status: 'CANCELLED' },
      });
      await this.outbox.supersedePendingCommands(
        tx,
        bookingId,
        'Superseded by the cancellation',
      );
      return this.outbox.enqueue(tx, {
        bookingId,
        mode: 'EVENT',
        kind: 'CANCEL',
        payload: { reason, cancelledBy: initiator },
      });
    });
    if (outboxId !== null) {
      const driver = (await this.load(tripId)).trip.driverSubject;
      this.drivers.markAvailable(driver);
    }
    return this.reported(tripId, bookingId, outboxId);
  }

  // ──── HELPERS ────

  private async locate(tripId: string): Promise<{ bookingId: string }> {
    if (!UUID.test(tripId)) {
      throw new NotFoundException(`Trip with ID ${tripId} not found`);
    }
    const trip = await this.prisma.engineTrip.findUnique({
      where: { id: tripId },
      select: { bookingId: true },
    });
    if (!trip) {
      throw new NotFoundException(`Trip with ID ${tripId} not found`);
    }
    return trip;
  }

  private async load(tripId: string): Promise<TripBundle> {
    return this.loadIn(this.prisma, tripId);
  }

  private async loadIn(
    db: Tx | PrismaService,
    tripId: string,
  ): Promise<TripBundle> {
    const trip = await db.engineTrip.findUnique({
      where: { id: tripId },
      include: {
        booking: { include: { stops: { orderBy: { sequence: 'asc' } } } },
      },
    });
    if (!trip) {
      throw new NotFoundException(`Trip with ID ${tripId} not found`);
    }
    const { booking, ...tripRow } = trip;
    const { stops, ...bookingRow } = booking;
    return { trip: tripRow, booking: bookingRow, stops };
  }

  private async loadForDriver(
    tripId: string,
    subject: string,
  ): Promise<TripBundle> {
    const bundle = await this.load(tripId);
    assertDriver(bundle, subject);
    return bundle;
  }

  private assertParticipant(bundle: TripBundle, subject: string): void {
    if (
      bundle.trip.driverSubject !== subject &&
      bundle.booking.customerSubject !== subject
    ) {
      // Another user's trip behaves like a missing one.
      throw new NotFoundException(`Trip with ID ${bundle.trip.id} not found`);
    }
  }

  /** Runs `work` with the booking locked, on fresh rows, as the trip's driver. */
  private async mutate<T>(
    tripId: string,
    subject: string,
    work: (tx: Tx, bundle: TripBundle) => Promise<T>,
  ): Promise<T> {
    const { bookingId } = await this.locate(tripId);
    return this.prisma.runInTransaction(async (tx) => {
      await lockBooking(tx, bookingId);
      const bundle = await this.loadIn(tx, tripId);
      assertDriver(bundle, subject);
      return work(tx, bundle);
    });
  }

  private enqueueStop(
    tx: Tx,
    bookingId: string,
    tripId: string,
    sequence: number,
    status: 'ARRIVED' | 'DELIVERY_FAILED',
    reason?: string,
  ): Promise<bigint> {
    return this.outbox.enqueue(tx, {
      bookingId,
      mode: 'EVENT',
      kind: 'STOP_STATUS',
      payload: { tripId, sequence, status, ...(reason ? { reason } : {}) },
    });
  }

  /** Every earlier report of the booking has reached the payment backend, or 503. */
  private async requireSynced(bookingId: string): Promise<void> {
    await this.outbox.flushBooking(bookingId);
    const pending = await this.prisma.engineOutbox.count({
      where: { bookingId, status: 'PENDING' },
    });
    if (pending > 0) {
      throw paymentBackendUnavailable(
        'The payment backend has not confirmed the trip so far; nothing was changed. Try again shortly.',
        { pendingReports: pending },
      );
    }
  }

  /** A fresh read of the payment backend's booking (payment gate). Fails closed. */
  private async readBackend(bundle: TripBundle): Promise<InternalBooking> {
    const paymentBookingId = bundle.booking.paymentBookingId;
    if (!paymentBookingId) {
      throw paymentBackendUnavailable(
        'The booking is not registered with the payment backend',
      );
    }
    const outcome = await this.backend.getBooking(
      paymentBookingId,
      `eng-gate-${bundle.trip.id}`,
    );
    if (outcome.kind !== 'OK') {
      throw paymentBackendUnavailable(
        'The payment status could not be read from the payment backend; nothing was changed. Try again.',
        { code: outcome.code },
      );
    }
    return outcome.value;
  }

  /**
   * The payment gate for a handover, read fresh. A booking the payment backend closed on its own
   * (an admin cancellation) hands nothing over: the trip follows it with POST /trips/:id/refresh.
   */
  private async readGate(
    bundle: TripBundle,
  ): Promise<InternalBooking['paymentGate']> {
    const backend = await this.readBackend(bundle);
    if (
      backend.status === 'CANCELLED' ||
      backend.trip?.status === 'CANCELLED'
    ) {
      throw engineError(
        HttpStatus.CONFLICT,
        'BOOKING_CANCELLED',
        'The payment backend cancelled this booking: nothing can be handed over. Refresh the trip.',
      );
    }
    return backend.paymentGate;
  }

  /** An event was committed: try to deliver it now and say whether the backend has it. */
  private async reported(
    tripId: string,
    bookingId: string,
    outboxId: bigint | null,
  ): Promise<ActionResult> {
    const record =
      outboxId === null
        ? await this.outbox.flushBooking(bookingId)
        : await this.outbox.flushBooking(bookingId, outboxId);
    const trip = tripView(await this.load(tripId));
    return {
      changed: outboxId !== null,
      trip,
      paymentGate: record ? gateOf(record) : null,
      paymentSync: record ? record.status : 'NONE',
    };
  }

  /**
   * A backend-first command: applied (200), refused (4xx, nothing changed), or unknown (503).
   * No command (null): the step was already done by a duplicate request, nothing changes.
   */
  private async awaitCommand(
    tripId: string,
    bookingId: string,
    commandId: bigint | null,
    action: string,
  ): Promise<ActionResult> {
    if (commandId === null) {
      return {
        changed: false,
        trip: tripView(await this.load(tripId)),
        paymentSync: 'NONE',
      };
    }
    const record = await this.outbox.flushBooking(bookingId, commandId);
    if (record?.status === 'DELIVERED') {
      return {
        changed: true,
        trip: tripView(await this.load(tripId)),
        paymentGate: gateOf(record),
        paymentSync: 'DELIVERED',
      };
    }
    if (record?.status === 'REFUSED') {
      throw refusedCommand(record, action);
    }
    throw paymentBackendUnavailable(
      `The payment backend did not confirm ${action}; it is not committed yet. It is retried automatically: check the trip before trying again.`,
      { retry: true, code: record?.lastErrorCode ?? null },
    );
  }

  private repeatWithOtp(
    bundle: TripBundle,
    otp: string,
    expected: string,
    message = 'Invalid OTP. Please ask the customer for the correct code.',
  ): ActionResult {
    if (!otpMatches(expected, otp)) {
      throw new BadRequestException(message);
    }
    return { changed: false, trip: tripView(bundle), paymentSync: 'NONE' };
  }
}

function assertDriver(bundle: TripBundle, subject: string): void {
  if (bundle.trip.driverSubject !== subject) {
    throw new ForbiddenException(
      'Only the assigned driver can perform this action',
    );
  }
}

function invalidTransition(
  from: EngineTripStatus,
  to: EngineTripStatus,
): BadRequestException {
  return new BadRequestException(
    `Invalid trip state transition from ${from} to ${to}`,
  );
}

function assertCurrentStop(
  current: { id: string; sequence: number },
  stopId?: string,
): void {
  if (stopId && stopId !== current.id) {
    throw new BadRequestException(
      `Stop ID mismatch: requested ${stopId} but current active stop is ${current.id} (sequence ${current.sequence})`,
    );
  }
}

/** The current drop, ready for its OTP (prototype invariants and messages). */
function assertOtpStop(bundle: TripBundle, stopId?: string) {
  if (bundle.trip.status !== 'DROP_PROGRESS') {
    throw new BadRequestException(
      `Cannot verify stop OTP: trip is ${bundle.trip.status}, expected DROP_PROGRESS`,
    );
  }
  const current = bundle.stops[bundle.trip.currentStopIndex];
  if (!current) {
    throw new BadRequestException('No active stop to confirm');
  }
  assertCurrentStop(current, stopId);
  if (current.status === 'DELIVERED') {
    throw new BadRequestException(
      `Stop ${current.sequence} is already delivered. Cannot verify OTP again.`,
    );
  }
  if (current.status !== 'ARRIVED') {
    throw new BadRequestException(
      `Stop ${current.sequence} must be ARRIVED before OTP verification (current: ${current.status}). Did you call arrive first?`,
    );
  }
  return current;
}

function assertDeliverableStop(bundle: TripBundle, stopId?: string) {
  if (bundle.trip.status !== 'DROP_PROGRESS') {
    throw new BadRequestException(
      `Cannot confirm delivery: trip is ${bundle.trip.status}, expected DROP_PROGRESS`,
    );
  }
  const current = bundle.stops[bundle.trip.currentStopIndex];
  if (!current) {
    throw new BadRequestException('No active stop to confirm');
  }
  if (stopId && stopId !== current.id) {
    throw new BadRequestException(
      `Stop ID mismatch: requested ${stopId} but current active stop is ${current.id}`,
    );
  }
  if (current.status === 'DELIVERED') {
    throw new BadRequestException(
      `Stop ${current.sequence} is already delivered.`,
    );
  }
  if (current.status !== 'ARRIVED') {
    throw new BadRequestException(
      `Stop ${current.sequence} must be ARRIVED before delivery confirmation.`,
    );
  }
  if (!current.otpVerified) {
    throw new BadRequestException(
      `OTP for Stop ${current.sequence} must be verified before submitting photo proof.`,
    );
  }
  return current;
}

function gateOf(record: EngineOutbox): InternalBooking['paymentGate'] | null {
  const result = (record.result ?? {}) as Record<string, unknown>;
  return (
    (result['paymentGate'] as InternalBooking['paymentGate'] | undefined) ??
    null
  );
}

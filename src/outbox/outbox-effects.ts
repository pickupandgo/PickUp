import { Injectable, Logger } from '@nestjs/common';
import type { EngineOutbox } from '../generated/prisma/client';
import type { InternalBooking } from '../payment-backend/payment-backend.types';
import type { Tx } from '../prisma/prisma.service';
import { nextStopIndex } from '../trips/trip-progress';
import type { OutboxPayload } from './outbox-payloads';

/** Done after the transaction committed (in-memory driver presence). */
export type PostCommit = {
  readonly kind: 'DRIVER_AVAILABLE';
  readonly driverSubject: string;
};

export interface RefusalFacts {
  readonly code: string;
  readonly message: string;
}

/**
 * What a final answer from the payment backend does to the engine's own state, inside the
 * outbox record's finalizing transaction (the booking row is locked).
 *
 *   COMMAND delivered  the transition the engine held back is applied now (backend first)
 *   COMMAND refused    nothing changes (the engine never advances on its own); ASSIGN refused
 *                      releases the driver and reopens the booking for another offer
 *   EVENT              the engine already committed it: nothing to apply either way
 *
 * Every apply checks the engine state first, so a late or repeated answer changes nothing.
 */
@Injectable()
export class OutboxEffects {
  private readonly logger = new Logger(OutboxEffects.name);

  async onDelivered(
    tx: Tx,
    record: EngineOutbox,
    entry: OutboxPayload,
    booking: InternalBooking,
  ): Promise<PostCommit[]> {
    const now = new Date();
    switch (entry.kind) {
      case 'ASSIGN': {
        const paymentTripId = booking.trip?.tripId ?? null;
        if (!paymentTripId) {
          this.logger.error({
            alert: 'ENGINE_OUTBOX_CONTRACT',
            msg: 'The payment backend accepted the assignment without a trip id',
            outboxId: record.id.toString(),
            bookingId: record.bookingId,
          });
          return [];
        }
        await tx.engineTrip.updateMany({
          where: { id: entry.payload.tripId, paymentTripId: null },
          data: { paymentTripId },
        });
        return [];
      }
      case 'TRIP_STATUS': {
        if (record.mode !== 'COMMAND') {
          return [];
        }
        return this.applyTripStatus(
          tx,
          entry.payload.tripId,
          entry.payload.status,
          now,
        );
      }
      case 'STOP_STATUS': {
        if (record.mode === 'COMMAND' && entry.payload.status === 'DELIVERED') {
          await this.applyStopDelivered(
            tx,
            entry.payload.tripId,
            entry.payload.sequence,
            entry.payload.proofUri ?? null,
            now,
          );
        }
        return [];
      }
      case 'SEARCHING':
      case 'CANCEL':
        return [];
    }
  }

  async onRefused(
    tx: Tx,
    entry: OutboxPayload | null,
    refusal: RefusalFacts,
  ): Promise<PostCommit[]> {
    if (entry?.kind !== 'ASSIGN') {
      return [];
    }
    // The payment backend refused the driver (not provisioned, not approved, booking closed...):
    // the engine trip never existed there. Close it here, free the driver, and reopen the
    // booking so the customer can offer it to another driver.
    const now = new Date();
    const trip = await tx.engineTrip.findUnique({
      where: { id: entry.payload.tripId },
    });
    if (!trip || trip.status === 'CANCELLED' || trip.paymentTripId) {
      return [];
    }
    await tx.engineTrip.update({
      where: { id: trip.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: now,
        cancelledBy: 'SYSTEM',
        cancellationReason:
          `Assignment refused by the payment backend (${refusal.code})`.slice(
            0,
            200,
          ),
      },
    });
    await tx.engineOffer.updateMany({
      where: {
        bookingId: trip.bookingId,
        driverSubject: trip.driverSubject,
        status: 'ACCEPTED',
      },
      data: {
        status: 'FAILED',
        failureCode: refusal.code.slice(0, 60),
        respondedAt: now,
      },
    });
    await tx.engineBooking.updateMany({
      where: { id: trip.bookingId, status: 'ASSIGNED' },
      data: { status: 'OPEN' },
    });
    return [{ kind: 'DRIVER_AVAILABLE', driverSubject: trip.driverSubject }];
  }

  private async applyTripStatus(
    tx: Tx,
    tripId: string,
    status: 'DRIVER_ARRIVED' | 'PICKUP_VERIFIED' | 'IN_TRANSIT' | 'COMPLETED',
    now: Date,
  ): Promise<PostCommit[]> {
    const trip = await tx.engineTrip.findUnique({ where: { id: tripId } });
    if (!trip) {
      return [];
    }
    switch (status) {
      case 'PICKUP_VERIFIED':
        if (trip.status === 'DRIVER_ARRIVED') {
          await tx.engineTrip.update({
            where: { id: tripId },
            data: { status: 'PICKUP_VERIFIED', pickupVerifiedAt: now },
          });
        }
        return [];
      case 'IN_TRANSIT':
        if (trip.status === 'PICKUP_VERIFIED') {
          await tx.engineTrip.update({
            where: { id: tripId },
            data: { status: 'IN_TRANSIT', startedAt: now, currentStopIndex: 0 },
          });
          await tx.engineStop.updateMany({
            where: {
              bookingId: trip.bookingId,
              sequence: 1,
              status: 'PENDING',
            },
            data: { status: 'IN_TRANSIT' },
          });
        }
        return [];
      case 'COMPLETED':
        if (trip.status === 'DELIVERED') {
          await tx.engineTrip.update({
            where: { id: tripId },
            data: { status: 'COMPLETED', completedAt: now },
          });
          await tx.engineBooking.update({
            where: { id: trip.bookingId },
            data: { status: 'COMPLETED' },
          });
          return [
            { kind: 'DRIVER_AVAILABLE', driverSubject: trip.driverSubject },
          ];
        }
        return [];
      case 'DRIVER_ARRIVED':
        // Always an EVENT: committed by the engine before it was sent.
        return [];
    }
  }

  private async applyStopDelivered(
    tx: Tx,
    tripId: string,
    sequence: number,
    proofUri: string | null,
    now: Date,
  ): Promise<void> {
    const trip = await tx.engineTrip.findUnique({ where: { id: tripId } });
    if (!trip || trip.status !== 'DROP_PROGRESS' || !proofUri) {
      return;
    }
    const stops = await tx.engineStop.findMany({
      where: { bookingId: trip.bookingId },
      orderBy: { sequence: 'asc' },
    });
    const index = stops.findIndex((stop) => stop.sequence === sequence);
    const stop = stops[index];
    if (!stop || stop.status !== 'ARRIVED' || index !== trip.currentStopIndex) {
      return;
    }
    await tx.engineStop.update({
      where: { id: stop.id },
      data: {
        status: 'DELIVERED',
        deliveredAt: now,
        proofUri,
        proofSubmittedAt: now,
      },
    });
    const delivered = stops.map((other) =>
      other.id === stop.id ? { status: 'DELIVERED' as const } : other,
    );
    const next = nextStopIndex(delivered, index);
    if (next === null) {
      await tx.engineTrip.update({
        where: { id: tripId },
        data: {
          status: 'DELIVERED',
          deliveredAt: now,
          currentStopIndex: stops.length,
        },
      });
      return;
    }
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
}

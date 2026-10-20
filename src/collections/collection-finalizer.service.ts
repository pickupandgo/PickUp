import { Injectable, Logger } from '@nestjs/common';
import { lockBooking, lockStopsOfBooking, lockTripOfBooking } from '../bookings/booking-locks';
import { applyCollectionCompleted } from '../bookings/booking-payment-state';
import type { PaymentCollection } from '../generated/prisma/client';
import {
  ANOMALY_OUTCOMES,
  ConfirmationOutcome,
  type ConfirmationSource,
  WebhookOutcome,
} from '../payments/payment.constants';
import { normalizeMethod } from '../payments/payment-method';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import type { CollectionLinkState } from './collection-link.gateway';

export type CollectionOutcome =
  | (typeof ConfirmationOutcome)[keyof typeof ConfirmationOutcome]
  | typeof WebhookOutcome.COLLECTION_NOT_PAID
  | typeof WebhookOutcome.COLLECTION_CLOSED;

export interface CollectionApplyContext {
  readonly source: ConfirmationSource;
  readonly providerEventId?: string;
  /** Stored as failure_reason when the provider reports the object closed. */
  readonly closeReason?: string;
}

export interface CollectionApplyResult {
  readonly collection: PaymentCollection;
  readonly outcome: CollectionOutcome;
}

const CAPTURED = 'captured';

/**
 * Applies the provider's state for an ONLINE_QR collection exactly once. The state always comes
 * from Razorpay (authenticated API response), never from the driver or customer app:
 *
 *   PAID              lock booking -> trip -> drops -> collection, check the amount against the
 *                     collection's own obligation (the booking, or its drop), collection
 *                     COMPLETED, then its effects: booking PAID, or the drop's payment confirmed
 *                     and the booking PARTIALLY_PAID or PAID (and trip PAYMENT_CONFIRMED if
 *                     delivered). Webhook, driver refresh and admin sync all end here.
 *   EXPIRED/CANCELLED collection FAILED, so a new QR or cash can be used
 *   ACTIVE            nothing to do yet
 */
@Injectable()
export class CollectionFinalizerService {
  private readonly logger = new Logger(CollectionFinalizerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async apply(
    collectionId: string,
    state: CollectionLinkState,
    context: CollectionApplyContext,
  ): Promise<CollectionApplyResult> {
    const result =
      state.status === 'PAID' || state.status === 'PARTIALLY_PAID'
        ? await this.applyPaid(collectionId, state)
        : state.status === 'EXPIRED' || state.status === 'CANCELLED'
          ? await this.applyClosed(collectionId, state, context)
          : {
              collection: await this.prisma.paymentCollection.findUniqueOrThrow({
                where: { id: collectionId },
              }),
              outcome: WebhookOutcome.COLLECTION_NOT_PAID,
            };

    const fields = {
      collectionId,
      bookingId: result.collection.bookingId,
      providerReferenceId: state.referenceId,
      providerStatus: state.status,
      outcome: result.outcome,
      source: context.source,
      providerEventId: context.providerEventId,
    };
    if (isAnomaly(result.outcome)) {
      this.logger.error({ ...fields, alert: 'PAYMENT_ANOMALY' }, 'Collection needs manual review');
    } else if (result.outcome === ConfirmationOutcome.APPLIED) {
      this.logger.log(fields, 'Online collection completed');
    }
    return result;
  }

  private applyPaid(
    collectionId: string,
    state: CollectionLinkState,
  ): Promise<CollectionApplyResult> {
    return this.prisma.runInTransaction(async (tx) => {
      const located = await tx.paymentCollection.findUniqueOrThrow({
        where: { id: collectionId },
        select: { bookingId: true },
      });
      const booking = await lockBooking(tx, located.bookingId);
      if (!booking) {
        throw new Error('Booking disappeared during collection finalization');
      }
      // booking -> trip -> drops -> collection: the order every money path takes.
      const trip = await lockTripOfBooking(tx, located.bookingId);
      const stops =
        booking.paymentModel === 'QUOTE_PER_STOP' ? await lockStopsOfBooking(tx, booking.id) : [];
      const collection = await this.lockCollection(tx, collectionId);
      const payment = state.payments.find((candidate) => candidate.status === CAPTURED);

      if (collection.status === 'COMPLETED') {
        const same = payment !== undefined && collection.providerPaymentId === payment.id;
        return {
          collection,
          outcome: same
            ? ConfirmationOutcome.ALREADY_APPLIED
            : ConfirmationOutcome.DUPLICATE_ORDER_PAYMENT,
        };
      }
      if (collection.status !== 'PENDING') {
        // Money arrived for a collection we had already closed: refund review.
        return { collection, outcome: ConfirmationOutcome.PAYMENT_NOT_PENDING };
      }
      // What this collection's obligation is owed, from the frozen snapshot: its drop's payable
      // amount, or the whole booking's. A QR can only ever pay the obligation it was made for.
      const stop = collection.bookingStopId
        ? (stops.find((candidate) => candidate.id === collection.bookingStopId) ?? null)
        : null;
      const owed = collection.bookingStopId ? (stop?.payablePaise ?? null) : booking.finalFareMinor;
      if (
        state.status !== 'PAID' ||
        !payment ||
        state.referenceId !== collection.providerReferenceId ||
        payment.currency !== 'INR' ||
        BigInt(payment.amount) !== collection.amountPaise ||
        owed === null ||
        collection.amountPaise !== owed
      ) {
        return { collection, outcome: ConfirmationOutcome.AMOUNT_MISMATCH };
      }
      if (
        collection.bookingStopId === null
          ? booking.paymentStatus !== 'UNPAID'
          : await this.isStopPaid(tx, collection.bookingStopId, collectionId)
      ) {
        return { collection, outcome: ConfirmationOutcome.DUPLICATE_BOOKING_PAYMENT };
      }

      const now = new Date();
      const completed = await tx.paymentCollection.update({
        where: { id: collectionId },
        data: {
          status: 'COMPLETED',
          providerPaymentId: payment.id,
          providerOrderId: payment.orderId ?? state.orderId,
          paymentMethod: normalizeMethod(payment.method),
          completedAt: now,
        },
      });
      const effects = await applyCollectionCompleted(tx, booking, trip, stops, completed, now);
      return {
        collection: completed,
        outcome:
          booking.status === 'CANCELLED'
            ? ConfirmationOutcome.PAID_AFTER_CANCELLATION
            : effects.stop?.status === 'UNDELIVERED' || effects.stop?.status === 'CANCELLED'
              ? ConfirmationOutcome.PAID_FOR_CLOSED_DROP
              : ConfirmationOutcome.APPLIED,
      };
    });
  }

  /** True when another collection already paid this drop (the live index makes it unreachable). */
  private async isStopPaid(tx: Tx, bookingStopId: string, collectionId: string): Promise<boolean> {
    const other = await tx.paymentCollection.findFirst({
      where: { bookingStopId, status: 'COMPLETED', id: { not: collectionId } },
      select: { id: true },
    });
    return other !== null;
  }

  private applyClosed(
    collectionId: string,
    state: CollectionLinkState,
    context: CollectionApplyContext,
  ): Promise<CollectionApplyResult> {
    return this.prisma.runInTransaction(async (tx) => {
      const collection = await this.lockCollection(tx, collectionId);
      if (collection.status !== 'PENDING') {
        return { collection, outcome: WebhookOutcome.COLLECTION_CLOSED };
      }
      const failed = await tx.paymentCollection.update({
        where: { id: collectionId },
        data: {
          status: 'FAILED',
          failureReason: context.closeReason ?? state.status,
        },
      });
      return { collection: failed, outcome: WebhookOutcome.COLLECTION_CLOSED };
    });
  }

  private async lockCollection(tx: Tx, collectionId: string): Promise<PaymentCollection> {
    await tx.$queryRaw`SELECT id FROM payment_collections WHERE id = ${collectionId}::uuid FOR UPDATE`;
    return tx.paymentCollection.findUniqueOrThrow({ where: { id: collectionId } });
  }
}

export function isAnomaly(outcome: CollectionOutcome): boolean {
  return (ANOMALY_OUTCOMES as ReadonlySet<string>).has(outcome);
}

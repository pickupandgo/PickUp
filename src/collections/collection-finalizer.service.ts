import { Injectable, Logger } from '@nestjs/common';
import { lockBooking, lockTripOfBooking } from '../bookings/booking-locks';
import { applyBookingPaid } from '../bookings/booking-payment-state';
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
 *   PAID              lock booking -> trip -> collection, check amount, collection COMPLETED,
 *                     booking PAID (and trip PAYMENT_CONFIRMED if delivered)
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
      const trip = await lockTripOfBooking(tx, located.bookingId);
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
      if (
        state.status !== 'PAID' ||
        !payment ||
        state.referenceId !== collection.providerReferenceId ||
        payment.currency !== 'INR' ||
        BigInt(payment.amount) !== collection.amountPaise ||
        collection.amountPaise !== booking.finalFareMinor
      ) {
        return { collection, outcome: ConfirmationOutcome.AMOUNT_MISMATCH };
      }
      if (booking.paymentStatus !== 'UNPAID') {
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
      await applyBookingPaid(tx, booking, trip, now);
      return {
        collection: completed,
        outcome:
          booking.status === 'CANCELLED'
            ? ConfirmationOutcome.PAID_AFTER_CANCELLATION
            : ConfirmationOutcome.APPLIED,
      };
    });
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

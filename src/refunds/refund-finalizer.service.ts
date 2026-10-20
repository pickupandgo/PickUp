import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { recordAdminAction } from '../audit/admin-actions';
import { lockBooking } from '../bookings/booking-locks';
import { syncBookingMoneyStatus } from '../bookings/booking-payment-state';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import type { Booking, PaymentRefund } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { type ProviderRefund, REFUND_PROVIDER_RAZORPAY } from './refund.gateway';
import { refundMove, type RefundStatus, refundStatusForProvider } from './refund-policy';

export type RefundUpdateSource = 'SUBMIT' | 'WEBHOOK' | 'ADMIN_SYNC';

/** Result of applying a provider refund state; stored on payment_events for webhooks. */
export const RefundOutcome = {
  APPLIED: 'REFUND_APPLIED',
  /** Same state as already recorded (repeated webhook, sync after webhook). Nothing changed. */
  ALREADY_APPLIED: 'REFUND_ALREADY_APPLIED',
  /** An older provider state arrived after a newer one. Ignored. */
  STALE_UPDATE: 'REFUND_STALE_UPDATE',
  /** Provider payment, amount, currency or ids do not match our refund. Not applied. */
  MISMATCH: 'REFUND_MISMATCH',
  /** The provider reports what our record rules out (e.g. a refund for one we closed). */
  CONFLICTING_STATE: 'REFUND_CONFLICTING_STATE',
  /** A Razorpay refund this service never requested (e.g. made on the dashboard). */
  UNKNOWN: 'REFUND_UNKNOWN',
} as const;
export type RefundOutcome = (typeof RefundOutcome)[keyof typeof RefundOutcome];

/** Outcomes that need a human: money may have moved without a matching record. */
export const REFUND_ANOMALIES: ReadonlySet<string> = new Set([
  RefundOutcome.MISMATCH,
  RefundOutcome.CONFLICTING_STATE,
  RefundOutcome.UNKNOWN,
]);

export interface RefundUpdateResult {
  readonly refund: PaymentRefund;
  readonly outcome: RefundOutcome;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Applies provider refund states and local outcomes, one transaction each, locking booking ->
 * refund (the booking lock serializes everything that changes the booking's money):
 *
 *   PENDING -> PROCESSING   Razorpay accepted it (pending)
 *   PENDING|PROCESSING -> COMPLETED   processed: the money went back; refunded_paise follows
 *   PENDING|PROCESSING -> FAILED      failed: nothing was refunded
 *   PENDING -> REFUSED      Razorpay rejected the request and has no record of it
 *   PENDING -> CANCELLED    an admin withdrew it before it reached Razorpay
 *
 * Every change moves the booking's payment status to what its money says (booking_money_status).
 * The submission reply, webhooks and admin syncs all end here, so they converge: repeated or
 * out-of-order states change nothing, and contradictions are reported, never applied. A failed
 * refund releases nothing on its own: an earning put on hold for it stays held for an admin.
 */
@Injectable()
export class RefundFinalizerService {
  private readonly logger = new Logger(RefundFinalizerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async apply(
    refundId: string,
    provider: ProviderRefund,
    source: RefundUpdateSource,
  ): Promise<RefundUpdateResult> {
    const result = await this.prisma.runInTransaction(async (tx) => {
      const { booking, refund } = await this.lock(tx, refundId);

      if (await this.mismatches(tx, refund, provider)) {
        return { refund, outcome: RefundOutcome.MISMATCH };
      }
      const target = refundStatusForProvider(provider.status);
      const move = refundMove(refund.status as RefundStatus, target);
      if (move === 'CONFLICT') {
        return { refund, outcome: RefundOutcome.CONFLICTING_STATE };
      }
      if (move === 'STALE') {
        return { refund, outcome: RefundOutcome.STALE_UPDATE };
      }
      if (move === 'ALREADY_APPLIED') {
        const reference = provider.reference ?? refund.providerReference;
        const refreshed =
          refund.providerStatus === provider.status && refund.providerReference === reference
            ? refund
            : await tx.paymentRefund.update({
                where: { id: refundId },
                data: { providerStatus: provider.status, providerReference: reference },
              });
        return { refund: refreshed, outcome: RefundOutcome.ALREADY_APPLIED };
      }

      const now = new Date();
      const updated = await tx.paymentRefund.update({
        where: { id: refundId },
        data: {
          status: target,
          providerRefundId: provider.id,
          providerStatus: provider.status,
          providerReference: provider.reference ?? refund.providerReference,
          ...(target === 'COMPLETED' ? { completedAt: now } : {}),
          ...(target === 'FAILED'
            ? { failedAt: now, failureReason: `PROVIDER_FAILED:${provider.status}`.slice(0, 200) }
            : {}),
        },
      });
      const paymentStatus = await syncBookingMoneyStatus(tx, booking);
      if (target !== 'PROCESSING') {
        await recordAdminAction(tx, {
          actorUserId: null,
          action: target === 'COMPLETED' ? 'REFUND_COMPLETED' : 'REFUND_FAILED',
          targetType: 'PAYMENT_REFUND',
          targetId: refundId,
          details: {
            bookingId: refund.bookingId,
            providerRefundId: provider.id,
            providerStatus: provider.status,
            source,
            bookingPaymentStatus: paymentStatus,
          },
        });
      }
      return { refund: updated, outcome: RefundOutcome.APPLIED };
    });

    const fields = {
      refundId,
      bookingId: result.refund.bookingId,
      providerRefundId: provider.id,
      providerStatus: provider.status,
      status: result.refund.status,
      outcome: result.outcome,
      source,
    };
    if (REFUND_ANOMALIES.has(result.outcome)) {
      this.logger.error({ ...fields, alert: 'REFUND_ANOMALY' }, 'Refund needs manual review');
    } else if (result.outcome === RefundOutcome.APPLIED) {
      this.logger.log(fields, 'Refund status updated');
    }
    return result;
  }

  /**
   * A refund Razorpay reported through a webhook: ours by refund id, or by our receipt / notes
   * when the submission reply never arrived. Unknown refunds are reported, never recorded.
   */
  async applyWebhook(
    provider: ProviderRefund,
  ): Promise<{ readonly outcome: RefundOutcome; readonly refund: PaymentRefund | null }> {
    const refund = await this.findOurs(provider);
    if (!refund) {
      this.logger.error(
        {
          providerRefundId: provider.id,
          providerPaymentId: provider.paymentId,
          providerStatus: provider.status,
          alert: 'REFUND_ANOMALY',
        },
        'Razorpay reported a refund this service did not request',
      );
      return { outcome: RefundOutcome.UNKNOWN, refund: null };
    }
    return this.apply(refund.id, provider, 'WEBHOOK');
  }

  /**
   * Razorpay definitively rejected the request and has no record of our refund id: nothing was
   * refunded. The booking's payment status goes back to what its money says.
   */
  async refuse(refundId: string, reason: string): Promise<PaymentRefund> {
    const refused = await this.prisma.runInTransaction(async (tx) => {
      const { booking, refund } = await this.lock(tx, refundId);
      if (refund.status !== 'PENDING' || refund.providerRefundId !== null) {
        return refund;
      }
      const updated = await tx.paymentRefund.update({
        where: { id: refundId },
        data: { status: 'REFUSED', failedAt: new Date(), failureReason: reason.slice(0, 200) },
      });
      const paymentStatus = await syncBookingMoneyStatus(tx, booking);
      await recordAdminAction(tx, {
        actorUserId: null,
        action: 'REFUND_REFUSED',
        targetType: 'PAYMENT_REFUND',
        targetId: refundId,
        reason: reason.slice(0, 200),
        details: { bookingId: refund.bookingId, bookingPaymentStatus: paymentStatus },
      });
      return updated;
    });
    this.logger.warn({ refundId, reason }, 'Refund refused by the provider');
    return refused;
  }

  /**
   * An admin withdraws a provider refund that never reached Razorpay (the caller checked
   * Razorpay has no record of it). Refused while a submission may be in flight (its lease).
   */
  async cancel(
    refundId: string,
    adminUserId: string,
    reason: string,
    leaseSeconds: number,
  ): Promise<PaymentRefund> {
    return this.prisma.runInTransaction(async (tx) => {
      const { booking, refund } = await this.lock(tx, refundId);
      if (refund.status !== 'PENDING' || refund.providerRefundId !== null) {
        throw invalidState(refund, 'NOT_PENDING');
      }
      const [lease] = await tx.$queryRaw<{ active: boolean }[]>`
        SELECT (last_submitted_at IS NOT NULL
                AND last_submitted_at >= now() - make_interval(secs => ${leaseSeconds})) AS active
        FROM payment_refunds WHERE id = ${refundId}::uuid`;
      if (lease?.active) {
        throw invalidState(refund, 'SUBMISSION_IN_PROGRESS');
      }
      const updated = await tx.paymentRefund.update({
        where: { id: refundId },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelledByUserId: adminUserId,
          cancellationReason: reason,
        },
      });
      const paymentStatus = await syncBookingMoneyStatus(tx, booking);
      await recordAdminAction(tx, {
        actorUserId: adminUserId,
        action: 'REFUND_CANCELLED',
        targetType: 'PAYMENT_REFUND',
        targetId: refundId,
        reason,
        details: {
          bookingId: refund.bookingId,
          submitAttempts: refund.submitAttempts,
          bookingPaymentStatus: paymentStatus,
        },
      });
      return updated;
    });
  }

  private async findOurs(provider: ProviderRefund): Promise<PaymentRefund | null> {
    const byProviderId = await this.prisma.paymentRefund.findFirst({
      where: { provider: REFUND_PROVIDER_RAZORPAY, providerRefundId: provider.id },
    });
    if (byProviderId) {
      return byProviderId;
    }
    for (const candidate of [provider.receipt, provider.notes.refund_id]) {
      if (candidate && UUID_PATTERN.test(candidate)) {
        const refund = await this.prisma.paymentRefund.findUnique({ where: { id: candidate } });
        if (refund?.kind === 'PROVIDER') {
          // apply() checks that it really is this refund (payment, amount, currency).
          return refund;
        }
      }
    }
    return null;
  }

  /** The provider's refund must be exactly ours: same payment, amount, currency and ids. */
  private async mismatches(
    tx: Tx,
    refund: PaymentRefund,
    provider: ProviderRefund,
  ): Promise<boolean> {
    if (
      refund.kind !== 'PROVIDER' ||
      provider.paymentId !== refund.providerPaymentId ||
      BigInt(provider.amount) !== refund.amountPaise ||
      provider.currency !== refund.currency ||
      (refund.providerRefundId !== null && refund.providerRefundId !== provider.id) ||
      (provider.receipt !== null && provider.receipt !== refund.id) ||
      (provider.notes.refund_id !== undefined && provider.notes.refund_id !== refund.id)
    ) {
      return true;
    }
    if (refund.providerRefundId === null) {
      // A provider refund id is recorded once (unique index): never for a second refund.
      const other = await tx.paymentRefund.findFirst({
        where: {
          provider: REFUND_PROVIDER_RAZORPAY,
          providerRefundId: provider.id,
          id: { not: refund.id },
        },
        select: { id: true },
      });
      return other !== null;
    }
    return false;
  }

  /** booking -> refund, the order every money path takes (the booking id never changes). */
  private async lock(
    tx: Tx,
    refundId: string,
  ): Promise<{ booking: Booking; refund: PaymentRefund }> {
    const located = await tx.paymentRefund.findUnique({
      where: { id: refundId },
      select: { bookingId: true },
    });
    if (!located) {
      throw new AppError(ErrorCode.REFUND_NOT_FOUND, HttpStatus.NOT_FOUND, 'Refund not found');
    }
    const booking = await lockBooking(tx, located.bookingId);
    if (!booking) {
      throw new Error(`Booking ${located.bookingId} of refund ${refundId} disappeared`);
    }
    await tx.$queryRaw`SELECT id FROM payment_refunds WHERE id = ${refundId}::uuid FOR UPDATE`;
    const refund = await tx.paymentRefund.findUniqueOrThrow({ where: { id: refundId } });
    return { booking, refund };
  }
}

function invalidState(refund: PaymentRefund, reason: string): AppError {
  return new AppError(
    ErrorCode.REFUND_INVALID_STATE,
    HttpStatus.CONFLICT,
    reason === 'SUBMISSION_IN_PROGRESS'
      ? 'The refund is being sent to the provider; sync it, or retry in a few minutes'
      : 'Only a provider refund that never reached the provider can be cancelled',
    { status: refund.status, reason },
  );
}

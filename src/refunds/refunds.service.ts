import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Principal } from '../auth/principal';
import { recordAdminAction } from '../audit/admin-actions';
import { lockBooking, lockStopsOfBooking, lockTripOfBooking } from '../bookings/booking-locks';
import { syncBookingMoneyStatus } from '../bookings/booking-payment-state';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { numberToPaise } from '../common/money';
import { EarningsService, HOLD_REFUND, type RefundHoldOutcome } from '../earnings/earnings.service';
import type { Booking, BookingStop, PaymentRefund, Prisma, Trip } from '../generated/prisma/client';
import { isUniqueViolation } from '../prisma/prisma-errors';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { RazorpayApiError, RazorpayUnavailableError } from '../razorpay/razorpay.errors';
import { WalletLedgerService } from '../wallet/wallet-ledger.service';
import { RefundFinalizerService, type RefundUpdateResult } from './refund-finalizer.service';
import {
  findOurRefund,
  type ProviderRefund,
  REFUND_PROVIDER_RAZORPAY,
  RefundGateway,
} from './refund.gateway';
import {
  type FeeTreatment,
  LIVE_REFUND_STATUSES,
  refundCaseOf,
  type RefundKind,
  type RefundStatus,
  resolveRefundAmount,
} from './refund-policy';
import { refundsNotConfigured } from './simulated-refund.gateway';

/** A submission newer than this may still be in flight; it is not repeated or cancelled. */
export const REFUND_SUBMISSION_LEASE_SECONDS = 120;
/** Provider rejections that are definitive for this request. Anything else is retried. */
const DEFINITIVE_REJECTIONS: ReadonlySet<number> = new Set([400, 401, 403, 404, 422]);

export interface RefundRequestInput {
  readonly bookingId: string;
  readonly sourceCollectionId: string | null;
  readonly sourcePaymentId: string | null;
  /** Optional cross-check: the drop the source collection paid for. */
  readonly stopSequence: number | null;
  readonly kind: RefundKind;
  /** Optional: confirms (or, with partial refunds on, chooses) the amount. Never trusted alone. */
  readonly amountPaise: number | null;
  readonly reason: string;
  readonly feeTreatment: FeeTreatment | null;
}

/**
 * What happened when a provider refund was sent: its status afterwards (PROCESSING, COMPLETED,
 * FAILED, REFUSED), PENDING_RETRY (unknown outcome, retried with the same idempotency key),
 * SKIPPED (another submission holds it, or it is no longer pending), or an anomaly outcome.
 */
export type SubmissionResult = string;

export interface RequestRefundResult {
  readonly refund: RefundWithStop;
  /** False when this Idempotency-Key was already used: the original refund is returned. */
  readonly created: boolean;
  /** Provider refunds only: what the submission on this request did. */
  readonly submission: SubmissionResult | null;
}

export const REFUND_VIEW = {
  bookingStop: { select: { sequence: true } },
} satisfies Prisma.PaymentRefundInclude;

export type RefundWithStop = Prisma.PaymentRefundGetPayload<{ include: typeof REFUND_VIEW }>;

interface RefundSource {
  readonly type: 'COLLECTION' | 'PAYMENT';
  readonly id: string;
  readonly bookingStopId: string | null;
  readonly amountPaise: bigint;
  readonly providerPaymentId: string | null;
  /** CASH collections: the platform fee debited for it, and the driver who collected it. */
  readonly platformFeePaise: bigint | null;
  readonly collectedByDriverId: string | null;
}

/**
 * Refunds requested by an admin (payment flow Phase 6). The technical system only: every refund
 * is admin-initiated, with a reason, audited, for an amount the server computes from what its
 * source collected; whether one is due is an open business decision (OPEN_DECISIONS L-7 to L-10,
 * L-21). Nothing here refunds, debits or recovers anything on its own.
 *
 *   PROVIDER       an online payment (QR collection or historical prepaid) goes back through
 *                  Razorpay: recorded PENDING in one transaction, then sent outside it with the
 *                  refund id as X-Refund-Idempotency (RefundFinalizerService applies the result)
 *   CASH_RETURNED  the cash a driver collected was handed back: recorded COMPLETED with the
 *                  admin's decision on the cash platform fee (KEPT, or CREDITED_TO_WALLET as a
 *                  REFUND_REVERSAL ledger credit in the same transaction); no wallet movement
 *                  happens without that decision
 *
 * In the request transaction: booking -> trip -> drops -> driver wallet -> source -> earning
 * locks; the earning goes ON_HOLD (REFUND); one IN_PAYOUT refuses the refund until its payout
 * resolves; one already PAID or kept in cash is left as it is (reconciliation reports it).
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: RefundGateway,
    private readonly finalizer: RefundFinalizerService,
    private readonly earnings: EarningsService,
    private readonly ledger: WalletLedgerService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async request(
    admin: Principal,
    idempotencyKey: string,
    input: RefundRequestInput,
  ): Promise<RequestRefundResult> {
    const key = `admin:${admin.userId}:${idempotencyKey}`;
    const existing = await this.prisma.paymentRefund.findUnique({
      where: { idempotencyKey: key },
    });
    if (existing) {
      return this.replay(existing, input);
    }
    checkShape(input);
    if (input.kind === 'PROVIDER' && !this.gateway.enabled) {
      throw refundsNotConfigured();
    }

    const refundId = randomUUID();
    let recorded: { refund: PaymentRefund; created: boolean };
    try {
      recorded = await this.prisma.runInTransaction((tx) =>
        this.record(tx, admin, key, refundId, input),
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        const winner = await this.prisma.paymentRefund.findUnique({
          where: { idempotencyKey: key },
        });
        if (winner) {
          return this.replay(winner, input);
        }
        throw new AppError(
          ErrorCode.REFUND_IN_PROGRESS,
          HttpStatus.CONFLICT,
          'Another refund of this source is in progress',
        );
      }
      throw error;
    }
    if (!recorded.created) {
      return this.replay(recorded.refund, input);
    }

    this.logger.log(
      {
        refundId,
        bookingId: input.bookingId,
        kind: recorded.refund.kind,
        refundCase: recorded.refund.refundCase,
        amountPaise: Number(recorded.refund.amountPaise),
        adminUserId: admin.userId,
      },
      recorded.refund.kind === 'PROVIDER' ? 'Refund requested' : 'Cash return recorded',
    );
    const submission = recorded.refund.kind === 'PROVIDER' ? await this.submit(refundId) : null;
    return { refund: await this.view(refundId), created: true, submission };
  }

  /**
   * Sends a pending provider refund once its lease allows it (never two submissions at a time),
   * always with the refund id as X-Refund-Idempotency and receipt. A retry first looks for the
   * refund at Razorpay, so a reply lost to a crash or timeout is found instead of sent again.
   */
  async submit(refundId: string): Promise<SubmissionResult> {
    if (!this.gateway.enabled) {
      return 'PROVIDER_DISABLED';
    }
    const claimed = await this.prisma.$queryRaw<{ submit_attempts: number }[]>`
      UPDATE payment_refunds
      SET submit_attempts = submit_attempts + 1,
          last_submitted_at = now(),
          updated_at = now()
      WHERE id = ${refundId}::uuid
        AND kind = 'PROVIDER'
        AND status = 'PENDING'
        AND provider_refund_id IS NULL
        AND (last_submitted_at IS NULL
             OR last_submitted_at < now() - make_interval(secs => ${REFUND_SUBMISSION_LEASE_SECONDS}))
      RETURNING submit_attempts`;
    const [claim] = claimed;
    if (!claim) {
      return 'SKIPPED';
    }
    const refund = await this.prisma.paymentRefund.findUniqueOrThrow({ where: { id: refundId } });
    const providerPaymentId = refund.providerPaymentId;
    if (!providerPaymentId) {
      throw new Error(`Provider refund ${refundId} has no provider payment id`);
    }

    if (Number(claim.submit_attempts) > 1) {
      // An earlier attempt may have reached Razorpay: find it before sending anything again.
      try {
        const found = findOurRefund(
          await this.gateway.listPaymentRefunds(providerPaymentId),
          refundId,
        );
        if (found) {
          return submissionResult(await this.finalizer.apply(refundId, found, 'SUBMIT'));
        }
      } catch (error) {
        if (error instanceof RazorpayUnavailableError || error instanceof RazorpayApiError) {
          this.logger.warn(
            { refundId, reason: error.name },
            'Could not check Razorpay before resending a refund; it stays PENDING',
          );
          return 'PENDING_RETRY';
        }
        throw error;
      }
    }

    let provider: ProviderRefund;
    try {
      provider = await this.gateway.createRefund({
        refundId,
        providerPaymentId,
        amountPaise: Number(refund.amountPaise),
        notes: refundNotes(refund),
      });
    } catch (error) {
      return this.handleSubmitError(refund, providerPaymentId, error);
    }
    return submissionResult(await this.finalizer.apply(refundId, provider, 'SUBMIT'));
  }

  /**
   * Admin recovery: reads the refund from Razorpay (by its refund id, or our receipt when the
   * reply was lost) and applies what it reports; a pending refund Razorpay has no record of is
   * sent again (same idempotency key) once its lease allows.
   */
  async sync(
    refundId: string,
    admin: Principal,
  ): Promise<{ refund: RefundWithStop; outcome: string }> {
    const refund = await this.prisma.paymentRefund.findUnique({ where: { id: refundId } });
    if (!refund) {
      throw refundNotFound();
    }
    await recordAdminAction(this.prisma, {
      actorUserId: admin.userId,
      action: 'REFUND_SYNCED',
      targetType: 'PAYMENT_REFUND',
      targetId: refundId,
    });
    if (refund.kind !== 'PROVIDER' || !refund.providerPaymentId) {
      return { refund: await this.view(refundId), outcome: 'NOT_A_PROVIDER_REFUND' };
    }
    if (!this.gateway.enabled) {
      throw refundsNotConfigured();
    }
    let provider: ProviderRefund | null;
    try {
      provider = refund.providerRefundId
        ? await this.gateway.fetchRefund(refund.providerRefundId)
        : findOurRefund(await this.gateway.listPaymentRefunds(refund.providerPaymentId), refundId);
    } catch (error) {
      throw toRefundProviderError(error);
    }
    if (provider) {
      const result = await this.finalizer.apply(refundId, provider, 'ADMIN_SYNC');
      return { refund: await this.view(refundId), outcome: result.outcome };
    }
    if (refund.status === 'PENDING') {
      const result = await this.submit(refundId);
      return { refund: await this.view(refundId), outcome: `RESUBMITTED_${result}` };
    }
    return { refund: await this.view(refundId), outcome: 'NOT_FOUND_AT_PROVIDER' };
  }

  /**
   * Withdraws a provider refund that never reached Razorpay. One that was ever sent is checked
   * at Razorpay first: found there, it is applied instead and the cancel is refused.
   */
  async cancel(refundId: string, admin: Principal, reason: string): Promise<RefundWithStop> {
    const refund = await this.prisma.paymentRefund.findUnique({ where: { id: refundId } });
    if (!refund) {
      throw refundNotFound();
    }
    if (refund.kind !== 'PROVIDER' || refund.status !== 'PENDING' || refund.providerRefundId) {
      throw new AppError(
        ErrorCode.REFUND_INVALID_STATE,
        HttpStatus.CONFLICT,
        'Only a provider refund that never reached the provider can be cancelled',
        { status: refund.status, reason: 'NOT_PENDING' },
      );
    }
    if (refund.submitAttempts > 0) {
      if (!this.gateway.enabled || !refund.providerPaymentId) {
        throw refundsNotConfigured();
      }
      let found: ProviderRefund | null;
      try {
        found = findOurRefund(
          await this.gateway.listPaymentRefunds(refund.providerPaymentId),
          refundId,
        );
      } catch (error) {
        throw toRefundProviderError(error);
      }
      if (found) {
        const applied = await this.finalizer.apply(refundId, found, 'ADMIN_SYNC');
        throw new AppError(
          ErrorCode.REFUND_INVALID_STATE,
          HttpStatus.CONFLICT,
          'The refund reached the provider; its status was updated instead',
          { status: applied.refund.status, reason: 'REACHED_PROVIDER' },
        );
      }
    }
    await this.finalizer.cancel(refundId, admin.userId, reason, REFUND_SUBMISSION_LEASE_SECONDS);
    this.logger.log({ refundId, adminUserId: admin.userId }, 'Refund cancelled');
    return this.view(refundId);
  }

  async get(refundId: string): Promise<RefundWithStop> {
    return this.view(refundId);
  }

  list(filter: {
    readonly bookingId?: string;
    readonly status?: RefundStatus;
    readonly limit?: number;
  }): Promise<RefundWithStop[]> {
    return this.prisma.paymentRefund.findMany({
      where: {
        ...(filter.bookingId ? { bookingId: filter.bookingId } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      },
      include: REFUND_VIEW,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: filter.limit ?? 50,
    });
  }

  /** Records the refund (and its effects) under the booking lock. */
  private async record(
    tx: Tx,
    admin: Principal,
    key: string,
    refundId: string,
    input: RefundRequestInput,
  ): Promise<{ refund: PaymentRefund; created: boolean }> {
    const booking = await lockBooking(tx, input.bookingId);
    if (!booking) {
      throw new AppError(ErrorCode.BOOKING_NOT_FOUND, HttpStatus.NOT_FOUND, 'Booking not found');
    }
    const trip = await lockTripOfBooking(tx, booking.id);
    const stops =
      booking.paymentModel === 'QUOTE_PER_STOP' ? await lockStopsOfBooking(tx, booking.id) : [];
    // A concurrent request with the same key has committed by now, or never will.
    const again = await tx.paymentRefund.findUnique({ where: { idempotencyKey: key } });
    if (again) {
      return { refund: again, created: false };
    }
    if (booking.status !== 'CANCELLED' && booking.status !== 'COMPLETED') {
      throw notRefundable(
        'BOOKING_NOT_CLOSED',
        'Only a cancelled or completed booking is refunded; this one is still in progress',
      );
    }

    const source = await this.loadSource(tx, booking, input);
    const stop = source.bookingStopId
      ? (stops.find((candidate) => candidate.id === source.bookingStopId) ?? null)
      : null;
    if (input.stopSequence !== null && stop?.sequence !== input.stopSequence) {
      throw sourceInvalid('STOP_MISMATCH', 'The source was not collected for this drop');
    }

    const sourceFilter =
      source.type === 'COLLECTION'
        ? { sourceCollectionId: source.id }
        : { sourcePaymentId: source.id };
    const live = await tx.paymentRefund.findFirst({
      where: { ...sourceFilter, status: { in: [...LIVE_REFUND_STATUSES] } },
      select: { id: true },
    });
    if (live) {
      throw new AppError(
        ErrorCode.REFUND_IN_PROGRESS,
        HttpStatus.CONFLICT,
        'A refund of this source is already in progress',
        { refundId: live.id },
      );
    }
    const completed = await tx.paymentRefund.aggregate({
      where: { ...sourceFilter, status: 'COMPLETED' },
      _sum: { amountPaise: true },
    });
    const refundablePaise = source.amountPaise - (completed._sum.amountPaise ?? 0n);
    const amount = resolveRefundAmount({
      refundablePaise,
      requestedPaise: input.amountPaise === null ? null : numberToPaise(input.amountPaise),
      partialAllowed: this.config.refunds.partialAllowed,
    });
    if (!amount.ok) {
      if (amount.reason === 'NOTHING_LEFT') {
        throw notRefundable('ALREADY_REFUNDED', 'This source was already refunded in full', {
          refundablePaise: 0,
        });
      }
      throw new AppError(
        ErrorCode.REFUND_AMOUNT_NOT_ALLOWED,
        HttpStatus.UNPROCESSABLE_ENTITY,
        amount.reason === 'PARTIAL_NOT_ALLOWED'
          ? 'Partial refunds are off: a refund returns everything left of its source'
          : 'The amount exceeds what is left of the source',
        { refundablePaise: Number(refundablePaise), reason: amount.reason },
      );
    }

    const refundCase = refundCaseOf({
      bookingStatus: booking.status,
      handedOver: handedOver(trip, stop),
      stopStatus: stop?.status ?? null,
    });
    if (!this.config.refunds.allowedCases.includes(refundCase)) {
      throw new AppError(
        ErrorCode.REFUND_CASE_NOT_ALLOWED,
        HttpStatus.CONFLICT,
        'Refunds of this case are not allowed on this server (REFUND_ALLOWED_CASES)',
        { refundCase },
      );
    }

    // The admin's decision on the cash platform fee: credited back only with the cash return of
    // everything left of the collection, once, to the driver whose wallet it was debited from.
    let feeCreditPaise: bigint | null = null;
    let walletTransactionId: string | null = null;
    if (input.kind === 'CASH_RETURNED' && input.feeTreatment === 'CREDITED_TO_WALLET') {
      const fee = source.platformFeePaise;
      if (fee === null || fee <= 0n || !source.collectedByDriverId) {
        throw feeTreatmentInvalid('NO_FEE_TO_CREDIT', 'This collection had no platform fee');
      }
      if (amount.amountPaise !== refundablePaise) {
        throw feeTreatmentInvalid(
          'NEEDS_FULL_RETURN',
          'The platform fee is credited back only with the return of everything left',
        );
      }
      const wallet = await tx.driverWallet.findUnique({
        where: { driverId: source.collectedByDriverId },
        select: { id: true },
      });
      if (!wallet) {
        throw new Error(`Driver ${source.collectedByDriverId} has a cash fee but no wallet`);
      }
      const { entry, replayed } = await this.ledger.postEntry(tx, {
        walletId: wallet.id,
        type: 'REFUND_REVERSAL',
        direction: 'CREDIT',
        amountPaise: fee,
        referenceType: 'REFUND',
        referenceId: refundId,
        idempotencyKey: `refund-fee-credit:${refundId}`,
        performedByUserId: admin.userId,
        reason: `Cash returned to the customer; platform fee credited back: ${input.reason}`.slice(
          0,
          500,
        ),
        metadata: { refundId, bookingId: booking.id, collectionId: source.id },
      });
      if (replayed) {
        throw new Error(`Refund ${refundId} already has a fee credit`);
      }
      feeCreditPaise = fee;
      walletTransactionId = entry.id;
    }

    // Lock the source last among the money rows (after the wallet), then check it is unchanged.
    await this.lockSource(tx, source);

    const hold = await this.earnings.holdForRefund(
      tx,
      booking.id,
      `${HOLD_REFUND}: refund ${refundId} requested (${refundCase}); an admin decides what the driver is paid (OPEN_DECISIONS L-21)`,
    );
    if (hold === 'IN_PAYOUT') {
      throw new AppError(
        ErrorCode.REFUND_EARNING_IN_PAYOUT,
        HttpStatus.CONFLICT,
        "The booking's earning is in a payout being executed; retry once that payout resolves",
      );
    }

    const now = new Date();
    const provider = input.kind === 'PROVIDER';
    const refund = await tx.paymentRefund.create({
      data: {
        id: refundId,
        bookingId: booking.id,
        bookingStopId: source.bookingStopId,
        sourceCollectionId: source.type === 'COLLECTION' ? source.id : null,
        sourcePaymentId: source.type === 'PAYMENT' ? source.id : null,
        kind: input.kind,
        status: provider ? 'PENDING' : 'COMPLETED',
        refundCase,
        amountPaise: amount.amountPaise,
        currency: 'INR',
        reason: input.reason,
        requestedByUserId: admin.userId,
        idempotencyKey: key,
        provider: provider ? REFUND_PROVIDER_RAZORPAY : null,
        providerPaymentId: provider ? source.providerPaymentId : null,
        feeTreatment: provider ? null : input.feeTreatment,
        feeCreditPaise,
        walletTransactionId,
        completedAt: provider ? null : now,
      },
    });
    const paymentStatus = await syncBookingMoneyStatus(tx, booking);
    await recordAdminAction(tx, {
      actorUserId: admin.userId,
      action: provider ? 'REFUND_REQUESTED' : 'CASH_RETURN_RECORDED',
      targetType: 'PAYMENT_REFUND',
      targetId: refundId,
      reason: input.reason,
      details: {
        bookingId: booking.id,
        kind: input.kind,
        sourceCollectionId: refund.sourceCollectionId,
        sourcePaymentId: refund.sourcePaymentId,
        stopSequence: stop?.sequence ?? null,
        amountPaise: Number(amount.amountPaise),
        refundablePaise: Number(refundablePaise),
        refundCase,
        feeTreatment: refund.feeTreatment,
        feeCreditPaise: feeCreditPaise === null ? null : Number(feeCreditPaise),
        earningHold: hold satisfies RefundHoldOutcome,
        bookingPaymentStatus: paymentStatus,
      },
    });
    return { refund, created: true };
  }

  /** The source, read under the booking lock: of this booking, completed, by this means. */
  private async loadSource(
    tx: Tx,
    booking: Booking,
    input: RefundRequestInput,
  ): Promise<RefundSource> {
    if (input.sourceCollectionId) {
      const collection = await tx.paymentCollection.findUnique({
        where: { id: input.sourceCollectionId },
      });
      if (!collection || collection.bookingId !== booking.id) {
        throw sourceInvalid('NOT_THIS_BOOKING', 'The collection does not belong to this booking');
      }
      if (collection.status !== 'COMPLETED') {
        throw notRefundable('SOURCE_NOT_COMPLETED', 'Only a completed collection is refunded');
      }
      if (input.kind === 'PROVIDER') {
        if (
          collection.method !== 'ONLINE_QR' ||
          collection.provider !== REFUND_PROVIDER_RAZORPAY ||
          !collection.providerPaymentId
        ) {
          throw sourceInvalid(
            'NOT_ONLINE',
            'A provider refund needs money collected online; cash is returned in cash',
          );
        }
      } else if (collection.method !== 'CASH') {
        throw sourceInvalid(
          'NOT_CASH',
          'Only cash is returned in cash; online money is refunded through the provider',
        );
      }
      return {
        type: 'COLLECTION',
        id: collection.id,
        bookingStopId: collection.bookingStopId,
        amountPaise: collection.amountPaise,
        providerPaymentId: collection.providerPaymentId,
        platformFeePaise: collection.method === 'CASH' ? collection.platformFeePaise : null,
        collectedByDriverId: collection.collectedByDriverId,
      };
    }

    const payment = input.sourcePaymentId
      ? await tx.payment.findUnique({ where: { id: input.sourcePaymentId } })
      : null;
    if (!payment || payment.bookingId !== booking.id || payment.purpose !== 'BOOKING') {
      throw sourceInvalid(
        'NOT_THIS_BOOKING',
        'The payment is not a booking payment of this booking',
      );
    }
    if (payment.status !== 'PAID' || !payment.razorpayPaymentId) {
      throw notRefundable('SOURCE_NOT_COMPLETED', 'Only a paid booking payment is refunded');
    }
    if (input.kind !== 'PROVIDER') {
      throw sourceInvalid('NOT_CASH', 'A prepaid payment is refunded through the provider');
    }
    return {
      type: 'PAYMENT',
      id: payment.id,
      bookingStopId: null,
      amountPaise: payment.amountPaise,
      providerPaymentId: payment.razorpayPaymentId,
      platformFeePaise: null,
      collectedByDriverId: null,
    };
  }

  private async lockSource(tx: Tx, source: RefundSource): Promise<void> {
    const rows =
      source.type === 'COLLECTION'
        ? await tx.$queryRaw<{ status: string }[]>`
            SELECT status FROM payment_collections WHERE id = ${source.id}::uuid FOR UPDATE`
        : await tx.$queryRaw<{ status: string }[]>`
            SELECT status::text AS status FROM payments WHERE id = ${source.id}::uuid FOR UPDATE`;
    const status = rows[0]?.status;
    if (status !== (source.type === 'COLLECTION' ? 'COMPLETED' : 'PAID')) {
      throw notRefundable('SOURCE_NOT_COMPLETED', 'The source changed; it is no longer refundable');
    }
  }

  /** A retried request: the original refund, if it is the same request; pending ones are resent. */
  private async replay(
    refund: PaymentRefund,
    input: RefundRequestInput,
  ): Promise<RequestRefundResult> {
    const same =
      refund.bookingId === input.bookingId &&
      refund.kind === input.kind &&
      refund.sourceCollectionId === input.sourceCollectionId &&
      refund.sourcePaymentId === input.sourcePaymentId &&
      (input.amountPaise === null || refund.amountPaise === BigInt(input.amountPaise)) &&
      (input.kind !== 'CASH_RETURNED' || refund.feeTreatment === input.feeTreatment);
    if (!same) {
      throw new AppError(
        ErrorCode.IDEMPOTENCY_KEY_REUSED,
        HttpStatus.CONFLICT,
        'This idempotency key was already used for a different refund',
      );
    }
    const submission =
      refund.kind === 'PROVIDER' && refund.status === 'PENDING'
        ? await this.submit(refund.id)
        : null;
    return { refund: await this.view(refund.id), created: false, submission };
  }

  private async handleSubmitError(
    refund: PaymentRefund,
    providerPaymentId: string,
    error: unknown,
  ): Promise<SubmissionResult> {
    if (error instanceof RazorpayApiError) {
      // The request may still have created a refund (a late rejection, an unusable reply). Only
      // a provider with no record of our refund id lets us close it.
      let found: ProviderRefund | null;
      try {
        found = findOurRefund(await this.gateway.listPaymentRefunds(providerPaymentId), refund.id);
      } catch (lookupError) {
        this.logger.warn(
          { refundId: refund.id, reason: (lookupError as Error).name },
          'Could not check Razorpay after a rejected refund; it stays PENDING',
        );
        return 'PENDING_RETRY';
      }
      if (found) {
        return submissionResult(await this.finalizer.apply(refund.id, found, 'SUBMIT'));
      }
      if (DEFINITIVE_REJECTIONS.has(error.httpStatus)) {
        await this.finalizer.refuse(
          refund.id,
          `PROVIDER_REJECTED:${error.errorCode ?? error.httpStatus}`,
        );
        return 'REFUSED';
      }
      return 'PENDING_RETRY';
    }
    if (error instanceof RazorpayUnavailableError) {
      // Unknown outcome: the refund stays PENDING and is retried with the same key.
      this.logger.warn({ refundId: refund.id }, 'Refund provider unavailable; will retry');
      return 'PENDING_RETRY';
    }
    throw error;
  }

  private async view(refundId: string): Promise<RefundWithStop> {
    const refund = await this.prisma.paymentRefund.findUnique({
      where: { id: refundId },
      include: REFUND_VIEW,
    });
    if (!refund) {
      throw refundNotFound();
    }
    return refund;
  }
}

/** Request-shape rules the DTO can't express: the fee decision belongs to cash returns only. */
function checkShape(input: RefundRequestInput): void {
  if ((input.sourceCollectionId === null) === (input.sourcePaymentId === null)) {
    throw sourceInvalid('ONE_SOURCE', 'Name exactly one source: a collection or a payment');
  }
  if (input.kind === 'CASH_RETURNED' && input.feeTreatment === null) {
    throw feeTreatmentInvalid(
      'MISSING',
      'A cash return needs the decision on the cash platform fee (KEPT or CREDITED_TO_WALLET)',
    );
  }
  if (input.kind === 'PROVIDER' && input.feeTreatment !== null) {
    throw feeTreatmentInvalid('NOT_A_CASH_RETURN', 'Only a cash return has a fee decision');
  }
}

/**
 * The goods behind the money were handed over: picked up, for money collected for the whole
 * booking; delivered, for a drop's money.
 */
function handedOver(trip: Trip | null, stop: BookingStop | null): boolean {
  if (stop) {
    return stop.deliveredAt !== null;
  }
  return trip?.pickupVerifiedAt !== null && trip?.pickupVerifiedAt !== undefined;
}

function refundNotes(refund: PaymentRefund): Record<string, string> {
  return {
    refund_id: refund.id,
    booking_id: refund.bookingId,
    ...(refund.sourceCollectionId ? { collection_id: refund.sourceCollectionId } : {}),
    ...(refund.sourcePaymentId ? { payment_id: refund.sourcePaymentId } : {}),
  };
}

function submissionResult(result: RefundUpdateResult): SubmissionResult {
  return result.outcome === 'REFUND_APPLIED' || result.outcome === 'REFUND_ALREADY_APPLIED'
    ? result.refund.status
    : result.outcome;
}

export function toRefundProviderError(error: unknown): unknown {
  if (error instanceof RazorpayUnavailableError || error instanceof RazorpayApiError) {
    return new AppError(
      ErrorCode.REFUND_PROVIDER_ERROR,
      HttpStatus.BAD_GATEWAY,
      error instanceof RazorpayUnavailableError
        ? 'The refund provider is unavailable; nothing was changed, retry later'
        : 'The refund provider refused the request; nothing was changed',
    );
  }
  return error;
}

function refundNotFound(): AppError {
  return new AppError(ErrorCode.REFUND_NOT_FOUND, HttpStatus.NOT_FOUND, 'Refund not found');
}

function sourceInvalid(reason: string, message: string): AppError {
  return new AppError(ErrorCode.REFUND_SOURCE_INVALID, HttpStatus.UNPROCESSABLE_ENTITY, message, {
    reason,
  });
}

function notRefundable(
  reason: string,
  message: string,
  extra: Readonly<Record<string, unknown>> = {},
): AppError {
  return new AppError(ErrorCode.REFUND_SOURCE_NOT_REFUNDABLE, HttpStatus.CONFLICT, message, {
    reason,
    ...extra,
  });
}

function feeTreatmentInvalid(reason: string, message: string): AppError {
  return new AppError(
    ErrorCode.REFUND_FEE_TREATMENT_REQUIRED,
    HttpStatus.UNPROCESSABLE_ENTITY,
    message,
    { reason },
  );
}

import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Principal } from '../auth/principal';
import { recordAdminAction } from '../audit/admin-actions';
import { computeEarningBreakdown } from '../common/deductions';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { feeForFare } from '../fees/fee-rules';
import type {
  Booking,
  DriverEarning,
  PaymentCollection,
  PaymentSettlement,
  Prisma,
  Trip,
} from '../generated/prisma/client';
import type { EarningStatus } from '../generated/prisma/enums';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import {
  type EarningFunding,
  earningFunding,
  onlineSettlementProgress,
  prepaidSplit,
  type SourceSettlement,
} from './earning-funding';

export const EARNINGS_PAGE_SIZE = 20;

/** Hold reason prefixes set by the system (an admin hold carries the admin's own reason). */
export const HOLD_PAYMENT_DISPUTED = 'PAYMENT_DISPUTED';
export const HOLD_UNDELIVERED_STOP_REVIEW = 'UNDELIVERED_STOP_REVIEW';
/** A refund of the booking's money was requested (payment flow Phase 6). */
export const HOLD_REFUND = 'REFUND';

/** What applying a merchant settlement did to a booking's earning. */
export type SettlementApplyOutcome =
  /** AWAITING_SETTLEMENT -> PAYABLE: every online payment of the earning is now settled. */
  | 'PROMOTED'
  /** ON_HOLD: the settlement is recorded; the earning stays held until an admin releases it. */
  | 'LINKED_ON_HOLD'
  | 'ALREADY_LINKED'
  /** The trip has not completed yet; the earning will start PAYABLE when it does. */
  | 'NO_EARNING_YET'
  /**
   * Funded by several collections and another online one is still unsettled: the earning stays
   * AWAITING_SETTLEMENT until every one is (payment flow Phase 5).
   */
  | 'PARTIALLY_SETTLED'
  | 'NOT_APPLICABLE';

/** An earning with the collections that fund it and their merchant settlements. */
export const EARNING_SOURCES = {
  collectionLinks: {
    // In the order the money was collected (drop by drop). The links themselves are all written
    // in one transaction at trip completion, so their own created_at ties.
    orderBy: [{ collection: { createdAt: 'asc' } }, { collectionId: 'asc' }],
    include: {
      collection: {
        select: {
          bookingStop: { select: { sequence: true } },
          settlement: { select: { id: true, providerSettlementId: true, settledAt: true } },
        },
      },
    },
  },
} satisfies Prisma.DriverEarningInclude;

export type EarningWithSources = Prisma.DriverEarningGetPayload<{
  include: typeof EARNING_SOURCES;
}>;

export interface EarningPage {
  readonly items: EarningWithSources[];
  readonly nextCursor: string | null;
}

/**
 * Totals per state. Each earning counts its payout amount under its status (0 for CASH, the online
 * net otherwise) and the cash share the driver already kept under settledInCashPaise, so the cash
 * part of a MIXED earning is never shown as waiting for a settlement.
 */
export interface EarningSummary {
  /** Payout amounts whose online payments Razorpay has not all settled yet. Not payable. */
  readonly awaitingSettlementPaise: bigint;
  /** Settled payout amounts waiting for the next weekly payout. */
  readonly payablePaise: bigint;
  readonly inPayoutPaise: bigint;
  readonly onHoldPaise: bigint;
  readonly paidPaise: bigint;
  /** The driver's share of cash already kept (cash collected minus its fee). */
  readonly settledInCashPaise: bigint;
  readonly grossPaise: bigint;
  readonly platformFeePaise: bigint;
  readonly tripCount: number;
}

/** Result of trying to hold an earning because its customer payment is disputed. */
export type DisputeHoldOutcome =
  'HELD' | 'ALREADY_ON_HOLD' | 'NO_EARNING_YET' | 'CASH_EARNING' | 'IN_PAYOUT' | 'ALREADY_PAID';

/** Result of trying to hold an earning because a refund of its booking's money was requested. */
export type RefundHoldOutcome =
  'HELD' | 'ALREADY_ON_HOLD' | 'NO_EARNING' | 'CASH_EARNING' | 'IN_PAYOUT' | 'ALREADY_PAID';

/**
 * Driver earnings: what the driver earned on each completed trip (gross fare, platform fee, net
 * share). This is deliberately separate from the wallet, whose balance only funds cash-trip fees
 * and is never the driver's earnings.
 */
@Injectable()
export class EarningsService {
  private readonly logger = new Logger(EarningsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Creates the earning for a trip that is completing, inside the completion transaction (the
   * caller holds the booking and trip locks). Idempotent: one earning per booking (UNIQUE).
   *
   *   prepaid or QR (money with Nikhil Enterprises) -> ONLINE:
   *       AWAITING_SETTLEMENT until Razorpay settles every online payment,
   *       PAYABLE if those settlements are already recorded,
   *       ON_HOLD if a payment is disputed, or a drop was left undelivered (L-11 / D-70 technical
   *       safe default, EARNINGS_UNDELIVERED_DROP_HOLD)
   *   cash (money with the driver, fee already debited from the wallet) -> CASH, SETTLED_IN_CASH
   *   both (a booking paid drop by drop) -> MIXED: the cash part is already with the driver; the
   *       online part follows the ONLINE rules
   */
  async createForCompletedTrip(
    tx: Tx,
    booking: Booking,
    trip: Trip,
    completedAt: Date,
  ): Promise<DriverEarning> {
    const existing = await tx.driverEarning.findUnique({ where: { bookingId: booking.id } });
    if (existing) {
      return existing;
    }

    const rule = await tx.feeRule.findUniqueOrThrow({ where: { id: booking.feeRuleId } });
    const gross = booking.finalFareMinor;
    // The fee frozen at registration; a legacy booking computes it from its pinned rule.
    const onlineFee = booking.platformFeePaise ?? feeForFare(rule, gross);
    const base = {
      bookingId: booking.id,
      tripId: trip.id,
      driverId: trip.driverId,
      grossAmountPaise: gross,
      feeRuleId: rule.id,
    };

    let data: Prisma.DriverEarningUncheckedCreateInput;
    let funding: EarningFunding | null = null;
    if (booking.paymentMethod === 'PREPAID_UPI') {
      const payment = await tx.payment.findFirst({
        where: { bookingId: booking.id, purpose: 'BOOKING', status: 'PAID' },
      });
      if (!payment) {
        throw new Error(`Booking ${booking.id} is PAID without a paid booking payment`);
      }
      const disputed = await this.isDisputed(tx, payment.razorpayPaymentId);
      const settlement = await tx.paymentSettlement.findUnique({
        where: { paymentId: payment.id },
      });
      data = {
        ...base,
        ...breakdown(gross, onlineFee),
        ...prepaidSplit(gross, onlineFee),
        settlement: 'ONLINE',
        paymentId: payment.id,
        ...onlineStatus(disputed ? DISPUTED_HOLD : null, settlement, completedAt),
      };
    } else {
      // Every completed collection of the booking funds the earning: one for a booking paid as a
      // whole, one per paid drop for a booking paid drop by drop (payment flow Phase 4).
      const collections = await tx.paymentCollection.findMany({
        where: { bookingId: booking.id, status: 'COMPLETED' },
        include: { bookingStop: { select: { platformFeeSharePaise: true } } },
        orderBy: [{ completedAt: 'asc' }, { id: 'asc' }],
      });
      if (collections.length === 0) {
        throw new Error(`Booking ${booking.id} is paid without a completed collection`);
      }
      funding = earningFunding(
        collections.map((collection) => ({
          collectionId: collection.id,
          method: collection.method === 'CASH' ? ('CASH' as const) : ('ONLINE_QR' as const),
          amountPaise: collection.amountPaise,
          platformFeePaise: feeOnCollection(collection, onlineFee),
        })),
      );
      const fields = {
        ...base,
        // Gross is what was collected: the fare, unless a drop ended undelivered and unpaid (N5).
        ...breakdown(funding.grossPaise, funding.platformFeePaise),
        ...funding.split,
        settlement: funding.settlement,
        collectionId: funding.collectionId,
      };
      if (funding.settlement === 'CASH') {
        data = { ...fields, status: 'SETTLED_IN_CASH' };
      } else {
        const online = collections.filter((collection) => collection.method !== 'CASH');
        let disputed = false;
        for (const collection of online) {
          disputed = disputed || (await this.isDisputed(tx, collection.providerPaymentId));
        }
        const hold = disputed ? DISPUTED_HOLD : await this.undeliveredStopHold(tx, booking.id);
        const settlements = await tx.paymentSettlement.findMany({
          where: { collectionId: { in: online.map((collection) => collection.id) } },
        });
        if (funding.collectionId !== null) {
          // One online collection: its own settlement link, as before.
          data = { ...fields, ...onlineStatus(hold, settlements[0] ?? null, completedAt) };
        } else {
          // Several: payable only once every online collection is settled (trg_earnings_settled).
          const progress = onlineSettlementProgress(
            online.map((collection) => ({
              collectionId: collection.id,
              method: 'ONLINE_QR',
              amountPaise: collection.amountPaise,
              settledAt:
                settlements.find((settlement) => settlement.collectionId === collection.id)
                  ?.settledAt ?? null,
            })),
          );
          data = { ...fields, ...severalStatus(hold, progress.settledAt, completedAt) };
        }
      }
    }

    const earning = await tx.driverEarning.create({ data });
    if (funding) {
      // The source of every amount: one row per funding collection (deferred check at commit).
      await tx.earningCollection.createMany({
        data: funding.collections.map((collection) => ({
          collectionId: collection.collectionId,
          earningId: earning.id,
          bookingId: booking.id,
          method: collection.method,
          amountPaise: collection.amountPaise,
          platformFeePaise: collection.platformFeePaise,
          netAmountPaise: collection.amountPaise - collection.platformFeePaise,
        })),
      });
    }
    this.logger.log(
      {
        earningId: earning.id,
        bookingId: booking.id,
        driverId: trip.driverId,
        settlement: earning.settlement,
        status: earning.status,
        grossPaise: Number(earning.grossAmountPaise),
        feePaise: Number(earning.platformFeePaise),
        payoutPaise: Number(earning.payoutAmountPaise),
      },
      'Driver earning recorded',
    );
    return earning;
  }

  async listForDriver(
    driverId: string,
    options: { limit?: number; cursor?: string; status?: EarningStatus },
  ): Promise<EarningPage> {
    return this.page({ driverId, ...(options.status ? { status: options.status } : {}) }, options);
  }

  async listAll(options: {
    limit?: number;
    cursor?: string;
    status?: EarningStatus;
    driverId?: string;
  }): Promise<EarningPage> {
    return this.page(
      {
        ...(options.driverId ? { driverId: options.driverId } : {}),
        ...(options.status ? { status: options.status } : {}),
      },
      options,
    );
  }

  async summaryForDriver(driverId: string): Promise<EarningSummary> {
    const groups = await this.prisma.driverEarning.groupBy({
      by: ['status'],
      where: { driverId },
      _sum: {
        netAmountPaise: true,
        payoutAmountPaise: true,
        grossAmountPaise: true,
        platformFeePaise: true,
      },
      _count: { _all: true },
    });
    const payout = (status: EarningStatus) =>
      groups.find((group) => group.status === status)?._sum.payoutAmountPaise ?? 0n;
    const total = (
      field: 'netAmountPaise' | 'payoutAmountPaise' | 'grossAmountPaise' | 'platformFeePaise',
    ) => groups.reduce((sum, group) => sum + (group._sum[field] ?? 0n), 0n);
    return {
      awaitingSettlementPaise: payout('AWAITING_SETTLEMENT'),
      payablePaise: payout('PAYABLE'),
      inPayoutPaise: payout('IN_PAYOUT'),
      onHoldPaise: payout('ON_HOLD'),
      paidPaise: payout('PAID'),
      // What is not paid out is the cash part, already kept: net - payout amount.
      settledInCashPaise: total('netAmountPaise') - total('payoutAmountPaise'),
      grossPaise: total('grossAmountPaise'),
      platformFeePaise: total('platformFeePaise'),
      tripCount: groups.reduce((sum, group) => sum + group._count._all, 0),
    };
  }

  async getForDriver(driverId: string, earningId: string): Promise<EarningWithSources> {
    const earning = await this.prisma.driverEarning.findFirst({
      where: { id: earningId, driverId },
      include: EARNING_SOURCES,
    });
    if (!earning) {
      throw new AppError(ErrorCode.EARNING_NOT_FOUND, HttpStatus.NOT_FOUND, 'Earning not found');
    }
    return earning;
  }

  async get(earningId: string): Promise<EarningWithSources> {
    const earning = await this.prisma.driverEarning.findUnique({
      where: { id: earningId },
      include: EARNING_SOURCES,
    });
    if (!earning) {
      throw new AppError(ErrorCode.EARNING_NOT_FOUND, HttpStatus.NOT_FOUND, 'Earning not found');
    }
    return earning;
  }

  /**
   * Admin hold: keeps an earning that is payable (or still waiting for its settlement) out of
   * payouts until released. Idempotent.
   */
  async hold(admin: Principal, earningId: string, reason: string): Promise<EarningWithSources> {
    await this.prisma.runInTransaction(async (tx) => {
      const earning = await this.lock(tx, earningId);
      if (earning.status === 'ON_HOLD') {
        return;
      }
      if (earning.status !== 'PAYABLE' && earning.status !== 'AWAITING_SETTLEMENT') {
        throw invalidState(
          earning.status,
          'Only an earning that is payable or awaiting settlement can be put on hold',
        );
      }
      await tx.driverEarning.update({
        where: { id: earningId },
        data: {
          status: 'ON_HOLD',
          holdReason: reason,
          heldAt: new Date(),
          heldByUserId: admin.userId,
        },
      });
      await recordAdminAction(tx, {
        actorUserId: admin.userId,
        action: 'EARNING_HELD',
        targetType: 'DRIVER_EARNING',
        targetId: earningId,
        reason,
      });
    });
    return this.get(earningId);
  }

  /**
   * Admin release of an ON_HOLD earning (a dispute, a failed or returned payout, an undelivered
   * drop). It becomes PAYABLE only if every online payment of it is already settled; otherwise it
   * goes back to AWAITING_SETTLEMENT. A release never makes unsettled money payable, and a
   * released earning is paid only by a new payout. Idempotent.
   */
  async release(admin: Principal, earningId: string, reason: string): Promise<EarningWithSources> {
    await this.prisma.runInTransaction(async (tx) => {
      const earning = await this.lock(tx, earningId);
      if (earning.status === 'PAYABLE' || earning.status === 'AWAITING_SETTLEMENT') {
        return;
      }
      if (earning.status !== 'ON_HOLD') {
        throw invalidState(earning.status, 'Only an earning on hold can be released');
      }
      const settledAt = await this.settledAt(tx, earning);
      const cleared = { holdReason: null, heldAt: null, heldByUserId: null };
      const released = await tx.driverEarning.update({
        where: { id: earningId },
        data: settledAt
          ? {
              ...cleared,
              status: 'PAYABLE',
              ...(earning.payableAt ? {} : { payableAt: later(settledAt, earning.createdAt) }),
            }
          : { ...cleared, status: 'AWAITING_SETTLEMENT' },
      });
      await recordAdminAction(tx, {
        actorUserId: admin.userId,
        action: 'EARNING_RELEASED',
        targetType: 'DRIVER_EARNING',
        targetId: earningId,
        reason,
        details: { previousHoldReason: earning.holdReason, releasedTo: released.status },
      });
    });
    return this.get(earningId);
  }

  /**
   * Applies a recorded merchant settlement to the booking's earning, inside the settlement's
   * transaction (the caller holds the booking lock, the same lock trip completion takes, so a
   * completing trip and a settlement never miss each other). An earning funded by several
   * collections becomes payable only with the settlement of its last unsettled online collection.
   */
  async applySettlement(
    tx: Tx,
    bookingId: string,
    settlement: Pick<PaymentSettlement, 'id' | 'settledAt' | 'collectionId'>,
  ): Promise<SettlementApplyOutcome> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM driver_earnings WHERE booking_id = ${bookingId}::uuid FOR UPDATE`;
    const [row] = rows;
    if (!row) {
      return 'NO_EARNING_YET';
    }
    const earning = await tx.driverEarning.findUniqueOrThrow({ where: { id: row.id } });
    if (earning.settlement === 'CASH') {
      return 'NOT_APPLICABLE';
    }
    if (earning.paymentId === null && earning.collectionId === null) {
      return this.applyToSeveral(tx, earning, settlement);
    }
    if (earning.paymentSettlementId) {
      return 'ALREADY_LINKED';
    }
    if (earning.status === 'AWAITING_SETTLEMENT') {
      await tx.driverEarning.update({
        where: { id: earning.id },
        data: {
          status: 'PAYABLE',
          paymentSettlementId: settlement.id,
          payableAt: later(settlement.settledAt, earning.createdAt),
        },
      });
      this.logger.log(
        { earningId: earning.id, bookingId, settlementId: settlement.id },
        'Earning is payable: merchant settlement confirmed',
      );
      return 'PROMOTED';
    }
    if (earning.status === 'ON_HOLD') {
      await tx.driverEarning.update({
        where: { id: earning.id },
        data: { paymentSettlementId: settlement.id },
      });
      return 'LINKED_ON_HOLD';
    }
    return 'NOT_APPLICABLE';
  }

  /**
   * Keeps a disputed payment's earning out of automatic payouts. Runs inside the dispute
   * webhook's transaction. Never touches an earning that is already being paid or was paid: those
   * are reported for manual review instead.
   */
  async holdForDispute(tx: Tx, bookingId: string, reason: string): Promise<DisputeHoldOutcome> {
    // Earnings created later check payment_disputes and start ON_HOLD.
    return (await this.holdForReview(tx, bookingId, reason)) ?? 'NO_EARNING_YET';
  }

  /**
   * A refund of the booking's money was requested (payment flow Phase 6): its earning goes ON_HOLD
   * (REFUND) so nothing is paid out on money being given back, until an admin decides. Runs inside
   * the refund's transaction, after the booking lock. Nothing is clawed back: an earning already
   * paid out (PAID) or kept in cash (SETTLED_IN_CASH) is left as it is and reported by
   * reconciliation (L-21, open). IN_PAYOUT is returned for the caller to refuse the refund until
   * that payout resolves. What the driver gets after a refund is an open business decision.
   */
  async holdForRefund(tx: Tx, bookingId: string, reason: string): Promise<RefundHoldOutcome> {
    // Only cancelled or completed bookings are refunded; a cancelled one never has an earning.
    return (await this.holdForReview(tx, bookingId, reason)) ?? 'NO_EARNING';
  }

  /** Puts the booking's earning ON_HOLD with a system reason when it can still be held. */
  private async holdForReview(
    tx: Tx,
    bookingId: string,
    reason: string,
  ): Promise<Exclude<DisputeHoldOutcome, 'NO_EARNING_YET'> | null> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM driver_earnings WHERE booking_id = ${bookingId}::uuid FOR UPDATE`;
    const [row] = rows;
    if (!row) {
      return null;
    }
    const earning = await tx.driverEarning.findUniqueOrThrow({ where: { id: row.id } });
    switch (earning.status) {
      case 'ON_HOLD':
        return 'ALREADY_ON_HOLD';
      case 'SETTLED_IN_CASH':
        return 'CASH_EARNING';
      case 'IN_PAYOUT':
        return 'IN_PAYOUT';
      case 'PAID':
        return 'ALREADY_PAID';
      case 'AWAITING_SETTLEMENT':
      case 'PAYABLE':
        await tx.driverEarning.update({
          where: { id: earning.id },
          data: {
            status: 'ON_HOLD',
            holdReason: reason.slice(0, 500),
            heldAt: new Date(),
            heldByUserId: null,
          },
        });
        return 'HELD';
    }
  }

  /** The collections funding an earning, with when each online one was settled. */
  async sourcesOf(db: Tx | PrismaService, earningId: string): Promise<SourceSettlement[]> {
    const links = await db.earningCollection.findMany({
      where: { earningId },
      include: { collection: { select: { settlement: { select: { settledAt: true } } } } },
    });
    return links.map((link) => ({
      collectionId: link.collectionId,
      method: link.method,
      amountPaise: link.amountPaise,
      settledAt: link.collection.settlement?.settledAt ?? null,
    }));
  }

  /** Several collections: payable once the last unsettled online one is settled. */
  private async applyToSeveral(
    tx: Tx,
    earning: DriverEarning,
    settlement: Pick<PaymentSettlement, 'id' | 'settledAt' | 'collectionId'>,
  ): Promise<SettlementApplyOutcome> {
    const sources = await this.sourcesOf(tx, earning.id);
    if (
      !sources.some(
        (source) =>
          source.method === 'ONLINE_QR' && source.collectionId === settlement.collectionId,
      )
    ) {
      return 'NOT_APPLICABLE';
    }
    const progress = onlineSettlementProgress(sources);
    if (!progress.fullySettled || progress.settledAt === null) {
      return 'PARTIALLY_SETTLED';
    }
    if (earning.status === 'AWAITING_SETTLEMENT') {
      await tx.driverEarning.update({
        where: { id: earning.id },
        data: { status: 'PAYABLE', payableAt: later(progress.settledAt, earning.createdAt) },
      });
      this.logger.log(
        { earningId: earning.id, bookingId: earning.bookingId, settlementId: settlement.id },
        'Earning is payable: every online collection is settled',
      );
      return 'PROMOTED';
    }
    return earning.status === 'ON_HOLD' ? 'LINKED_ON_HOLD' : 'ALREADY_LINKED';
  }

  /** When the earning's online money was fully settled, or null while it isn't (or is cash). */
  private async settledAt(tx: Tx, earning: DriverEarning): Promise<Date | null> {
    if (earning.settlement === 'CASH') {
      return null;
    }
    if (earning.paymentId !== null || earning.collectionId !== null) {
      if (!earning.paymentSettlementId) {
        return null;
      }
      const settlement = await tx.paymentSettlement.findUniqueOrThrow({
        where: { id: earning.paymentSettlementId },
      });
      return settlement.settledAt;
    }
    return onlineSettlementProgress(await this.sourcesOf(tx, earning.id)).settledAt;
  }

  /**
   * L-11 / D-70 (open business decisions; technical safe default, not a final rule): with
   * EARNINGS_UNDELIVERED_DROP_HOLD on (the default), a drop left undelivered holds the online part
   * for an admin's review. Either way the earning carries only what was collected (an unpaid drop
   * adds nothing), and nothing is refunded, compensated or debited on its own.
   */
  private async undeliveredStopHold(tx: Tx, bookingId: string): Promise<string | null> {
    if (!this.config.earnings.undeliveredDropHold) {
      return null;
    }
    const undelivered = await tx.bookingStop.findMany({
      where: { bookingId, status: 'UNDELIVERED' },
      select: { sequence: true },
      orderBy: { sequence: 'asc' },
    });
    if (undelivered.length === 0) {
      return null;
    }
    const drops = undelivered.map((stop) => stop.sequence).join(', ');
    return `${HOLD_UNDELIVERED_STOP_REVIEW}: drop ${drops} was not delivered; an admin reviews the trip before its online part is paid out`;
  }

  private async lock(tx: Tx, earningId: string): Promise<DriverEarning> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM driver_earnings WHERE id = ${earningId}::uuid FOR UPDATE`;
    if (rows.length === 0) {
      throw new AppError(ErrorCode.EARNING_NOT_FOUND, HttpStatus.NOT_FOUND, 'Earning not found');
    }
    return tx.driverEarning.findUniqueOrThrow({ where: { id: earningId } });
  }

  private async isDisputed(tx: Tx, providerPaymentId: string | null): Promise<boolean> {
    if (!providerPaymentId) {
      return false;
    }
    const disputes = await tx.paymentDispute.count({ where: { providerPaymentId } });
    return disputes > 0;
  }

  private async page(
    where: Prisma.DriverEarningWhereInput,
    options: { limit?: number; cursor?: string },
  ): Promise<EarningPage> {
    const limit = options.limit ?? EARNINGS_PAGE_SIZE;
    const rows = await this.prisma.driverEarning.findMany({
      where,
      include: EARNING_SOURCES,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items.at(-1);
    return { items, nextCursor: hasMore && last ? last.id : null };
  }
}

const DISPUTED_HOLD = `${HOLD_PAYMENT_DISPUTED}: the customer payment has a dispute`;

/** Server-side amounts of an earning (fee from the pinned rule; TDS policy DISABLED). */
function breakdown(
  gross: bigint,
  fee: bigint,
): Pick<
  Prisma.DriverEarningUncheckedCreateInput,
  | 'grossAmountPaise'
  | 'platformFeePaise'
  | 'otherDeductionsPaise'
  | 'tdsAmountPaise'
  | 'netAmountPaise'
  | 'tdsPolicy'
  | 'taxRuleId'
> {
  return computeEarningBreakdown(gross, fee);
}

/**
 * Starting state of an earning with one online source. It is payable only once Razorpay has
 * settled the customer payment; a hold (dispute, undelivered drop) keeps it held either way.
 */
function onlineStatus(
  holdReason: string | null,
  settlement: Pick<PaymentSettlement, 'id' | 'settledAt'> | null,
  completedAt: Date,
): Pick<
  Prisma.DriverEarningUncheckedCreateInput,
  'status' | 'payableAt' | 'holdReason' | 'heldAt' | 'paymentSettlementId'
> {
  if (holdReason) {
    return {
      status: 'ON_HOLD',
      paymentSettlementId: settlement?.id ?? null,
      holdReason,
      heldAt: completedAt,
    };
  }
  if (settlement) {
    return {
      status: 'PAYABLE',
      paymentSettlementId: settlement.id,
      payableAt: later(settlement.settledAt, completedAt),
    };
  }
  return { status: 'AWAITING_SETTLEMENT' };
}

/**
 * Starting state of an earning funded by several collections with online money: payable once
 * every online collection is settled (`settledAt` is the latest of them), never on one alone.
 */
function severalStatus(
  holdReason: string | null,
  settledAt: Date | null,
  completedAt: Date,
): Pick<
  Prisma.DriverEarningUncheckedCreateInput,
  'status' | 'payableAt' | 'holdReason' | 'heldAt'
> {
  if (holdReason) {
    return { status: 'ON_HOLD', holdReason, heldAt: completedAt };
  }
  if (settledAt) {
    return { status: 'PAYABLE', payableAt: later(settledAt, completedAt) };
  }
  return { status: 'AWAITING_SETTLEMENT' };
}

/**
 * The platform fee on one collection: the fee debited from the wallet for cash; for an online
 * collection, the share owed on it (its drop's share, or the booking's whole fee).
 */
function feeOnCollection(
  collection: Pick<PaymentCollection, 'id' | 'method' | 'platformFeePaise'> & {
    readonly bookingStop: { readonly platformFeeSharePaise: bigint } | null;
  },
  bookingFee: bigint,
): bigint {
  if (collection.method === 'CASH') {
    if (collection.platformFeePaise === null) {
      throw new Error(`Cash collection ${collection.id} has no platform fee`);
    }
    return collection.platformFeePaise;
  }
  return collection.bookingStop?.platformFeeSharePaise ?? bookingFee;
}

/** An earning is eligible from the later of trip completion and merchant settlement. */
function later(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b;
}

function invalidState(status: EarningStatus, message: string): AppError {
  return new AppError(ErrorCode.EARNING_INVALID_STATE, HttpStatus.CONFLICT, message, { status });
}

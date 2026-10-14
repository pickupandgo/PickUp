import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { Principal } from '../auth/principal';
import { recordAdminAction } from '../audit/admin-actions';
import { computeEarningBreakdown } from '../common/deductions';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { feeForFare } from '../fees/fee-rules';
import type {
  Booking,
  DriverEarning,
  PaymentSettlement,
  Prisma,
  Trip,
} from '../generated/prisma/client';
import type { EarningStatus } from '../generated/prisma/enums';
import { PrismaService, type Tx } from '../prisma/prisma.service';

export const EARNINGS_PAGE_SIZE = 20;

/** What applying a merchant settlement did to a booking's earning. */
export type SettlementApplyOutcome =
  /** AWAITING_SETTLEMENT -> PAYABLE. */
  | 'PROMOTED'
  /** ON_HOLD: the settlement is linked; the earning stays held until an admin releases it. */
  | 'LINKED_ON_HOLD'
  | 'ALREADY_LINKED'
  /** The trip has not completed yet; the earning will start PAYABLE when it does. */
  | 'NO_EARNING_YET'
  | 'NOT_APPLICABLE';

export interface EarningPage {
  readonly items: DriverEarning[];
  readonly nextCursor: string | null;
}

export interface EarningSummary {
  /** ONLINE earnings whose customer payment Razorpay has not settled yet. Not payable. */
  readonly awaitingSettlementPaise: bigint;
  /** ONLINE earnings (settled) waiting for the next weekly payout. */
  readonly payablePaise: bigint;
  readonly inPayoutPaise: bigint;
  readonly onHoldPaise: bigint;
  readonly paidPaise: bigint;
  /** Net share of CASH trips the driver already kept. */
  readonly settledInCashPaise: bigint;
  readonly grossPaise: bigint;
  readonly platformFeePaise: bigint;
  readonly tripCount: number;
}

/** Result of trying to hold an earning because its customer payment is disputed. */
export type DisputeHoldOutcome =
  'HELD' | 'ALREADY_ON_HOLD' | 'NO_EARNING_YET' | 'CASH_EARNING' | 'IN_PAYOUT' | 'ALREADY_PAID';

/**
 * Driver earnings: what the driver earned on each completed trip (gross fare, platform fee, net
 * share). This is deliberately separate from the wallet, whose balance only funds cash-trip fees
 * and is never the driver's earnings.
 */
@Injectable()
export class EarningsService {
  private readonly logger = new Logger(EarningsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates the earning for a trip that is completing, inside the completion transaction (the
   * caller holds the booking and trip locks). Idempotent: one earning per booking (UNIQUE).
   *
   *   prepaid or QR (money with Nikhil Enterprises) -> ONLINE:
   *       AWAITING_SETTLEMENT until Razorpay settles the customer payment,
   *       PAYABLE if that settlement is already recorded,
   *       ON_HOLD if the payment is disputed
   *   cash (money with the driver, fee already debited from the wallet) -> CASH, SETTLED_IN_CASH
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
        settlement: 'ONLINE',
        paymentId: payment.id,
        ...onlineStatus(disputed, settlement, completedAt),
      };
    } else {
      const collection = await tx.paymentCollection.findFirst({
        where: { bookingId: booking.id, status: 'COMPLETED' },
      });
      if (!collection) {
        throw new Error(`Booking ${booking.id} is PAID without a completed collection`);
      }
      if (collection.method === 'CASH') {
        if (collection.platformFeePaise === null) {
          throw new Error(`Cash collection ${collection.id} has no platform fee`);
        }
        data = {
          ...base,
          ...breakdown(gross, collection.platformFeePaise),
          settlement: 'CASH',
          collectionId: collection.id,
          status: 'SETTLED_IN_CASH',
        };
      } else {
        const disputed = await this.isDisputed(tx, collection.providerPaymentId);
        const settlement = await tx.paymentSettlement.findUnique({
          where: { collectionId: collection.id },
        });
        data = {
          ...base,
          ...breakdown(gross, onlineFee),
          settlement: 'ONLINE',
          collectionId: collection.id,
          ...onlineStatus(disputed, settlement, completedAt),
        };
      }
    }

    const earning = await tx.driverEarning.create({ data });
    this.logger.log(
      {
        earningId: earning.id,
        bookingId: booking.id,
        driverId: trip.driverId,
        settlement: earning.settlement,
        status: earning.status,
        grossPaise: Number(earning.grossAmountPaise),
        feePaise: Number(earning.platformFeePaise),
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
      _sum: { netAmountPaise: true, grossAmountPaise: true, platformFeePaise: true },
      _count: { _all: true },
    });
    const net = (status: EarningStatus) =>
      groups.find((group) => group.status === status)?._sum.netAmountPaise ?? 0n;
    return {
      awaitingSettlementPaise: net('AWAITING_SETTLEMENT'),
      payablePaise: net('PAYABLE'),
      inPayoutPaise: net('IN_PAYOUT'),
      onHoldPaise: net('ON_HOLD'),
      paidPaise: net('PAID'),
      settledInCashPaise: net('SETTLED_IN_CASH'),
      grossPaise: groups.reduce((sum, group) => sum + (group._sum.grossAmountPaise ?? 0n), 0n),
      platformFeePaise: groups.reduce(
        (sum, group) => sum + (group._sum.platformFeePaise ?? 0n),
        0n,
      ),
      tripCount: groups.reduce((sum, group) => sum + group._count._all, 0),
    };
  }

  async getForDriver(driverId: string, earningId: string): Promise<DriverEarning> {
    const earning = await this.prisma.driverEarning.findFirst({
      where: { id: earningId, driverId },
    });
    if (!earning) {
      throw new AppError(ErrorCode.EARNING_NOT_FOUND, HttpStatus.NOT_FOUND, 'Earning not found');
    }
    return earning;
  }

  async get(earningId: string): Promise<DriverEarning> {
    const earning = await this.prisma.driverEarning.findUnique({ where: { id: earningId } });
    if (!earning) {
      throw new AppError(ErrorCode.EARNING_NOT_FOUND, HttpStatus.NOT_FOUND, 'Earning not found');
    }
    return earning;
  }

  /**
   * Admin hold: keeps an earning that is payable (or still waiting for its settlement) out of
   * payouts until released. Idempotent.
   */
  async hold(admin: Principal, earningId: string, reason: string): Promise<DriverEarning> {
    return this.prisma.runInTransaction(async (tx) => {
      const earning = await this.lock(tx, earningId);
      if (earning.status === 'ON_HOLD') {
        return earning;
      }
      if (earning.status !== 'PAYABLE' && earning.status !== 'AWAITING_SETTLEMENT') {
        throw invalidState(
          earning.status,
          'Only an earning that is payable or awaiting settlement can be put on hold',
        );
      }
      const held = await tx.driverEarning.update({
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
      return held;
    });
  }

  /**
   * Admin release of an ON_HOLD earning. It becomes PAYABLE only if its customer payment is
   * already settled; otherwise it goes back to AWAITING_SETTLEMENT. A release never makes
   * unsettled money payable. Idempotent.
   */
  async release(admin: Principal, earningId: string, reason: string): Promise<DriverEarning> {
    return this.prisma.runInTransaction(async (tx) => {
      const earning = await this.lock(tx, earningId);
      if (earning.status === 'PAYABLE' || earning.status === 'AWAITING_SETTLEMENT') {
        return earning;
      }
      if (earning.status !== 'ON_HOLD') {
        throw invalidState(earning.status, 'Only an earning on hold can be released');
      }
      const settlement = earning.paymentSettlementId
        ? await tx.paymentSettlement.findUniqueOrThrow({
            where: { id: earning.paymentSettlementId },
          })
        : null;
      const cleared = { holdReason: null, heldAt: null, heldByUserId: null };
      const released = await tx.driverEarning.update({
        where: { id: earningId },
        data: settlement
          ? {
              ...cleared,
              status: 'PAYABLE',
              ...(earning.payableAt
                ? {}
                : { payableAt: later(settlement.settledAt, earning.createdAt) }),
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
      return released;
    });
  }

  /**
   * Applies a recorded merchant settlement to the booking's earning, inside the settlement's
   * transaction (the caller holds the booking lock, the same lock trip completion takes, so a
   * completing trip and a settlement never miss each other).
   */
  async applySettlement(
    tx: Tx,
    bookingId: string,
    settlement: Pick<PaymentSettlement, 'id' | 'settledAt'>,
  ): Promise<SettlementApplyOutcome> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM driver_earnings WHERE booking_id = ${bookingId}::uuid FOR UPDATE`;
    const [row] = rows;
    if (!row) {
      return 'NO_EARNING_YET';
    }
    const earning = await tx.driverEarning.findUniqueOrThrow({ where: { id: row.id } });
    if (earning.settlement !== 'ONLINE') {
      return 'NOT_APPLICABLE';
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
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM driver_earnings WHERE booking_id = ${bookingId}::uuid FOR UPDATE`;
    const [row] = rows;
    if (!row) {
      // Earnings created later check payment_disputes and start ON_HOLD.
      return 'NO_EARNING_YET';
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
          data: { status: 'ON_HOLD', holdReason: reason, heldAt: new Date(), heldByUserId: null },
        });
        return 'HELD';
    }
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
 * Starting state of an ONLINE earning. It is payable only once Razorpay has settled the customer
 * payment; a dispute holds it either way.
 */
function onlineStatus(
  disputed: boolean,
  settlement: Pick<PaymentSettlement, 'id' | 'settledAt'> | null,
  completedAt: Date,
): Pick<
  Prisma.DriverEarningUncheckedCreateInput,
  'status' | 'payableAt' | 'holdReason' | 'heldAt' | 'paymentSettlementId'
> {
  if (disputed) {
    return {
      status: 'ON_HOLD',
      paymentSettlementId: settlement?.id ?? null,
      holdReason: 'PAYMENT_DISPUTED: the customer payment has a dispute',
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

/** An earning is eligible from the later of trip completion and merchant settlement. */
function later(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b;
}

function invalidState(status: EarningStatus, message: string): AppError {
  return new AppError(ErrorCode.EARNING_INVALID_STATE, HttpStatus.CONFLICT, message, { status });
}

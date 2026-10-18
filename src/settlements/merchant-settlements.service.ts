import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { adminActionStatement } from '../audit/admin-actions';
import { lockBooking } from '../bookings/booking-locks';
import { Clock } from '../common/clock';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import {
  EARNING_SOURCES,
  type EarningWithSources,
  EarningsService,
  type SettlementApplyOutcome,
} from '../earnings/earnings.service';
import type { PaymentSettlement } from '../generated/prisma/client';
import { zonedParts } from '../payouts/payout-schedule';
import { PrismaService } from '../prisma/prisma.service';
import { SETTLEMENT_ID_PATTERN } from './razorpay-settlement-http.gateway';
import {
  formatSettlementDay,
  type SettledPayment,
  type SettlementDay,
  SettlementGateway,
} from './settlement.gateway';

/** Razorpay files settlements under India dates. */
export const SETTLEMENT_TIME_ZONE = 'Asia/Kolkata';
export const MAX_SYNC_DAYS = 31;
const SWEEP_LIMIT = 500;
const DAY_MS = 86_400_000;
const PROVIDER_RAZORPAY = 'RAZORPAY';

export type SettlementSyncTrigger = 'SCHEDULE' | 'WEBHOOK' | 'ADMIN' | 'PRE_BATCH';

export type RecordOutcome =
  | 'RECORDED'
  | 'ALREADY_RECORDED'
  /** A settled payment that is not a booking payment (e.g. a driver wallet top-up). */
  | 'NOT_A_BOOKING_PAYMENT'
  /** Not a payment this backend knows. */
  | 'UNKNOWN_PAYMENT'
  /** Settlement amount differs from our payment amount: never recorded, needs a human. */
  | 'AMOUNT_MISMATCH';

export interface SettlementSyncResult {
  readonly enabled: boolean;
  readonly trigger: SettlementSyncTrigger;
  readonly days: readonly string[];
  readonly seen: number;
  readonly recorded: number;
  readonly alreadyRecorded: number;
  readonly notBookingPayments: number;
  readonly unknownPayments: number;
  readonly amountMismatches: number;
  readonly earningsPromoted: number;
  readonly earningsLinkedOnHold: number;
}

const settlementEntitySchema = z.looseObject({
  id: z.string().regex(SETTLEMENT_ID_PATTERN),
  created_at: z.number().int().positive().nullish(),
});

interface SettlementTarget {
  readonly bookingId: string;
  readonly paymentId: string | null;
  readonly collectionId: string | null;
  readonly amountPaise: bigint;
}

/**
 * Merchant settlement tracking (OPEN_DECISIONS D-45). Customer payment, merchant settlement,
 * driver earning, payout and wallet stay separate records:
 *
 *   payment captured -> Razorpay settles it to Nikhil Enterprises -> payment_settlements row
 *   -> the trip's ONLINE earning becomes PAYABLE -> next Monday payout batch
 *
 * Settlements are pulled from Razorpay's settlement reconciliation data (periodically, on the
 * settlement.processed webhook, on admin request and before each scheduled batch). Webhooks are
 * only a hint to pull. Every step is idempotent: a settlement is recorded once per payment, and
 * an earning is promoted once.
 */
@Injectable()
export class MerchantSettlementsService {
  private readonly logger = new Logger(MerchantSettlementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: SettlementGateway,
    private readonly earnings: EarningsService,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  get enabled(): boolean {
    return this.gateway.enabled;
  }

  /** Today and the previous lookback days, oldest first, in India dates. */
  defaultDays(now: Date = this.clock.now()): SettlementDay[] {
    return daysBack(now, this.config.settlements.lookbackDays);
  }

  /** Pulls settled payments for the given dates, records ours, and promotes their earnings. */
  async sync(input: {
    trigger: SettlementSyncTrigger;
    days?: readonly SettlementDay[];
  }): Promise<SettlementSyncResult> {
    const days = input.days ?? this.defaultDays();
    const tally = {
      seen: 0,
      recorded: 0,
      alreadyRecorded: 0,
      notBookingPayments: 0,
      unknownPayments: 0,
      amountMismatches: 0,
      earningsPromoted: 0,
      earningsLinkedOnHold: 0,
    };
    const result = (): SettlementSyncResult => ({
      enabled: this.gateway.enabled,
      trigger: input.trigger,
      days: days.map(formatSettlementDay),
      ...tally,
    });
    if (!this.gateway.enabled) {
      return result();
    }

    for (const day of days) {
      const settled = await this.gateway.listSettledPayments(day);
      for (const item of settled) {
        tally.seen += 1;
        const { outcome, applied } = await this.record(item);
        switch (outcome) {
          case 'RECORDED':
            tally.recorded += 1;
            break;
          case 'ALREADY_RECORDED':
            tally.alreadyRecorded += 1;
            break;
          case 'NOT_A_BOOKING_PAYMENT':
            tally.notBookingPayments += 1;
            break;
          case 'UNKNOWN_PAYMENT':
            tally.unknownPayments += 1;
            break;
          case 'AMOUNT_MISMATCH':
            tally.amountMismatches += 1;
            break;
        }
        countApplied(tally, applied);
      }
    }
    // Self-healing: earnings whose settlement was recorded but not applied (e.g. a crash between
    // the two, or an earning created while the settlement was being recorded).
    for (const applied of await this.applyRecordedSettlements()) {
      countApplied(tally, applied);
    }

    const summary = result();
    this.logger.log(summary, 'Merchant settlement sync finished');
    return summary;
  }

  /** Admin-requested sync of an explicit date range (inclusive, India dates). */
  async syncForAdmin(
    actorUserId: string,
    range: { from?: string; to?: string },
  ): Promise<SettlementSyncResult> {
    if (!this.gateway.enabled) {
      throw new AppError(
        ErrorCode.SETTLEMENT_TRACKING_DISABLED,
        HttpStatus.SERVICE_UNAVAILABLE,
        'Merchant settlement tracking is not enabled on this server',
      );
    }
    const days = range.from || range.to ? this.parseRange(range) : this.defaultDays();
    const result = await this.sync({ trigger: 'ADMIN', days });
    await this.prisma.withFinancialContext(
      adminActionStatement(this.prisma, {
        actorUserId,
        action: 'SETTLEMENT_SYNC_REQUESTED',
        targetType: 'MERCHANT_SETTLEMENTS',
        targetId: `${result.days[0] ?? ''}..${result.days.at(-1) ?? ''}`,
        details: {
          recorded: result.recorded,
          alreadyRecorded: result.alreadyRecorded,
          amountMismatches: result.amountMismatches,
          earningsPromoted: result.earningsPromoted,
        },
      }),
    );
    return result;
  }

  /**
   * settlement.processed webhook: a hint that Razorpay settled something. The payload has no
   * per-payment list, so the dates around the settlement are pulled from the recon API.
   */
  async handleSettlementWebhook(entity: unknown): Promise<{ outcome: string; problem?: string }> {
    const parsed = settlementEntitySchema.safeParse(entity);
    if (!parsed.success) {
      return { outcome: 'UNSUPPORTED_PAYLOAD', problem: 'Settlement entity missing or malformed' };
    }
    if (!this.gateway.enabled) {
      return { outcome: 'SETTLEMENT_TRACKING_DISABLED' };
    }
    const now = this.clock.now();
    const createdAt = parsed.data.created_at ? new Date(parsed.data.created_at * 1000) : now;
    // The day before and after cover any difference in how the settlement date is filed.
    const days = [-1, 0, 1]
      .map((offset) => new Date(createdAt.getTime() + offset * DAY_MS))
      .filter((instant) => instant.getTime() <= now.getTime() + DAY_MS)
      .map((instant) => localDay(instant));
    const unique = [...new Map(days.map((day) => [formatSettlementDay(day), day])).values()];
    const result = await this.sync({ trigger: 'WEBHOOK', days: unique });
    return {
      outcome: 'SETTLEMENT_SYNCED',
      problem: result.amountMismatches > 0 ? 'SETTLEMENT_AMOUNT_MISMATCH' : undefined,
    };
  }

  /** Records one settled payment (once) and applies it to the booking's earning. */
  async record(
    item: SettledPayment,
  ): Promise<{ outcome: RecordOutcome; applied: SettlementApplyOutcome | null }> {
    const target = await this.findTarget(item.providerPaymentId);
    if (target === 'NOT_A_BOOKING_PAYMENT') {
      return { outcome: target, applied: null };
    }
    if (target === 'UNKNOWN_PAYMENT') {
      // Money settled to Nikhil Enterprises for a payment this backend never made: reported.
      await this.recordFinding(item, 'UNKNOWN_PAYMENT', null);
      return { outcome: target, applied: null };
    }
    if (BigInt(item.amountPaise) !== target.amountPaise) {
      this.logger.error(
        {
          providerPaymentId: item.providerPaymentId,
          providerSettlementId: item.providerSettlementId,
          settledAmountPaise: item.amountPaise,
          expectedAmountPaise: Number(target.amountPaise),
          alert: 'SETTLEMENT_ANOMALY',
        },
        'Settlement amount does not match the payment; not recorded',
      );
      await this.recordFinding(item, 'AMOUNT_MISMATCH', target);
      return { outcome: 'AMOUNT_MISMATCH', applied: null };
    }

    return this.prisma.runInTransaction(async (tx) => {
      // Same lock trip completion takes, so a completing trip always sees the settlement or is
      // seen by it.
      await lockBooking(tx, target.bookingId);
      const key = {
        provider_providerPaymentId: {
          provider: PROVIDER_RAZORPAY,
          providerPaymentId: item.providerPaymentId,
        },
      };
      let settlement = await tx.paymentSettlement.findUnique({ where: key });
      const created = !settlement;
      settlement ??= await tx.paymentSettlement.create({
        data: {
          provider: PROVIDER_RAZORPAY,
          providerPaymentId: item.providerPaymentId,
          providerSettlementId: item.providerSettlementId,
          settlementUtr: item.settlementUtr,
          settledAt: item.settledAt,
          amountPaise: BigInt(item.amountPaise),
          feePaise: BigInt(item.feePaise),
          taxPaise: BigInt(item.taxPaise),
          bookingId: target.bookingId,
          paymentId: target.paymentId,
          collectionId: target.collectionId,
          source: this.gateway.source,
          details: {
            orderId: item.orderId,
            settledAtUnix: Math.floor(item.settledAt.getTime() / 1000),
          },
        },
      });
      const applied = await this.earnings.applySettlement(tx, target.bookingId, settlement);
      if (created) {
        this.logger.log(
          {
            bookingId: target.bookingId,
            providerPaymentId: item.providerPaymentId,
            providerSettlementId: item.providerSettlementId,
            source: this.gateway.source,
            applied,
          },
          'Merchant settlement recorded',
        );
      }
      return { outcome: created ? 'RECORDED' : 'ALREADY_RECORDED', applied };
    });
  }

  list(options: { bookingId?: string }): Promise<PaymentSettlement[]> {
    return this.prisma.paymentSettlement.findMany({
      where: options.bookingId ? { bookingId: options.bookingId } : {},
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  /** Earnings still waiting for a merchant settlement after SETTLEMENT_OVERDUE_DAYS. */
  overdueEarnings(): Promise<EarningWithSources[]> {
    const before = new Date(
      this.clock.now().getTime() - this.config.settlements.overdueDays * DAY_MS,
    );
    return this.prisma.driverEarning.findMany({
      where: { status: 'AWAITING_SETTLEMENT', createdAt: { lt: before } },
      include: EARNING_SOURCES,
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
  }

  /**
   * A settled payment that matched none of ours, or ours with another amount: recorded once per
   * payment, settlement and kind (seeing it again only counts it), never applied to an earning.
   */
  private async recordFinding(
    item: SettledPayment,
    kind: 'UNKNOWN_PAYMENT' | 'AMOUNT_MISMATCH',
    target: SettlementTarget | null,
  ): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO settlement_findings (provider, kind, provider_payment_id, provider_settlement_id,
                                       settled_at, settled_amount_paise, expected_amount_paise,
                                       booking_id, payment_id, collection_id, source)
      VALUES (${PROVIDER_RAZORPAY}, ${kind}, ${item.providerPaymentId}, ${item.providerSettlementId},
              ${item.settledAt}, ${BigInt(item.amountPaise)}, ${target?.amountPaise ?? null},
              ${target?.bookingId ?? null}::uuid, ${target?.paymentId ?? null}::uuid,
              ${target?.collectionId ?? null}::uuid, ${this.gateway.source})
      ON CONFLICT (provider, provider_payment_id, provider_settlement_id, kind)
      DO UPDATE SET occurrences = settlement_findings.occurrences + 1,
                    last_seen_at = greatest(settlement_findings.last_seen_at, clock_timestamp())`;
  }

  private async applyRecordedSettlements(): Promise<SettlementApplyOutcome[]> {
    // Earnings with one source whose settlement is recorded but not linked, and earnings funded
    // by several collections whose online collections are all settled but that are still
    // waiting (applied with their latest settlement).
    const rows = await this.prisma.$queryRaw<{ booking_id: string; settlement_id: string }[]>`
      SELECT booking_id, settlement_id FROM (
        SELECT e.booking_id, s.id AS settlement_id, e.created_at
        FROM driver_earnings e
        JOIN payment_settlements s
          ON (e.payment_id IS NOT NULL AND s.payment_id = e.payment_id)
          OR (e.collection_id IS NOT NULL AND s.collection_id = e.collection_id)
        WHERE e.settlement = 'ONLINE'::earning_settlement
          AND e.payment_settlement_id IS NULL
          AND e.status IN ('AWAITING_SETTLEMENT'::earning_status, 'ON_HOLD'::earning_status)
        UNION ALL
        SELECT e.booking_id, latest.id AS settlement_id, e.created_at
        FROM driver_earnings e
        CROSS JOIN LATERAL (
              SELECT s.id
              FROM earning_collections l
              JOIN payment_settlements s ON s.collection_id = l.collection_id
              WHERE l.earning_id = e.id
              ORDER BY s.settled_at DESC, s.id
              LIMIT 1) latest
        WHERE e.payment_id IS NULL AND e.collection_id IS NULL
          AND e.settlement IN ('ONLINE'::earning_settlement, 'MIXED'::earning_settlement)
          AND e.status = 'AWAITING_SETTLEMENT'::earning_status
          AND NOT EXISTS (
                SELECT 1 FROM earning_collections l
                WHERE l.earning_id = e.id AND l.method = 'ONLINE_QR'
                  AND NOT EXISTS (SELECT 1 FROM payment_settlements s2
                                  WHERE s2.collection_id = l.collection_id))
      ) pending
      ORDER BY created_at
      LIMIT ${SWEEP_LIMIT}`;
    const outcomes: SettlementApplyOutcome[] = [];
    for (const row of rows) {
      outcomes.push(
        await this.prisma.runInTransaction(async (tx) => {
          await lockBooking(tx, row.booking_id);
          const settlement = await tx.paymentSettlement.findUniqueOrThrow({
            where: { id: row.settlement_id },
          });
          return this.earnings.applySettlement(tx, row.booking_id, settlement);
        }),
      );
    }
    return outcomes;
  }

  private async findTarget(
    providerPaymentId: string,
  ): Promise<SettlementTarget | 'NOT_A_BOOKING_PAYMENT' | 'UNKNOWN_PAYMENT'> {
    const payment = await this.prisma.payment.findUnique({
      where: { razorpayPaymentId: providerPaymentId },
    });
    if (payment) {
      if (payment.purpose !== 'BOOKING' || !payment.bookingId) {
        return 'NOT_A_BOOKING_PAYMENT';
      }
      return {
        bookingId: payment.bookingId,
        paymentId: payment.id,
        collectionId: null,
        amountPaise: payment.amountPaise,
      };
    }
    const collection = await this.prisma.paymentCollection.findFirst({
      where: { providerPaymentId, method: 'ONLINE_QR' },
    });
    if (collection) {
      return {
        bookingId: collection.bookingId,
        paymentId: null,
        collectionId: collection.id,
        amountPaise: collection.amountPaise,
      };
    }
    return 'UNKNOWN_PAYMENT';
  }

  private parseRange(range: { from?: string; to?: string }): SettlementDay[] {
    const today = localDay(this.clock.now());
    const to = range.to ? parseDay(range.to) : today;
    const from = range.from ? parseDay(range.from) : to;
    const fromMs = Date.UTC(from.year, from.month - 1, from.day);
    const toMs = Date.UTC(to.year, to.month - 1, to.day);
    const todayMs = Date.UTC(today.year, today.month - 1, today.day);
    if (fromMs > toMs || toMs > todayMs) {
      throw invalidRange('from must be on or before to, and to cannot be in the future');
    }
    const count = (toMs - fromMs) / DAY_MS + 1;
    if (count > MAX_SYNC_DAYS) {
      throw invalidRange(`A sync covers at most ${MAX_SYNC_DAYS} days`);
    }
    return Array.from({ length: count }, (_, index) => utcCalendarDay(fromMs + index * DAY_MS));
  }
}

function countApplied(
  tally: { earningsPromoted: number; earningsLinkedOnHold: number },
  applied: SettlementApplyOutcome | null,
): void {
  if (applied === 'PROMOTED') {
    tally.earningsPromoted += 1;
  } else if (applied === 'LINKED_ON_HOLD') {
    tally.earningsLinkedOnHold += 1;
  }
}

/** The India calendar date of an instant. */
export function localDay(instant: Date): SettlementDay {
  const local = zonedParts(instant, SETTLEMENT_TIME_ZONE);
  return { year: local.year, month: local.month, day: local.day };
}

/** `count` India dates ending today, oldest first. */
export function daysBack(now: Date, count: number): SettlementDay[] {
  const today = localDay(now);
  const todayMs = Date.UTC(today.year, today.month - 1, today.day);
  return Array.from({ length: count }, (_, index) =>
    utcCalendarDay(todayMs - (count - 1 - index) * DAY_MS),
  );
}

function utcCalendarDay(ms: number): SettlementDay {
  const date = new Date(ms);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDay(value: string): SettlementDay {
  const match = DAY_PATTERN.exec(value);
  if (!match) {
    throw invalidRange('Dates must be YYYY-MM-DD');
  }
  const day = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  const check = new Date(Date.UTC(day.year, day.month - 1, day.day));
  if (
    check.getUTCFullYear() !== day.year ||
    check.getUTCMonth() + 1 !== day.month ||
    check.getUTCDate() !== day.day
  ) {
    throw invalidRange('Dates must be real calendar dates');
  }
  return day;
}

function invalidRange(message: string): AppError {
  return new AppError(ErrorCode.VALIDATION_FAILED, HttpStatus.BAD_REQUEST, message);
}

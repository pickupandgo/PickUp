import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { recordAdminAction } from '../audit/admin-actions';
import { Clock } from '../common/clock';
import { computePayoutBreakdown } from '../common/deductions';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import type { DriverPayout, PayoutBatch } from '../generated/prisma/client';
import { isUniqueViolation } from '../prisma/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import { notConfigured } from './disabled-payout.gateway';
import { PayoutGateway } from './payout.gateway';
import { isoWeekKey } from './payout-schedule';

/** RazorpayX's minimum payout (Rs 1). Smaller balances wait for the next week. */
export const MIN_PAYOUT_PAISE = 100n;

export interface PrepareBatchInput {
  readonly origin: 'SCHEDULE' | 'ADMIN';
  readonly idempotencyKey: string;
  /** Earnings that became payable at or before this instant are included. */
  readonly cutoffAt: Date;
  readonly actorUserId: string | null;
}

export interface PrepareResult {
  readonly batch: PayoutBatch;
  readonly created: boolean;
}

interface EligibleEarningRow {
  readonly id: string;
  readonly driver_id: string;
  readonly payout_amount_paise: bigint;
  readonly bank_account_id: string;
}

/**
 * Prepares a payout batch: every ONLINE or MIXED earning that is PAYABLE up to the cutoff, for its
 * payout amount, grouped into one payout per driver with a VERIFIED bank account. PAYABLE already
 * means every online payment of the earning was settled to Nikhil Enterprises and the earning is
 * not held or disputed; the query checks the settlements again anyway. Excluded: unsettled
 * (AWAITING_SETTLEMENT), held, disputed or failed (ON_HOLD), already in a payout (IN_PAYOUT) or
 * paid (PAID) earnings, cash earnings (nothing to pay out), and drivers whose account is pending,
 * rejected or suspended.
 *
 * One transaction locks the earnings, creates the payouts and items and moves the earnings to
 * IN_PAYOUT, so an earning can never land in two batches (also a partial unique index).
 */
@Injectable()
export class PayoutBatchesService {
  private readonly logger = new Logger(PayoutBatchesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: PayoutGateway,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async prepare(input: PrepareBatchInput): Promise<PrepareResult> {
    const existing = await this.prisma.payoutBatch.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      return { batch: existing, created: false };
    }
    if (!this.gateway.enabled) {
      throw notConfigured();
    }
    if (input.cutoffAt.getTime() > this.clock.now().getTime()) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        HttpStatus.BAD_REQUEST,
        'The cutoff cannot be in the future',
      );
    }

    try {
      const batch = await this.prisma.runInTransaction(
        async (tx) => {
          // PAYABLE online or mixed earnings, for their payout amount (the online net; a mixed
          // earning's cash part is already with the driver). Settled: the single settlement link,
          // or every online collection of an earning funded by several (the database refuses
          // anything else at commit). A booking paid drop by drop with a drop left undelivered is
          // PARTIALLY_PAID; one being refunded is never paid out.
          const rows = await tx.$queryRaw<EligibleEarningRow[]>`
            SELECT e.id, e.driver_id, e.payout_amount_paise, a.id AS bank_account_id
            FROM driver_earnings e
            JOIN bookings b ON b.id = e.booking_id
            JOIN driver_bank_accounts a
              ON a.driver_id = e.driver_id AND a.status = 'VERIFIED'::bank_account_status
            WHERE e.status = 'PAYABLE'::earning_status
              AND e.settlement IN ('ONLINE'::earning_settlement, 'MIXED'::earning_settlement)
              AND (e.payment_settlement_id IS NOT NULL
                   OR (e.payment_id IS NULL AND e.collection_id IS NULL
                       AND NOT EXISTS (
                             SELECT 1 FROM earning_collections l
                             WHERE l.earning_id = e.id AND l.method = 'ONLINE_QR'
                               AND NOT EXISTS (SELECT 1 FROM payment_settlements s
                                               WHERE s.collection_id = l.collection_id))))
              AND e.payable_at <= ${input.cutoffAt}
              AND e.payout_amount_paise > 0
              AND b.payment_status IN ('PAID'::booking_payment_status,
                                       'PARTIALLY_PAID'::booking_payment_status)
            ORDER BY e.id
            FOR UPDATE OF e`;

          const byDriver = new Map<
            string,
            { bankAccountId: string; total: bigint; earnings: { id: string; amount: bigint }[] }
          >();
          for (const row of rows) {
            const amount = BigInt(row.payout_amount_paise);
            const group = byDriver.get(row.driver_id) ?? {
              bankAccountId: row.bank_account_id,
              total: 0n,
              earnings: [],
            };
            group.total += amount;
            group.earnings.push({ id: row.id, amount });
            byDriver.set(row.driver_id, group);
          }
          const groups = [...byDriver.entries()]
            .map(([driverId, group]) => ({
              driverId,
              ...group,
              breakdown: computePayoutBreakdown(group.total),
            }))
            .filter((group) => group.breakdown.amountPaise >= MIN_PAYOUT_PAISE);
          const total = groups.reduce((sum, group) => sum + group.breakdown.amountPaise, 0n);
          const now = this.clock.now();

          const created = await tx.payoutBatch.create({
            data: {
              id: randomUUID(),
              idempotencyKey: input.idempotencyKey,
              cycleKey: isoWeekKey(input.cutoffAt, this.config.payouts.schedule.timeZone),
              origin: input.origin,
              cutoffAt: input.cutoffAt,
              status: groups.length > 0 ? 'PREPARED' : 'COMPLETED',
              completedAt: groups.length > 0 ? null : now,
              payoutCount: groups.length,
              totalAmountPaise: total,
              createdByUserId: input.actorUserId,
            },
          });

          for (const group of groups) {
            const payoutId = randomUUID();
            await tx.driverPayout.create({
              data: {
                id: payoutId,
                batchId: created.id,
                driverId: group.driverId,
                bankAccountId: group.bankAccountId,
                grossAmountPaise: group.breakdown.grossAmountPaise,
                tdsAmountPaise: group.breakdown.tdsAmountPaise,
                otherDeductionsPaise: group.breakdown.otherDeductionsPaise,
                tdsPolicy: group.breakdown.tdsPolicy,
                taxRuleId: group.breakdown.taxRuleId,
                amountPaise: group.breakdown.amountPaise,
                mode: this.config.payouts.mode,
                provider: this.gateway.provider,
              },
            });
            await tx.payoutItem.createMany({
              data: group.earnings.map((earning) => ({
                payoutId,
                earningId: earning.id,
                amountPaise: earning.amount,
              })),
            });
            await tx.driverEarning.updateMany({
              where: { id: { in: group.earnings.map((earning) => earning.id) }, status: 'PAYABLE' },
              data: { status: 'IN_PAYOUT' },
            });
          }

          await recordAdminAction(tx, {
            actorUserId: input.actorUserId,
            action: 'PAYOUT_BATCH_PREPARED',
            targetType: 'PAYOUT_BATCH',
            targetId: created.id,
            details: {
              origin: input.origin,
              cutoffAt: input.cutoffAt.toISOString(),
              payoutCount: groups.length,
              totalAmountPaise: Number(total),
            },
          });
          return created;
        },
        { timeoutMs: 60_000 },
      );

      this.logger.log(
        {
          batchId: batch.id,
          cycleKey: batch.cycleKey,
          origin: batch.origin,
          payoutCount: batch.payoutCount,
          totalAmountPaise: Number(batch.totalAmountPaise),
        },
        'Payout batch prepared',
      );
      return { batch, created: true };
    } catch (error) {
      if (isUniqueViolation(error)) {
        // A concurrent prepare with the same key won.
        const winner = await this.prisma.payoutBatch.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        });
        if (winner) {
          return { batch: winner, created: false };
        }
      }
      throw error;
    }
  }

  list(): Promise<PayoutBatch[]> {
    return this.prisma.payoutBatch.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
  }

  async get(batchId: string): Promise<{ batch: PayoutBatch; payouts: DriverPayout[] }> {
    const batch = await this.prisma.payoutBatch.findUnique({
      where: { id: batchId },
      include: { payouts: { orderBy: { createdAt: 'asc' } } },
    });
    if (!batch) {
      throw new AppError(
        ErrorCode.PAYOUT_BATCH_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'Payout batch not found',
      );
    }
    const { payouts, ...rest } = batch;
    return { batch: rest, payouts };
  }
}

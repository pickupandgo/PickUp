import { Injectable, Logger } from '@nestjs/common';
import { recordAdminAction } from '../audit/admin-actions';
import type { DriverPayout } from '../generated/prisma/client';
import type { PayoutStatus } from '../generated/prisma/enums';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import type { ProviderPayout } from './payout.gateway';

/** status_reason prefix of an account suspended because a payout to it came back. */
const PAYOUT_REVERSED = 'PAYOUT_REVERSED';

export type PayoutUpdateSource = 'SUBMIT' | 'WEBHOOK' | 'ADMIN_SYNC';

export const PayoutOutcome = {
  APPLIED: 'APPLIED',
  /** Same state as already recorded (repeated webhook, retried sync). Nothing changed. */
  ALREADY_APPLIED: 'ALREADY_APPLIED',
  /** An older provider state arrived after a newer one. Ignored. */
  STALE_UPDATE: 'STALE_UPDATE',
  /** Provider amount, currency or ids do not match our payout. Not applied. */
  MISMATCH: 'MISMATCH',
  /** The provider reports success for a payout we already failed. Needs a human. */
  CONFLICTING_STATE: 'CONFLICTING_STATE',
} as const;
export type PayoutOutcome = (typeof PayoutOutcome)[keyof typeof PayoutOutcome];

export const PAYOUT_ANOMALIES: ReadonlySet<PayoutOutcome> = new Set([
  PayoutOutcome.MISMATCH,
  PayoutOutcome.CONFLICTING_STATE,
]);

export interface PayoutUpdateResult {
  readonly payout: DriverPayout;
  readonly outcome: PayoutOutcome;
}

const RANK: Readonly<Record<PayoutStatus, number>> = {
  PREPARED: 0,
  SUBMITTING: 1,
  SUBMITTED: 2,
  PROCESSED: 3,
  REVERSED: 4,
  FAILED: 4,
};

/** RazorpayX payout status -> our payout status. Unknown statuses count as still in progress. */
export function mapProviderStatus(status: string): PayoutStatus {
  switch (status) {
    case 'processed':
      return 'PROCESSED';
    case 'reversed':
      return 'REVERSED';
    case 'failed':
    case 'rejected':
    case 'cancelled':
      return 'FAILED';
    default:
      return 'SUBMITTED';
  }
}

/**
 * Applies provider payout states, forward only, in one transaction per update:
 *
 *   SUBMITTED  provider accepted it (queued / pending / processing)
 *   PROCESSED  items PAID, earnings PAID: the only way an earning is ever marked paid
 *   FAILED     items RELEASED, earnings back to PAYABLE: retried in a later payout with a new key
 *   REVERSED   items REVERSED, earnings ON_HOLD for review (money returned after processing)
 *
 * Repeated or out-of-order updates (webhook retries, sync after webhook) change nothing.
 */
@Injectable()
export class PayoutStatusService {
  private readonly logger = new Logger(PayoutStatusService.name);

  constructor(private readonly prisma: PrismaService) {}

  async apply(
    payoutId: string,
    provider: ProviderPayout,
    source: PayoutUpdateSource,
  ): Promise<PayoutUpdateResult> {
    const result = await this.prisma.runInTransaction(async (tx) => {
      const payout = await this.lock(tx, payoutId);

      if (
        provider.amount !== Number(payout.amountPaise) ||
        provider.currency !== payout.currency ||
        (payout.providerPayoutId !== null && payout.providerPayoutId !== provider.id) ||
        (provider.referenceId !== null && provider.referenceId !== payout.id)
      ) {
        return { payout, outcome: PayoutOutcome.MISMATCH };
      }

      let target = mapProviderStatus(provider.status);
      if (target === 'FAILED' && payout.status === 'PROCESSED') {
        // Money that had reached the bank came back (RazorpayX: processed -> failed/reversed).
        target = 'REVERSED';
      }

      if (payout.status === 'FAILED') {
        return {
          payout,
          outcome:
            target === 'FAILED' ? PayoutOutcome.ALREADY_APPLIED : PayoutOutcome.CONFLICTING_STATE,
        };
      }
      if (target === payout.status) {
        const refreshed = await this.refreshProviderFields(tx, payout, provider);
        return { payout: refreshed, outcome: PayoutOutcome.ALREADY_APPLIED };
      }
      if (RANK[target] < RANK[payout.status]) {
        return { payout, outcome: PayoutOutcome.STALE_UPDATE };
      }

      const now = new Date();
      let updated: DriverPayout;
      switch (target) {
        case 'SUBMITTED':
          updated = await tx.driverPayout.update({
            where: { id: payoutId },
            data: {
              status: 'SUBMITTED',
              providerPayoutId: provider.id,
              providerStatus: provider.status,
              utr: provider.utr ?? payout.utr,
              submittedAt: payout.submittedAt ?? now,
            },
          });
          break;
        case 'PROCESSED':
          updated = await tx.driverPayout.update({
            where: { id: payoutId },
            data: {
              status: 'PROCESSED',
              providerPayoutId: provider.id,
              providerStatus: provider.status,
              utr: provider.utr ?? payout.utr,
              submittedAt: payout.submittedAt ?? now,
              processedAt: now,
            },
          });
          await tx.payoutItem.updateMany({
            where: { payoutId, status: 'INCLUDED' },
            data: { status: 'PAID' },
          });
          await tx.driverEarning.updateMany({
            where: { status: 'IN_PAYOUT', payoutItems: { some: { payoutId, status: 'PAID' } } },
            data: { status: 'PAID', paidAt: now },
          });
          break;
        case 'FAILED':
          updated = await tx.driverPayout.update({
            where: { id: payoutId },
            data: {
              status: 'FAILED',
              providerPayoutId: provider.id,
              providerStatus: provider.status,
              failedAt: now,
              failureReason: provider.failureReason ?? `PROVIDER_${provider.status.toUpperCase()}`,
            },
          });
          await this.release(tx, payoutId);
          break;
        case 'REVERSED':
          updated = await tx.driverPayout.update({
            where: { id: payoutId },
            data: {
              status: 'REVERSED',
              providerPayoutId: provider.id,
              providerStatus: provider.status,
              reversedAt: now,
              failureReason: provider.failureReason ?? payout.failureReason,
            },
          });
          await this.reverse(tx, payoutId, now);
          break;
        default:
          return { payout, outcome: PayoutOutcome.STALE_UPDATE };
      }
      return { payout: updated, outcome: PayoutOutcome.APPLIED };
    });

    const fields = {
      payoutId,
      providerPayoutId: provider.id,
      providerStatus: provider.status,
      status: result.payout.status,
      outcome: result.outcome,
      source,
    };
    if (PAYOUT_ANOMALIES.has(result.outcome)) {
      this.logger.error({ ...fields, alert: 'PAYOUT_ANOMALY' }, 'Payout needs manual review');
    } else if (result.outcome === PayoutOutcome.APPLIED) {
      this.logger.log(fields, 'Payout status updated');
    }
    if (result.outcome === PayoutOutcome.APPLIED) {
      await this.completeBatchIfDone(result.payout.batchId);
    }
    return result;
  }

  /**
   * Fails a payout that never reached the provider (bank account no longer verified, or the
   * provider definitively refused the request and has no record of it). Its earnings go back to
   * PAYABLE for a later payout.
   */
  async failBeforeSubmit(payoutId: string, reason: string): Promise<DriverPayout> {
    const payout = await this.prisma.runInTransaction(async (tx) => {
      const locked = await this.lock(tx, payoutId);
      if (locked.status !== 'PREPARED' && locked.status !== 'SUBMITTING') {
        return locked;
      }
      if (locked.providerPayoutId !== null) {
        throw new Error('A payout known to the provider cannot be failed locally');
      }
      const failed = await tx.driverPayout.update({
        where: { id: payoutId },
        data: { status: 'FAILED', failedAt: new Date(), failureReason: reason.slice(0, 300) },
      });
      await this.release(tx, payoutId);
      return failed;
    });
    this.logger.warn({ payoutId, reason }, 'Payout failed before reaching the provider');
    await this.completeBatchIfDone(payout.batchId);
    return payout;
  }

  /** Marks the batch COMPLETED once none of its payouts is still in flight. */
  async completeBatchIfDone(batchId: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE payout_batches
      SET status = 'COMPLETED'::payout_batch_status, completed_at = now(), updated_at = now()
      WHERE id = ${batchId}::uuid
        AND status <> 'COMPLETED'::payout_batch_status
        AND NOT EXISTS (
          SELECT 1 FROM driver_payouts
          WHERE batch_id = ${batchId}::uuid
            AND status IN ('PREPARED'::payout_status, 'SUBMITTING'::payout_status,
                           'SUBMITTED'::payout_status)
        )`;
  }

  /** Items RELEASED first, then their earnings back to PAYABLE (the earnings trigger checks it). */
  private async release(tx: Tx, payoutId: string): Promise<void> {
    const items = await tx.payoutItem.findMany({
      where: { payoutId, status: 'INCLUDED' },
      select: { earningId: true },
    });
    await tx.payoutItem.updateMany({
      where: { payoutId, status: 'INCLUDED' },
      data: { status: 'RELEASED' },
    });
    await tx.driverEarning.updateMany({
      where: { id: { in: items.map((item) => item.earningId) }, status: 'IN_PAYOUT' },
      data: { status: 'PAYABLE' },
    });
  }

  /**
   * A returned payout (OPEN_DECISIONS assumption C): items REVERSED, earnings ON_HOLD for an
   * admin to review, and the destination account SUSPENDED, so nothing is paid there again until
   * an admin has checked the cause and approved the account on a new bank validation. No payout
   * is ever retried automatically.
   */
  private async reverse(tx: Tx, payoutId: string, now: Date): Promise<void> {
    await this.holdReversedEarnings(tx, payoutId, now);
    const payout = await tx.driverPayout.findUniqueOrThrow({ where: { id: payoutId } });
    const rows = await tx.$queryRaw<{ status: string }[]>`
      SELECT status::text AS status FROM driver_bank_accounts
      WHERE id = ${payout.bankAccountId}::uuid FOR UPDATE`;
    if (rows[0]?.status === 'VERIFIED') {
      const reason = `${PAYOUT_REVERSED}: payout ${payoutId} was returned by the bank`;
      await tx.driverBankAccount.update({
        where: { id: payout.bankAccountId },
        data: { status: 'SUSPENDED', statusReason: reason, statusChangedByUserId: null },
      });
      await recordAdminAction(tx, {
        actorUserId: null,
        action: 'BANK_ACCOUNT_SUSPENDED',
        targetType: 'DRIVER_BANK_ACCOUNT',
        targetId: payout.bankAccountId,
        reason,
        details: { payoutId },
      });
    }
  }

  private async holdReversedEarnings(tx: Tx, payoutId: string, now: Date): Promise<void> {
    const items = await tx.payoutItem.findMany({
      where: { payoutId, status: { in: ['INCLUDED', 'PAID'] } },
      select: { earningId: true },
    });
    await tx.payoutItem.updateMany({
      where: { payoutId, status: { in: ['INCLUDED', 'PAID'] } },
      data: { status: 'REVERSED' },
    });
    await tx.driverEarning.updateMany({
      where: {
        id: { in: items.map((item) => item.earningId) },
        status: { in: ['IN_PAYOUT', 'PAID'] },
      },
      data: {
        status: 'ON_HOLD',
        holdReason: `${PAYOUT_REVERSED}: payout ${payoutId} was returned by the bank`,
        heldAt: now,
        heldByUserId: null,
      },
    });
  }

  private async refreshProviderFields(
    tx: Tx,
    payout: DriverPayout,
    provider: ProviderPayout,
  ): Promise<DriverPayout> {
    const utr = provider.utr ?? payout.utr;
    if (payout.providerStatus === provider.status && payout.utr === utr) {
      return payout;
    }
    return tx.driverPayout.update({
      where: { id: payout.id },
      data: { providerStatus: provider.status, utr },
    });
  }

  private async lock(tx: Tx, payoutId: string): Promise<DriverPayout> {
    await tx.$queryRaw`SELECT id FROM driver_payouts WHERE id = ${payoutId}::uuid FOR UPDATE`;
    return tx.driverPayout.findUniqueOrThrow({ where: { id: payoutId } });
  }
}

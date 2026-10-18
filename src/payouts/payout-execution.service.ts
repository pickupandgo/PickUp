import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { adminActionStatement } from '../audit/admin-actions';
import { financialContextStatement } from '../audit/financial-context';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import type { DriverPayout, PayoutBatch } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RazorpayApiError, RazorpayUnavailableError } from '../razorpay/razorpay.errors';
import { toPayoutProviderError } from './bank-accounts.service';
import { notConfigured } from './disabled-payout.gateway';
import { PayoutGateway, type ProviderPayout } from './payout.gateway';
import { type PayoutUpdateResult, PayoutStatusService } from './payout-status.service';

/** A SUBMITTING payout older than this may be re-submitted (same idempotency key). */
const STALE_SUBMISSION_SECONDS = 120;
/** Provider rejections that are definitive for this request. Anything else is retried. */
const DEFINITIVE_REJECTIONS: ReadonlySet<number> = new Set([400, 401, 403, 404, 422]);

export interface SubmitResult {
  readonly payoutId: string;
  /** SUBMITTED / PROCESSED / FAILED ..., SKIPPED when another executor holds it, PENDING_RETRY on an outage. */
  readonly result: string;
}

/**
 * Sends prepared payouts to the provider. Calls happen outside any transaction. Each payout is
 * claimed (PREPARED -> SUBMITTING) before the call and always sent with its own id as
 * X-Payout-Idempotency, so retries, crashes and concurrent executions can't pay twice.
 */
@Injectable()
export class PayoutExecutionService {
  private readonly logger = new Logger(PayoutExecutionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: PayoutGateway,
    private readonly status: PayoutStatusService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async executeBatch(
    batchId: string,
    actorUserId: string | null,
  ): Promise<{ batch: PayoutBatch; results: SubmitResult[] }> {
    if (!this.gateway.enabled) {
      throw notConfigured();
    }
    const batch = await this.prisma.payoutBatch.findUnique({ where: { id: batchId } });
    if (!batch) {
      throw new AppError(
        ErrorCode.PAYOUT_BATCH_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'Payout batch not found',
      );
    }
    if (batch.status === 'PREPARED') {
      await this.prisma.$transaction([
        // Who executed it, for the financial event log (payment flow Phase 7).
        financialContextStatement(this.prisma),
        this.prisma.payoutBatch.updateMany({
          where: { id: batchId, status: 'PREPARED' },
          data: { status: 'EXECUTING', executedAt: new Date() },
        }),
        this.prisma.adminAction.create({
          data: {
            actorUserId,
            action: 'PAYOUT_BATCH_EXECUTED',
            targetType: 'PAYOUT_BATCH',
            targetId: batchId,
          },
        }),
      ]);
    }

    const payouts = await this.prisma.driverPayout.findMany({
      where: { batchId, status: { in: ['PREPARED', 'SUBMITTING'] } },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    const results: SubmitResult[] = [];
    for (const { id } of payouts) {
      try {
        results.push(await this.submit(id));
      } catch (error) {
        // One payout's problem must not stop the others; it stays retryable.
        this.logger.error({ err: error, payoutId: id }, 'Payout submission failed');
        results.push({ payoutId: id, result: 'ERROR' });
      }
    }
    await this.status.completeBatchIfDone(batchId);
    const fresh = await this.prisma.payoutBatch.findUniqueOrThrow({ where: { id: batchId } });
    return { batch: fresh, results };
  }

  /** Submits one payout if it is waiting (or its earlier submission went silent). */
  async submit(payoutId: string): Promise<SubmitResult> {
    const claimed = await this.prisma.withFinancialContext(
      this.prisma.$queryRaw<{ id: string }[]>`
        UPDATE driver_payouts
        SET status = 'SUBMITTING'::payout_status,
            attempts = attempts + 1,
            last_attempt_at = now(),
            updated_at = now()
        WHERE id = ${payoutId}::uuid
          AND (status = 'PREPARED'::payout_status
               OR (status = 'SUBMITTING'::payout_status
                   AND (last_attempt_at IS NULL
                        OR last_attempt_at < now() - make_interval(secs => ${STALE_SUBMISSION_SECONDS}))))
        RETURNING id`,
    );
    if (claimed.length === 0) {
      return { payoutId, result: 'SKIPPED' };
    }

    const payout = await this.prisma.driverPayout.findUniqueOrThrow({
      where: { id: payoutId },
      include: { bankAccount: true },
    });
    if (payout.bankAccount.status !== 'VERIFIED') {
      const failed = await this.status.failBeforeSubmit(payoutId, 'BANK_ACCOUNT_NOT_VERIFIED');
      return { payoutId, result: failed.status };
    }

    let provider: ProviderPayout;
    try {
      provider = await this.gateway.createPayout({
        idempotencyKey: payout.id,
        referenceId: payout.id,
        fundAccountId: payout.bankAccount.providerFundAccountId,
        amountPaise: Number(payout.amountPaise),
        mode: payout.mode as 'IMPS' | 'NEFT' | 'RTGS',
        narration: this.config.payouts.narration,
        queueIfLowBalance: this.config.payouts.queueIfLowBalance,
        notes: { payout_id: payout.id, batch_id: payout.batchId, driver_id: payout.driverId },
      });
    } catch (error) {
      return { payoutId, result: await this.handleSubmitError(payout, error) };
    }
    const applied = await this.status.apply(payoutId, provider, 'SUBMIT');
    return { payoutId, result: applied.payout.status };
  }

  /** Admin recovery: reads the payout from the provider and applies what it reports. */
  async sync(
    payoutId: string,
    actorUserId: string,
  ): Promise<PayoutUpdateResult | { payout: DriverPayout; outcome: string }> {
    if (!this.gateway.enabled) {
      throw notConfigured();
    }
    const payout = await this.prisma.driverPayout.findUnique({ where: { id: payoutId } });
    if (!payout) {
      throw new AppError(ErrorCode.PAYOUT_NOT_FOUND, HttpStatus.NOT_FOUND, 'Payout not found');
    }
    await this.prisma.withFinancialContext(
      adminActionStatement(this.prisma, {
        actorUserId,
        action: 'PAYOUT_SYNCED',
        targetType: 'DRIVER_PAYOUT',
        targetId: payoutId,
      }),
    );
    if (payout.status === 'PREPARED') {
      return { payout, outcome: 'NOT_SUBMITTED' };
    }

    let provider: ProviderPayout | null;
    try {
      provider = payout.providerPayoutId
        ? await this.gateway.fetchPayout(payout.providerPayoutId)
        : await this.gateway.findPayoutByReference(payout.id);
    } catch (error) {
      throw toPayoutProviderError(error);
    }
    if (provider) {
      return this.status.apply(payoutId, provider, 'ADMIN_SYNC');
    }
    if (payout.status === 'SUBMITTING') {
      // The provider has no record of it: resubmit with the same idempotency key.
      const result = await this.submit(payoutId);
      const fresh = await this.prisma.driverPayout.findUniqueOrThrow({ where: { id: payoutId } });
      return { payout: fresh, outcome: `RESUBMITTED_${result.result}` };
    }
    return { payout, outcome: 'NOT_FOUND_AT_PROVIDER' };
  }

  private async handleSubmitError(payout: DriverPayout, error: unknown): Promise<string> {
    if (error instanceof RazorpayApiError) {
      // The request may still have created a transfer (e.g. the reply was rejected late). Only
      // a provider with no record of our reference lets us release the earnings.
      let existing: ProviderPayout | null;
      try {
        existing = await this.gateway.findPayoutByReference(payout.id);
      } catch (lookupError) {
        this.logger.warn(
          { payoutId: payout.id, reason: (lookupError as Error).name },
          'Could not check the provider after a rejected payout; it stays SUBMITTING',
        );
        return 'PENDING_RETRY';
      }
      if (existing) {
        return (await this.status.apply(payout.id, existing, 'SUBMIT')).payout.status;
      }
      if (DEFINITIVE_REJECTIONS.has(error.httpStatus)) {
        const failed = await this.status.failBeforeSubmit(
          payout.id,
          `PROVIDER_REJECTED:${error.errorCode ?? error.httpStatus}`,
        );
        return failed.status;
      }
      return 'PENDING_RETRY';
    }
    if (error instanceof RazorpayUnavailableError) {
      // Unknown outcome. The payout stays SUBMITTING and is retried with the same key.
      this.logger.warn({ payoutId: payout.id }, 'Payout provider unavailable; will retry');
      return 'PENDING_RETRY';
    }
    throw error;
  }
}

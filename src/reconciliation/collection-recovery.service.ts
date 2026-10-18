import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CollectionApplyResult } from '../collections/collection-finalizer.service';
import { CollectionsService } from '../collections/collections.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { ConfirmationOutcome, WebhookOutcome } from '../payments/payment.constants';
import { PrismaService } from '../prisma/prisma.service';
import {
  critical,
  type DetectedFinding,
  detected,
  info,
  kindPart,
  type KindSpec,
  warning,
} from './finding-types';

export interface RecoveryScope {
  /** Only collections created at or after this instant (a scoped run); null: all. */
  readonly since: Date | null;
  readonly limit: number;
}

export interface RecoverySummary {
  readonly candidates: number;
  /** More candidates than the per-run limit: the next run continues. */
  readonly truncated: boolean;
  /** Razorpay reported them paid; applied now (webhook and driver refresh had not). */
  readonly recovered: number;
  /** Razorpay reported them expired or cancelled; closed as FAILED, nothing was owed. */
  readonly closed: number;
  /** Still open at Razorpay. */
  readonly stillOpen: number;
  /** Applied meanwhile (webhook, refresh, sync), or no longer pending. */
  readonly alreadySettled: number;
  /** Razorpay reports money the finalizer did not apply: findings for an admin. */
  readonly anomalies: number;
  readonly lookupFailed: number;
  readonly providerUnavailable: number;
  readonly errors: number;
  /** Stopped after three "provider unavailable" answers in a row. */
  readonly stoppedEarly: boolean;
}

export interface RecoveryResult {
  readonly summary: RecoverySummary;
  readonly findings: readonly DetectedFinding[];
  /** Every candidate was read and settled one way or another. */
  readonly complete: boolean;
}

interface CandidateRow {
  readonly id: string;
  readonly booking_id: string;
  readonly driver_id: string;
  readonly provider_reference_id: string;
  readonly amount_paise: bigint;
}

const OUTAGE_AFTER = 3;
/** Candidates between progress reports (the run renews its lease). */
const PROGRESS_EVERY = 25;

/**
 * The collection recovery job (payment flow Phase 7). A QR or payment link the customer paid
 * stays PENDING until a webhook, the driver's refresh or an admin sync applies it; if all of
 * those were missed (an outage, a lost webhook, an app closed mid-payment), this job re-reads the
 * still PENDING online collections from Razorpay and applies what Razorpay reports, through the
 * same collection finalizer (CollectionsService.recover). So it can never apply a payment twice:
 * the finalizer locks the collection, a second pass finds it no longer PENDING, and a webhook
 * racing it gets ALREADY_APPLIED.
 *
 * Nothing it does is silent: every collection it applies is recorded as a finding (INFO; CRITICAL
 * when the money arrived for a cancelled booking or a closed drop, which waits for a refund
 * decision), and so is every payment the finalizer would not apply. A QR that expired unpaid is
 * closed, as the webhook would have; that change is in the financial event log under this job.
 *
 * Only PENDING ONLINE_QR collections are touched. Pending checkout payments (top-ups, historical
 * prepaid bookings) are only reported by the reconciliation run: applying one may capture an
 * authorized payment, which stays an admin's decision (payment sync).
 */
@Injectable()
export class CollectionRecoveryService {
  private readonly logger = new Logger(CollectionRecoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly collections: CollectionsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async run(scope: RecoveryScope, progress?: () => Promise<void>): Promise<RecoveryResult> {
    const since = scope.since ? scope.since.toISOString() : null;
    const rows = await this.prisma.$queryRaw<CandidateRow[]>`
      SELECT c.id, c.booking_id, c.collected_by_driver_id AS driver_id, c.provider_reference_id,
             c.amount_paise
        FROM payment_collections c
       WHERE c.status = 'PENDING' AND c.method = 'ONLINE_QR'
         AND c.provider_product IS NOT NULL AND c.provider_reference_id IS NOT NULL
         AND c.created_at < now() - make_interval(mins => ${this.config.reconciliation.recoveryMinAgeMinutes}::int)
         AND (${since}::timestamptz IS NULL OR c.created_at >= ${since}::timestamptz)
       ORDER BY c.created_at, c.id
       LIMIT ${scope.limit + 1}`;
    const candidates = rows.slice(0, scope.limit);
    const findings: DetectedFinding[] = [];
    const counts = {
      recovered: 0,
      closed: 0,
      stillOpen: 0,
      alreadySettled: 0,
      anomalies: 0,
      lookupFailed: 0,
      providerUnavailable: 0,
      errors: 0,
    };
    let consecutiveUnavailable = 0;
    let stoppedEarly = false;

    for (const [index, row] of candidates.entries()) {
      if (consecutiveUnavailable >= OUTAGE_AFTER) {
        stoppedEarly = true;
        break;
      }
      if (progress && index > 0 && index % PROGRESS_EVERY === 0) {
        await progress();
      }
      let result: CollectionApplyResult | null;
      try {
        result = await this.collections.recover(row.id);
      } catch (error) {
        if (error instanceof AppError && error.code === ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE) {
          consecutiveUnavailable += 1;
          counts.providerUnavailable += 1;
          continue;
        }
        consecutiveUnavailable = 0;
        if (error instanceof AppError && error.code === ErrorCode.PAYMENT_PROVIDER_ERROR) {
          counts.lookupFailed += 1;
          findings.push(
            recoveryFinding(
              warning('PROVIDER_EVENT_ANOMALY'),
              'RECOVERY_PROVIDER_LOOKUP_FAILED',
              row,
              {
                state: 'PENDING',
                detail: `Razorpay refused the lookup of ${row.provider_reference_id}; the collection stays PENDING and is retried`,
              },
            ),
          );
          continue;
        }
        // A lock timeout (a webhook or the driver applying it right now) or a database error:
        // nothing was applied; the next run retries it.
        counts.errors += 1;
        this.logger.warn(
          { err: error, collectionId: row.id },
          'Collection recovery could not settle one collection; the next run retries it',
        );
        continue;
      }
      consecutiveUnavailable = 0;
      if (!result) {
        counts.alreadySettled += 1;
        continue;
      }
      const collection = result.collection;
      const paid = {
        state: collection.status,
        providerRef: collection.providerPaymentId ?? row.provider_reference_id,
      };
      switch (result.outcome) {
        case ConfirmationOutcome.APPLIED:
          counts.recovered += 1;
          findings.push(
            recoveryFinding(info('PROVIDER_PAID_INTERNAL_PENDING'), 'COLLECTION_RECOVERED', row, {
              ...paid,
              detail: `Razorpay reported ${row.provider_reference_id} paid (${collection.providerPaymentId ?? 'payment'}) and no webhook, refresh or sync had applied it; applied by the recovery job through the collection finalizer`,
            }),
          );
          break;
        case ConfirmationOutcome.PAID_AFTER_CANCELLATION:
          counts.recovered += 1;
          findings.push(
            recoveryFinding(
              critical('PROVIDER_PAID_INTERNAL_PENDING'),
              'RECOVERED_PAID_AFTER_CANCELLATION',
              row,
              {
                ...paid,
                detail: `Razorpay reported ${row.provider_reference_id} paid after the booking was cancelled; recorded as paid by the recovery job: refund review (refund policy open)`,
              },
            ),
          );
          break;
        case ConfirmationOutcome.PAID_FOR_CLOSED_DROP:
          counts.recovered += 1;
          findings.push(
            recoveryFinding(
              critical('PROVIDER_PAID_INTERNAL_PENDING'),
              'RECOVERED_PAID_FOR_CLOSED_DROP',
              row,
              {
                ...paid,
                detail: `Razorpay reported ${row.provider_reference_id} paid after its drop was closed as undelivered; recorded as paid by the recovery job: refund review (refund policy open)`,
              },
            ),
          );
          break;
        case WebhookOutcome.COLLECTION_CLOSED:
          counts.closed += 1;
          break;
        case WebhookOutcome.COLLECTION_NOT_PAID:
          counts.stillOpen += 1;
          break;
        case ConfirmationOutcome.ALREADY_APPLIED:
          counts.alreadySettled += 1;
          break;
        default:
          counts.anomalies += 1;
          findings.push(
            recoveryFinding(
              critical('PROVIDER_PAID_INTERNAL_PENDING'),
              `RECOVERY_${kindPart(result.outcome, 'ANOMALY')}`,
              row,
              {
                state: collection.status,
                providerRef: row.provider_reference_id,
                detail: `Razorpay reports money on ${row.provider_reference_id} that the collection finalizer did not apply (${result.outcome}); nothing was changed: needs a human`,
              },
            ),
          );
      }
    }

    const truncated = rows.length > scope.limit;
    const summary: RecoverySummary = {
      candidates: candidates.length,
      truncated,
      ...counts,
      stoppedEarly,
    };
    return {
      summary,
      findings,
      complete:
        !truncated && !stoppedEarly && counts.errors === 0 && counts.providerUnavailable === 0,
    };
  }
}

function recoveryFinding(
  spec: KindSpec,
  kind: string,
  row: CandidateRow,
  extra: { readonly state: string; readonly providerRef?: string; readonly detail: string },
): DetectedFinding {
  return detected({
    ...spec,
    kind,
    source: 'RECOVERY',
    entityType: 'PAYMENT_COLLECTION',
    entityId: row.id,
    bookingId: row.booking_id,
    driverId: row.driver_id,
    providerRef: extra.providerRef ?? row.provider_reference_id,
    internalState: extra.state,
    internalAmountPaise: row.amount_paise,
    detail: extra.detail,
    refs: { providerReferenceId: row.provider_reference_id },
    identity: ['PAYMENT_COLLECTION', row.id],
  });
}

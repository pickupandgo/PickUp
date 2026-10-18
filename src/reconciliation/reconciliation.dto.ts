import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import {
  FINDING_CATEGORIES,
  FINDING_SEVERITIES,
  FINDING_SOURCES,
  FINDING_STATUSES,
  type FindingCategory,
  type FindingSeverity,
  type FindingSource,
} from './finding-types';
import {
  RECONCILIATION_JOBS,
  type ReconciliationJob,
  RUN_STATUSES,
} from './reconciliation-runs.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ListFindingsQuery {
  /** OPEN (needs an admin) or RESOLVED. Default: both. */
  @IsOptional()
  @IsIn(FINDING_STATUSES)
  status?: (typeof FINDING_STATUSES)[number];

  @IsOptional()
  @IsIn(FINDING_CATEGORIES)
  category?: FindingCategory;

  @IsOptional()
  @IsIn(FINDING_SEVERITIES)
  severity?: FindingSeverity;

  @IsOptional()
  @IsIn(FINDING_SOURCES)
  source?: FindingSource;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,59}$/, { message: 'kind is invalid' })
  kind?: string;

  @IsOptional()
  @IsUUID('4')
  bookingId?: string;

  @IsOptional()
  @IsUUID('4')
  driverId?: string;

  /** The record the finding is about (a collection, payout, earning, refund, event, ...). */
  @IsOptional()
  @IsString()
  @Length(1, 150)
  entityId?: string;

  /** Findings this run saw last. */
  @IsOptional()
  @IsUUID('4')
  runId?: string;

  /** true: only findings a complete run no longer sees; false: only those still seen. */
  @IsOptional()
  @IsIn(['true', 'false'])
  cleared?: 'true' | 'false';

  /** Page size, 1-200. Defaults to 50. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  /** `nextCursor` from the previous page. */
  @IsOptional()
  @IsUUID('4')
  cursor?: string;
}

export class FindingResponse {
  id!: string;
  /** PROVIDER_PAID_INTERNAL_PENDING, INTERNAL_PAID_PROVIDER_NOT_PAID, ... */
  category!: string;
  /** The check's problem code, e.g. PROVIDER_PAID_PAYMENT_PENDING. */
  kind!: string;
  /** INFO, WARNING or CRITICAL. */
  severity!: string;
  /** DATABASE, PROVIDER or RECOVERY. */
  source!: string;
  /** OPEN or RESOLVED. */
  status!: string;
  fingerprint!: string;
  entityType!: string | null;
  entityId!: string | null;
  bookingId!: string | null;
  driverId!: string | null;
  /** The provider id involved (pay_, qr_, pout_, rfnd_, a webhook event id, ...). */
  providerRef!: string | null;
  internalState!: string | null;
  providerState!: string | null;
  internalAmountPaise!: number | null;
  providerAmountPaise!: number | null;
  detail!: string | null;
  refs!: Record<string, unknown>;
  /** Runs that saw it (an acknowledged finding keeps counting after it is resolved). */
  occurrences!: number;
  firstSeenAt!: string;
  lastSeenAt!: string;
  firstRunId!: string | null;
  lastRunId!: string | null;
  /** When a complete run no longer saw it. Null while it is still seen. */
  clearedAt!: string | null;
  resolvedAt!: string | null;
  resolvedByUserId!: string | null;
  resolutionNote!: string | null;
}

export class FindingPageResponse {
  items!: FindingResponse[];
  nextCursor!: string | null;
}

export class ResolveFindingRequest {
  /** What was checked or done, or the decision reference. Stored on the finding and audited. */
  @Transform(trim)
  @IsString()
  @Length(10, 500)
  note!: string;
}

export class StartRunRequest {
  /** COLLECTION_RECOVERY or RECONCILIATION. */
  @IsIn(RECONCILIATION_JOBS)
  job!: ReconciliationJob;

  /**
   * Only re-read (recovery) or compare with the provider records created since then. The
   * database checks always cover everything; a run with `since` never marks anything cleared.
   */
  @IsOptional()
  @IsISO8601({ strict: true })
  since?: string;
}

export class ListRunsQuery {
  @IsOptional()
  @IsIn(RECONCILIATION_JOBS)
  job?: ReconciliationJob;

  @IsOptional()
  @IsIn(RUN_STATUSES)
  status?: (typeof RUN_STATUSES)[number];

  /** Page size, 1-100. Defaults to 20. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsUUID('4')
  cursor?: string;
}

export class RunResponse {
  id!: string;
  job!: string;
  /** SCHEDULE or ADMIN. */
  triggeredBy!: string;
  /** RUNNING, COMPLETED, FAILED or ABANDONED. */
  status!: string;
  scope!: Record<string, unknown>;
  requestedByUserId!: string | null;
  startedAt!: string;
  leaseExpiresAt!: string;
  finishedAt!: string | null;
  /** Counts and per-check results. */
  summary!: Record<string, unknown>;
  error!: string | null;
}

export class RunPageResponse {
  items!: RunResponse[];
  nextCursor!: string | null;
}

export class ReconciliationSummaryResponse {
  openFindings!: {
    total: number;
    bySeverity: Record<string, number>;
    byCategory: Record<string, number>;
  };
  latestRuns!: {
    COLLECTION_RECOVERY: RunResponse | null;
    RECONCILIATION: RunResponse | null;
  };
  schedule!: {
    /** 0 = only when an admin starts a run. */
    recoveryIntervalMinutes: number;
    reconciliationIntervalMinutes: number;
    providerChecks: boolean;
    lookbackDays: number;
  };
}

/** A condition a check sees now (not recorded: integrity-checks only reads). */
export class DetectedFindingResponse {
  category!: string;
  kind!: string;
  severity!: string;
  fingerprint!: string;
  entityType!: string | null;
  entityId!: string | null;
  bookingId!: string | null;
  driverId!: string | null;
  providerRef!: string | null;
  internalState!: string | null;
  providerState!: string | null;
  internalAmountPaise!: number | null;
  providerAmountPaise!: number | null;
  detail!: string | null;
  refs!: Record<string, string>;
}

export class IntegrityCheckResponse {
  check!: string;
  /** False when the check stopped at its row limit (or failed). */
  complete!: boolean;
  note!: string | null;
  findings!: DetectedFindingResponse[];
}

export class IntegrityChecksResponse {
  checks!: IntegrityCheckResponse[];
}

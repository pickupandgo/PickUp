import { HttpStatus, Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { recordAdminAction } from '../audit/admin-actions';
import type { Page } from '../audit/audit-events.service';
import { FinancialContext } from '../audit/financial-context';
import type { Principal } from '../auth/principal';
import { AppError, notFound } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import type { Prisma, ReconciliationRun } from '../generated/prisma/client';
import { isUniqueViolation } from '../prisma/prisma-errors';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { CollectionRecoveryService } from './collection-recovery.service';
import { type CheckResult, uniqueFindings } from './finding-types';
import { ProviderReconciliationService } from './provider-reconciliation.service';
import { ReconciliationChecksService } from './reconciliation-checks.service';
import {
  type RecordedCounts,
  ReconciliationFindingsService,
} from './reconciliation-findings.service';

export const RECONCILIATION_JOBS = ['COLLECTION_RECOVERY', 'RECONCILIATION'] as const;
export type ReconciliationJob = (typeof RECONCILIATION_JOBS)[number];

export const RUN_STATUSES = ['RUNNING', 'COMPLETED', 'FAILED', 'ABANDONED'] as const;

/** How long a run may go without renewing its lease before the next one closes it ABANDONED. */
const LEASE_MINUTES: Readonly<Record<ReconciliationJob, number>> = {
  COLLECTION_RECOVERY: 10,
  RECONCILIATION: 30,
};
/** Rows per database check in a run (the admin reports show 200). */
export const SNAPSHOT_LIMIT = 2_000;
/** Records read from the provider per check, per run. */
export const PROVIDER_LIMIT = 200;
/** Collections re-read per recovery run. */
export const RECOVERY_LIMIT = 200;
/** How long shutdown waits for a run in progress. */
const SHUTDOWN_WAIT_MS = 10_000;

export interface StartRunOptions {
  readonly trigger: 'SCHEDULE' | 'ADMIN';
  readonly requestedByUserId?: string | null;
  /** Limit recovery and provider reads to records created since then. */
  readonly since?: Date | null;
}

export interface RunFilter {
  readonly job?: ReconciliationJob;
  readonly status?: (typeof RUN_STATUSES)[number];
  readonly limit?: number;
  readonly cursor?: string;
}

/** The run lost its lease (it was closed as ABANDONED by another one): stop writing. */
class RunLeaseLostError extends Error {
  constructor(runId: string) {
    super(`Reconciliation run ${runId} lost its lease`);
    this.name = 'RunLeaseLostError';
  }
}

/**
 * Reconciliation and collection recovery runs (payment flow Phase 7).
 *
 * A run is leased in reconciliation_runs: at most one RUNNING run per job (unique index), so
 * overlapping timers, several instances and an admin's request never run a job twice at once. A
 * run that dies (crash, deploy) keeps its row RUNNING until its lease expires; the next run
 * closes it ABANDONED and starts over, which is safe because every step is idempotent: findings
 * count sightings once per run, and recovery goes through the collection finalizer.
 *
 * Everything a run changes in a financial table is recorded in the financial event log as this
 * job (actor SYSTEM, origin "job <JOB>", request id = the run id).
 */
@Injectable()
export class ReconciliationRunsService implements OnApplicationShutdown {
  private readonly logger = new Logger(ReconciliationRunsService.name);
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly findings: ReconciliationFindingsService,
    private readonly checks: ReconciliationChecksService,
    private readonly provider: ProviderReconciliationService,
    private readonly recovery: CollectionRecoveryService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Leases a run of `job` and runs it to the end. Null when a run of the job is already in
   * progress (it is left alone). Used by the scheduler and by tests.
   */
  async runNow(
    job: ReconciliationJob,
    options: StartRunOptions,
  ): Promise<ReconciliationRun | null> {
    let run: ReconciliationRun;
    try {
      run = await this.prisma.runInTransaction((tx) => this.lease(tx, job, options));
    } catch (error) {
      if (isUniqueViolation(error)) {
        return null;
      }
      throw error;
    }
    return this.execute(run);
  }

  /**
   * An admin starts a run: recorded (with an admin action) and leased now, executed in the
   * background. 409 RECONCILIATION_RUN_IN_PROGRESS while one is running.
   */
  async startForAdmin(
    admin: Principal,
    job: ReconciliationJob,
    since: Date | null,
  ): Promise<ReconciliationRun> {
    let run: ReconciliationRun;
    try {
      run = await this.prisma.runInTransaction(async (tx) => {
        const leased = await this.lease(tx, job, {
          trigger: 'ADMIN',
          requestedByUserId: admin.userId,
          since,
        });
        await recordAdminAction(tx, {
          actorUserId: admin.userId,
          action: 'RECONCILIATION_RUN_REQUESTED',
          targetType: 'RECONCILIATION_RUN',
          targetId: leased.id,
          details: { job, since: since ? since.toISOString() : null },
        });
        return leased;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const running = await this.prisma.reconciliationRun.findFirst({
          where: { job, status: 'RUNNING' },
          select: { id: true },
        });
        throw new AppError(
          ErrorCode.RECONCILIATION_RUN_IN_PROGRESS,
          HttpStatus.CONFLICT,
          'A run of this job is already in progress',
          { runId: running?.id ?? null },
        );
      }
      throw error;
    }
    this.background(run);
    return run;
  }

  async get(runId: string): Promise<ReconciliationRun> {
    const run = await this.prisma.reconciliationRun.findUnique({ where: { id: runId } });
    if (!run) {
      throw notFound(ErrorCode.RECONCILIATION_RUN_NOT_FOUND, 'Reconciliation run not found');
    }
    return run;
  }

  async list(filter: RunFilter): Promise<Page<ReconciliationRun>> {
    const limit = filter.limit ?? 20;
    const rows = await this.prisma.reconciliationRun.findMany({
      where: {
        ...(filter.job ? { job: filter.job } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return { items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
  }

  /** The latest run of each job. */
  async latest(): Promise<Record<ReconciliationJob, ReconciliationRun | null>> {
    const [recovery, reconciliation] = await Promise.all(
      RECONCILIATION_JOBS.map((job) =>
        this.prisma.reconciliationRun.findFirst({
          where: { job },
          orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        }),
      ),
    );
    return { COLLECTION_RECOVERY: recovery ?? null, RECONCILIATION: reconciliation ?? null };
  }

  /** Waits (briefly) for background runs, so a shutdown doesn't cut one off mid-write. */
  async onApplicationShutdown(): Promise<void> {
    if (this.inFlight.size === 0) {
      return;
    }
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.allSettled([...this.inFlight]),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, SHUTDOWN_WAIT_MS);
        timer.unref();
      }),
    ]);
    clearTimeout(timer);
  }

  /** Closes an expired run of the job as ABANDONED, then records a new RUNNING one. */
  private async lease(
    tx: Tx,
    job: ReconciliationJob,
    options: StartRunOptions,
  ): Promise<ReconciliationRun> {
    await tx.$executeRaw`
      UPDATE reconciliation_runs
         SET status = 'ABANDONED', finished_at = clock_timestamp(), updated_at = now(),
             error = 'The run stopped before it finished (its lease expired); the next run starts over'
       WHERE job = ${job} AND status = 'RUNNING' AND lease_expires_at < clock_timestamp()`;
    return tx.reconciliationRun.create({
      data: {
        job,
        triggeredBy: options.trigger,
        requestedByUserId: options.requestedByUserId ?? null,
        scope: options.since ? { since: options.since.toISOString() } : {},
        leaseExpiresAt: new Date(Date.now() + LEASE_MINUTES[job] * 60_000),
      },
    });
  }

  private background(run: ReconciliationRun): void {
    const task: Promise<void> = this.execute(run)
      .then(
        () => undefined,
        (error: unknown) => {
          this.logger.error({ err: error, runId: run.id }, 'Reconciliation run could not finish');
        },
      )
      .finally(() => {
        this.inFlight.delete(task);
      });
    this.inFlight.add(task);
  }

  /** Runs the job as SYSTEM (request id = run id) and records how it ended. */
  private async execute(run: ReconciliationRun): Promise<ReconciliationRun> {
    const job = run.job as ReconciliationJob;
    const since = sinceOf(run.scope);
    const started = Date.now();
    try {
      const summary = await FinancialContext.run(
        { actorType: 'SYSTEM', requestId: run.id, origin: `job ${job}` },
        () =>
          job === 'COLLECTION_RECOVERY' ? this.recover(run, since) : this.reconcile(run, since),
      );
      const failed = summary.failedChecks;
      const finished = await this.finish(
        run.id,
        failed.length > 0 ? 'FAILED' : 'COMPLETED',
        { ...summary.counts, durationMs: Date.now() - started },
        failed.length > 0 ? `Checks failed: ${failed.join(', ')}` : null,
      );
      this.logger.log(
        { runId: run.id, job, status: finished.status, ...summary.counts.recorded },
        'Reconciliation run finished',
      );
      return finished;
    } catch (error) {
      this.logger.error({ err: error, runId: run.id, job }, 'Reconciliation run failed');
      return this.finish(
        run.id,
        'FAILED',
        { durationMs: Date.now() - started },
        error instanceof RunLeaseLostError
          ? error.message
          : `The run failed (${error instanceof Error ? error.name : 'unknown error'}); the next run retries`,
      );
    }
  }

  private async reconcile(run: ReconciliationRun, since: Date | null): Promise<RunOutcome> {
    const renew = () => this.renew(run.id, 'RECONCILIATION');
    const results: (CheckResult & { readonly failed?: boolean })[] = [];
    results.push(...(await this.checks.run(SNAPSHOT_LIMIT)));
    await renew();
    results.push(...(await this.provider.run({ since, limit: PROVIDER_LIMIT })));
    await renew();

    const detected = uniqueFindings(results.flatMap((result) => result.findings));
    const recorded = await this.findings.record(run.id, detected, renew);
    // Only a full, untruncated database check can say a condition is gone. A scoped run (or a
    // provider check) never clears anything.
    const clearable = results.filter(
      (result) => result.source === 'DATABASE' && result.clears && result.complete,
    );
    const cleared =
      since === null
        ? await this.findings.clearUnseen(
            run.id,
            clearable.flatMap((result) => result.kinds),
          )
        : 0;
    return {
      failedChecks: results.filter((result) => result.failed).map((result) => result.check),
      counts: {
        scoped: since !== null,
        providerChecks: this.provider.enabled,
        detected: detected.length,
        recorded,
        cleared,
        checks: results.map((result) => ({
          check: result.check,
          source: result.source,
          findings: result.findings.length,
          complete: result.complete,
          ...(result.note ? { note: result.note } : {}),
        })),
      },
    };
  }

  private async recover(run: ReconciliationRun, since: Date | null): Promise<RunOutcome> {
    const renew = () => this.renew(run.id, 'COLLECTION_RECOVERY');
    const result = await this.recovery.run({ since, limit: RECOVERY_LIMIT }, renew);
    const detected = uniqueFindings(result.findings);
    const recorded = await this.findings.record(run.id, detected, renew);
    return {
      failedChecks: [],
      counts: {
        scoped: since !== null,
        ...result.summary,
        complete: result.complete,
        detected: detected.length,
        recorded,
      },
    };
  }

  /** Pushes the lease forward; throws when the run was closed meanwhile. */
  private async renew(runId: string, job: ReconciliationJob): Promise<void> {
    const updated = await this.prisma.$executeRaw`
      UPDATE reconciliation_runs
         SET lease_expires_at = GREATEST(lease_expires_at,
                                         clock_timestamp() + make_interval(mins => ${LEASE_MINUTES[job]}::int)),
             updated_at = now()
       WHERE id = ${runId}::uuid AND status = 'RUNNING'`;
    if (updated === 0) {
      throw new RunLeaseLostError(runId);
    }
  }

  private async finish(
    runId: string,
    status: 'COMPLETED' | 'FAILED',
    summary: Record<string, unknown>,
    error: string | null,
  ): Promise<ReconciliationRun> {
    const { count } = await this.prisma.reconciliationRun.updateMany({
      where: { id: runId, status: 'RUNNING' },
      data: {
        status,
        finishedAt: new Date(),
        summary: summary as Prisma.InputJsonObject,
        error: error ? error.slice(0, 500) : null,
      },
    });
    if (count === 0) {
      this.logger.warn(
        { runId },
        'Reconciliation run was closed by another run before it finished',
      );
    }
    return this.prisma.reconciliationRun.findUniqueOrThrow({ where: { id: runId } });
  }
}

interface RunOutcome {
  readonly failedChecks: readonly string[];
  readonly counts: Record<string, unknown> & { readonly recorded: RecordedCounts };
}

function sinceOf(scope: Prisma.JsonValue): Date | null {
  if (scope !== null && typeof scope === 'object' && !Array.isArray(scope)) {
    const value = scope.since;
    if (typeof value === 'string') {
      const since = new Date(value);
      return Number.isNaN(since.getTime()) ? null : since;
    }
  }
  return null;
}

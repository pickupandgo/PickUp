import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AdminOnly, CurrentPrincipal } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { paiseToNumber } from '../common/money';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import type { ReconciliationFinding, ReconciliationRun } from '../generated/prisma/client';
import type { DetectedFinding } from './finding-types';
import { ReconciliationChecksService } from './reconciliation-checks.service';
import { ReconciliationFindingsService } from './reconciliation-findings.service';
import { ReconciliationRunsService } from './reconciliation-runs.service';
import {
  type DetectedFindingResponse,
  FindingPageResponse,
  FindingResponse,
  IntegrityChecksResponse,
  ListFindingsQuery,
  ListRunsQuery,
  ReconciliationSummaryResponse,
  ResolveFindingRequest,
  RunPageResponse,
  RunResponse,
  StartRunRequest,
} from './reconciliation.dto';

const uuid = new ParseUUIDPipe({ version: '4' });
/** Rows per check in the on-demand integrity view (as the individual reports). */
const INTEGRITY_CHECK_LIMIT = 200;

/**
 * Reconciliation (payment flow Phase 7), admin only. Runs record findings; admins resolve them.
 * Nothing here moves money: a finding names the record and the admin action that settles it
 * (payment, collection, payout or refund sync; hold or release; a refund decision), and every
 * resolution is audited.
 *
 *   summary            OPEN findings by severity and category, the latest run of each job
 *   findings           recorded findings (filters, cursor pages); resolve one with a note
 *   runs               start a run (202; poll GET runs/:id), list and read runs
 *   integrity-checks   what the database checks see right now, without recording anything
 */
@ApiTags('admin')
@AdminOnly()
@Controller({ path: 'admin/reconciliation', version: '1' })
export class AdminReconciliationController {
  constructor(
    private readonly findings: ReconciliationFindingsService,
    private readonly runs: ReconciliationRunsService,
    private readonly checks: ReconciliationChecksService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('summary')
  async summary(): Promise<ReconciliationSummaryResponse> {
    const [open, latest] = await Promise.all([this.findings.openCounts(), this.runs.latest()]);
    return {
      openFindings: {
        total: open.total,
        bySeverity: { ...open.bySeverity },
        byCategory: { ...open.byCategory },
      },
      latestRuns: {
        COLLECTION_RECOVERY: latest.COLLECTION_RECOVERY
          ? toRunResponse(latest.COLLECTION_RECOVERY)
          : null,
        RECONCILIATION: latest.RECONCILIATION ? toRunResponse(latest.RECONCILIATION) : null,
      },
      schedule: {
        recoveryIntervalMinutes: this.config.reconciliation.recoveryIntervalMinutes,
        reconciliationIntervalMinutes: this.config.reconciliation.intervalMinutes,
        providerChecks: this.config.reconciliation.providerChecks,
        lookbackDays: this.config.reconciliation.lookbackDays,
      },
    };
  }

  @Get('findings')
  async listFindings(@Query() query: ListFindingsQuery): Promise<FindingPageResponse> {
    const page = await this.findings.list({
      status: query.status,
      category: query.category,
      severity: query.severity,
      source: query.source,
      kind: query.kind,
      bookingId: query.bookingId,
      driverId: query.driverId,
      entityId: query.entityId,
      runId: query.runId,
      cleared: query.cleared === undefined ? undefined : query.cleared === 'true',
      limit: query.limit,
      cursor: query.cursor,
    });
    return { items: page.items.map(toFindingResponse), nextCursor: page.nextCursor };
  }

  @Get('findings/:findingId')
  async getFinding(@Param('findingId', uuid) findingId: string): Promise<FindingResponse> {
    return toFindingResponse(await this.findings.get(findingId));
  }

  /** Closes a finding with a note. 409 when it is already resolved (a resolution never changes). */
  @Post('findings/:findingId/resolve')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async resolveFinding(
    @CurrentPrincipal() principal: Principal,
    @Param('findingId', uuid) findingId: string,
    @Body() body: ResolveFindingRequest,
  ): Promise<FindingResponse> {
    return toFindingResponse(await this.findings.resolve(principal, findingId, body.note));
  }

  /**
   * Starts a run now: 202 with the RUNNING run; poll GET runs/:id for the outcome. 409
   * RECONCILIATION_RUN_IN_PROGRESS while a run of the job is in progress.
   */
  @Post('runs')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async startRun(
    @CurrentPrincipal() principal: Principal,
    @Body() body: StartRunRequest,
  ): Promise<RunResponse> {
    const run = await this.runs.startForAdmin(
      principal,
      body.job,
      body.since ? new Date(body.since) : null,
    );
    return toRunResponse(run);
  }

  @Get('runs')
  async listRuns(@Query() query: ListRunsQuery): Promise<RunPageResponse> {
    const page = await this.runs.list(query);
    return { items: page.items.map(toRunResponse), nextCursor: page.nextCursor };
  }

  @Get('runs/:runId')
  async getRun(@Param('runId', uuid) runId: string): Promise<RunResponse> {
    return toRunResponse(await this.runs.get(runId));
  }

  /** The database checks as they stand now (read-only; up to 200 rows per check). */
  @Get('integrity-checks')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async integrityChecks(): Promise<IntegrityChecksResponse> {
    const results = await this.checks.run(INTEGRITY_CHECK_LIMIT);
    return {
      checks: results.map((result) => ({
        check: result.check,
        complete: result.complete,
        note: result.note ?? null,
        findings: result.findings.map(toDetectedFindingResponse),
      })),
    };
  }
}

export function toFindingResponse(finding: ReconciliationFinding): FindingResponse {
  return {
    id: finding.id,
    category: finding.category,
    kind: finding.kind,
    severity: finding.severity,
    source: finding.source,
    status: finding.status,
    fingerprint: finding.fingerprint,
    entityType: finding.entityType,
    entityId: finding.entityId,
    bookingId: finding.bookingId,
    driverId: finding.driverId,
    providerRef: finding.providerRef,
    internalState: finding.internalState,
    providerState: finding.providerState,
    internalAmountPaise: paise(finding.internalAmountPaise),
    providerAmountPaise: paise(finding.providerAmountPaise),
    detail: finding.detail,
    refs: asObject(finding.refs),
    occurrences: finding.occurrences,
    firstSeenAt: finding.firstSeenAt.toISOString(),
    lastSeenAt: finding.lastSeenAt.toISOString(),
    firstRunId: finding.firstRunId,
    lastRunId: finding.lastRunId,
    clearedAt: finding.clearedAt?.toISOString() ?? null,
    resolvedAt: finding.resolvedAt?.toISOString() ?? null,
    resolvedByUserId: finding.resolvedByUserId,
    resolutionNote: finding.resolutionNote,
  };
}

export function toRunResponse(run: ReconciliationRun): RunResponse {
  return {
    id: run.id,
    job: run.job,
    triggeredBy: run.triggeredBy,
    status: run.status,
    scope: asObject(run.scope),
    requestedByUserId: run.requestedByUserId,
    startedAt: run.startedAt.toISOString(),
    leaseExpiresAt: run.leaseExpiresAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    summary: asObject(run.summary),
    error: run.error,
  };
}

function toDetectedFindingResponse(finding: DetectedFinding): DetectedFindingResponse {
  return {
    category: finding.category,
    kind: finding.kind,
    severity: finding.severity,
    fingerprint: finding.fingerprint,
    entityType: finding.entityType,
    entityId: finding.entityId,
    bookingId: finding.bookingId,
    driverId: finding.driverId,
    providerRef: finding.providerRef,
    internalState: finding.internalState,
    providerState: finding.providerState,
    internalAmountPaise: paise(finding.internalAmountPaise),
    providerAmountPaise: paise(finding.providerAmountPaise),
    detail: finding.detail,
    refs: { ...finding.refs },
  };
}

function paise(value: bigint | null): number | null {
  return value === null ? null : paiseToNumber(value);
}

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

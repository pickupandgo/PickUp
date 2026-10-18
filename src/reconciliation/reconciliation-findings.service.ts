import { HttpStatus, Injectable } from '@nestjs/common';
import { recordAdminAction } from '../audit/admin-actions';
import type { Page } from '../audit/audit-events.service';
import type { Principal } from '../auth/principal';
import { AppError, notFound } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import type { Prisma, ReconciliationFinding } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  DetectedFinding,
  FindingCategory,
  FindingSeverity,
  FindingSource,
} from './finding-types';

/** What recording one detected finding did. */
export type Sighting =
  /** A new OPEN finding. */
  | 'CREATED'
  /** Another sighting of the OPEN finding of this condition. */
  | 'SIGHTED'
  /** Another sighting of a resolved finding whose condition never cleared: counted, not reopened. */
  | 'ACKNOWLEDGED'
  /** Already counted by this run (a retried or repeated record). */
  | 'UNCHANGED';

export interface RecordedCounts {
  readonly created: number;
  readonly sighted: number;
  readonly acknowledged: number;
  readonly unchanged: number;
}

export interface FindingFilter {
  readonly status?: 'OPEN' | 'RESOLVED';
  readonly category?: FindingCategory;
  readonly severity?: FindingSeverity;
  readonly source?: FindingSource;
  readonly kind?: string;
  readonly bookingId?: string;
  readonly driverId?: string;
  readonly entityId?: string;
  /** Findings this run saw last. */
  readonly runId?: string;
  /** true: only cleared findings; false: only findings whose condition is still seen. */
  readonly cleared?: boolean;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface OpenFindingCounts {
  readonly total: number;
  readonly bySeverity: Readonly<Record<string, number>>;
  readonly byCategory: Readonly<Record<string, number>>;
}

/** How often a long recording pass reports progress (renews the run's lease). */
const PROGRESS_EVERY = 100;

/**
 * Reconciliation findings (payment flow Phase 7): recorded by runs, resolved by admins. Nothing
 * here moves money or changes a financial record.
 *
 *   one OPEN finding per fingerprint; seeing the condition again counts a sighting on it
 *   a resolved finding whose condition is still seen is acknowledged: counted, never reopened
 *   a resolved finding whose condition cleared and then came back: a new OPEN finding
 *   a complete, unscoped run marks the state findings it no longer sees as cleared (never deleted)
 *
 * The table's triggers enforce the same rules, for every role.
 */
@Injectable()
export class ReconciliationFindingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Records what a run detected. `progress` is awaited every 100 findings. */
  async record(
    runId: string,
    findings: readonly DetectedFinding[],
    progress?: () => Promise<void>,
  ): Promise<RecordedCounts> {
    const counts = { created: 0, sighted: 0, acknowledged: 0, unchanged: 0 };
    let done = 0;
    for (const finding of findings) {
      const result = await this.recordOne(runId, finding);
      switch (result) {
        case 'CREATED':
          counts.created += 1;
          break;
        case 'SIGHTED':
          counts.sighted += 1;
          break;
        case 'ACKNOWLEDGED':
          counts.acknowledged += 1;
          break;
        case 'UNCHANGED':
          counts.unchanged += 1;
          break;
      }
      done += 1;
      if (progress && done % PROGRESS_EVERY === 0) {
        await progress();
      }
    }
    return counts;
  }

  /**
   * One statement, so the three cases can't interleave: sight the OPEN finding, else acknowledge
   * the resolved one that never cleared, else insert a new OPEN finding. A sighting already
   * counted by this run changes nothing, so a retried record is harmless.
   */
  async recordOne(runId: string, finding: DetectedFinding): Promise<Sighting> {
    const refs = JSON.stringify(finding.refs);
    const internalAmount = finding.internalAmountPaise?.toString() ?? null;
    const providerAmount = finding.providerAmountPaise?.toString() ?? null;
    const rows = await this.prisma.$queryRaw<{ result: Sighting }[]>`
      WITH open_finding AS (
        SELECT id FROM reconciliation_findings
         WHERE fingerprint = ${finding.fingerprint}::varchar AND status = 'OPEN'
      ),
      acknowledged_finding AS (
        SELECT id FROM reconciliation_findings
         WHERE fingerprint = ${finding.fingerprint}::varchar AND status = 'RESOLVED'
           AND cleared_at IS NULL
         ORDER BY resolved_at DESC, id DESC
         LIMIT 1
      ),
      sighted AS (
        UPDATE reconciliation_findings f
           SET occurrences = f.occurrences + 1,
               last_seen_at = GREATEST(f.last_seen_at, clock_timestamp()),
               last_run_id = ${runId}::uuid,
               cleared_at = NULL,
               detail = ${finding.detail}::varchar,
               internal_state = ${finding.internalState}::varchar,
               provider_state = ${finding.providerState}::varchar,
               internal_amount_paise = ${internalAmount}::bigint,
               provider_amount_paise = ${providerAmount}::bigint,
               refs = ${refs}::jsonb,
               updated_at = now()
          FROM open_finding o
         WHERE f.id = o.id
           -- On the row itself (not the snapshot), so a concurrent record waiting for this row's
           -- lock re-checks it and does not count the same run twice.
           AND f.status = 'OPEN'
           AND f.last_run_id IS DISTINCT FROM ${runId}::uuid
        RETURNING 'SIGHTED'::text AS result
      ),
      acknowledged AS (
        UPDATE reconciliation_findings f
           SET occurrences = f.occurrences + 1,
               last_seen_at = GREATEST(f.last_seen_at, clock_timestamp()),
               last_run_id = ${runId}::uuid,
               updated_at = now()
          FROM acknowledged_finding a
         WHERE f.id = a.id
           AND f.status = 'RESOLVED'
           AND f.cleared_at IS NULL
           AND f.last_run_id IS DISTINCT FROM ${runId}::uuid
           AND NOT EXISTS (SELECT 1 FROM open_finding)
        RETURNING 'ACKNOWLEDGED'::text AS result
      ),
      created AS (
        INSERT INTO reconciliation_findings (
          category, kind, severity, source, fingerprint, entity_type, entity_id, booking_id,
          driver_id, provider_ref, internal_state, provider_state, internal_amount_paise,
          provider_amount_paise, detail, refs, first_seen_at, last_seen_at, first_run_id,
          last_run_id)
        SELECT ${finding.category}::varchar, ${finding.kind}::varchar,
               ${finding.severity}::varchar, ${finding.source}::varchar,
               ${finding.fingerprint}::varchar, ${finding.entityType}::varchar,
               ${finding.entityId}::varchar, ${finding.bookingId}::uuid,
               ${finding.driverId}::uuid, ${finding.providerRef}::varchar,
               ${finding.internalState}::varchar, ${finding.providerState}::varchar,
               ${internalAmount}::bigint, ${providerAmount}::bigint, ${finding.detail}::varchar,
               ${refs}::jsonb, ts.at, ts.at, ${runId}::uuid, ${runId}::uuid
          FROM (SELECT clock_timestamp() AS at) ts
         WHERE NOT EXISTS (SELECT 1 FROM open_finding)
           AND NOT EXISTS (SELECT 1 FROM acknowledged_finding)
        ON CONFLICT (fingerprint) WHERE status = 'OPEN' DO NOTHING
        RETURNING 'CREATED'::text AS result
      )
      SELECT result FROM sighted
      UNION ALL SELECT result FROM acknowledged
      UNION ALL SELECT result FROM created`;
    return rows[0]?.result ?? 'UNCHANGED';
  }

  /**
   * Marks findings of these kinds that the run did not see as cleared (the records agree again).
   * Only for a complete, unscoped run's DATABASE state checks; the finding stays, OPEN or
   * RESOLVED, for the admin.
   */
  async clearUnseen(runId: string, kinds: readonly string[]): Promise<number> {
    if (kinds.length === 0) {
      return 0;
    }
    return this.prisma.$executeRaw`
      UPDATE reconciliation_findings
         SET cleared_at = clock_timestamp(), updated_at = now()
       WHERE source = 'DATABASE'
         AND cleared_at IS NULL
         AND last_run_id IS DISTINCT FROM ${runId}::uuid
         AND kind IN (SELECT jsonb_array_elements_text(${JSON.stringify(kinds)}::jsonb))`;
  }

  async list(filter: FindingFilter): Promise<Page<ReconciliationFinding>> {
    const limit = filter.limit ?? 50;
    const where: Prisma.ReconciliationFindingWhereInput = {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.category ? { category: filter.category } : {}),
      ...(filter.severity ? { severity: filter.severity } : {}),
      ...(filter.source ? { source: filter.source } : {}),
      ...(filter.kind ? { kind: filter.kind } : {}),
      ...(filter.bookingId ? { bookingId: filter.bookingId } : {}),
      ...(filter.driverId ? { driverId: filter.driverId } : {}),
      ...(filter.entityId ? { entityId: filter.entityId } : {}),
      ...(filter.runId ? { lastRunId: filter.runId } : {}),
      ...(filter.cleared === undefined ? {} : { clearedAt: filter.cleared ? { not: null } : null }),
    };
    const rows = await this.prisma.reconciliationFinding.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return { items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
  }

  async get(findingId: string): Promise<ReconciliationFinding> {
    const finding = await this.prisma.reconciliationFinding.findUnique({
      where: { id: findingId },
    });
    if (!finding) {
      throw notFound(ErrorCode.RECONCILIATION_FINDING_NOT_FOUND, 'Finding not found');
    }
    return finding;
  }

  /**
   * An admin closes a finding with a note (what was checked, what was done, or the decision
   * reference). It moves no money: any correction is made with the audited admin actions
   * (sync, hold, release, refund, compensating wallet entry). A resolution is never changed.
   */
  async resolve(admin: Principal, findingId: string, note: string): Promise<ReconciliationFinding> {
    return this.prisma.runInTransaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ status: string }[]>`
        SELECT status FROM reconciliation_findings WHERE id = ${findingId}::uuid FOR UPDATE`;
      if (!locked) {
        throw notFound(ErrorCode.RECONCILIATION_FINDING_NOT_FOUND, 'Finding not found');
      }
      if (locked.status !== 'OPEN') {
        throw new AppError(
          ErrorCode.RECONCILIATION_FINDING_RESOLVED,
          HttpStatus.CONFLICT,
          'The finding is already resolved; a resolution is never changed',
          { findingId },
        );
      }
      const resolved = await tx.reconciliationFinding.update({
        where: { id: findingId },
        data: {
          status: 'RESOLVED',
          resolvedAt: new Date(),
          resolvedByUserId: admin.userId,
          resolutionNote: note,
        },
      });
      await recordAdminAction(tx, {
        actorUserId: admin.userId,
        action: 'RECONCILIATION_FINDING_RESOLVED',
        targetType: 'RECONCILIATION_FINDING',
        targetId: findingId,
        reason: note,
        details: {
          category: resolved.category,
          kind: resolved.kind,
          severity: resolved.severity,
          occurrences: resolved.occurrences,
          cleared: resolved.clearedAt !== null,
          // Puts the resolution on the booking's (and driver's) audit trail.
          bookingId: resolved.bookingId,
          driverId: resolved.driverId,
        },
      });
      return resolved;
    });
  }

  /** OPEN findings by severity and category. */
  async openCounts(): Promise<OpenFindingCounts> {
    const groups = await this.prisma.reconciliationFinding.groupBy({
      by: ['category', 'severity'],
      where: { status: 'OPEN' },
      _count: { _all: true },
    });
    const bySeverity: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    let total = 0;
    for (const group of groups) {
      const count = group._count._all;
      total += count;
      bySeverity[group.severity] = (bySeverity[group.severity] ?? 0) + count;
      byCategory[group.category] = (byCategory[group.category] ?? 0) + count;
    }
    return { total, bySeverity, byCategory };
  }
}

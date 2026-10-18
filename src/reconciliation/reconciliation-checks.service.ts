import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EarningsReconciliationService, type Finding } from './earnings-reconciliation.service';
import {
  type CheckResult,
  critical,
  type DetectedFinding,
  detected,
  firstUuid,
  info,
  kindPart,
  type KindSpec,
  warning,
  webhookOutcomeSpec,
} from './finding-types';
import { ReconciliationService } from './reconciliation.service';

/** A database check: its kinds, and whether a complete run clears what it no longer sees. */
export interface CheckSpec {
  readonly check: string;
  readonly clears: boolean;
  readonly kinds: Readonly<Record<string, KindSpec>>;
  /** For a report code this catalog does not list (recorded, never cleared). */
  readonly fallback: KindSpec;
}

/** Report codes recorded under another kind name (a code that is ambiguous on its own). */
const PROBLEM_ALIASES: Readonly<Record<string, string>> = { REVERSED: 'PAYOUT_REVERSED' };

// ----- The existing integrity reports (EarningsReconciliationService, ReconciliationService) -----

const EARNING_MISMATCHES: CheckSpec = {
  check: 'EARNING_MISMATCHES',
  clears: true,
  fallback: critical('EARNING_SOURCE_MISMATCH'),
  kinds: {
    GROSS_NOT_BOOKING_FARE: critical('EARNING_SOURCE_MISMATCH'),
    COMPLETED_TRIP_WITHOUT_EARNING: critical('EARNING_SOURCE_MISMATCH'),
    CASH_FEE_NOT_COLLECTION_FEE: critical('EARNING_SOURCE_MISMATCH'),
    PAID_WITHOUT_PAID_ITEM: critical('PAYOUT_MISMATCH'),
    IN_PAYOUT_WITHOUT_ITEM: critical('PAYOUT_MISMATCH'),
    ITEM_PAID_EARNING_NOT_PAID: critical('PAYOUT_MISMATCH'),
    SETTLED_BUT_AWAITING: warning('SETTLEMENT_MISMATCH'),
    SETTLEMENT_AMOUNT_NOT_GROSS: critical('SETTLEMENT_MISMATCH'),
    EARNING_NOT_SUM_OF_SOURCES: critical('EARNING_SOURCE_MISMATCH'),
    FEE_NOT_SUM_OF_SOURCES: critical('EARNING_SOURCE_MISMATCH'),
    CASH_NOT_CASH_SOURCES: critical('EARNING_SOURCE_MISMATCH'),
    ONLINE_NOT_ONLINE_SOURCES: critical('EARNING_SOURCE_MISMATCH'),
    PAYOUT_AMOUNT_NOT_ONLINE_NET: critical('EARNING_SOURCE_MISMATCH'),
    PAYABLE_BEFORE_SETTLEMENT: critical('SETTLEMENT_MISMATCH'),
    COLLECTION_LINKED_TWICE: critical('EARNING_SOURCE_MISMATCH'),
    COLLECTION_FUNDS_SEVERAL_EARNINGS: critical('EARNING_SOURCE_MISMATCH'),
    COLLECTION_NOT_IN_EARNING: critical('EARNING_SOURCE_MISMATCH'),
  },
};

const PAYOUT_MISMATCHES: CheckSpec = {
  check: 'PAYOUT_MISMATCHES',
  clears: true,
  fallback: critical('PAYOUT_MISMATCH'),
  kinds: {
    GROSS_NOT_SUM_OF_ITEMS: critical('PAYOUT_MISMATCH'),
    PROCESSED_WITH_UNPAID_ITEMS: critical('PAYOUT_MISMATCH'),
    FAILED_WITH_LIVE_ITEMS: critical('PAYOUT_MISMATCH'),
    STUCK_SUBMITTING: warning('STALE_PENDING'),
    STUCK_AT_PROVIDER: warning('STALE_PENDING'),
    PAYOUT_REVERSED: warning('PAYOUT_MISMATCH'),
    ITEM_NOT_EARNING_PAYOUT_AMOUNT: critical('PAYOUT_MISMATCH'),
    EARNING_IN_SEVERAL_LIVE_ITEMS: critical('PAYOUT_MISMATCH'),
  },
};

const FAILED_PAYOUTS: CheckSpec = {
  check: 'FAILED_PAYOUTS',
  clears: true,
  fallback: warning('PAYOUT_MISMATCH'),
  kinds: { PAYOUT_FAILED: warning('PAYOUT_MISMATCH') },
};

const REFUND_ANOMALIES: CheckSpec = {
  check: 'REFUND_ANOMALIES',
  clears: true,
  fallback: critical('REFUND_MISMATCH'),
  kinds: {
    STALE_PENDING_REFUND: warning('STALE_PENDING'),
    STALE_PROCESSING_REFUND: warning('STALE_PENDING'),
    // Open business decisions (L-21): reported, nothing is recovered automatically.
    REFUND_AFTER_PAYOUT: warning('REFUND_MISMATCH'),
    REFUND_ON_CASH_EARNING: warning('REFUND_MISMATCH'),
    REFUNDED_TOTAL_MISMATCH: critical('REFUND_MISMATCH'),
    REFUNDS_EXCEED_SOURCE: critical('REFUND_MISMATCH'),
    BOOKING_REFUND_STATUS_MISMATCH: critical('REFUND_MISMATCH'),
    FEE_CREDIT_MISMATCH: critical('WALLET_MISMATCH'),
  },
};

/** Paid and cancelled: waiting for a refund decision (policy open, L-7 to L-10). */
const PAID_CANCELLED_BOOKINGS: CheckSpec = {
  check: 'PAID_CANCELLED_BOOKINGS',
  clears: true,
  fallback: info('REFUND_MISMATCH'),
  kinds: { PAID_BOOKING_CANCELLED: info('REFUND_MISMATCH') },
};

const CASH_FEE_MISMATCHES: CheckSpec = {
  check: 'CASH_FEE_MISMATCHES',
  clears: true,
  fallback: critical('WALLET_MISMATCH'),
  kinds: {
    FEE_NOT_LEDGER_AMOUNT: critical('WALLET_MISMATCH'),
    LEDGER_FEE_WITHOUT_COLLECTION: critical('WALLET_MISMATCH'),
  },
};

const STALE_COLLECTIONS: CheckSpec = {
  check: 'STALE_COLLECTIONS',
  clears: true,
  fallback: warning('STALE_PENDING'),
  kinds: { PENDING_PAST_EXPIRY: warning('STALE_PENDING') },
};

const WALLET_BALANCES: CheckSpec = {
  check: 'WALLET_BALANCES',
  clears: true,
  fallback: critical('WALLET_MISMATCH'),
  kinds: { WALLET_BALANCE_NOT_LEDGER: critical('WALLET_MISMATCH') },
};

const LEDGER_PROVIDER_PAYMENTS: CheckSpec = {
  check: 'LEDGER_PROVIDER_PAYMENTS',
  clears: true,
  fallback: critical('DUPLICATE_PROVIDER_EVENT'),
  kinds: { DUPLICATE_LEDGER_PROVIDER_PAYMENT: critical('DUPLICATE_PROVIDER_EVENT') },
};

const PAYABLE_WITHOUT_BANK_ACCOUNT: CheckSpec = {
  check: 'PAYABLE_WITHOUT_BANK_ACCOUNT',
  clears: true,
  fallback: info('PAYOUT_MISMATCH'),
  kinds: { PAYABLE_WITHOUT_BANK_ACCOUNT: info('PAYOUT_MISMATCH') },
};

// ----- Checks added by payment flow Phase 7 -----

const EARNING_SOURCES: CheckSpec = {
  check: 'EARNING_SOURCES',
  clears: true,
  fallback: critical('EARNING_SOURCE_MISMATCH'),
  kinds: {
    SOURCE_LINK_NOT_COLLECTION: critical('EARNING_SOURCE_MISMATCH'),
    SOURCE_NOT_COMPLETED: critical('EARNING_SOURCE_MISMATCH'),
    SOURCE_DRIVER_MISMATCH: critical('EARNING_SOURCE_MISMATCH'),
  },
};

const PAYOUT_RECORDS: CheckSpec = {
  check: 'PAYOUT_RECORDS',
  clears: true,
  fallback: critical('PAYOUT_MISMATCH'),
  kinds: {
    ITEM_DRIVER_NOT_PAYOUT_DRIVER: critical('PAYOUT_MISMATCH'),
    PROCESSED_WITHOUT_UTR: warning('PAYOUT_MISMATCH'),
  },
};

const SETTLEMENT_DATA: CheckSpec = {
  check: 'SETTLEMENT_DATA',
  // Recorded from Razorpay's settlement data; each one stays as it was seen.
  clears: false,
  fallback: critical('SETTLEMENT_MISMATCH'),
  kinds: {
    SETTLEMENT_UNKNOWN_PAYMENT: critical('SETTLEMENT_MISMATCH'),
    SETTLEMENT_AMOUNT_MISMATCH: critical('SETTLEMENT_MISMATCH'),
  },
};

const SETTLEMENT_OVERDUE: CheckSpec = {
  check: 'SETTLEMENT_OVERDUE',
  clears: true,
  fallback: warning('SETTLEMENT_MISMATCH'),
  kinds: { SETTLEMENT_OVERDUE: warning('SETTLEMENT_MISMATCH') },
};

const REFUND_HOLDS: CheckSpec = {
  check: 'REFUND_HOLDS',
  clears: true,
  fallback: warning('REFUND_MISMATCH'),
  kinds: { REFUND_ON_PAYABLE_EARNING: warning('REFUND_MISMATCH') },
};

const WALLET_LEDGER: CheckSpec = {
  check: 'WALLET_LEDGER',
  clears: true,
  fallback: critical('WALLET_MISMATCH'),
  kinds: {
    TOPUP_CREDIT_MISMATCH: critical('WALLET_MISMATCH'),
    TOPUP_CREDIT_WITHOUT_PAYMENT: critical('WALLET_MISMATCH'),
    LEDGER_BALANCE_CHAIN_BROKEN: critical('WALLET_MISMATCH'),
    CASH_FEE_DEBIT_MISMATCH: critical('WALLET_MISMATCH'),
  },
};

const STALE_PENDING: CheckSpec = {
  check: 'STALE_PENDING',
  clears: true,
  fallback: warning('STALE_PENDING'),
  kinds: {
    // Usually an abandoned checkout; the provider checks tell a paid one apart.
    STALE_PENDING_PAYMENT: info('STALE_PENDING'),
    STALE_PAYMENT_WITHOUT_ORDER: warning('STALE_PENDING'),
    STALE_COLLECTION_UNRECOVERABLE: warning('STALE_PENDING'),
  },
};

const UNPROCESSED_WEBHOOKS: CheckSpec = {
  check: 'UNPROCESSED_WEBHOOKS',
  clears: true,
  fallback: warning('STALE_PENDING'),
  kinds: {
    WEBHOOK_NOT_PROCESSED: warning('STALE_PENDING'),
    PAYOUT_WEBHOOK_NOT_PROCESSED: warning('STALE_PENDING'),
  },
};

const DUPLICATE_MONEY: CheckSpec = {
  check: 'DUPLICATE_MONEY',
  clears: true,
  fallback: critical('DUPLICATE_PROVIDER_EVENT'),
  kinds: {
    PROVIDER_PAYMENT_ON_TWO_RECORDS: critical('DUPLICATE_PROVIDER_EVENT'),
    BOOKING_PAID_TWICE: critical('DUPLICATE_PROVIDER_EVENT'),
    PROVIDER_EVENT_APPLIED_TWICE: critical('DUPLICATE_PROVIDER_EVENT'),
  },
};

const DUPLICATE_DELIVERIES: CheckSpec = {
  check: 'DUPLICATE_DELIVERIES',
  // Past deliveries, handled idempotently: kept as seen.
  clears: false,
  fallback: info('DUPLICATE_PROVIDER_EVENT'),
  kinds: { DUPLICATE_WEBHOOK_DELIVERY: info('DUPLICATE_PROVIDER_EVENT') },
};

const DISPUTES: CheckSpec = {
  check: 'DISPUTES',
  clears: true,
  fallback: critical('INTERNAL_PAID_PROVIDER_NOT_PAID'),
  kinds: {
    DISPUTED_EARNING_NOT_HELD: critical('INTERNAL_PAID_PROVIDER_NOT_PAID'),
    DISPUTE_LOST: critical('INTERNAL_PAID_PROVIDER_NOT_PAID'),
  },
};

/** Every database check with fixed kinds (the webhook problem checks name kinds by outcome). */
export const DATABASE_CHECKS: readonly CheckSpec[] = [
  EARNING_MISMATCHES,
  EARNING_SOURCES,
  PAYOUT_MISMATCHES,
  FAILED_PAYOUTS,
  PAYOUT_RECORDS,
  PAYABLE_WITHOUT_BANK_ACCOUNT,
  SETTLEMENT_DATA,
  SETTLEMENT_OVERDUE,
  REFUND_ANOMALIES,
  PAID_CANCELLED_BOOKINGS,
  REFUND_HOLDS,
  WALLET_BALANCES,
  CASH_FEE_MISMATCHES,
  WALLET_LEDGER,
  STALE_COLLECTIONS,
  STALE_PENDING,
  UNPROCESSED_WEBHOOKS,
  DUPLICATE_MONEY,
  LEDGER_PROVIDER_PAYMENTS,
  DUPLICATE_DELIVERIES,
  DISPUTES,
];

/** The kinds a check reports (report codes under their kind names). */
export function kindsOf(spec: CheckSpec): string[] {
  return Object.keys(spec.kinds);
}

/** One row of a Phase 7 check: what, on which record, and the amounts involved. */
interface CheckRow {
  readonly kind: string;
  readonly entity_type: string;
  readonly entity_id: string;
  readonly booking_id: string | null;
  readonly driver_id: string | null;
  readonly provider_ref: string | null;
  readonly internal_state: string | null;
  readonly provider_state: string | null;
  readonly internal_amount: bigint | null;
  readonly provider_amount: bigint | null;
  readonly detail: string | null;
  readonly refs: Prisma.JsonValue;
}

interface WebhookProblemRow {
  readonly id: string;
  readonly event_id: string;
  readonly event_type: string;
  readonly outcome: string | null;
  readonly processing_error: string | null;
  readonly booking_id: string | null;
  readonly driver_id: string | null;
  readonly record_id: string | null;
  readonly entity_id: string | null;
  readonly entity_status: string | null;
}

/**
 * The database checks of a reconciliation run (payment flow Phase 7). Read-only: each returns
 * what it found, and the run records it as findings for an admin. Nothing is corrected here.
 *
 * The existing integrity reports are reused as they are (their admin endpoints are unchanged),
 * with a larger row cap so a run can tell when a report was cut short; the checks added here
 * cover what those reports did not: an earning's sources, payout records, settlement data and
 * overdue settlements, refunds on payable earnings, the wallet ledger chain and top-up credits,
 * stale pending money, unprocessed and problem webhooks, money recorded twice, and disputes.
 */
@Injectable()
export class ReconciliationChecksService {
  private readonly logger = new Logger(ReconciliationChecksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: ReconciliationService,
    private readonly earnings: EarningsReconciliationService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Runs every database check, one after another, each capped at `limit` rows. A check that
   * fails is returned incomplete with `failed` set; the others still run.
   */
  async run(limit: number): Promise<(CheckResult & { readonly failed?: boolean })[]> {
    const checks: readonly [string, () => Promise<CheckResult>][] = [
      [
        EARNING_MISMATCHES.check,
        () => this.report(EARNING_MISMATCHES, (n) => this.earnings.findEarningMismatches(n), limit),
      ],
      [EARNING_SOURCES.check, () => this.earningSources(limit)],
      [
        PAYOUT_MISMATCHES.check,
        () => this.report(PAYOUT_MISMATCHES, (n) => this.earnings.findPayoutMismatches(n), limit),
      ],
      [
        FAILED_PAYOUTS.check,
        () => this.report(FAILED_PAYOUTS, (n) => this.earnings.findFailedPayouts(n), limit),
      ],
      [PAYOUT_RECORDS.check, () => this.payoutRecords(limit)],
      [PAYABLE_WITHOUT_BANK_ACCOUNT.check, () => this.payableWithoutBankAccount(limit)],
      [SETTLEMENT_DATA.check, () => this.settlementData(limit)],
      [SETTLEMENT_OVERDUE.check, () => this.settlementOverdue(limit)],
      [
        REFUND_ANOMALIES.check,
        () => this.report(REFUND_ANOMALIES, (n) => this.earnings.findRefundAnomalies(n), limit),
      ],
      [
        PAID_CANCELLED_BOOKINGS.check,
        () =>
          this.report(
            PAID_CANCELLED_BOOKINGS,
            (n) => this.earnings.findPaidCancelledBookings(n),
            limit,
          ),
      ],
      [REFUND_HOLDS.check, () => this.refundHolds(limit)],
      [WALLET_BALANCES.check, () => this.walletBalances(limit)],
      [
        CASH_FEE_MISMATCHES.check,
        () =>
          this.report(CASH_FEE_MISMATCHES, (n) => this.earnings.findCashFeeMismatches(n), limit),
      ],
      [WALLET_LEDGER.check, () => this.walletLedger(limit)],
      [
        STALE_COLLECTIONS.check,
        () => this.report(STALE_COLLECTIONS, (n) => this.earnings.findStaleCollections(n), limit),
      ],
      [STALE_PENDING.check, () => this.stalePending(limit)],
      [UNPROCESSED_WEBHOOKS.check, () => this.unprocessedWebhooks(limit)],
      [DUPLICATE_MONEY.check, () => this.duplicateMoney(limit)],
      [LEDGER_PROVIDER_PAYMENTS.check, () => this.ledgerProviderPayments(limit)],
      [DUPLICATE_DELIVERIES.check, () => this.duplicateDeliveries(limit)],
      ['WEBHOOK_PROBLEMS', () => this.webhookProblems(limit)],
      ['PAYOUT_WEBHOOK_PROBLEMS', () => this.payoutWebhookProblems(limit)],
      [DISPUTES.check, () => this.disputes(limit)],
    ];
    const results: (CheckResult & { readonly failed?: boolean })[] = [];
    for (const [name, check] of checks) {
      try {
        results.push(await check());
      } catch (error) {
        this.logger.error({ err: error, check: name }, 'Reconciliation check failed');
        results.push({
          check: name,
          source: 'DATABASE',
          kinds: [],
          findings: [],
          complete: false,
          clears: false,
          note: `failed: ${error instanceof Error ? error.name : 'unknown error'}`,
          failed: true,
        });
      }
    }
    return results;
  }

  /** An existing report, read with `limit + 1` rows so a cut-short report is known. */
  private async report(
    spec: CheckSpec,
    read: (limit: number) => Promise<readonly Finding[]>,
    limit: number,
  ): Promise<CheckResult> {
    const rows = await read(limit + 1);
    return {
      check: spec.check,
      source: 'DATABASE',
      kinds: kindsOf(spec),
      findings: rows.slice(0, limit).map((row) => reportFinding(spec, row)),
      complete: rows.length <= limit,
      clears: spec.clears,
    };
  }

  private result(spec: CheckSpec, rows: readonly CheckRow[], limit: number): CheckResult {
    return {
      check: spec.check,
      source: 'DATABASE',
      kinds: kindsOf(spec),
      findings: rows.slice(0, limit).map((row) => rowFinding(spec, row)),
      complete: rows.length <= limit,
      clears: spec.clears,
    };
  }

  private skipped(spec: CheckSpec, note: string): CheckResult {
    return {
      check: spec.check,
      source: 'DATABASE',
      kinds: kindsOf(spec),
      findings: [],
      complete: false,
      clears: spec.clears,
      note,
    };
  }

  /** An earning's sources are completed money of its own booking, collected by its driver. */
  private async earningSources(limit: number): Promise<CheckResult> {
    const rows = await this.prisma.$queryRaw<CheckRow[]>`
      WITH sources AS (
        SELECT e.id AS earning_id, e.booking_id, e.driver_id, e.collection_id
          FROM driver_earnings e
         WHERE e.collection_id IS NOT NULL
        UNION
        SELECT l.earning_id, e.booking_id, e.driver_id, l.collection_id
          FROM earning_collections l JOIN driver_earnings e ON e.id = l.earning_id
      )
      SELECT * FROM (
        -- A link row copies its collection: same booking, method and amount.
        SELECT 'SOURCE_LINK_NOT_COLLECTION'::text AS kind,
               'PAYMENT_COLLECTION'::text AS entity_type, l.collection_id::text AS entity_id,
               l.booking_id, e.driver_id, c.provider_payment_id AS provider_ref,
               c.status::text AS internal_state, NULL::text AS provider_state,
               l.amount_paise AS internal_amount, NULL::bigint AS provider_amount,
               'linked as ' || l.method || ' ' || l.amount_paise::text || ' paise of booking '
                 || l.booking_id::text || '; the collection is ' || c.method || ' '
                 || c.amount_paise::text || ' paise of booking ' || c.booking_id::text AS detail,
               jsonb_build_object('earningId', l.earning_id) AS refs
          FROM earning_collections l
          JOIN payment_collections c ON c.id = l.collection_id
          JOIN driver_earnings e ON e.id = l.earning_id
         WHERE l.method <> c.method OR l.amount_paise <> c.amount_paise
            OR l.booking_id <> c.booking_id OR l.booking_id <> e.booking_id
        UNION ALL
        -- Only completed money funds an earning.
        SELECT 'SOURCE_NOT_COMPLETED', 'PAYMENT_COLLECTION', c.id::text, s.booking_id,
               s.driver_id, c.provider_payment_id, c.status::text, NULL, c.amount_paise, NULL,
               'funds earning ' || s.earning_id::text || ' but is ' || c.status,
               jsonb_build_object('earningId', s.earning_id)
          FROM sources s JOIN payment_collections c ON c.id = s.collection_id
         WHERE c.status <> 'COMPLETED'
        UNION ALL
        SELECT 'SOURCE_NOT_COMPLETED', 'PAYMENT', p.id::text, e.booking_id, e.driver_id,
               p.razorpay_payment_id, p.status::text, NULL, p.amount_paise, NULL,
               'funds earning ' || e.id::text || ' but is ' || p.status::text,
               jsonb_build_object('earningId', e.id)
          FROM driver_earnings e JOIN payments p ON p.id = e.payment_id
         WHERE p.status::text NOT IN ('PAID', 'REFUND_PENDING', 'REFUNDED')
        UNION ALL
        -- The earning is the trip driver's, who collected its money.
        SELECT 'SOURCE_DRIVER_MISMATCH', 'DRIVER_EARNING', e.id::text, e.booking_id, e.driver_id,
               NULL, e.status::text, NULL, e.gross_amount_paise, NULL,
               'the trip was driven by driver ' || t.driver_id::text,
               jsonb_build_object('tripId', t.id)
          FROM driver_earnings e JOIN trips t ON t.id = e.trip_id
         WHERE t.driver_id <> e.driver_id
        UNION ALL
        SELECT 'SOURCE_DRIVER_MISMATCH', 'PAYMENT_COLLECTION', c.id::text, s.booking_id,
               s.driver_id, c.provider_payment_id, c.status::text, NULL, c.amount_paise, NULL,
               'collected by driver ' || c.collected_by_driver_id::text || ' for earning '
                 || s.earning_id::text,
               jsonb_build_object('earningId', s.earning_id)
          FROM sources s JOIN payment_collections c ON c.id = s.collection_id
         WHERE c.collected_by_driver_id <> s.driver_id
      ) f
      ORDER BY kind, entity_id
      LIMIT ${limit + 1}`;
    return this.result(EARNING_SOURCES, rows, limit);
  }

  private async payoutRecords(limit: number): Promise<CheckResult> {
    const rows = await this.prisma.$queryRaw<CheckRow[]>`
      SELECT * FROM (
        SELECT 'ITEM_DRIVER_NOT_PAYOUT_DRIVER'::text AS kind, 'PAYOUT_ITEM'::text AS entity_type,
               i.id::text AS entity_id, e.booking_id, p.driver_id,
               p.provider_payout_id AS provider_ref, i.status::text AS internal_state,
               NULL::text AS provider_state, i.amount_paise AS internal_amount,
               NULL::bigint AS provider_amount,
               'payout ' || p.id::text || ' to driver ' || p.driver_id::text
                 || ' carries an earning of driver ' || e.driver_id::text AS detail,
               jsonb_build_object('payoutId', p.id, 'earningId', e.id) AS refs
          FROM payout_items i
          JOIN driver_payouts p ON p.id = i.payout_id
          JOIN driver_earnings e ON e.id = i.earning_id
         WHERE e.driver_id <> p.driver_id
        UNION ALL
        SELECT 'PROCESSED_WITHOUT_UTR', 'DRIVER_PAYOUT', p.id::text, NULL, p.driver_id,
               p.provider_payout_id, p.status::text, p.provider_status, p.amount_paise, NULL,
               'processed ' || COALESCE(to_char(p.processed_at AT TIME ZONE 'UTC',
                                                'YYYY-MM-DD HH24:MI') || ' UTC', '(time unknown)')
                 || ' without a bank reference (UTR)',
               '{}'::jsonb
          FROM driver_payouts p
         WHERE p.status = 'PROCESSED'::payout_status AND p.utr IS NULL
      ) f
      ORDER BY kind, entity_id
      LIMIT ${limit + 1}`;
    return this.result(PAYOUT_RECORDS, rows, limit);
  }

  private async payableWithoutBankAccount(limit: number): Promise<CheckResult> {
    const rows = await this.earnings.findPayableWithoutBankAccount(limit + 1);
    const spec = PAYABLE_WITHOUT_BANK_ACCOUNT.kinds.PAYABLE_WITHOUT_BANK_ACCOUNT;
    return {
      check: PAYABLE_WITHOUT_BANK_ACCOUNT.check,
      source: 'DATABASE',
      kinds: kindsOf(PAYABLE_WITHOUT_BANK_ACCOUNT),
      clears: true,
      complete: rows.length <= limit,
      findings: rows.slice(0, limit).map((row) =>
        detected({
          ...(spec ?? PAYABLE_WITHOUT_BANK_ACCOUNT.fallback),
          kind: 'PAYABLE_WITHOUT_BANK_ACCOUNT',
          source: 'DATABASE',
          entityType: 'DRIVER',
          entityId: row.driverId,
          driverId: row.driverId,
          internalAmountPaise: row.payablePaise,
          detail: `${row.earningCount} payable earning(s), ${row.payablePaise} paise; no verified bank account to pay them to`,
        }),
      ),
    };
  }

  /** Settled payments Razorpay reported that matched none of ours, or another amount. */
  private async settlementData(limit: number): Promise<CheckResult> {
    const rows = await this.prisma.settlementFinding.findMany({
      orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    return {
      check: SETTLEMENT_DATA.check,
      source: 'DATABASE',
      kinds: kindsOf(SETTLEMENT_DATA),
      clears: SETTLEMENT_DATA.clears,
      complete: rows.length <= limit,
      findings: rows.slice(0, limit).map((row) => {
        const kind = `SETTLEMENT_${kindPart(row.kind, 'FINDING', 30)}`;
        const spec = SETTLEMENT_DATA.kinds[kind] ?? SETTLEMENT_DATA.fallback;
        return detected({
          ...spec,
          kind,
          source: 'DATABASE',
          entityType: 'SETTLEMENT_FINDING',
          entityId: row.id,
          bookingId: row.bookingId,
          providerRef: row.providerPaymentId,
          internalAmountPaise: row.expectedAmountPaise,
          providerAmountPaise: row.settledAmountPaise,
          detail:
            `${row.providerPaymentId} settled in ${row.providerSettlementId} (${row.source})` +
            (row.expectedAmountPaise === null
              ? ', matching none of our payments'
              : `, ours is ${row.expectedAmountPaise.toString()} paise`) +
            `; seen ${row.occurrences} time(s); never applied to an earning`,
          refs: {
            providerSettlementId: row.providerSettlementId,
            paymentId: row.paymentId,
            collectionId: row.collectionId,
          },
          identity: [row.providerPaymentId, row.providerSettlementId],
        });
      }),
    };
  }

  /** ONLINE money of an earning still not settled after SETTLEMENT_OVERDUE_DAYS. */
  private async settlementOverdue(limit: number): Promise<CheckResult> {
    if (this.config.settlements.provider === null) {
      return this.skipped(SETTLEMENT_OVERDUE, 'settlement tracking is off (SETTLEMENT_PROVIDER)');
    }
    const days = this.config.settlements.overdueDays;
    const rows = await this.prisma.$queryRaw<CheckRow[]>`
      SELECT 'SETTLEMENT_OVERDUE'::text AS kind, 'DRIVER_EARNING'::text AS entity_type,
             e.id::text AS entity_id, e.booking_id, e.driver_id, NULL::text AS provider_ref,
             e.status::text AS internal_state, NULL::text AS provider_state,
             e.online_collected_paise AS internal_amount, NULL::bigint AS provider_amount,
             'online money recorded ' || to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
               || ' UTC is not settled after ' || ${days}::int::text || ' days' AS detail,
             '{}'::jsonb AS refs
        FROM driver_earnings e
       WHERE e.status = 'AWAITING_SETTLEMENT'::earning_status
         AND e.created_at < now() - make_interval(days => ${days}::int)
       ORDER BY e.id
       LIMIT ${limit + 1}`;
    return this.result(SETTLEMENT_OVERDUE, rows, limit);
  }

  /** A refund was requested, yet the booking's earning can be paid out (released or never held). */
  private async refundHolds(limit: number): Promise<CheckResult> {
    const rows = await this.prisma.$queryRaw<CheckRow[]>`
      SELECT 'REFUND_ON_PAYABLE_EARNING'::text AS kind, 'DRIVER_EARNING'::text AS entity_type,
             e.id::text AS entity_id, e.booking_id, e.driver_id, NULL::text AS provider_ref,
             e.status::text AS internal_state, NULL::text AS provider_state,
             e.payout_amount_paise AS internal_amount, NULL::bigint AS provider_amount,
             count(r.id)::text || ' refund(s) of ' || sum(r.amount_paise)::bigint::text
               || ' paise requested; the earning is ' || e.status::text
               || ', so a payout would include it' AS detail,
             jsonb_build_object('refundId', min(r.id::text)) AS refs
        FROM driver_earnings e
        JOIN payment_refunds r ON r.booking_id = e.booking_id
       WHERE r.status IN ('PENDING', 'PROCESSING', 'COMPLETED')
         AND e.status IN ('AWAITING_SETTLEMENT'::earning_status, 'PAYABLE'::earning_status)
       GROUP BY e.id
       ORDER BY e.id
       LIMIT ${limit + 1}`;
    return this.result(REFUND_HOLDS, rows, limit);
  }

  private async walletBalances(limit: number): Promise<CheckResult> {
    const rows = await this.wallets.findWalletMismatches(limit + 1);
    return {
      check: WALLET_BALANCES.check,
      source: 'DATABASE',
      kinds: kindsOf(WALLET_BALANCES),
      clears: true,
      complete: rows.length <= limit,
      findings: rows.slice(0, limit).map((row) =>
        detected({
          ...WALLET_BALANCES.fallback,
          kind: 'WALLET_BALANCE_NOT_LEDGER',
          source: 'DATABASE',
          entityType: 'DRIVER_WALLET',
          entityId: row.walletId,
          driverId: row.driverId,
          internalAmountPaise: row.storedBalancePaise,
          detail: `stored balance ${row.storedBalancePaise} paise at version ${row.storedVersion}; the ledger gives ${row.ledgerBalancePaise} paise over ${row.ledgerEntryCount} entries (highest version ${row.highestEntryVersion})`,
        }),
      ),
    };
  }

  /** Top-up credits match their payments, each entry continues the last, cash fees are debits. */
  private async walletLedger(limit: number): Promise<CheckResult> {
    const rows = await this.prisma.$queryRaw<CheckRow[]>`
      SELECT * FROM (
        SELECT 'TOPUP_CREDIT_MISMATCH'::text AS kind, 'PAYMENT'::text AS entity_type,
               p.id::text AS entity_id, NULL::uuid AS booking_id, d.id AS driver_id,
               p.razorpay_payment_id AS provider_ref, p.status::text AS internal_state,
               NULL::text AS provider_state, p.amount_paise AS internal_amount,
               NULL::bigint AS provider_amount,
               CASE WHEN t.id IS NULL THEN 'a paid top-up without its TOPUP credit'
                    ELSE 'TOPUP entry ' || t.id::text || ' is a ' || t.direction::text || ' of '
                         || t.amount_paise::text || ' paise to the wallet of driver '
                         || w.driver_id::text END AS detail,
               jsonb_build_object('walletTransactionId', t.id) AS refs
          FROM payments p
          LEFT JOIN drivers d ON d.user_id = p.user_id
          LEFT JOIN driver_wallet_transactions t
            ON t.type = 'TOPUP'::wallet_entry_type AND t.provider = p.provider
           AND t.provider_payment_id = p.razorpay_payment_id
          LEFT JOIN driver_wallets w ON w.id = t.wallet_id
         WHERE p.purpose = 'DRIVER_WALLET_TOPUP' AND p.status = 'PAID'::payment_status
           AND (t.id IS NULL OR t.amount_paise <> p.amount_paise
                OR t.direction <> 'CREDIT'::ledger_direction OR w.driver_id IS DISTINCT FROM d.id)
        UNION ALL
        SELECT 'TOPUP_CREDIT_WITHOUT_PAYMENT', 'WALLET_TRANSACTION', t.id::text, NULL,
               w.driver_id, t.provider_payment_id, NULL, NULL, t.amount_paise, NULL,
               CASE WHEN p.id IS NULL THEN 'a TOPUP credit without a top-up payment'
                    ELSE 'a TOPUP credit for payment ' || p.id::text || ', which is '
                         || p.status::text END,
               jsonb_build_object('paymentId', p.id)
          FROM driver_wallet_transactions t
          JOIN driver_wallets w ON w.id = t.wallet_id
          LEFT JOIN payments p
            ON p.provider = t.provider AND p.razorpay_payment_id = t.provider_payment_id
           AND p.purpose = 'DRIVER_WALLET_TOPUP'
         WHERE t.type = 'TOPUP'::wallet_entry_type
           AND (p.id IS NULL OR p.status <> 'PAID'::payment_status)
        UNION ALL
        SELECT 'LEDGER_BALANCE_CHAIN_BROKEN', 'WALLET_TRANSACTION', x.id::text, NULL, x.driver_id,
               NULL, NULL, NULL, x.balance_after_paise, NULL,
               'entry ' || x.wallet_version::text || ' of wallet ' || x.wallet_id::text
                 || ' records a balance of ' || x.balance_after_paise::text
                 || ' paise; the previous entry and this amount give ' || x.expected::text,
               jsonb_build_object('walletId', x.wallet_id)
          FROM (SELECT t.id, t.wallet_id, w.driver_id, t.wallet_version, t.balance_after_paise,
                       COALESCE(lag(t.balance_after_paise)
                                  OVER (PARTITION BY t.wallet_id ORDER BY t.wallet_version), 0)
                         + CASE WHEN t.direction = 'CREDIT' THEN t.amount_paise
                                ELSE -t.amount_paise END AS expected
                  FROM driver_wallet_transactions t
                  JOIN driver_wallets w ON w.id = t.wallet_id
                 WHERE t.status = 'POSTED') x
         WHERE x.balance_after_paise <> x.expected
        UNION ALL
        SELECT 'CASH_FEE_DEBIT_MISMATCH', 'PAYMENT_COLLECTION', c.id::text, c.booking_id,
               c.collected_by_driver_id, NULL, c.status::text, NULL, c.platform_fee_paise, NULL,
               'CASH_RIDE_FEE entry ' || t.id::text || ' is a ' || t.direction::text
                 || ' of the wallet of driver ' || w.driver_id::text,
               jsonb_build_object('walletTransactionId', t.id)
          FROM payment_collections c
          JOIN driver_wallet_transactions t ON t.id = c.wallet_transaction_id
          JOIN driver_wallets w ON w.id = t.wallet_id
         WHERE t.direction <> 'DEBIT'::ledger_direction
            OR w.driver_id <> c.collected_by_driver_id
      ) f
      ORDER BY kind, entity_id
      LIMIT ${limit + 1}`;
    return this.result(WALLET_LEDGER, rows, limit);
  }

  /** Money still pending after RECONCILIATION_MIN_AGE_MINUTES. */
  private async stalePending(limit: number): Promise<CheckResult> {
    const minutes = this.config.reconciliation.minAgeMinutes;
    const rows = await this.prisma.$queryRaw<CheckRow[]>`
      SELECT * FROM (
        SELECT 'STALE_PENDING_PAYMENT'::text AS kind, 'PAYMENT'::text AS entity_type,
               p.id::text AS entity_id, p.booking_id, d.id AS driver_id,
               p.razorpay_order_id AS provider_ref, p.status::text AS internal_state,
               NULL::text AS provider_state, p.amount_paise AS internal_amount,
               NULL::bigint AS provider_amount,
               p.purpose || ' order pending since '
                 || to_char(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC'
                 AS detail,
               '{}'::jsonb AS refs
          FROM payments p LEFT JOIN drivers d ON d.user_id = p.user_id
         WHERE p.status = 'PENDING'::payment_status AND p.razorpay_order_id IS NOT NULL
           AND p.created_at < now() - make_interval(mins => ${minutes}::int)
        UNION ALL
        SELECT 'STALE_PAYMENT_WITHOUT_ORDER', 'PAYMENT', p.id::text, p.booking_id, d.id, NULL,
               p.status::text, NULL, p.amount_paise, NULL,
               p.purpose || ' without a Razorpay order since '
                 || to_char(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC',
               '{}'::jsonb
          FROM payments p LEFT JOIN drivers d ON d.user_id = p.user_id
         WHERE p.status = 'PENDING'::payment_status AND p.razorpay_order_id IS NULL
           AND p.created_at < now() - make_interval(mins => ${minutes}::int)
        UNION ALL
        -- Pending, with nothing at Razorpay the recovery job could re-read.
        SELECT 'STALE_COLLECTION_UNRECOVERABLE', 'PAYMENT_COLLECTION', c.id::text, c.booking_id,
               c.collected_by_driver_id, c.provider_reference_id, c.status::text, NULL,
               c.amount_paise, NULL,
               c.method || ' collection pending since '
                 || to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI')
                 || ' UTC with no provider QR or link to re-read',
               '{}'::jsonb
          FROM payment_collections c
         WHERE c.status = 'PENDING'
           AND (c.method <> 'ONLINE_QR' OR c.provider_product IS NULL
                OR c.provider_reference_id IS NULL)
           AND c.created_at < now() - make_interval(mins => ${minutes}::int)
      ) f
      ORDER BY kind, entity_id
      LIMIT ${limit + 1}`;
    return this.result(STALE_PENDING, rows, limit);
  }

  /** Signed webhooks still not processed after RECONCILIATION_MIN_AGE_MINUTES. */
  private async unprocessedWebhooks(limit: number): Promise<CheckResult> {
    const minutes = this.config.reconciliation.minAgeMinutes;
    const rows = await this.prisma.$queryRaw<CheckRow[]>`
      SELECT * FROM (
        SELECT 'WEBHOOK_NOT_PROCESSED'::text AS kind, 'PAYMENT_EVENT'::text AS entity_type,
               e.id::text AS entity_id, p.booking_id, NULL::uuid AS driver_id,
               e.event_id AS provider_ref, NULL::text AS internal_state,
               NULL::text AS provider_state, NULL::bigint AS internal_amount,
               NULL::bigint AS provider_amount,
               e.event_type || ' received '
                 || to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC, '
                 || e.attempts::text || ' attempt(s)'
                 || COALESCE(', last error ' || e.processing_error, '') AS detail,
               jsonb_build_object('paymentId', e.payment_id) AS refs
          FROM payment_events e LEFT JOIN payments p ON p.id = e.payment_id
         WHERE e.processed_at IS NULL
           AND e.created_at < now() - make_interval(mins => ${minutes}::int)
        UNION ALL
        SELECT 'PAYOUT_WEBHOOK_NOT_PROCESSED', 'PAYOUT_EVENT', e.id::text, NULL, o.driver_id,
               e.event_id, NULL, NULL, NULL, NULL,
               e.event_type || ' received '
                 || to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC, '
                 || e.attempts::text || ' attempt(s)'
                 || COALESCE(', last error ' || e.processing_error, ''),
               jsonb_build_object('payoutId', e.payout_id)
          FROM payout_events e LEFT JOIN driver_payouts o ON o.id = e.payout_id
         WHERE e.processed_at IS NULL
           AND e.created_at < now() - make_interval(mins => ${minutes}::int)
      ) f
      ORDER BY kind, entity_id
      LIMIT ${limit + 1}`;
    return this.result(UNPROCESSED_WEBHOOKS, rows, limit);
  }

  /** The same money recorded twice: one Razorpay payment on two records, a booking overpaid. */
  private async duplicateMoney(limit: number): Promise<CheckResult> {
    const rows = await this.prisma.$queryRaw<CheckRow[]>`
      SELECT * FROM (
        SELECT 'PROVIDER_PAYMENT_ON_TWO_RECORDS'::text AS kind,
               'PROVIDER_PAYMENT'::text AS entity_type, x.provider_payment_id AS entity_id,
               min(x.booking_id::text)::uuid AS booking_id, NULL::uuid AS driver_id,
               x.provider_payment_id AS provider_ref, NULL::text AS internal_state,
               NULL::text AS provider_state, NULL::bigint AS internal_amount,
               NULL::bigint AS provider_amount,
               'recorded on ' || string_agg(x.record, ', ' ORDER BY x.record) AS detail,
               '{}'::jsonb AS refs
          FROM (SELECT p.provider, p.razorpay_payment_id AS provider_payment_id, p.booking_id,
                       'payment ' || p.id::text AS record
                  FROM payments p WHERE p.razorpay_payment_id IS NOT NULL
                UNION ALL
                SELECT c.provider, c.provider_payment_id, c.booking_id,
                       'collection ' || c.id::text
                  FROM payment_collections c WHERE c.provider_payment_id IS NOT NULL) x
         GROUP BY x.provider, x.provider_payment_id
        HAVING count(*) > 1
        UNION ALL
        SELECT 'BOOKING_PAID_TWICE', 'BOOKING', b.id::text, b.id, NULL, NULL,
               b.payment_status::text, NULL, m.total, NULL,
               m.sources::text || ' payments recorded ' || m.total::text
                 || ' paise for a fare of ' || b.final_fare_minor::text || ' paise',
               '{}'::jsonb
          FROM bookings b
          JOIN (SELECT money.booking_id, sum(money.amount)::bigint AS total,
                       count(*) AS sources
                  FROM (SELECT c.booking_id, c.amount_paise AS amount
                          FROM payment_collections c WHERE c.status = 'COMPLETED'
                        UNION ALL
                        SELECT p.booking_id, p.amount_paise
                          FROM payments p
                         WHERE p.purpose = 'BOOKING'
                           AND p.status::text IN ('PAID', 'REFUND_PENDING', 'REFUNDED')) money
                 GROUP BY money.booking_id) m ON m.booking_id = b.id
         WHERE m.total > b.final_fare_minor
        UNION ALL
        SELECT 'PROVIDER_EVENT_APPLIED_TWICE', 'PROVIDER_PAYMENT', a.pay_id, NULL, NULL, a.pay_id,
               NULL, NULL, NULL, NULL,
               count(*)::text || ' webhook events applied it: '
                 || string_agg(a.event_id, ', ' ORDER BY a.event_id),
               '{}'::jsonb
          FROM (SELECT e.event_id, e.payload #>> '{payload,payment,entity,id}' AS pay_id
                  FROM payment_events e WHERE e.outcome = 'APPLIED') a
         WHERE a.pay_id IS NOT NULL
         GROUP BY a.pay_id
        HAVING count(*) > 1
      ) f
      ORDER BY kind, entity_id
      LIMIT ${limit + 1}`;
    return this.result(DUPLICATE_MONEY, rows, limit);
  }

  private async ledgerProviderPayments(limit: number): Promise<CheckResult> {
    const rows = await this.wallets.findDuplicateProviderPayments(limit + 1);
    return {
      check: LEDGER_PROVIDER_PAYMENTS.check,
      source: 'DATABASE',
      kinds: kindsOf(LEDGER_PROVIDER_PAYMENTS),
      clears: true,
      complete: rows.length <= limit,
      findings: rows.slice(0, limit).map((row) =>
        detected({
          ...LEDGER_PROVIDER_PAYMENTS.fallback,
          kind: 'DUPLICATE_LEDGER_PROVIDER_PAYMENT',
          source: 'DATABASE',
          entityType: 'PROVIDER_PAYMENT',
          entityId: row.providerPaymentId,
          providerRef: row.providerPaymentId,
          detail: `${row.occurrences} wallet ledger entries carry ${row.provider} payment ${row.providerPaymentId}`,
          identity: [row.provider, row.providerPaymentId],
        }),
      ),
    };
  }

  /**
   * The same event type for the same provider object delivered under different event ids, in
   * the look-back window. Each was handled idempotently; kept for the record.
   */
  private async duplicateDeliveries(limit: number): Promise<CheckResult> {
    const days = this.config.reconciliation.lookbackDays;
    const rows = await this.prisma.$queryRaw<CheckRow[]>`
      SELECT * FROM (
        SELECT 'DUPLICATE_WEBHOOK_DELIVERY'::text AS kind, 'WEBHOOK_ENTITY'::text AS entity_type,
               'RAZORPAY ' || x.event_type || ' ' || x.entity_id AS entity_id,
               NULL::uuid AS booking_id, NULL::uuid AS driver_id, x.entity_id AS provider_ref,
               NULL::text AS internal_state, NULL::text AS provider_state,
               NULL::bigint AS internal_amount, NULL::bigint AS provider_amount,
               count(*)::text || ' deliveries of ' || x.event_type || ' for ' || x.entity_id
                 || ': ' || string_agg(x.event_id || ' ' || COALESCE(x.outcome, 'not processed'),
                                       ', ' ORDER BY x.created_at, x.event_id) AS detail,
               '{}'::jsonb AS refs
          FROM (SELECT e.event_id, e.event_type, e.outcome, e.created_at,
                       CASE WHEN e.event_type LIKE 'payment.dispute.%'
                            THEN e.payload #>> '{payload,dispute,entity,id}'
                            ELSE e.payload #>> ARRAY['payload', split_part(e.event_type, '.', 1),
                                                     'entity', 'id'] END AS entity_id
                  FROM payment_events e
                 WHERE e.created_at >= now() - make_interval(days => ${days}::int)
                   AND e.event_type NOT LIKE '%.updated') x
         WHERE x.entity_id IS NOT NULL
         GROUP BY x.event_type, x.entity_id
        HAVING count(*) > 1
        UNION ALL
        SELECT 'DUPLICATE_WEBHOOK_DELIVERY', 'WEBHOOK_ENTITY',
               'RAZORPAYX ' || x.event_type || ' ' || x.entity_id, NULL, NULL, x.entity_id,
               NULL, NULL, NULL, NULL,
               count(*)::text || ' deliveries of ' || x.event_type || ' for ' || x.entity_id
                 || ': ' || string_agg(x.event_id || ' ' || COALESCE(x.outcome, 'not processed'),
                                       ', ' ORDER BY x.created_at, x.event_id),
               '{}'::jsonb
          FROM (SELECT e.event_id, e.event_type, e.outcome, e.created_at,
                       e.payload #>> ARRAY['payload', split_part(e.event_type, '.', 1),
                                           'entity', 'id'] AS entity_id
                  FROM payout_events e
                 WHERE e.created_at >= now() - make_interval(days => ${days}::int)
                   AND e.event_type NOT LIKE '%.updated') x
         WHERE x.entity_id IS NOT NULL
         GROUP BY x.event_type, x.entity_id
        HAVING count(*) > 1
      ) f
      ORDER BY entity_id
      LIMIT ${limit + 1}`;
    return this.result(DUPLICATE_DELIVERIES, rows, limit);
  }

  /** Razorpay webhooks processed with a problem, in the look-back window, by outcome. */
  private async webhookProblems(limit: number): Promise<CheckResult> {
    const days = this.config.reconciliation.lookbackDays;
    const rows = await this.prisma.$queryRaw<WebhookProblemRow[]>`
      SELECT x.*,
             COALESCE(
               (SELECT p.booking_id FROM payments p WHERE p.id = x.payment_id),
               (SELECT c.booking_id FROM payment_collections c
                 WHERE c.provider = 'RAZORPAY'
                   AND (c.provider_payment_id = x.pay_id OR c.provider_reference_id = x.entity_id)
                 LIMIT 1),
               (SELECT r.booking_id FROM payment_refunds r
                 WHERE r.provider_refund_id = x.entity_id LIMIT 1),
               (SELECT d.booking_id FROM payment_disputes d
                 WHERE d.provider_dispute_id = x.entity_id LIMIT 1)) AS booking_id,
             NULL::uuid AS driver_id,
             x.payment_id::text AS record_id
        FROM (SELECT e.id, e.event_id, e.event_type, e.outcome, e.processing_error,
                     e.payment_id, e.created_at,
                     e.payload #>> '{payload,payment,entity,id}' AS pay_id,
                     CASE WHEN e.event_type LIKE 'payment.dispute.%'
                          THEN e.payload #>> '{payload,dispute,entity,id}'
                          ELSE e.payload #>> ARRAY['payload', split_part(e.event_type, '.', 1),
                                                   'entity', 'id'] END AS entity_id,
                     CASE WHEN e.event_type LIKE 'payment.dispute.%'
                          THEN e.payload #>> '{payload,dispute,entity,status}'
                          ELSE e.payload #>> ARRAY['payload', split_part(e.event_type, '.', 1),
                                                   'entity', 'status'] END AS entity_status
                FROM payment_events e
               WHERE e.processed_at IS NOT NULL AND e.processing_error IS NOT NULL
                 AND e.created_at >= now() - make_interval(days => ${days}::int)) x
       ORDER BY x.created_at DESC, x.id DESC
       LIMIT ${limit + 1}`;
    const findings = rows
      .slice(0, limit)
      .map((row) => webhookFinding('RAZORPAY', row, 'WEBHOOK', 'PAYMENT_EVENT', 'paymentId'));
    return {
      check: 'WEBHOOK_PROBLEMS',
      source: 'DATABASE',
      kinds: [...new Set(findings.map((finding) => finding.kind))],
      findings,
      complete: rows.length <= limit,
      clears: false,
    };
  }

  /** RazorpayX webhooks processed with a problem, in the look-back window, by outcome. */
  private async payoutWebhookProblems(limit: number): Promise<CheckResult> {
    const days = this.config.reconciliation.lookbackDays;
    const rows = await this.prisma.$queryRaw<WebhookProblemRow[]>`
      SELECT e.id, e.event_id, e.event_type, e.outcome, e.processing_error,
             NULL::uuid AS booking_id, o.driver_id, e.payout_id::text AS record_id,
             e.payload #>> ARRAY['payload', split_part(e.event_type, '.', 1), 'entity', 'id']
               AS entity_id,
             e.payload #>> ARRAY['payload', split_part(e.event_type, '.', 1), 'entity', 'status']
               AS entity_status
        FROM payout_events e LEFT JOIN driver_payouts o ON o.id = e.payout_id
       WHERE e.processed_at IS NOT NULL AND e.processing_error IS NOT NULL
         AND e.created_at >= now() - make_interval(days => ${days}::int)
       ORDER BY e.created_at DESC, e.id DESC
       LIMIT ${limit + 1}`;
    const findings = rows
      .slice(0, limit)
      .map((row) => webhookFinding('RAZORPAYX', row, 'PAYOUT_WEBHOOK', 'PAYOUT_EVENT', 'payoutId'));
    return {
      check: 'PAYOUT_WEBHOOK_PROBLEMS',
      source: 'DATABASE',
      kinds: [...new Set(findings.map((finding) => finding.kind))],
      findings,
      complete: rows.length <= limit,
      clears: false,
    };
  }

  /** Disputed money that can still be paid out, and disputes the customer's bank won. */
  private async disputes(limit: number): Promise<CheckResult> {
    const rows = await this.prisma.$queryRaw<CheckRow[]>`
      SELECT * FROM (
        SELECT 'DISPUTED_EARNING_NOT_HELD'::text AS kind, 'DRIVER_EARNING'::text AS entity_type,
               e.id::text AS entity_id, e.booking_id, e.driver_id,
               d.provider_dispute_id AS provider_ref, e.status::text AS internal_state,
               d.status AS provider_state, e.payout_amount_paise AS internal_amount,
               d.amount_paise AS provider_amount,
               'dispute ' || d.provider_dispute_id || ' (' || d.status || ') on '
                 || d.provider_payment_id || '; the earning is ' || e.status::text
                 || ', not held' AS detail,
               jsonb_build_object('disputeId', d.id) AS refs
          FROM payment_disputes d JOIN driver_earnings e ON e.booking_id = d.booking_id
         WHERE d.status IN ('open', 'under_review')
           AND e.status IN ('AWAITING_SETTLEMENT'::earning_status, 'PAYABLE'::earning_status,
                            'IN_PAYOUT'::earning_status)
        UNION ALL
        SELECT 'DISPUTE_LOST', 'PAYMENT_DISPUTE', d.id::text, d.booking_id, e.driver_id,
               d.provider_dispute_id, b.payment_status::text, d.status, b.final_fare_minor,
               d.amount_paise,
               'the customer''s bank took back ' || d.amount_paise::text || ' paise of '
                 || d.provider_payment_id || '; the booking is '
                 || COALESCE(b.payment_status::text, 'not ours') || ', its earning '
                 || COALESCE(e.status::text, 'not recorded'),
               '{}'::jsonb
          FROM payment_disputes d
          LEFT JOIN bookings b ON b.id = d.booking_id
          LEFT JOIN driver_earnings e ON e.booking_id = d.booking_id
         WHERE d.status = 'lost'
      ) f
      ORDER BY kind, entity_id
      LIMIT ${limit + 1}`;
    return this.result(DISPUTES, rows, limit);
  }
}

/** An existing report's row: the most specific record it names is the finding's entity. */
function reportFinding(spec: CheckSpec, row: Finding): DetectedFinding {
  const kind = PROBLEM_ALIASES[row.problem] ?? row.problem;
  const classified = spec.kinds[kind] ?? spec.fallback;
  // A refund, trip or ledger entry named in the detail tells two conditions on one record apart.
  const related = firstUuid(row.detail);
  const [entityType, entityId] = row.earningId
    ? ['DRIVER_EARNING', row.earningId]
    : row.payoutId
      ? ['DRIVER_PAYOUT', row.payoutId]
      : row.collectionId
        ? ['PAYMENT_COLLECTION', row.collectionId]
        : row.bookingId
          ? ['BOOKING', row.bookingId]
          : [related ? 'RECORD' : null, related];
  return detected({
    ...classified,
    kind,
    source: 'DATABASE',
    entityType,
    entityId,
    bookingId: row.bookingId,
    internalAmountPaise: row.amountPaise,
    detail: row.detail,
    refs: {
      earningId: row.earningId,
      payoutId: row.payoutId,
      collectionId: row.collectionId,
      relatedId: related,
    },
    identity: [row.bookingId, row.earningId, row.payoutId, row.collectionId, related],
  });
}

function rowFinding(spec: CheckSpec, row: CheckRow): DetectedFinding {
  return detected({
    ...(spec.kinds[row.kind] ?? spec.fallback),
    kind: row.kind,
    source: 'DATABASE',
    entityType: row.entity_type,
    entityId: row.entity_id,
    bookingId: row.booking_id,
    driverId: row.driver_id,
    providerRef: row.provider_ref,
    internalState: row.internal_state,
    providerState: row.provider_state,
    internalAmountPaise: row.internal_amount,
    providerAmountPaise: row.provider_amount,
    detail: row.detail,
    refs: stringRefs(row.refs),
  });
}

function webhookFinding(
  source: 'RAZORPAY' | 'RAZORPAYX',
  row: WebhookProblemRow,
  prefix: 'WEBHOOK' | 'PAYOUT_WEBHOOK',
  entityType: 'PAYMENT_EVENT' | 'PAYOUT_EVENT',
  recordKey: 'paymentId' | 'payoutId',
): DetectedFinding {
  return detected({
    ...webhookOutcomeSpec(source, row.outcome, row.event_type),
    kind: `${prefix}_${kindPart(row.outcome, 'PROBLEM')}`,
    source: 'DATABASE',
    entityType,
    entityId: row.id,
    bookingId: row.booking_id,
    driverId: row.driver_id,
    providerRef: row.entity_id,
    providerState: row.entity_status,
    detail: `${row.event_type} ${row.event_id}: ${row.processing_error ?? row.outcome ?? 'problem'}`,
    refs: { eventId: row.event_id, [recordKey]: row.record_id },
    identity: [source, row.event_id],
  });
}

function stringRefs(value: Prisma.JsonValue): Record<string, string> {
  const refs: Record<string, string> = {};
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === 'string' && entry.length > 0) {
        refs[key] = entry;
      }
    }
  }
  return refs;
}

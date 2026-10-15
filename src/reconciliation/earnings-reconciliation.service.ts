import { Injectable } from '@nestjs/common';
import { paiseToNumber } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';

const ROW_LIMIT = 200;

export interface Finding {
  /** Stable machine-readable problem code. */
  readonly problem: string;
  readonly bookingId: string | null;
  readonly earningId: string | null;
  readonly payoutId: string | null;
  readonly collectionId: string | null;
  readonly amountPaise: number | null;
  readonly detail: string | null;
}

export interface DriverPayableSummary {
  readonly driverId: string;
  readonly payablePaise: number;
  readonly earningCount: number;
}

interface FindingRow {
  readonly problem: string;
  readonly booking_id: string | null;
  readonly earning_id: string | null;
  readonly payout_id: string | null;
  readonly collection_id: string | null;
  readonly amount_paise: bigint | null;
  readonly detail: string | null;
}

/**
 * Read-only integrity checks for collections, earnings and payouts. A healthy system returns
 * empty lists. Never fix a finding by editing rows: investigate, then use the audited admin
 * actions (hold, release, sync, compensating wallet entry).
 */
@Injectable()
export class EarningsReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  /** Earnings that disagree with their booking, their trip or their payout items. */
  async findEarningMismatches(): Promise<Finding[]> {
    const rows = await this.prisma.$queryRaw<FindingRow[]>`
      SELECT * FROM (
        SELECT 'GROSS_NOT_BOOKING_FARE' AS problem, e.booking_id, e.id AS earning_id,
               NULL::uuid AS payout_id, e.collection_id, e.gross_amount_paise AS amount_paise,
               'booking fare ' || b.final_fare_minor::text AS detail
        FROM driver_earnings e JOIN bookings b ON b.id = e.booking_id
        -- A booking paid drop by drop earns what its drops collected (an undelivered unpaid drop
        -- adds nothing, N5); every other earning is the booking's fare.
        WHERE e.gross_amount_paise <> CASE
                WHEN b.payment_model = 'QUOTE_PER_STOP'::booking_payment_model
                 AND b.payment_method = 'PAY_AT_DELIVERY'::booking_payment_method
                THEN (SELECT COALESCE(sum(c.amount_paise), 0) FROM payment_collections c
                       WHERE c.booking_id = b.id AND c.status = 'COMPLETED')
                ELSE b.final_fare_minor
              END
        UNION ALL
        SELECT 'COMPLETED_TRIP_WITHOUT_EARNING', t.booking_id, NULL, NULL, NULL, NULL, t.id::text
        FROM trips t LEFT JOIN driver_earnings e ON e.trip_id = t.id
        WHERE t.status = 'COMPLETED'::trip_status AND e.id IS NULL
        UNION ALL
        SELECT 'CASH_FEE_NOT_COLLECTION_FEE', e.booking_id, e.id, NULL, e.collection_id,
               e.platform_fee_paise, 'collection fee ' || COALESCE(c.platform_fee_paise::text, 'null')
        FROM driver_earnings e JOIN payment_collections c ON c.id = e.collection_id
        WHERE e.settlement = 'CASH'::earning_settlement
          AND c.platform_fee_paise IS DISTINCT FROM e.platform_fee_paise
        UNION ALL
        SELECT 'PAID_WITHOUT_PAID_ITEM', e.booking_id, e.id, NULL, NULL, e.net_amount_paise, NULL
        FROM driver_earnings e
        WHERE e.status = 'PAID'::earning_status
          AND NOT EXISTS (SELECT 1 FROM payout_items i
                          WHERE i.earning_id = e.id AND i.status = 'PAID'::payout_item_status)
        UNION ALL
        SELECT 'IN_PAYOUT_WITHOUT_ITEM', e.booking_id, e.id, NULL, NULL, e.net_amount_paise, NULL
        FROM driver_earnings e
        WHERE e.status = 'IN_PAYOUT'::earning_status
          AND NOT EXISTS (SELECT 1 FROM payout_items i
                          WHERE i.earning_id = e.id AND i.status = 'INCLUDED'::payout_item_status)
        UNION ALL
        SELECT 'ITEM_PAID_EARNING_NOT_PAID', e.booking_id, e.id, i.payout_id, NULL,
               i.amount_paise, e.status::text
        FROM payout_items i JOIN driver_earnings e ON e.id = i.earning_id
        WHERE i.status = 'PAID'::payout_item_status AND e.status <> 'PAID'::earning_status
        UNION ALL
        -- A recorded merchant settlement that was not applied to its earning (the settlement
        -- sync applies it on its next pass).
        SELECT 'SETTLED_BUT_AWAITING', e.booking_id, e.id, NULL, e.collection_id,
               e.net_amount_paise, s.provider_settlement_id
        FROM driver_earnings e
        JOIN payment_settlements s
          ON (e.payment_id IS NOT NULL AND s.payment_id = e.payment_id)
          OR (e.collection_id IS NOT NULL AND s.collection_id = e.collection_id)
        WHERE e.status = 'AWAITING_SETTLEMENT'::earning_status
        UNION ALL
        SELECT 'SETTLEMENT_AMOUNT_NOT_GROSS', e.booking_id, e.id, NULL, e.collection_id,
               s.amount_paise, 'earning gross ' || e.gross_amount_paise::text
        FROM driver_earnings e JOIN payment_settlements s ON s.id = e.payment_settlement_id
        WHERE s.amount_paise <> e.gross_amount_paise
      ) findings
      ORDER BY problem, booking_id
      LIMIT ${ROW_LIMIT}`;
    return rows.map(toFinding);
  }

  /** Payouts whose amount, items or provider state disagree, or that have been stuck too long. */
  async findPayoutMismatches(): Promise<Finding[]> {
    const rows = await this.prisma.$queryRaw<FindingRow[]>`
      SELECT * FROM (
        SELECT 'GROSS_NOT_SUM_OF_ITEMS' AS problem, NULL::uuid AS booking_id,
               NULL::uuid AS earning_id, p.id AS payout_id, NULL::uuid AS collection_id,
               p.gross_amount_paise AS amount_paise,
               'items ' || COALESCE(SUM(i.amount_paise), 0)::text AS detail
        FROM driver_payouts p LEFT JOIN payout_items i ON i.payout_id = p.id
        GROUP BY p.id, p.gross_amount_paise
        HAVING p.gross_amount_paise <> COALESCE(SUM(i.amount_paise), 0)
        UNION ALL
        SELECT 'PROCESSED_WITH_UNPAID_ITEMS', NULL, NULL, p.id, NULL, p.amount_paise, NULL
        FROM driver_payouts p
        WHERE p.status = 'PROCESSED'::payout_status
          AND EXISTS (SELECT 1 FROM payout_items i
                      WHERE i.payout_id = p.id AND i.status <> 'PAID'::payout_item_status)
        UNION ALL
        SELECT 'FAILED_WITH_LIVE_ITEMS', NULL, NULL, p.id, NULL, p.amount_paise, NULL
        FROM driver_payouts p
        WHERE p.status = 'FAILED'::payout_status
          AND EXISTS (SELECT 1 FROM payout_items i
                      WHERE i.payout_id = p.id
                        AND i.status IN ('INCLUDED'::payout_item_status, 'PAID'::payout_item_status))
        UNION ALL
        SELECT 'STUCK_SUBMITTING', NULL, NULL, p.id, NULL, p.amount_paise,
               'last attempt ' || COALESCE(p.last_attempt_at::text, 'never')
        FROM driver_payouts p
        WHERE p.status = 'SUBMITTING'::payout_status
          AND (p.last_attempt_at IS NULL OR p.last_attempt_at < now() - interval '10 minutes')
        UNION ALL
        SELECT 'STUCK_AT_PROVIDER', NULL, NULL, p.id, NULL, p.amount_paise,
               'provider status ' || COALESCE(p.provider_status, 'unknown')
        FROM driver_payouts p
        WHERE p.status = 'SUBMITTED'::payout_status
          AND p.updated_at < now() - interval '3 days'
        UNION ALL
        SELECT 'REVERSED', NULL, NULL, p.id, NULL, p.amount_paise, p.failure_reason
        FROM driver_payouts p
        WHERE p.status = 'REVERSED'::payout_status
      ) findings
      ORDER BY problem, payout_id
      LIMIT ${ROW_LIMIT}`;
    return rows.map(toFinding);
  }

  /** Failed payouts: their earnings went back to PAYABLE and ride the next batch. */
  async findFailedPayouts(): Promise<Finding[]> {
    const rows = await this.prisma.$queryRaw<FindingRow[]>`
      SELECT 'PAYOUT_FAILED' AS problem, NULL::uuid AS booking_id, NULL::uuid AS earning_id,
             p.id AS payout_id, NULL::uuid AS collection_id, p.amount_paise,
             p.failure_reason AS detail
      FROM driver_payouts p
      WHERE p.status = 'FAILED'::payout_status
      ORDER BY p.failed_at DESC
      LIMIT ${ROW_LIMIT}`;
    return rows.map(toFinding);
  }

  /** Cancelled bookings the customer paid for: refund review (D-22). */
  async findPaidCancelledBookings(): Promise<Finding[]> {
    const rows = await this.prisma.$queryRaw<FindingRow[]>`
      SELECT 'PAID_BOOKING_CANCELLED' AS problem, b.id AS booking_id, NULL::uuid AS earning_id,
             NULL::uuid AS payout_id, c.id AS collection_id,
             -- One row per completed collection: a booking paid drop by drop lists each drop paid.
             COALESCE(c.amount_paise, b.final_fare_minor) AS amount_paise,
             b.payment_method::text || COALESCE(' via ' || c.method, '') AS detail
      FROM bookings b
      LEFT JOIN payment_collections c
        ON c.booking_id = b.id AND c.status = 'COMPLETED'
      WHERE b.status = 'CANCELLED'::booking_status
        AND b.payment_status <> 'UNPAID'::booking_payment_status
      ORDER BY b.cancelled_at DESC
      LIMIT ${ROW_LIMIT}`;
    return rows.map(toFinding);
  }

  /** Cash collections whose fee does not match their CASH_RIDE_FEE ledger entry, and vice versa. */
  async findCashFeeMismatches(): Promise<Finding[]> {
    const rows = await this.prisma.$queryRaw<FindingRow[]>`
      SELECT * FROM (
        SELECT 'FEE_NOT_LEDGER_AMOUNT' AS problem, c.booking_id, NULL::uuid AS earning_id,
               NULL::uuid AS payout_id, c.id AS collection_id, c.platform_fee_paise AS amount_paise,
               'ledger ' || COALESCE(t.amount_paise::text, 'missing') AS detail
        FROM payment_collections c
        LEFT JOIN driver_wallet_transactions t ON t.id = c.wallet_transaction_id
        WHERE c.method = 'CASH' AND c.platform_fee_paise > 0
          AND (t.id IS NULL OR t.amount_paise <> c.platform_fee_paise
               OR t.type <> 'CASH_RIDE_FEE'::wallet_entry_type)
        UNION ALL
        SELECT 'LEDGER_FEE_WITHOUT_COLLECTION', t.reference_id::uuid, NULL, NULL, NULL,
               t.amount_paise, t.id::text
        FROM driver_wallet_transactions t
        LEFT JOIN payment_collections c ON c.wallet_transaction_id = t.id
        WHERE t.type = 'CASH_RIDE_FEE'::wallet_entry_type
          AND t.reference_type = 'BOOKING'
          AND t.reference_id ~ '^[0-9a-f-]{36}$'
          AND c.id IS NULL
      ) findings
      ORDER BY problem
      LIMIT ${ROW_LIMIT}`;
    return rows.map(toFinding);
  }

  /** QR collections still PENDING well after they expired (missed webhook): sync them. */
  async findStaleCollections(): Promise<Finding[]> {
    const rows = await this.prisma.$queryRaw<FindingRow[]>`
      SELECT 'PENDING_PAST_EXPIRY' AS problem, c.booking_id, NULL::uuid AS earning_id,
             NULL::uuid AS payout_id, c.id AS collection_id, c.amount_paise,
             c.provider_reference_id AS detail
      FROM payment_collections c
      WHERE c.status = 'PENDING'
        AND c.expires_at < now() - interval '10 minutes'
      ORDER BY c.expires_at
      LIMIT ${ROW_LIMIT}`;
    return rows.map(toFinding);
  }

  /** Drivers with payable earnings but no verified bank account: they can't be paid out. */
  async findPayableWithoutBankAccount(): Promise<DriverPayableSummary[]> {
    const rows = await this.prisma.$queryRaw<
      { driver_id: string; payable: bigint; earnings: bigint }[]
    >`
      SELECT e.driver_id, SUM(e.net_amount_paise)::bigint AS payable, COUNT(*)::bigint AS earnings
      FROM driver_earnings e
      WHERE e.status = 'PAYABLE'::earning_status
        AND NOT EXISTS (SELECT 1 FROM driver_bank_accounts a
                        WHERE a.driver_id = e.driver_id
                          AND a.status = 'VERIFIED'::bank_account_status)
      GROUP BY e.driver_id
      ORDER BY payable DESC
      LIMIT ${ROW_LIMIT}`;
    return rows.map((row) => ({
      driverId: row.driver_id,
      payablePaise: paiseToNumber(BigInt(row.payable)),
      earningCount: paiseToNumber(BigInt(row.earnings)),
    }));
  }

  async findUnprocessedPayoutWebhooks(): Promise<Finding[]> {
    const events = await this.prisma.payoutEvent.findMany({
      where: { processedAt: null },
      orderBy: { createdAt: 'asc' },
      take: ROW_LIMIT,
    });
    return events.map((event) => ({
      problem: 'PAYOUT_WEBHOOK_UNPROCESSED',
      bookingId: null,
      earningId: null,
      payoutId: event.payoutId,
      collectionId: null,
      amountPaise: null,
      detail: `${event.eventType} ${event.eventId}${event.processingError ? ` ${event.processingError}` : ''}`,
    }));
  }

  async findPayoutWebhookAnomalies(): Promise<Finding[]> {
    const events = await this.prisma.payoutEvent.findMany({
      where: { processedAt: { not: null }, processingError: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: ROW_LIMIT,
    });
    return events.map((event) => ({
      problem: event.outcome ?? 'PAYOUT_WEBHOOK_PROBLEM',
      bookingId: null,
      earningId: null,
      payoutId: event.payoutId,
      collectionId: null,
      amountPaise: null,
      detail: `${event.eventType} ${event.eventId} ${event.processingError ?? ''}`.trim(),
    }));
  }
}

function toFinding(row: FindingRow): Finding {
  return {
    problem: row.problem,
    bookingId: row.booking_id,
    earningId: row.earning_id,
    payoutId: row.payout_id,
    collectionId: row.collection_id,
    amountPaise: row.amount_paise === null ? null : paiseToNumber(BigInt(row.amount_paise)),
    detail: row.detail,
  };
}

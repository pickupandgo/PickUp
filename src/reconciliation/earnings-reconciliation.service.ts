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
        UNION ALL
        -- Payment flow Phase 5: an earning against its linked collections, by method.
        SELECT 'EARNING_NOT_SUM_OF_SOURCES', e.booking_id, e.id, NULL, NULL,
               e.gross_amount_paise,
               'sources ' || l.amount::text || ' paise, fees ' || l.fee::text
        FROM driver_earnings e
        JOIN (SELECT earning_id, sum(amount_paise) AS amount, sum(platform_fee_paise) AS fee,
                     coalesce(sum(amount_paise) FILTER (WHERE method = 'CASH'), 0) AS cash,
                     coalesce(sum(amount_paise) FILTER (WHERE method = 'ONLINE_QR'), 0) AS online,
                     coalesce(sum(platform_fee_paise) FILTER (WHERE method = 'CASH'), 0) AS cash_fee,
                     coalesce(sum(platform_fee_paise) FILTER (WHERE method = 'ONLINE_QR'), 0) AS online_fee
                FROM earning_collections GROUP BY earning_id) l ON l.earning_id = e.id
        WHERE l.amount <> e.gross_amount_paise
        UNION ALL
        SELECT 'FEE_NOT_SUM_OF_SOURCES', e.booking_id, e.id, NULL, NULL, e.platform_fee_paise,
               'source fees ' || l.fee::text
        FROM driver_earnings e
        JOIN (SELECT earning_id, sum(platform_fee_paise) AS fee FROM earning_collections
               GROUP BY earning_id) l ON l.earning_id = e.id
        WHERE l.fee <> e.platform_fee_paise
        UNION ALL
        SELECT 'CASH_NOT_CASH_SOURCES', e.booking_id, e.id, NULL, NULL, e.cash_collected_paise,
               'cash sources ' || l.cash::text || ', fees ' || l.cash_fee::text
        FROM driver_earnings e
        JOIN (SELECT earning_id,
                     coalesce(sum(amount_paise) FILTER (WHERE method = 'CASH'), 0) AS cash,
                     coalesce(sum(platform_fee_paise) FILTER (WHERE method = 'CASH'), 0) AS cash_fee
                FROM earning_collections GROUP BY earning_id) l ON l.earning_id = e.id
        WHERE l.cash <> e.cash_collected_paise OR l.cash_fee <> e.cash_fee_paise
        UNION ALL
        SELECT 'ONLINE_NOT_ONLINE_SOURCES', e.booking_id, e.id, NULL, NULL, e.online_collected_paise,
               'online sources ' || l.online::text || ', fees ' || l.online_fee::text
        FROM driver_earnings e
        JOIN (SELECT earning_id,
                     coalesce(sum(amount_paise) FILTER (WHERE method = 'ONLINE_QR'), 0) AS online,
                     coalesce(sum(platform_fee_paise) FILTER (WHERE method = 'ONLINE_QR'), 0) AS online_fee
                FROM earning_collections GROUP BY earning_id) l ON l.earning_id = e.id
        WHERE l.online <> e.online_collected_paise OR l.online_fee <> e.online_fee_paise
        UNION ALL
        -- The payout amount the approved model gives: nothing for cash, the online net otherwise.
        SELECT 'PAYOUT_AMOUNT_NOT_ONLINE_NET', e.booking_id, e.id, NULL, NULL,
               e.payout_amount_paise,
               'expected ' || (CASE e.settlement WHEN 'CASH' THEN 0
                                    WHEN 'ONLINE' THEN e.net_amount_paise
                                    ELSE e.online_collected_paise - e.online_fee_paise END)::text
        FROM driver_earnings e
        WHERE e.payout_amount_paise <> CASE e.settlement WHEN 'CASH' THEN 0
                                            WHEN 'ONLINE' THEN e.net_amount_paise
                                            ELSE e.online_collected_paise - e.online_fee_paise END
        UNION ALL
        -- Every online collection of an earning funded by several is settled, yet it still waits.
        SELECT 'SETTLED_BUT_AWAITING', e.booking_id, e.id, NULL, NULL, e.payout_amount_paise,
               'every online collection is settled'
        FROM driver_earnings e
        WHERE e.status = 'AWAITING_SETTLEMENT'::earning_status
          AND e.payment_id IS NULL AND e.collection_id IS NULL
          AND EXISTS (SELECT 1 FROM earning_collections l
                      WHERE l.earning_id = e.id AND l.method = 'ONLINE_QR')
          AND NOT EXISTS (SELECT 1 FROM earning_collections l
                          WHERE l.earning_id = e.id AND l.method = 'ONLINE_QR'
                            AND NOT EXISTS (SELECT 1 FROM payment_settlements s
                                            WHERE s.collection_id = l.collection_id))
        UNION ALL
        -- Payable, in a payout or paid while some online money is not settled yet.
        SELECT 'PAYABLE_BEFORE_SETTLEMENT', e.booking_id, e.id, NULL, l.collection_id,
               l.amount_paise, 'online collection not settled'
        FROM driver_earnings e
        JOIN earning_collections l ON l.earning_id = e.id AND l.method = 'ONLINE_QR'
        WHERE e.status IN ('PAYABLE'::earning_status, 'IN_PAYOUT'::earning_status,
                           'PAID'::earning_status)
          AND NOT EXISTS (SELECT 1 FROM payment_settlements s WHERE s.collection_id = l.collection_id)
        UNION ALL
        SELECT 'PAYABLE_BEFORE_SETTLEMENT', e.booking_id, e.id, NULL, e.collection_id,
               e.payout_amount_paise, 'no settlement link'
        FROM driver_earnings e
        WHERE e.settlement IN ('ONLINE'::earning_settlement, 'MIXED'::earning_settlement)
          AND e.status IN ('PAYABLE'::earning_status, 'IN_PAYOUT'::earning_status,
                           'PAID'::earning_status)
          AND (e.payment_id IS NOT NULL OR e.collection_id IS NOT NULL)
          AND e.payment_settlement_id IS NULL
        UNION ALL
        -- A collection funds at most one earning: one link row (primary key), and never the
        -- direct source of one earning while linked to another.
        SELECT 'COLLECTION_LINKED_TWICE', NULL, NULL, NULL, l.collection_id, NULL,
               count(*)::text || ' links'
        FROM earning_collections l GROUP BY l.collection_id HAVING count(*) > 1
        UNION ALL
        SELECT 'COLLECTION_FUNDS_SEVERAL_EARNINGS', e.booking_id, e.id, NULL, e.collection_id,
               NULL, 'also linked to earning ' || l.earning_id::text
        FROM driver_earnings e
        JOIN earning_collections l ON l.collection_id = e.collection_id AND l.earning_id <> e.id
        UNION ALL
        -- Money completed for a booking after its earning was recorded: in no earning.
        SELECT 'COLLECTION_NOT_IN_EARNING', c.booking_id, e.id, NULL, c.id, c.amount_paise,
               c.method || ' completed ' || COALESCE(c.completed_at::text, 'unknown')
        FROM payment_collections c
        JOIN driver_earnings e ON e.booking_id = c.booking_id
        WHERE c.status = 'COMPLETED'
          AND e.collection_id IS DISTINCT FROM c.id
          AND NOT EXISTS (SELECT 1 FROM earning_collections l WHERE l.collection_id = c.id)
          AND e.payment_id IS NULL
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
        UNION ALL
        -- Payment flow Phase 5: an item carries exactly its earning's payout amount.
        SELECT 'ITEM_NOT_EARNING_PAYOUT_AMOUNT', e.booking_id, e.id, i.payout_id, NULL,
               i.amount_paise, 'earning payout amount ' || e.payout_amount_paise::text
        FROM payout_items i JOIN driver_earnings e ON e.id = i.earning_id
        WHERE i.amount_paise <> e.payout_amount_paise
        UNION ALL
        SELECT 'EARNING_IN_SEVERAL_LIVE_ITEMS', NULL, i.earning_id, NULL, NULL, NULL,
               count(*)::text || ' live items'
        FROM payout_items i
        WHERE i.status IN ('INCLUDED'::payout_item_status, 'PAID'::payout_item_status)
        GROUP BY i.earning_id HAVING count(*) > 1
      ) findings
      ORDER BY problem, payout_id
      LIMIT ${ROW_LIMIT}`;
    return rows.map(toFinding);
  }

  /**
   * Settled payments from Razorpay's settlement data that matched none of our payments, or one of
   * ours with a different amount (payment flow Phase 5). Never applied to an earning.
   */
  async findSettlementAnomalies(): Promise<Finding[]> {
    const findings = await this.prisma.settlementFinding.findMany({
      orderBy: { lastSeenAt: 'desc' },
      take: ROW_LIMIT,
    });
    return findings.map((finding) => ({
      problem: `SETTLEMENT_${finding.kind}`,
      bookingId: finding.bookingId,
      earningId: null,
      payoutId: null,
      collectionId: finding.collectionId,
      amountPaise: paiseToNumber(finding.settledAmountPaise),
      detail:
        `${finding.providerPaymentId} in ${finding.providerSettlementId}` +
        (finding.expectedAmountPaise === null
          ? ''
          : `, expected ${finding.expectedAmountPaise.toString()} paise`) +
        `, seen ${finding.occurrences} time(s), last ${finding.lastSeenAt.toISOString()}`,
    }));
  }

  /** Failed payouts: their earnings are ON_HOLD (PAYOUT_FAILED) until an admin releases them. */
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
      SELECT e.driver_id, SUM(e.payout_amount_paise)::bigint AS payable, COUNT(*)::bigint AS earnings
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

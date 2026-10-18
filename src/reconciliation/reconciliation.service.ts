import { Injectable } from '@nestjs/common';
import { paiseToNumber } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';

const ROW_LIMIT = 200;

export interface WalletMismatch {
  readonly walletId: string;
  readonly driverId: string;
  readonly storedBalancePaise: number;
  readonly ledgerBalancePaise: number;
  readonly storedVersion: number;
  readonly ledgerEntryCount: number;
  readonly highestEntryVersion: number;
}

export interface WebhookEventSummary {
  readonly id: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly paymentId: string | null;
  readonly outcome: string | null;
  readonly attempts: number;
  readonly processingError: string | null;
  readonly createdAt: string;
  readonly processedAt: string | null;
}

export interface PendingPaymentSummary {
  readonly id: string;
  readonly userId: string;
  readonly purpose: string;
  readonly razorpayOrderId: string | null;
  readonly amountPaise: number;
  readonly createdAt: string;
}

export interface DuplicateProviderPayment {
  readonly provider: string;
  readonly providerPaymentId: string;
  readonly occurrences: number;
}

/**
 * Read-only integrity checks (PW 9.2, 10.1-10.3). A healthy system returns empty lists.
 * Never "fix" a mismatch by editing balances: investigate, then post a compensating entry.
 */
@Injectable()
export class ReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Wallets whose cached balance differs from the sum of their POSTED ledger entries, or whose
   * ledger is not a gap-free chain 1..version.
   */
  async findWalletMismatches(limit = ROW_LIMIT): Promise<WalletMismatch[]> {
    const rows = await this.prisma.$queryRaw<
      {
        wallet_id: string;
        driver_id: string;
        stored_balance: bigint;
        ledger_balance: bigint;
        stored_version: bigint;
        entry_count: bigint;
        highest_version: bigint;
      }[]
    >`
      SELECT w.id AS wallet_id,
             w.driver_id,
             w.balance_paise AS stored_balance,
             COALESCE(SUM(CASE WHEN t.direction = 'CREDIT' THEN t.amount_paise
                               ELSE -t.amount_paise END), 0)::bigint AS ledger_balance,
             w.version AS stored_version,
             COUNT(t.id)::bigint AS entry_count,
             COALESCE(MAX(t.wallet_version), 0)::bigint AS highest_version
      FROM driver_wallets w
      LEFT JOIN driver_wallet_transactions t
        ON t.wallet_id = w.id AND t.status = 'POSTED'
      GROUP BY w.id, w.driver_id, w.balance_paise, w.version
      HAVING w.balance_paise <> COALESCE(SUM(CASE WHEN t.direction = 'CREDIT' THEN t.amount_paise
                                                  ELSE -t.amount_paise END), 0)
          OR w.version <> COUNT(t.id)
          OR w.version <> COALESCE(MAX(t.wallet_version), 0)
      ORDER BY w.id
      LIMIT ${limit}`;

    return rows.map((row) => ({
      walletId: row.wallet_id,
      driverId: row.driver_id,
      storedBalancePaise: paiseToNumber(row.stored_balance),
      ledgerBalancePaise: paiseToNumber(row.ledger_balance),
      storedVersion: paiseToNumber(row.stored_version),
      ledgerEntryCount: paiseToNumber(row.entry_count),
      highestEntryVersion: paiseToNumber(row.highest_version),
    }));
  }

  /** PW 10.2: verified webhook events that have not been processed yet (oldest first). */
  async findUnprocessedWebhooks(): Promise<WebhookEventSummary[]> {
    const events = await this.prisma.paymentEvent.findMany({
      where: { processedAt: null },
      orderBy: { createdAt: 'asc' },
      take: ROW_LIMIT,
    });
    return events.map(toEventSummary);
  }

  /** Processed events that recorded a problem (amount mismatch, duplicate payment, ...). */
  async findWebhookAnomalies(): Promise<WebhookEventSummary[]> {
    const events = await this.prisma.paymentEvent.findMany({
      where: { processedAt: { not: null }, processingError: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: ROW_LIMIT,
    });
    return events.map(toEventSummary);
  }

  /** PW 10.3: payments still PENDING after `olderThanMinutes` (oldest first). */
  async findPendingPayments(olderThanMinutes: number): Promise<PendingPaymentSummary[]> {
    // The cutoff uses the database clock, the same clock that stamped created_at, so app-server
    // clock drift can never hide or invent pending payments.
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        user_id: string;
        purpose: string;
        razorpay_order_id: string | null;
        amount_paise: bigint;
        created_at: Date;
      }[]
    >`
      SELECT id, user_id, purpose, razorpay_order_id, amount_paise, created_at
      FROM payments
      WHERE status = 'PENDING'::payment_status
        AND created_at < now() - make_interval(mins => ${olderThanMinutes}::int)
      ORDER BY created_at ASC
      LIMIT ${ROW_LIMIT}`;
    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      purpose: row.purpose,
      razorpayOrderId: row.razorpay_order_id,
      amountPaise: paiseToNumber(BigInt(row.amount_paise)),
      createdAt: row.created_at.toISOString(),
    }));
  }

  /** PW 9.2: provider payment ids that appear on more than one ledger entry. */
  async findDuplicateProviderPayments(limit = ROW_LIMIT): Promise<DuplicateProviderPayment[]> {
    const rows = await this.prisma.$queryRaw<
      { provider: string; provider_payment_id: string; occurrences: bigint }[]
    >`
      SELECT provider, provider_payment_id, COUNT(*)::bigint AS occurrences
      FROM driver_wallet_transactions
      WHERE provider_payment_id IS NOT NULL
      GROUP BY provider, provider_payment_id
      HAVING COUNT(*) > 1
      ORDER BY provider_payment_id
      LIMIT ${limit}`;
    return rows.map((row) => ({
      provider: row.provider,
      providerPaymentId: row.provider_payment_id,
      occurrences: paiseToNumber(row.occurrences),
    }));
  }
}

function toEventSummary(event: {
  id: string;
  eventId: string;
  eventType: string;
  paymentId: string | null;
  outcome: string | null;
  attempts: number;
  processingError: string | null;
  createdAt: Date;
  processedAt: Date | null;
}): WebhookEventSummary {
  return {
    id: event.id,
    eventId: event.eventId,
    eventType: event.eventType,
    paymentId: event.paymentId,
    outcome: event.outcome,
    attempts: event.attempts,
    processingError: event.processingError,
    createdAt: event.createdAt.toISOString(),
    processedAt: event.processedAt ? event.processedAt.toISOString() : null,
  };
}

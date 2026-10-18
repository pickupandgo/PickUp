import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CollectionLinkGateway,
  type CollectionLinkPayment,
  type CollectionProduct,
} from '../collections/collection-link.gateway';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { PayoutGateway, type ProviderPayout } from '../payouts/payout.gateway';
import { mapProviderStatus } from '../payouts/payout-status.service';
import { PrismaService } from '../prisma/prisma.service';
import { RazorpayApiError, RazorpayUnavailableError } from '../razorpay/razorpay.errors';
import { RazorpayGateway } from '../razorpay/razorpay.gateway';
import { findOurRefund, type ProviderRefund, RefundGateway } from '../refunds/refund.gateway';
import { refundStatusForProvider } from '../refunds/refund-policy';
import {
  type CheckResult,
  critical,
  type DetectedFinding,
  detected,
  type FindingInput,
  warning,
} from './finding-types';

export interface ProviderScope {
  /** Only records created at or after this instant (a scoped run); null: the look-back window. */
  readonly since: Date | null;
  /** Records read per check. */
  readonly limit: number;
}

/** Provider statuses that mean the money was captured (and possibly refunded since). */
const CAPTURED_STATUSES: ReadonlySet<string> = new Set(['captured', 'refunded']);
/** After this many "unavailable" answers in a row, the run stops reading the provider. */
const OUTAGE_AFTER = 3;

type Read<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: 'REJECTED'; readonly detail: string }
  | { readonly ok: false; readonly reason: 'UNAVAILABLE' | 'STOPPED' };

/** One run's provider reads: counts them and stops after an outage. */
class ProviderReads {
  calls = 0;
  unavailable = 0;
  rejected = 0;
  private consecutiveUnavailable = 0;

  get stopped(): boolean {
    return this.consecutiveUnavailable >= OUTAGE_AFTER;
  }

  async read<T>(call: () => Promise<T>): Promise<Read<T>> {
    if (this.stopped) {
      return { ok: false, reason: 'STOPPED' };
    }
    this.calls += 1;
    try {
      const value = await call();
      this.consecutiveUnavailable = 0;
      return { ok: true, value };
    } catch (error) {
      if (error instanceof RazorpayApiError) {
        this.consecutiveUnavailable = 0;
        this.rejected += 1;
        return {
          ok: false,
          reason: 'REJECTED',
          detail: `HTTP ${error.httpStatus}${error.errorCode ? ` ${error.errorCode}` : ''}`,
        };
      }
      if (error instanceof RazorpayUnavailableError) {
        this.consecutiveUnavailable += 1;
        this.unavailable += 1;
        return { ok: false, reason: 'UNAVAILABLE' };
      }
      throw error;
    }
  }
}

/** Collects one check's findings and whether every record was read. */
class CheckProgress {
  readonly findings: DetectedFinding[] = [];
  private unread = 0;

  constructor(
    readonly check: string,
    private readonly truncated: boolean,
  ) {}

  add(finding: DetectedFinding): void {
    this.findings.push(finding);
  }

  /** Handles a failed read: a refusal is a finding, an outage leaves the record unread. */
  failed(
    read: Exclude<Read<unknown>, { ok: true }>,
    record: { entityType: string; entityId: string; bookingId?: string | null },
    operation: string,
    extra: Partial<FindingInput> = {},
  ): void {
    if (read.reason !== 'REJECTED') {
      this.unread += 1;
      return;
    }
    this.add(
      providerFinding({
        ...warning('PROVIDER_EVENT_ANOMALY'),
        kind: 'PROVIDER_LOOKUP_FAILED',
        ...record,
        ...extra,
        detail: `${operation} was refused by the provider (${read.detail}); its state could not be compared`,
        identity: [record.entityType, record.entityId, operation],
      }),
    );
  }

  result(kinds: readonly string[]): CheckResult {
    const complete = !this.truncated && this.unread === 0;
    return {
      check: this.check,
      source: 'PROVIDER',
      kinds,
      findings: this.findings,
      complete,
      // A provider's answer can change without our records changing: never cleared.
      clears: false,
      ...(complete
        ? {}
        : {
            note: [
              this.truncated ? 'more records than the per-run limit' : null,
              this.unread > 0 ? `${this.unread} record(s) not read (provider unavailable)` : null,
            ]
              .filter((part) => part !== null)
              .join('; '),
          }),
    };
  }
}

interface PendingPaymentRow {
  readonly id: string;
  readonly purpose: string;
  readonly booking_id: string | null;
  readonly driver_id: string | null;
  readonly razorpay_order_id: string;
  readonly amount_paise: bigint;
}

interface CollectionRow {
  readonly id: string;
  readonly booking_id: string;
  readonly driver_id: string;
  readonly provider_product: CollectionProduct;
  readonly provider_reference_id: string;
  readonly provider_payment_id: string | null;
  readonly amount_paise: bigint;
  readonly failure_reason: string | null;
  readonly refunds_live: bigint;
  readonly refunds_accepted: bigint;
}

interface PaidPaymentRow {
  readonly id: string;
  readonly purpose: string;
  readonly booking_id: string | null;
  readonly driver_id: string | null;
  readonly razorpay_payment_id: string;
  readonly amount_paise: bigint;
  readonly status: string;
  readonly refunds_live: bigint;
  readonly refunds_accepted: bigint;
}

interface PayoutRow {
  readonly id: string;
  readonly driver_id: string;
  readonly status: string;
  readonly provider_payout_id: string | null;
  readonly amount_paise: bigint;
}

interface RefundRow {
  readonly id: string;
  readonly booking_id: string;
  readonly status: string;
  readonly amount_paise: bigint;
  readonly provider_payment_id: string;
  readonly provider_refund_id: string | null;
}

/**
 * Read-only provider checks of a reconciliation run (payment flow Phase 7): what Razorpay and
 * RazorpayX report, compared with what we recorded. Nothing is applied: a payment Razorpay
 * captured that we hold as pending is reported (the admin payment or collection sync applies it,
 * through the same finalizers as the webhook), and so is money we hold as paid that Razorpay
 * reports not captured or refunded. Live refunds are never created here.
 *
 * Bounded: records of the look-back window (RECONCILIATION_LOOKBACK_DAYS, or the run's `since`),
 * at most `limit` per check, and no more reads once the provider is unavailable three times in a
 * row (the checks are then reported incomplete).
 */
@Injectable()
export class ProviderReconciliationService {
  private readonly logger = new Logger(ProviderReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly razorpay: RazorpayGateway,
    private readonly links: CollectionLinkGateway,
    private readonly payouts: PayoutGateway,
    private readonly refunds: RefundGateway,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  get enabled(): boolean {
    return this.config.reconciliation.providerChecks;
  }

  async run(scope: ProviderScope): Promise<(CheckResult & { readonly failed?: boolean })[]> {
    if (!this.enabled) {
      return [];
    }
    const reads = new ProviderReads();
    const checks: [string, () => Promise<CheckResult>][] = [
      ['PROVIDER_PENDING_PAYMENTS', () => this.pendingPayments(scope, reads)],
      ['PROVIDER_CLOSED_COLLECTIONS', () => this.closedCollections(scope, reads)],
      ['PROVIDER_PAID_COLLECTIONS', () => this.paidCollections(scope, reads)],
      ['PROVIDER_PAID_PAYMENTS', () => this.paidPayments(scope, reads)],
    ];
    if (this.payouts.enabled) {
      checks.push(['PROVIDER_PAYOUTS', () => this.payoutStates(scope, reads)]);
    }
    if (this.refunds.enabled) {
      checks.push(['PROVIDER_REFUNDS', () => this.refundStates(scope, reads)]);
    }
    const results: (CheckResult & { readonly failed?: boolean })[] = [];
    for (const [name, check] of checks) {
      try {
        results.push(await check());
      } catch (error) {
        this.logger.error({ err: error, check: name }, 'Provider reconciliation check failed');
        results.push({
          check: name,
          source: 'PROVIDER',
          kinds: [],
          findings: [],
          complete: false,
          clears: false,
          note: `failed: ${error instanceof Error ? error.name : 'unknown error'}`,
          failed: true,
        });
      }
    }
    this.logger.log(
      { calls: reads.calls, unavailable: reads.unavailable, rejected: reads.rejected },
      'Provider reconciliation reads',
    );
    return results;
  }

  /** Payments we hold as PENDING: has Razorpay captured (or authorized) money for the order? */
  private async pendingPayments(scope: ProviderScope, reads: ProviderReads): Promise<CheckResult> {
    const rows = await this.prisma.$queryRaw<PendingPaymentRow[]>`
      SELECT p.id, p.purpose, p.booking_id, d.id AS driver_id, p.razorpay_order_id, p.amount_paise
        FROM payments p LEFT JOIN drivers d ON d.user_id = p.user_id
       WHERE p.status = 'PENDING'::payment_status AND p.razorpay_order_id IS NOT NULL
         AND p.created_at < now() - make_interval(mins => ${this.config.reconciliation.minAgeMinutes}::int)
         AND p.created_at >= now() - make_interval(days => ${this.config.reconciliation.lookbackDays}::int)
         AND (${iso(scope.since)}::timestamptz IS NULL OR p.created_at >= ${iso(scope.since)}::timestamptz)
       ORDER BY p.created_at, p.id
       LIMIT ${scope.limit + 1}`;
    const progress = new CheckProgress('PROVIDER_PENDING_PAYMENTS', rows.length > scope.limit);
    for (const row of rows.slice(0, scope.limit)) {
      const record = { entityType: 'PAYMENT', entityId: row.id, bookingId: row.booking_id };
      const read = await reads.read(() => this.razorpay.fetchOrderPayments(row.razorpay_order_id));
      if (!read.ok) {
        progress.failed(read, record, 'GET /v1/orders/:id/payments', {
          driverId: row.driver_id,
          providerRef: row.razorpay_order_id,
        });
        continue;
      }
      const captured = read.value.filter((payment) => payment.status === 'captured');
      const authorized = read.value.filter((payment) => payment.status === 'authorized');
      const sync = `POST /v1/admin/payments/${row.id}/sync applies it`;
      for (const payment of captured) {
        progress.add(
          providerFinding({
            ...critical('PROVIDER_PAID_INTERNAL_PENDING'),
            kind: 'PROVIDER_PAID_PAYMENT_PENDING',
            ...record,
            driverId: row.driver_id,
            providerRef: payment.id,
            internalState: 'PENDING',
            providerState: payment.status,
            internalAmountPaise: row.amount_paise,
            providerAmountPaise: payment.amount,
            detail: `Razorpay captured ${payment.id} on ${row.purpose} order ${row.razorpay_order_id}, which is still PENDING here (no webhook or verification applied it); ${sync}`,
            refs: { orderId: row.razorpay_order_id },
          }),
        );
      }
      if (captured.length > 1) {
        progress.add(
          providerFinding({
            ...critical('DUPLICATE_PROVIDER_EVENT'),
            kind: 'PROVIDER_ORDER_PAID_TWICE',
            ...record,
            driverId: row.driver_id,
            providerRef: row.razorpay_order_id,
            internalAmountPaise: row.amount_paise,
            detail: `${captured.length} captured payments on one order: ${captured.map((payment) => payment.id).join(', ')}; at most one can be applied`,
          }),
        );
      }
      if (captured.length === 0 && authorized.length > 0) {
        const [payment] = authorized;
        progress.add(
          providerFinding({
            ...warning('PROVIDER_PAID_INTERNAL_PENDING'),
            kind: 'PROVIDER_AUTHORIZED_PAYMENT_PENDING',
            ...record,
            driverId: row.driver_id,
            providerRef: payment?.id ?? row.razorpay_order_id,
            internalState: 'PENDING',
            providerState: 'authorized',
            internalAmountPaise: row.amount_paise,
            providerAmountPaise: payment?.amount ?? null,
            detail: `Razorpay holds an authorized, uncaptured payment on order ${row.razorpay_order_id}; ${sync} (captures it) or Razorpay voids it on its own`,
          }),
        );
      }
    }
    return progress.result([
      'PROVIDER_PAID_PAYMENT_PENDING',
      'PROVIDER_ORDER_PAID_TWICE',
      'PROVIDER_AUTHORIZED_PAYMENT_PENDING',
      'PROVIDER_LOOKUP_FAILED',
    ]);
  }

  /** Online collections we closed (FAILED): did money arrive on the QR or link anyway? */
  private async closedCollections(
    scope: ProviderScope,
    reads: ProviderReads,
  ): Promise<CheckResult> {
    const rows = await this.prisma.$queryRaw<CollectionRow[]>`
      SELECT c.id, c.booking_id, c.collected_by_driver_id AS driver_id, c.provider_product,
             c.provider_reference_id, c.provider_payment_id, c.amount_paise, c.failure_reason,
             0::bigint AS refunds_live, 0::bigint AS refunds_accepted
        FROM payment_collections c
       WHERE c.method = 'ONLINE_QR' AND c.status = 'FAILED'
         AND c.provider_product IS NOT NULL AND c.provider_reference_id IS NOT NULL
         AND c.updated_at >= now() - make_interval(days => ${this.config.reconciliation.lookbackDays}::int)
         AND (${iso(scope.since)}::timestamptz IS NULL OR c.created_at >= ${iso(scope.since)}::timestamptz)
       ORDER BY c.updated_at, c.id
       LIMIT ${scope.limit + 1}`;
    const progress = new CheckProgress('PROVIDER_CLOSED_COLLECTIONS', rows.length > scope.limit);
    for (const row of rows.slice(0, scope.limit)) {
      const record = {
        entityType: 'PAYMENT_COLLECTION',
        entityId: row.id,
        bookingId: row.booking_id,
      };
      const read = await reads.read(() =>
        this.links.fetch(row.provider_product, row.provider_reference_id),
      );
      if (!read.ok) {
        progress.failed(read, record, `fetch ${row.provider_product}`, {
          driverId: row.driver_id,
          providerRef: row.provider_reference_id,
        });
        continue;
      }
      for (const payment of read.value.payments.filter((p) => p.status === 'captured')) {
        progress.add(
          providerFinding({
            ...critical('PROVIDER_PAID_INTERNAL_PENDING'),
            kind: 'PROVIDER_PAID_COLLECTION_CLOSED',
            ...record,
            driverId: row.driver_id,
            providerRef: payment.id,
            internalState: 'FAILED',
            providerState: read.value.status,
            internalAmountPaise: row.amount_paise,
            providerAmountPaise: payment.amount,
            detail: `Razorpay captured ${payment.id} (${payment.amount} paise) on ${row.provider_reference_id}, which was closed here as FAILED (${row.failure_reason ?? 'no reason'}); never applied: refund review`,
            refs: { providerReferenceId: row.provider_reference_id },
          }),
        );
      }
    }
    return progress.result(['PROVIDER_PAID_COLLECTION_CLOSED', 'PROVIDER_LOOKUP_FAILED']);
  }

  /** Online collections we hold as COMPLETED: still captured, nothing more paid or refunded? */
  private async paidCollections(scope: ProviderScope, reads: ProviderReads): Promise<CheckResult> {
    const days = this.config.reconciliation.lookbackDays;
    const rows = await this.prisma.$queryRaw<CollectionRow[]>`
      SELECT c.id, c.booking_id, c.collected_by_driver_id AS driver_id, c.provider_product,
             c.provider_reference_id, c.provider_payment_id, c.amount_paise, c.failure_reason,
             COALESCE((SELECT sum(r.amount_paise) FROM payment_refunds r
                        WHERE r.source_collection_id = c.id AND r.kind = 'PROVIDER'
                          AND r.status IN ('PENDING', 'PROCESSING', 'COMPLETED')), 0)::bigint
               AS refunds_live,
             COALESCE((SELECT sum(r.amount_paise) FROM payment_refunds r
                        WHERE r.source_collection_id = c.id AND r.kind = 'PROVIDER'
                          AND r.status IN ('PROCESSING', 'COMPLETED')), 0)::bigint
               AS refunds_accepted
        FROM payment_collections c
       WHERE c.method = 'ONLINE_QR' AND c.status = 'COMPLETED'
         AND c.provider_product IS NOT NULL AND c.provider_reference_id IS NOT NULL
         AND c.provider_payment_id IS NOT NULL
         AND (c.completed_at >= now() - make_interval(days => ${days}::int)
              OR EXISTS (SELECT 1 FROM payment_refunds r
                          WHERE r.source_collection_id = c.id
                            AND r.updated_at >= now() - make_interval(days => ${days}::int)))
         AND (${iso(scope.since)}::timestamptz IS NULL OR c.created_at >= ${iso(scope.since)}::timestamptz)
       ORDER BY c.completed_at, c.id
       LIMIT ${scope.limit + 1}`;
    const progress = new CheckProgress('PROVIDER_PAID_COLLECTIONS', rows.length > scope.limit);
    for (const row of rows.slice(0, scope.limit)) {
      const paymentId = row.provider_payment_id ?? '';
      const record = {
        entityType: 'PAYMENT_COLLECTION',
        entityId: row.id,
        bookingId: row.booking_id,
      };
      const read = await reads.read(() =>
        this.links.fetch(row.provider_product, row.provider_reference_id),
      );
      if (!read.ok) {
        progress.failed(read, record, `fetch ${row.provider_product}`, {
          driverId: row.driver_id,
          providerRef: row.provider_reference_id,
        });
        continue;
      }
      const ours = read.value.payments.find((payment) => payment.id === paymentId);
      this.checkCaptured(progress, record, row.driver_id, paymentId, row.amount_paise, ours);
      for (const extra of read.value.payments.filter(
        (payment) => payment.status === 'captured' && payment.id !== paymentId,
      )) {
        progress.add(
          providerFinding({
            ...critical('PROVIDER_PAID_INTERNAL_PENDING'),
            kind: 'PROVIDER_EXTRA_COLLECTION_PAYMENT',
            ...record,
            driverId: row.driver_id,
            providerRef: extra.id,
            internalState: 'COMPLETED',
            providerState: extra.status,
            internalAmountPaise: row.amount_paise,
            providerAmountPaise: extra.amount,
            detail: `a second captured payment ${extra.id} (${extra.amount} paise) on ${row.provider_reference_id}; the collection applied ${paymentId}: refund review`,
          }),
        );
      }
      await this.checkRefunds(progress, reads, record, row.driver_id, paymentId, row, ours);
    }
    return progress.result([
      'PROVIDER_PAYMENT_NOT_CAPTURED',
      'PROVIDER_EXTRA_COLLECTION_PAYMENT',
      'PROVIDER_REFUND_NOT_RECORDED',
      'INTERNAL_REFUND_NOT_AT_PROVIDER',
      'PROVIDER_LOOKUP_FAILED',
    ]);
  }

  /** Prepaid booking payments and top-ups we hold as paid: still captured, not refunded? */
  private async paidPayments(scope: ProviderScope, reads: ProviderReads): Promise<CheckResult> {
    const days = this.config.reconciliation.lookbackDays;
    const rows = await this.prisma.$queryRaw<PaidPaymentRow[]>`
      SELECT p.id, p.purpose, p.booking_id, d.id AS driver_id, p.razorpay_payment_id,
             p.amount_paise, p.status::text AS status,
             COALESCE((SELECT sum(r.amount_paise) FROM payment_refunds r
                        WHERE r.source_payment_id = p.id AND r.kind = 'PROVIDER'
                          AND r.status IN ('PENDING', 'PROCESSING', 'COMPLETED')), 0)::bigint
               AS refunds_live,
             COALESCE((SELECT sum(r.amount_paise) FROM payment_refunds r
                        WHERE r.source_payment_id = p.id AND r.kind = 'PROVIDER'
                          AND r.status IN ('PROCESSING', 'COMPLETED')), 0)::bigint
               AS refunds_accepted
        FROM payments p LEFT JOIN drivers d ON d.user_id = p.user_id
       WHERE p.status::text IN ('PAID', 'REFUND_PENDING', 'REFUNDED')
         AND p.razorpay_payment_id IS NOT NULL
         AND (p.updated_at >= now() - make_interval(days => ${days}::int)
              OR EXISTS (SELECT 1 FROM payment_refunds r
                          WHERE r.source_payment_id = p.id
                            AND r.updated_at >= now() - make_interval(days => ${days}::int)))
         AND (${iso(scope.since)}::timestamptz IS NULL OR p.created_at >= ${iso(scope.since)}::timestamptz)
       ORDER BY p.updated_at, p.id
       LIMIT ${scope.limit + 1}`;
    const progress = new CheckProgress('PROVIDER_PAID_PAYMENTS', rows.length > scope.limit);
    for (const row of rows.slice(0, scope.limit)) {
      const record = { entityType: 'PAYMENT', entityId: row.id, bookingId: row.booking_id };
      const read = await reads.read(() => this.razorpay.fetchPayment(row.razorpay_payment_id));
      if (!read.ok) {
        progress.failed(read, record, 'GET /v1/payments/:id', {
          driverId: row.driver_id,
          providerRef: row.razorpay_payment_id,
        });
        continue;
      }
      const payment = read.value;
      this.checkCaptured(progress, record, row.driver_id, payment.id, row.amount_paise, {
        id: payment.id,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        method: payment.method,
        orderId: payment.orderId,
        amountRefunded: payment.amountRefunded ?? null,
      });
      await this.checkRefunds(progress, reads, record, row.driver_id, payment.id, row, {
        id: payment.id,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        method: payment.method,
        orderId: payment.orderId,
        amountRefunded: payment.amountRefunded ?? null,
      });
    }
    return progress.result([
      'PROVIDER_PAYMENT_NOT_CAPTURED',
      'PROVIDER_REFUND_NOT_RECORDED',
      'INTERNAL_REFUND_NOT_AT_PROVIDER',
      'PROVIDER_LOOKUP_FAILED',
    ]);
  }

  /** Our money record says paid: the provider's payment must exist and be captured. */
  private checkCaptured(
    progress: CheckProgress,
    record: { entityType: string; entityId: string; bookingId: string | null },
    driverId: string | null,
    paymentId: string,
    amountPaise: bigint,
    payment: CollectionLinkPayment | undefined,
  ): void {
    if (payment && CAPTURED_STATUSES.has(payment.status)) {
      return;
    }
    progress.add(
      providerFinding({
        ...critical('INTERNAL_PAID_PROVIDER_NOT_PAID'),
        kind: 'PROVIDER_PAYMENT_NOT_CAPTURED',
        ...record,
        driverId,
        providerRef: paymentId,
        internalState: 'PAID',
        providerState: payment?.status ?? 'missing',
        internalAmountPaise: amountPaise,
        providerAmountPaise: payment?.amount ?? null,
        detail: payment
          ? `recorded as paid, but Razorpay reports ${paymentId} ${payment.status}`
          : `recorded as paid by ${paymentId}, which Razorpay does not list on its QR or link`,
      }),
    );
  }

  /**
   * What Razorpay refunded on a payment against our provider refunds of that source. From the
   * refunds API when provider refunds are on, else from the payment's amount_refunded when the
   * provider reports it; otherwise nothing is compared.
   */
  private async checkRefunds(
    progress: CheckProgress,
    reads: ProviderReads,
    record: { entityType: string; entityId: string; bookingId: string | null },
    driverId: string | null,
    paymentId: string,
    ours: { readonly refunds_live: bigint; readonly refunds_accepted: bigint },
    payment: CollectionLinkPayment | undefined,
  ): Promise<void> {
    let refunded: bigint | null = null;
    let listed: readonly ProviderRefund[] | null = null;
    if (this.refunds.enabled) {
      const read = await reads.read(() => this.refunds.listPaymentRefunds(paymentId));
      if (!read.ok) {
        progress.failed(read, record, 'GET /v1/payments/:id/refunds', {
          driverId,
          providerRef: paymentId,
        });
        return;
      }
      listed = read.value;
      refunded = listed
        .filter((refund) => refund.status !== 'failed')
        .reduce((sum, refund) => sum + BigInt(refund.amount), 0n);
    } else if (typeof payment?.amountRefunded === 'number') {
      refunded = BigInt(payment.amountRefunded);
    }
    if (refunded === null) {
      return;
    }
    if (refunded > ours.refunds_live) {
      const unknown = listed
        ?.filter(
          (refund) => refund.status !== 'failed' && !refund.receipt && !refund.notes.refund_id,
        )
        .map((refund) => refund.id);
      progress.add(
        providerFinding({
          ...critical('INTERNAL_PAID_PROVIDER_NOT_PAID'),
          kind: 'PROVIDER_REFUND_NOT_RECORDED',
          ...record,
          driverId,
          providerRef: paymentId,
          internalState: `refunds ${ours.refunds_live.toString()}`,
          providerState: `refunded ${refunded.toString()}`,
          internalAmountPaise: ours.refunds_live,
          providerAmountPaise: refunded,
          detail: `Razorpay refunded ${refunded.toString()} paise of ${paymentId}; our refunds of it total ${ours.refunds_live.toString()} paise${unknown && unknown.length > 0 ? ` (not ours: ${unknown.join(', ')})` : ''}: money we hold as paid went back`,
        }),
      );
    }
    if (ours.refunds_accepted > refunded) {
      progress.add(
        providerFinding({
          ...critical('REFUND_MISMATCH'),
          kind: 'INTERNAL_REFUND_NOT_AT_PROVIDER',
          ...record,
          driverId,
          providerRef: paymentId,
          internalState: `refunds ${ours.refunds_accepted.toString()}`,
          providerState: `refunded ${refunded.toString()}`,
          internalAmountPaise: ours.refunds_accepted,
          providerAmountPaise: refunded,
          detail: `our accepted refunds of ${paymentId} total ${ours.refunds_accepted.toString()} paise; Razorpay reports ${refunded.toString()} paise refunded`,
        }),
      );
    }
  }

  /** Payouts at the provider: status, amount and currency against ours. */
  private async payoutStates(scope: ProviderScope, reads: ProviderReads): Promise<CheckResult> {
    const rows = await this.prisma.$queryRaw<PayoutRow[]>`
      SELECT p.id, p.driver_id, p.status::text AS status, p.provider_payout_id, p.amount_paise
        FROM driver_payouts p
       WHERE p.provider = ${this.payouts.provider}
         AND (p.status IN ('SUBMITTING'::payout_status, 'SUBMITTED'::payout_status)
              OR (p.status IN ('PROCESSED'::payout_status, 'FAILED'::payout_status,
                               'REVERSED'::payout_status)
                  AND p.updated_at >= now() - make_interval(days => ${this.config.reconciliation.lookbackDays}::int)))
         AND (${iso(scope.since)}::timestamptz IS NULL OR p.created_at >= ${iso(scope.since)}::timestamptz)
       ORDER BY p.created_at, p.id
       LIMIT ${scope.limit + 1}`;
    const progress = new CheckProgress('PROVIDER_PAYOUTS', rows.length > scope.limit);
    for (const row of rows.slice(0, scope.limit)) {
      const record = { entityType: 'DRIVER_PAYOUT', entityId: row.id };
      const providerPayoutId = row.provider_payout_id;
      const read = await reads.read<ProviderPayout | null>(() =>
        providerPayoutId
          ? this.payouts.fetchPayout(providerPayoutId)
          : this.payouts.findPayoutByReference(row.id),
      );
      if (!read.ok) {
        progress.failed(
          read,
          record,
          providerPayoutId ? 'fetch payout' : 'find payout by reference',
          {
            driverId: row.driver_id,
            providerRef: providerPayoutId,
          },
        );
        continue;
      }
      const provider = read.value;
      if (!provider) {
        continue;
      }
      const base = {
        ...record,
        driverId: row.driver_id,
        providerRef: provider.id,
        internalState: row.status,
        providerState: provider.status,
        internalAmountPaise: row.amount_paise,
        providerAmountPaise: provider.amount,
      };
      if (BigInt(provider.amount) !== row.amount_paise || provider.currency !== 'INR') {
        progress.add(
          providerFinding({
            ...critical('PAYOUT_MISMATCH'),
            kind: 'PAYOUT_AMOUNT_MISMATCH',
            ...base,
            detail: `RazorpayX reports ${provider.amount} ${provider.currency} for ${provider.id}; ours is ${row.amount_paise.toString()} INR`,
          }),
        );
      }
      const mapped = mapProviderStatus(provider.status);
      const unrecorded = !providerPayoutId;
      if (mapped === row.status && !unrecorded) {
        continue;
      }
      // Behind: the provider moved forward (or we lack its id) and a sync would record it.
      // Anything else contradicts what we recorded and is never applied on its own.
      const behind =
        row.status === 'SUBMITTING' ||
        row.status === 'SUBMITTED' ||
        (row.status === 'PROCESSED' && mapped === 'REVERSED') ||
        (mapped === row.status && unrecorded);
      progress.add(
        providerFinding({
          ...(behind ? warning('PAYOUT_MISMATCH') : critical('PAYOUT_MISMATCH')),
          kind: behind ? 'PAYOUT_STATUS_BEHIND' : 'PAYOUT_STATUS_CONFLICT',
          ...base,
          detail: behind
            ? `RazorpayX reports ${provider.id} ${provider.status}; it is recorded ${row.status}${unrecorded ? ' without the provider id' : ''}: POST /v1/admin/payouts/${row.id}/sync records it`
            : `RazorpayX reports ${provider.id} ${provider.status}, which contradicts our ${row.status}; not applied (needs a human)`,
          identity: [record.entityType, record.entityId, provider.id, provider.status],
        }),
      );
    }
    return progress.result([
      'PAYOUT_AMOUNT_MISMATCH',
      'PAYOUT_STATUS_BEHIND',
      'PAYOUT_STATUS_CONFLICT',
      'PROVIDER_LOOKUP_FAILED',
    ]);
  }

  /** Provider refunds: status, payment and amount against ours; lost replies found by receipt. */
  private async refundStates(scope: ProviderScope, reads: ProviderReads): Promise<CheckResult> {
    const rows = await this.prisma.$queryRaw<RefundRow[]>`
      SELECT r.id, r.booking_id, r.status, r.amount_paise, r.provider_payment_id,
             r.provider_refund_id
        FROM payment_refunds r
       WHERE r.kind = 'PROVIDER' AND r.provider_payment_id IS NOT NULL
         AND (r.status = 'PROCESSING'
              OR (r.status IN ('COMPLETED', 'FAILED')
                  AND r.updated_at >= now() - make_interval(days => ${this.config.reconciliation.lookbackDays}::int))
              OR (r.status = 'PENDING' AND r.provider_refund_id IS NULL
                  AND r.created_at < now() - make_interval(mins => ${this.config.reconciliation.minAgeMinutes}::int)))
         AND (${iso(scope.since)}::timestamptz IS NULL OR r.created_at >= ${iso(scope.since)}::timestamptz)
       ORDER BY r.created_at, r.id
       LIMIT ${scope.limit + 1}`;
    const progress = new CheckProgress('PROVIDER_REFUNDS', rows.length > scope.limit);
    for (const row of rows.slice(0, scope.limit)) {
      const record = { entityType: 'PAYMENT_REFUND', entityId: row.id, bookingId: row.booking_id };
      const sync = `POST /v1/admin/refunds/${row.id}/sync records it`;
      const providerRefundId = row.provider_refund_id;
      if (!providerRefundId) {
        const read = await reads.read(() =>
          this.refunds.listPaymentRefunds(row.provider_payment_id),
        );
        if (!read.ok) {
          progress.failed(read, record, 'GET /v1/payments/:id/refunds', {
            providerRef: row.provider_payment_id,
          });
          continue;
        }
        const found = findOurRefund(read.value, row.id);
        if (found) {
          progress.add(
            providerFinding({
              ...warning('REFUND_MISMATCH'),
              kind: 'REFUND_STATUS_BEHIND',
              ...record,
              providerRef: found.id,
              internalState: row.status,
              providerState: found.status,
              internalAmountPaise: row.amount_paise,
              providerAmountPaise: found.amount,
              detail: `the refund reached Razorpay as ${found.id} (${found.status}) but is recorded ${row.status} without it; ${sync}`,
              identity: [record.entityType, record.entityId, found.id, found.status],
            }),
          );
        }
        continue;
      }
      const read = await reads.read(() => this.refunds.fetchRefund(providerRefundId));
      if (!read.ok) {
        progress.failed(read, record, 'GET /v1/refunds/:id', { providerRef: providerRefundId });
        continue;
      }
      const provider = read.value;
      const base = {
        ...record,
        providerRef: provider.id,
        internalState: row.status,
        providerState: provider.status,
        internalAmountPaise: row.amount_paise,
        providerAmountPaise: provider.amount,
      };
      if (
        provider.paymentId !== row.provider_payment_id ||
        BigInt(provider.amount) !== row.amount_paise ||
        provider.currency !== 'INR'
      ) {
        progress.add(
          providerFinding({
            ...critical('REFUND_MISMATCH'),
            kind: 'REFUND_PROVIDER_MISMATCH',
            ...base,
            detail: `Razorpay reports ${provider.id} as ${provider.amount} ${provider.currency} of ${provider.paymentId}; ours is ${row.amount_paise.toString()} INR of ${row.provider_payment_id}`,
          }),
        );
        continue;
      }
      const target = refundStatusForProvider(provider.status);
      if (target === row.status) {
        continue;
      }
      const behind = row.status === 'PENDING' || row.status === 'PROCESSING';
      progress.add(
        providerFinding({
          ...(behind ? warning('REFUND_MISMATCH') : critical('REFUND_MISMATCH')),
          kind: behind ? 'REFUND_STATUS_BEHIND' : 'REFUND_STATUS_CONFLICT',
          ...base,
          detail: behind
            ? `Razorpay reports ${provider.id} ${provider.status}; it is recorded ${row.status}: ${sync}`
            : `Razorpay reports ${provider.id} ${provider.status}, which contradicts our ${row.status}; not applied (needs a human)`,
          identity: [record.entityType, record.entityId, provider.id, provider.status],
        }),
      );
    }
    return progress.result([
      'REFUND_STATUS_BEHIND',
      'REFUND_STATUS_CONFLICT',
      'REFUND_PROVIDER_MISMATCH',
      'PROVIDER_LOOKUP_FAILED',
    ]);
  }
}

function providerFinding(input: Omit<FindingInput, 'source'>): DetectedFinding {
  return detected({ ...input, source: 'PROVIDER' });
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

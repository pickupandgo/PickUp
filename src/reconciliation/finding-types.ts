/**
 * Reconciliation findings (payment flow Phase 7): what a check found, before it is recorded.
 * A finding never moves money; it is kept for an admin, who resolves it with a note.
 */

export const FINDING_CATEGORIES = [
  /** Razorpay has money we have not applied (pending, closed or unmatched). */
  'PROVIDER_PAID_INTERNAL_PENDING',
  /** We hold money as paid that Razorpay reports failed, refunded or disputed. */
  'INTERNAL_PAID_PROVIDER_NOT_PAID',
  'EARNING_SOURCE_MISMATCH',
  'SETTLEMENT_MISMATCH',
  'PAYOUT_MISMATCH',
  'REFUND_MISMATCH',
  'WALLET_MISMATCH',
  /** Pending too long: collections, payments, webhooks not processed. */
  'STALE_PENDING',
  /** The same provider payment or event recorded or delivered more than once. */
  'DUPLICATE_PROVIDER_EVENT',
  /** A provider event the backend could not use, or a provider record it could not read. */
  'PROVIDER_EVENT_ANOMALY',
] as const;
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];

export const FINDING_SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export const FINDING_SOURCES = ['DATABASE', 'PROVIDER', 'RECOVERY'] as const;
export type FindingSource = (typeof FINDING_SOURCES)[number];

export const FINDING_STATUSES = ['OPEN', 'RESOLVED'] as const;

export interface DetectedFinding {
  readonly category: FindingCategory;
  /** The check's problem code (UPPER_SNAKE_CASE). */
  readonly kind: string;
  readonly severity: FindingSeverity;
  readonly source: FindingSource;
  /** Stable identity of the condition: the same condition seen again has the same value. */
  readonly fingerprint: string;
  readonly entityType: string | null;
  readonly entityId: string | null;
  readonly bookingId: string | null;
  readonly driverId: string | null;
  readonly providerRef: string | null;
  readonly internalState: string | null;
  readonly providerState: string | null;
  readonly internalAmountPaise: bigint | null;
  readonly providerAmountPaise: bigint | null;
  readonly detail: string | null;
  readonly refs: Readonly<Record<string, string>>;
}

export interface FindingInput {
  readonly category: FindingCategory;
  readonly kind: string;
  readonly severity: FindingSeverity;
  readonly source: FindingSource;
  readonly entityType?: string | null;
  readonly entityId?: string | null;
  readonly bookingId?: string | null;
  readonly driverId?: string | null;
  readonly providerRef?: string | null;
  readonly internalState?: string | null;
  readonly providerState?: string | null;
  readonly internalAmountPaise?: bigint | number | null;
  readonly providerAmountPaise?: bigint | number | null;
  readonly detail?: string | null;
  readonly refs?: Readonly<Record<string, string | null | undefined>>;
  /** What identifies the condition besides its kind. Default: the entity and the provider id. */
  readonly identity?: readonly (string | null | undefined)[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KIND = /^[A-Z][A-Z0-9_]{1,59}$/;

/** Builds a finding with its fingerprint; ids that are not UUIDs move to `refs`. */
export function detected(input: FindingInput): DetectedFinding {
  if (!KIND.test(input.kind)) {
    throw new Error(`Invalid finding kind ${input.kind}`);
  }
  const refs: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.refs ?? {})) {
    if (typeof value === 'string' && value.length > 0) {
      refs[key] = value.slice(0, 150);
    }
  }
  const bookingId = uuidOrRef(input.bookingId, 'bookingId', refs);
  const driverId = uuidOrRef(input.driverId, 'driverId', refs);
  const identity = input.identity ?? [input.entityType, input.entityId, input.providerRef];
  return {
    category: input.category,
    kind: input.kind,
    severity: input.severity,
    source: input.source,
    fingerprint: [input.kind, ...identity.map((part) => part ?? '')].join('|').slice(0, 300),
    entityType: clip(input.entityType, 40),
    entityId: clip(input.entityId, 150),
    bookingId,
    driverId,
    providerRef: clip(input.providerRef, 150),
    internalState: clip(input.internalState, 60),
    providerState: clip(input.providerState, 60),
    internalAmountPaise: toBigInt(input.internalAmountPaise),
    providerAmountPaise: toBigInt(input.providerAmountPaise),
    detail: clip(input.detail, 500),
    refs,
  };
}

function uuidOrRef(
  value: string | null | undefined,
  key: string,
  refs: Record<string, string>,
): string | null {
  if (!value) {
    return null;
  }
  if (UUID.test(value)) {
    return value.toLowerCase();
  }
  refs[key] = value.slice(0, 150);
  return null;
}

function clip(value: string | null | undefined, max: number): string | null {
  return value === null || value === undefined || value === '' ? null : value.slice(0, max);
}

function toBigInt(value: bigint | number | null | undefined): bigint | null {
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === 'bigint' ? value : BigInt(Math.trunc(value));
}

/** Keeps the first finding of each fingerprint (a check may see one condition twice). */
export function uniqueFindings(findings: readonly DetectedFinding[]): DetectedFinding[] {
  const seen = new Map<string, DetectedFinding>();
  for (const finding of findings) {
    if (!seen.has(finding.fingerprint)) {
      seen.set(finding.fingerprint, finding);
    }
  }
  return [...seen.values()];
}

/** What one check of a run found. */
export interface CheckResult {
  /** The check's name (UPPER_SNAKE_CASE), e.g. EARNING_MISMATCHES. */
  readonly check: string;
  readonly source: FindingSource;
  /** Every kind the check reports; a complete state check clears those it no longer sees. */
  readonly kinds: readonly string[];
  readonly findings: readonly DetectedFinding[];
  /** False when the check stopped early (row limit reached, provider unavailable, skipped). */
  readonly complete: boolean;
  /**
   * True for a check of current state (a mismatch that goes away once the records agree): a
   * complete, unscoped run marks its findings that are no longer seen as cleared. False for a
   * check of past events (a webhook problem, a duplicate delivery): those stay as recorded.
   */
  readonly clears: boolean;
  /** Why the check is incomplete, for the run summary. */
  readonly note?: string;
}

/** How a finding kind is classified. */
export interface KindSpec {
  readonly category: FindingCategory;
  readonly severity: FindingSeverity;
}

export const critical = (category: FindingCategory): KindSpec => ({
  category,
  severity: 'CRITICAL',
});
export const warning = (category: FindingCategory): KindSpec => ({ category, severity: 'WARNING' });
export const info = (category: FindingCategory): KindSpec => ({ category, severity: 'INFO' });

/** A provider code as a finding kind suffix: UPPER_SNAKE_CASE, at most `max` characters. */
export function kindPart(value: string | null | undefined, fallback: string, max = 40): string {
  const cleaned = (value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, max);
  return cleaned.length > 0 ? cleaned : fallback;
}

const UUID_IN_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** The first id in a report's detail text (a refund, trip or ledger entry), if any. */
export function firstUuid(text: string | null | undefined): string | null {
  const match = text ? UUID_IN_TEXT.exec(text) : null;
  return match ? match[0].toLowerCase() : null;
}

/** Provider event types that report money received (a payment, a paid link or QR). */
const MONEY_EVENT_TYPES: ReadonlySet<string> = new Set([
  'payment.authorized',
  'payment.captured',
  'order.paid',
  'payment_link.paid',
  'qr_code.credited',
]);

/**
 * The category and severity of a signed provider webhook that was processed with a problem
 * (payment_events / payout_events with a processing error), by its outcome. Unknown outcomes are
 * provider event anomalies: nothing is assumed about money.
 */
export function webhookOutcomeSpec(
  source: 'RAZORPAY' | 'RAZORPAYX',
  outcome: string | null,
  eventType: string,
): KindSpec {
  if (source === 'RAZORPAYX') {
    switch (outcome) {
      case 'MISMATCH':
      case 'CONFLICTING_STATE':
      case 'UNKNOWN_PAYOUT':
        return critical('PAYOUT_MISMATCH');
      default:
        return warning('PROVIDER_EVENT_ANOMALY');
    }
  }
  switch (outcome) {
    // Money reached Razorpay and was not applied to anything of ours.
    case 'AMOUNT_MISMATCH':
    case 'ORDER_MISMATCH':
    case 'PAYMENT_NOT_PENDING':
    case 'UNKNOWN_ORDER':
    case 'MISSING_ORDER_ID':
      return critical('PROVIDER_PAID_INTERNAL_PENDING');
    case 'UNKNOWN_COLLECTION':
      return MONEY_EVENT_TYPES.has(eventType)
        ? critical('PROVIDER_PAID_INTERNAL_PENDING')
        : warning('PROVIDER_EVENT_ANOMALY');
    // Authorized, not captured (the booking closed meanwhile); Razorpay voids it later.
    case 'BOOKING_NOT_PAYABLE':
      return warning('PROVIDER_PAID_INTERNAL_PENDING');
    // A second payment for an order or a booking.
    case 'DUPLICATE_ORDER_PAYMENT':
    case 'DUPLICATE_BOOKING_PAYMENT':
      return critical('DUPLICATE_PROVIDER_EVENT');
    // Recorded as paid; the money waits for a refund decision (open refund policy).
    case 'PAID_AFTER_CANCELLATION':
    case 'PAID_FOR_CLOSED_DROP':
      return warning('REFUND_MISMATCH');
    // We hold as paid what the customer's bank disputes, or what Razorpay refunded on its own.
    case 'DISPUTE_RECORDED':
    case 'REFUND_UNKNOWN':
      return critical('INTERNAL_PAID_PROVIDER_NOT_PAID');
    case 'REFUND_MISMATCH':
    case 'REFUND_CONFLICTING_STATE':
      return critical('REFUND_MISMATCH');
    default:
      return warning('PROVIDER_EVENT_ANOMALY');
  }
}

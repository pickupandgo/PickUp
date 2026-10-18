import type { BackendOutcome } from '../payment-backend/payment-backend.client';

export type OutboxKindName =
  'SEARCHING' | 'ASSIGN' | 'TRIP_STATUS' | 'STOP_STATUS' | 'CANCEL';
export type OutboxModeName = 'COMMAND' | 'EVENT';

export interface PolicyRecord {
  readonly kind: OutboxKindName;
  readonly mode: OutboxModeName;
  /** For TRIP_STATUS and STOP_STATUS: the status reported. */
  readonly status?: string;
}

/**
 * What a delivery attempt means for an outbox record:
 *   DELIVERED  the backend accepted it (a repeat is a no-op there, so a duplicate is fine)
 *   RETRY      no definitive answer, or one worth waiting for: tried again later, never dropped
 *   REFUSED    a definitive refusal: recorded, never sent again on its own
 * `alert` marks an outcome somebody must look at (a refusal nobody expects is a bug, never a
 * silent drop).
 */
export type Verdict =
  | { readonly kind: 'DELIVERED' }
  | { readonly kind: 'RETRY'; readonly alert: false }
  | { readonly kind: 'REFUSED'; readonly alert: boolean };

/**
 * Refusals that are an expected business answer to a backend-first command, not a divergence:
 * the payment gate said no (PAYMENT_REQUIRED). The engine refuses the action and commits nothing.
 */
const EXPECTED_COMMAND_REFUSALS: ReadonlySet<string> = new Set([
  'PAYMENT_REQUIRED',
]);

export function classify(
  record: PolicyRecord,
  outcome: BackendOutcome,
): Verdict {
  switch (outcome.kind) {
    case 'OK':
      return { kind: 'DELIVERED' };
    case 'UNAVAILABLE':
      return { kind: 'RETRY', alert: false };
    case 'REFUSED':
      // Completion waits for the payment to be confirmed: retried with backoff (review F,
      // "Complete: retry loop"). Every other refusal is definitive.
      if (
        record.kind === 'TRIP_STATUS' &&
        record.status === 'COMPLETED' &&
        outcome.code === 'PAYMENT_REQUIRED'
      ) {
        return { kind: 'RETRY', alert: false };
      }
      if (
        record.mode === 'COMMAND' &&
        EXPECTED_COMMAND_REFUSALS.has(outcome.code)
      ) {
        return { kind: 'REFUSED', alert: false };
      }
      // An EVENT describes something the engine already did, so its refusal means engine and
      // backend disagree; an unexpected refusal of a COMMAND (INVALID_*, STOPS_PENDING, ...) too.
      return { kind: 'REFUSED', alert: true };
  }
}

/**
 * Exponential backoff with equal jitter: half of the capped delay is fixed, half random, so
 * retries after an outage spread out without ever retrying immediately.
 */
export function backoffMs(
  attempts: number,
  baseMs: number,
  maxMs: number,
  random: () => number = Math.random,
): number {
  const exponent = Math.min(Math.max(attempts - 1, 0), 30);
  const capped = Math.min(maxMs, baseMs * 2 ** exponent);
  return Math.round(capped / 2 + random() * (capped / 2));
}

/** Alert when a record reaches the threshold, then again every `alertAfter` attempts. */
export function shouldAlertRetry(
  attempts: number,
  alertAfter: number,
): boolean {
  return attempts >= alertAfter && attempts % alertAfter === 0;
}

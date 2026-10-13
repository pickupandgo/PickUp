import type { CollectionDto, DriverTripDto } from './collectionsDto';
import type { PaymentsApi } from './paymentsApi';
import { PaymentsApiError } from './paymentsErrors';

/*
 * Pickup / delivery payment collection. The server decides everything that involves money:
 * whether the trip can be collected now, the fare, the platform fee, and whether a QR was paid.
 * The app only shows that state and asks the server to record cash or create a QR.
 */

/** What the collect screen can offer for a trip, from the server's view of it. */
export type CollectAvailability =
  /** Cash or QR can be collected now. */
  | { readonly kind: 'open' }
  /** Already paid (prepaid in the app, or collected earlier). */
  | { readonly kind: 'paid'; readonly prepaid: boolean }
  /** Pay-at-pickup / pay-at-delivery, but not in its window yet (or the trip is closed). */
  | { readonly kind: 'not_yet'; readonly stage: 'PICKUP' | 'DELIVERY' };

export function collectAvailability(trip: DriverTripDto): CollectAvailability {
  const { payment } = trip;
  if (payment.status !== 'UNPAID' || payment.collectionStage === null) {
    return { kind: 'paid', prepaid: payment.method === 'PREPAID_UPI' };
  }
  return payment.collectionOpen
    ? { kind: 'open' }
    : { kind: 'not_yet', stage: payment.collectionStage };
}

export type CollectionWatchResult =
  | { readonly kind: 'paid'; readonly collection: CollectionDto }
  /** The QR expired or was cancelled (e.g. replaced by cash): offer a new one. */
  | { readonly kind: 'failed'; readonly collection: CollectionDto }
  | { readonly kind: 'reversed'; readonly collection: CollectionDto }
  /** Still waiting when the watch stopped (screen closed, or the time limit). */
  | { readonly kind: 'stopped'; readonly collection: CollectionDto };

export interface WatchCollectionDeps {
  readonly api: Pick<PaymentsApi, 'getCollection'>;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly pollIntervalMs?: number;
  /** Upper bound on server checks (default covers the longest QR lifetime, 2 hours). */
  readonly maxPolls?: number;
  /** Return true to stop (e.g. the screen was closed). */
  readonly isAbandoned?: () => boolean;
  /** Every fresh server state, e.g. to show the payment method once it is known. */
  readonly onUpdate?: (collection: CollectionDto) => void;
}

const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_MAX_POLLS = 2_400;

const defaultSleep = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Waits for the customer to pay a QR. Each check asks our server, which re-reads the QR from
 * Razorpay; only the server's COMPLETED status counts as paid. Network errors don't end the
 * watch: the QR stays payable and the next check picks up the result.
 */
export async function watchCollection(
  initial: CollectionDto,
  deps: WatchCollectionDeps,
): Promise<CollectionWatchResult> {
  const sleep = deps.sleep ?? defaultSleep;
  const interval = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxPolls = deps.maxPolls ?? DEFAULT_MAX_POLLS;
  const abandoned = () => deps.isAbandoned?.() === true;

  let current = initial;
  for (let poll = 0; poll <= maxPolls; poll += 1) {
    const settled = settledResult(current);
    if (settled) {
      return settled;
    }
    if (poll === maxPolls || abandoned()) {
      break;
    }
    await sleep(interval);
    if (abandoned()) {
      break;
    }
    try {
      current = await deps.api.getCollection(
        current.tripId,
        current.collectionId,
      );
      deps.onUpdate?.(current);
    } catch (error) {
      if (
        !(error instanceof PaymentsApiError) ||
        error.code === 'INVALID_RESPONSE'
      ) {
        // Something is wrong with the response itself: stop rather than guess.
        throw error;
      }
      // Network, timeout, rate limit, server restart: keep the QR and try again.
    }
  }
  return { kind: 'stopped', collection: current };
}

function settledResult(
  collection: CollectionDto,
): CollectionWatchResult | null {
  switch (collection.status) {
    case 'COMPLETED':
      return { kind: 'paid', collection };
    case 'FAILED':
      return { kind: 'failed', collection };
    case 'REVERSED':
      return { kind: 'reversed', collection };
    default:
      return null;
  }
}

/**
 * The platform fee a cash collection needs in the wallet, from an INSUFFICIENT_BALANCE error.
 * Null for any other error.
 */
export function requiredFeePaise(error: unknown): number | null {
  if (
    !(error instanceof PaymentsApiError) ||
    error.code !== 'INSUFFICIENT_BALANCE'
  ) {
    return null;
  }
  const fee = error.details?.requiredFeePaise;
  return typeof fee === 'number' && Number.isSafeInteger(fee) && fee > 0
    ? fee
    : null;
}

/**
 * True when the outcome of a collection request is unknown (no answer from the server), so a
 * retry must reuse the same idempotency key. Definitive refusals start a fresh attempt.
 */
export function shouldReuseKey(error: unknown): boolean {
  return (
    error instanceof PaymentsApiError &&
    (error.retryable || error.code === 'INVALID_RESPONSE')
  );
}

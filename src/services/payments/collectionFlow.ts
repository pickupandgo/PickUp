import type {
  CollectionDto,
  DriverTripDto,
  GateStageDto,
  PaymentGateDto,
} from './collectionsDto';
import type { PaymentsApi } from './paymentsApi';
import { PaymentsApiError } from './paymentsErrors';

/*
 * Pickup / delivery payment collection. The server decides everything that involves money:
 * whether the trip can be collected now, what is owed (the booking's amount, or one drop's), the
 * platform fee, and whether a QR was paid. The app only shows that state and asks the server to
 * record cash or create a QR.
 */

/** What is owed at the handover point the trip is at now (from the payment gate). */
export interface Obligation {
  readonly stage: GateStageDto;
  /** What to collect, in paise: the booking's payable amount, or the drop's. */
  readonly amountPaise: number;
  /** The platform fee debited from the wallet if this is taken in cash. */
  readonly cashFeePaise: number | null;
  /** The drop being paid for (sent as stopSequence); null for the whole booking. */
  readonly stopSequence: number | null;
}

/** What the collect screen can offer for a trip, from the payment gate only. */
export type CollectAvailability =
  /** Owed now: cash or QR can be collected. */
  | (Obligation & {
      readonly kind: 'open';
      /** Why the last QR failed, when it did (shown to the driver). */
      readonly lastFailure: string | null;
    })
  /** A QR is open for this obligation: show it again, or take cash instead. */
  | (Obligation & {
      readonly kind: 'processing';
      readonly collectionId: string | null;
    })
  /** Paid: collected here, or prepaid in the app. */
  | {
      readonly kind: 'paid';
      readonly prepaid: boolean;
      readonly stopSequence: number | null;
    }
  /** Owed later: before the arrival at the pickup, or at a drop not reached yet. */
  | { readonly kind: 'not_yet'; readonly stage: 'PICKUP' | 'DELIVERY' }
  /** Prepaid in the app but not paid there: the customer pays in the app, never the driver. */
  | { readonly kind: 'awaiting_customer' }
  /** Nothing is owed at this point. */
  | { readonly kind: 'nothing_due' };

/**
 * Availability comes from the payment gate only (review G). A prepaid booking that is still
 * unpaid is not paid: the driver has nothing to collect, and the customer must pay in the app.
 */
export function collectAvailability(trip: DriverTripDto): CollectAvailability {
  const { paymentGate: gate, method, status } = trip.payment;
  const owed =
    gate.stage !== null && gate.amountPaise !== null && gate.amountPaise > 0
      ? {
          stage: gate.stage,
          amountPaise: gate.amountPaise,
          cashFeePaise: gate.cashFeePaise,
          stopSequence: gate.stopSequence,
        }
      : null;
  switch (gate.paymentState) {
    case 'PAYMENT_REQUIRED':
    case 'PAYMENT_FAILED':
      return owed
        ? { kind: 'open', ...owed, lastFailure: gate.lastFailure }
        : { kind: 'awaiting_customer' };
    case 'PAYMENT_PROCESSING':
      return owed
        ? { kind: 'processing', ...owed, collectionId: gate.collectionId }
        : { kind: 'awaiting_customer' };
    case 'PAYMENT_CONFIRMED':
      return {
        kind: 'paid',
        prepaid: method === 'PREPAID_UPI',
        stopSequence: gate.stopSequence,
      };
    case 'NOT_YET':
      return {
        kind: 'not_yet',
        stage: gate.stage === 'PICKUP' ? 'PICKUP' : 'DELIVERY',
      };
    default:
      return status === 'PAID'
        ? {
            kind: 'paid',
            prepaid: method === 'PREPAID_UPI',
            stopSequence: null,
          }
        : { kind: 'nothing_due' };
  }
}

/**
 * Whether the pickup OTP may be entered now: only when the payment backend allows the pickup
 * handover (paid, or nothing owed at the pickup). The engine checks the same gate again.
 */
export function pickupHandoverAllowed(gate: PaymentGateDto | null): boolean {
  return gate !== null && gate.stage === 'PICKUP' && gate.handoverAllowed;
}

/**
 * Whether the OTP of drop `sequence` may be entered now: only when the payment backend allows
 * that drop's handover (its payment confirmed, or nothing owed there).
 */
export function dropHandoverAllowed(
  gate: PaymentGateDto | null,
  sequence: number | undefined,
): boolean {
  return (
    gate !== null &&
    gate.stage === 'DROP' &&
    gate.handoverAllowed &&
    (gate.stopSequence === null || gate.stopSequence === sequence)
  );
}

/** True when the driver can collect (or is collecting) a payment for this trip now. */
export function isCollectable(trip: DriverTripDto): boolean {
  const availability = collectAvailability(trip);
  return availability.kind === 'open' || availability.kind === 'processing';
}

/**
 * The cash fee the wallet must cover before the driver takes cash, when the balance is short.
 * Null when there is no fee or the balance covers it (the server still checks it).
 */
export function cashShortfallPaise(
  cashFeePaise: number | null,
  balancePaise: number | null,
): number | null {
  if (cashFeePaise === null || cashFeePaise <= 0 || balancePaise === null) {
    return null;
  }
  return balancePaise < cashFeePaise ? cashFeePaise - balancePaise : null;
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

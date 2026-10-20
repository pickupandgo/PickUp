/**
 * Errors from the payments backend, or from trying to reach it.
 * Branch on `code` (stable), never on `message`.
 */

/** Codes that are safe to retry automatically: every payments call is idempotent on the server. */
const RETRYABLE_CODES: ReadonlySet<string> = new Set([
  'NETWORK_ERROR',
  'TIMEOUT',
  'PAYMENT_PROVIDER_UNAVAILABLE',
  'SERVICE_UNAVAILABLE',
  'AUTH_PROVIDER_UNAVAILABLE',
]);

/** Gateway and availability errors, e.g. from a load balancer while the server restarts. */
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);

export class PaymentsApiError extends Error {
  readonly code: string;
  /** HTTP status, or 0 when no response was received. */
  readonly status: number;
  /** Server correlation id. Show it to the driver so support can find the request. */
  readonly requestId?: string;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: string,
    message: string,
    status: number,
    requestId?: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'PaymentsApiError';
    this.code = code;
    this.status = status;
    this.requestId = requestId;
    this.details = details;
  }

  get retryable(): boolean {
    return (
      RETRYABLE_CODES.has(this.code) || RETRYABLE_STATUSES.has(this.status)
    );
  }
}

const GENERIC_MESSAGE = 'Something went wrong. Please try again.';

const MESSAGES: Readonly<Record<string, string>> = {
  NETWORK_ERROR: 'No internet connection. Check your network and try again.',
  TIMEOUT: 'The connection is slow. Please try again.',
  NOT_CONFIGURED:
    'Wallet payments are not available in this version of the app.',
  NOT_SIGNED_IN: 'Please sign in again to continue.',
  AUTH_REQUIRED: 'Please sign in again to continue.',
  AUTH_INVALID_TOKEN: 'Please sign in again to continue.',
  USER_NOT_PROVISIONED:
    'Your account is not set up for wallet payments yet. Please contact support.',
  ACCOUNT_DISABLED: 'Your account is disabled. Please contact support.',
  FORBIDDEN: 'This account cannot use the driver wallet.',
  DRIVER_NOT_APPROVED:
    'Your driver account must be approved before you can add money.',
  WALLET_NOT_FOUND: 'Your wallet is not set up yet. Please contact support.',
  WALLET_BLOCKED: 'Your wallet is blocked. Please contact support.',
  RATE_LIMITED: 'Too many attempts. Please wait a minute and try again.',
  PAYMENT_PROVIDER_UNAVAILABLE:
    'Payments are temporarily unavailable. Please try again shortly.',
  SERVICE_UNAVAILABLE:
    'Payments are temporarily unavailable. Please try again shortly.',
  AUTH_PROVIDER_UNAVAILABLE:
    'Payments are temporarily unavailable. Please try again shortly.',
  PAYMENT_PROVIDER_ERROR: 'The payment could not be started. Please try again.',
  INVALID_PAYMENT_SIGNATURE: 'This payment could not be verified.',
  PAYMENT_ORDER_MISMATCH: 'This payment could not be verified.',
  PAYMENT_VERIFICATION_FAILED:
    'We could not confirm this payment automatically. Support has been alerted and will sort it out.',
  PAYMENT_NOT_COMPLETED: 'The payment was not completed.',
  PAYMENT_INTERRUPTED: 'The payment was interrupted by a network problem.',
  PAYMENT_NOT_PAYABLE:
    'This recharge can no longer be paid. Please start a new one.',
  PAYMENT_NOT_FOUND: 'We could not find this recharge.',
  CHECKOUT_UNAVAILABLE:
    'The payment screen could not be opened. Please update the app or try again later.',
  IDEMPOTENCY_KEY_REUSED:
    'This recharge conflicts with an earlier one. Please start a new recharge.',
  AMOUNT_MISMATCH:
    'The amount did not match. No payment was started. Please try again.',
  INVALID_RESPONSE: 'Unexpected response from the server. Please try again.',
  INTERNAL_ERROR: 'Something went wrong on our side. Please try again.',
  // Trip payment collection
  TRIP_NOT_FOUND: 'We could not find this trip.',
  COLLECTION_NOT_FOUND: 'We could not find this payment.',
  COLLECTION_NOT_ALLOWED:
    'Payment cannot be collected for this trip right now.',
  COLLECTION_AMOUNT_MISMATCH:
    'The amount does not match the booking fare. Refresh and try again.',
  COLLECTION_PROVIDER_NOT_CONFIGURED:
    'QR payments are not available yet. Collect cash, or ask the customer to pay in the app.',
  COLLECTION_IN_PROGRESS:
    'An online payment for this trip is still in progress. Try again in a moment.',
  BOOKING_ALREADY_PAID: 'This trip is already paid.',
  BOOKING_CLOSED: 'This booking is closed.',
  STOP_REQUIRED:
    'This booking is paid drop by drop. Refresh and collect for the drop you are at.',
  STOP_NOT_FOUND:
    'This drop is not part of the booking. Refresh and try again.',
  INSUFFICIENT_BALANCE:
    'Your wallet balance does not cover the platform fee for this cash trip. Recharge your wallet and try again.',
  // Earnings and payouts
  EARNING_NOT_FOUND: 'We could not find this earning.',
  PAYOUT_NOT_FOUND: 'We could not find this payout.',
};

/** A short message that is safe to show to the driver. */
export function describePaymentsError(error: unknown): string {
  if (!(error instanceof PaymentsApiError)) {
    return GENERIC_MESSAGE;
  }
  if (error.code === 'AMOUNT_OUT_OF_RANGE') {
    const min = error.details?.minPaise;
    const max = error.details?.maxPaise;
    if (typeof min === 'number' && typeof max === 'number') {
      return `Enter an amount between ₹${formatRupees(min)} and ₹${formatRupees(
        max,
      )}.`;
    }
    return 'This amount is not allowed.';
  }
  return MESSAGES[error.code] ?? GENERIC_MESSAGE;
}

function formatRupees(paise: number): string {
  return (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

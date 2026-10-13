/**
 * Razorpay Checkout failures, normalised across platforms.
 *
 * Razorpay's native SDKs number the same failure differently, and react-native-razorpay passes
 * the native number through unchanged:
 *   Android (com.razorpay.Checkout): PAYMENT_CANCELED = 0, NETWORK_ERROR = 2, INVALID_OPTIONS = 3,
 *     TLS_ERROR = 6, INCOMPATIBLE_PLUGIN = 7, WEBVIEW_CREATION_FAILED = 8
 *   iOS: NETWORK_ERROR = 0, INVALID_OPTIONS = 1, PAYMENT_CANCELLED = 2
 * So "code 2" means "network error" on Android but "cancelled by the user" on iOS.
 */

export type CheckoutFailureKind =
  /** The driver closed Checkout. */
  | 'cancelled'
  /** The connection dropped. A payment may or may not have been made. */
  | 'network'
  /** Checkout could not run on this device or build (missing native module, TLS, WebView). */
  | 'unavailable'
  /** Any other failure reported by Checkout, e.g. a declined payment. */
  | 'failed';

export class CheckoutError extends Error {
  readonly kind: CheckoutFailureKind;
  /** Razorpay's native error code, when Checkout reported one. */
  readonly nativeCode?: number;

  constructor(kind: CheckoutFailureKind, nativeCode?: number) {
    super(`Razorpay Checkout ${kind}`);
    this.name = 'CheckoutError';
    this.kind = kind;
    this.nativeCode = nativeCode;
  }
}

interface NativeCodes {
  readonly cancelled: number;
  readonly network: number;
  readonly unavailable: readonly number[];
}

const NATIVE_CODES: Readonly<Record<'android' | 'ios', NativeCodes>> = {
  android: { cancelled: 0, network: 2, unavailable: [6, 7, 8] },
  ios: { cancelled: 2, network: 0, unavailable: [] },
};

/** Turns whatever Checkout rejected with into a CheckoutError for the given platform. */
export function classifyCheckoutError(
  error: unknown,
  os: string,
): CheckoutError {
  if (error instanceof CheckoutError) {
    return error;
  }
  const code =
    typeof error === 'object' && error !== null
      ? (error as { code?: unknown }).code
      : undefined;
  if (typeof code !== 'number') {
    // Not a Checkout result at all: the native module threw (for example it is not linked).
    return new CheckoutError('unavailable');
  }
  const codes = os === 'android' || os === 'ios' ? NATIVE_CODES[os] : undefined;
  if (codes?.cancelled === code) {
    return new CheckoutError('cancelled', code);
  }
  if (codes?.network === code) {
    return new CheckoutError('network', code);
  }
  if (codes?.unavailable.includes(code)) {
    return new CheckoutError('unavailable', code);
  }
  return new CheckoutError('failed', code);
}

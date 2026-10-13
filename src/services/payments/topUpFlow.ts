import { CheckoutError } from './checkoutErrors';
import {
  RAZORPAY_ORDER_ID_PATTERN,
  RAZORPAY_PAYMENT_ID_PATTERN,
  RAZORPAY_SIGNATURE_PATTERN,
  type CheckoutDto,
  type PaymentsApi,
  type TopUpDto,
  type VerifyTopUpBody,
} from './paymentsApi';
import { describePaymentsError, PaymentsApiError } from './paymentsErrors';

export type TopUpPhase =
  /** Our server is creating the Razorpay order. */
  | 'CREATING_ORDER'
  /** Razorpay Checkout is open. */
  | 'AWAITING_PAYMENT'
  /** Our server is verifying the payment with Razorpay. */
  | 'CONFIRMING'
  /** The payment is not settled yet; waiting for the server to confirm it. */
  | 'WAITING_FOR_BANK';

interface OutcomeBase {
  readonly amountPaise: number;
  /** Our payment id, once the server has created the top-up. */
  readonly paymentId?: string;
}

export type TopUpOutcome =
  | (OutcomeBase & {
      readonly kind: 'success';
      readonly balancePaise: number | null;
    })
  | (OutcomeBase & { readonly kind: 'pending' })
  | (OutcomeBase & { readonly kind: 'cancelled' })
  | (OutcomeBase & {
      readonly kind: 'failed';
      readonly message: string;
      readonly requestId?: string;
      /** True when Checkout was used, so money may have left the driver's account. */
      readonly paymentAttempted: boolean;
    });

/** What Razorpay Checkout returns on success (react-native-razorpay field names). */
export interface CheckoutSuccess {
  readonly razorpay_payment_id?: string;
  readonly razorpay_order_id?: string;
  readonly razorpay_signature?: string;
}

export interface TopUpFlowDeps {
  readonly api: Pick<PaymentsApi, 'startTopUp' | 'getTopUp' | 'verifyTopUp'>;
  /** Opens Razorpay Checkout for the server-created order. Rejects with CheckoutError. */
  readonly openCheckout: (checkout: CheckoutDto) => Promise<CheckoutSuccess>;
  readonly onPhase?: (phase: TopUpPhase, paymentId?: string) => void;
  /** Return true to stop (e.g. the screen was closed). Checked before Checkout and while waiting. */
  readonly isAbandoned?: () => boolean;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly pollIntervalMs?: number;
  /** Server checks while waiting for an unsettled payment. */
  readonly pollAttempts?: number;
  /** Server checks after Checkout lost its connection. */
  readonly interruptedPollAttempts?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_POLL_ATTEMPTS = 20;
const DEFAULT_INTERRUPTED_POLL_ATTEMPTS = 3;

/** Server answers to verification that are final: waiting longer will not change them. */
const VERIFY_REJECTIONS: ReadonlySet<string> = new Set([
  'INVALID_PAYMENT_SIGNATURE',
  'PAYMENT_ORDER_MISMATCH',
  'PAYMENT_VERIFICATION_FAILED',
  'PAYMENT_NOT_FOUND',
]);

const defaultSleep = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * One wallet recharge, end to end:
 *   1. our server creates the Razorpay order (the server checks the amount);
 *   2. Razorpay Checkout takes the payment;
 *   3. our server verifies the payment with Razorpay and credits the wallet;
 *   4. if the result is still open, the server is polled (its webhook finishes the job).
 *
 * The app never decides that money arrived: only the server's PAID status counts. Every step is
 * idempotent, so retries can never charge or credit twice. Once Checkout has been used, a
 * failure to reach the server is reported as "pending", never as "failed".
 */
export async function runTopUp(
  amountPaise: number,
  idempotencyKey: string,
  deps: TopUpFlowDeps,
): Promise<TopUpOutcome> {
  const sleep = deps.sleep ?? defaultSleep;
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const pollAttempts = deps.pollAttempts ?? DEFAULT_POLL_ATTEMPTS;
  const interruptedPollAttempts =
    deps.interruptedPollAttempts ?? DEFAULT_INTERRUPTED_POLL_ATTEMPTS;
  const abandoned = () => deps.isAbandoned?.() === true;

  const failed = (
    error: unknown,
    paymentAttempted: boolean,
    paymentId?: string,
  ): TopUpOutcome => ({
    kind: 'failed',
    amountPaise,
    paymentId,
    message: describePaymentsError(error),
    requestId: error instanceof PaymentsApiError ? error.requestId : undefined,
    paymentAttempted,
  });
  const clientError = (code: string) => new PaymentsApiError(code, code, 0);

  // 1. Order.
  deps.onPhase?.('CREATING_ORDER');
  let topUp: TopUpDto;
  try {
    topUp = await deps.api.startTopUp(amountPaise, idempotencyKey);
  } catch (error) {
    return failed(error, false);
  }
  const { paymentId } = topUp;
  if (topUp.amountPaise !== amountPaise) {
    // Never charge an amount the driver did not confirm.
    return failed(clientError('AMOUNT_MISMATCH'), false, paymentId);
  }
  if (topUp.status === 'PAID') {
    // A retry of an attempt that already went through.
    return { kind: 'success', amountPaise, paymentId, balancePaise: null };
  }
  if (topUp.status !== 'PENDING' || !topUp.checkout) {
    return failed(clientError('PAYMENT_NOT_PAYABLE'), false, paymentId);
  }
  if (abandoned()) {
    return { kind: 'cancelled', amountPaise, paymentId };
  }
  const { orderId } = topUp.checkout;

  /** The server's final answer for this top-up, or null while it is still open. */
  const settledOutcome = async (): Promise<TopUpOutcome | null> => {
    let current: TopUpDto;
    try {
      current = await deps.api.getTopUp(paymentId);
    } catch {
      return null;
    }
    if (current.status === 'PAID') {
      return { kind: 'success', amountPaise, paymentId, balancePaise: null };
    }
    if (current.status === 'FAILED') {
      return failed(clientError('PAYMENT_NOT_COMPLETED'), true, paymentId);
    }
    return null;
  };
  const waitForServer = async (
    attempts: number,
  ): Promise<TopUpOutcome | null> => {
    deps.onPhase?.('WAITING_FOR_BANK', paymentId);
    for (let attempt = 0; attempt < attempts && !abandoned(); attempt += 1) {
      await sleep(pollIntervalMs);
      if (abandoned()) {
        break;
      }
      const settled = await settledOutcome();
      if (settled) {
        return settled;
      }
    }
    return null;
  };
  const pending: TopUpOutcome = { kind: 'pending', amountPaise, paymentId };

  // 2. Payment.
  deps.onPhase?.('AWAITING_PAYMENT', paymentId);
  let checkoutResult: CheckoutSuccess;
  try {
    checkoutResult = await deps.openCheckout(topUp.checkout);
  } catch (error) {
    const kind = error instanceof CheckoutError ? error.kind : 'failed';
    if (kind === 'unavailable') {
      return failed(clientError('CHECKOUT_UNAVAILABLE'), false, paymentId);
    }
    if (kind === 'network') {
      // The connection dropped mid-payment: the bank may still approve it.
      const settled = await waitForServer(interruptedPollAttempts);
      return (
        settled ?? failed(clientError('PAYMENT_INTERRUPTED'), true, paymentId)
      );
    }
    // Checkout can report a cancel or failure although money moved (e.g. UPI approved in
    // another app, then the driver closed Checkout). Ask the server before deciding.
    const settled = await settledOutcome();
    if (settled) {
      return settled;
    }
    return kind === 'cancelled'
      ? { kind: 'cancelled', amountPaise, paymentId }
      : failed(clientError('PAYMENT_NOT_COMPLETED'), true, paymentId);
  }

  // 3. Server-side verification.
  deps.onPhase?.('CONFIRMING', paymentId);
  const body = toVerifyBody(checkoutResult, orderId);
  if (body) {
    try {
      const result = await deps.api.verifyTopUp(paymentId, body);
      if (result.payment.status === 'PAID') {
        return {
          kind: 'success',
          amountPaise,
          paymentId,
          balancePaise: result.wallet?.balancePaise ?? null,
        };
      }
      if (result.payment.status === 'FAILED') {
        return failed(clientError('PAYMENT_NOT_COMPLETED'), true, paymentId);
      }
      // Still pending (e.g. authorized, not yet captured): wait for the server below.
    } catch (error) {
      if (
        error instanceof PaymentsApiError &&
        VERIFY_REJECTIONS.has(error.code)
      ) {
        return failed(error, true, paymentId);
      }
      // Could not reach a verdict (network, sign-in, server error). The payment may have gone
      // through, so wait for the server rather than reporting a failure.
    }
  }

  // 4. Not settled yet (pending UPI, slow bank, or verification unreachable).
  return (await waitForServer(pollAttempts)) ?? pending;
}

function toVerifyBody(
  result: CheckoutSuccess,
  expectedOrderId: string,
): VerifyTopUpBody | null {
  const orderId = result.razorpay_order_id ?? expectedOrderId;
  const paymentId = result.razorpay_payment_id;
  const signature = result.razorpay_signature;
  if (
    orderId !== expectedOrderId ||
    !RAZORPAY_ORDER_ID_PATTERN.test(orderId) ||
    typeof paymentId !== 'string' ||
    !RAZORPAY_PAYMENT_ID_PATTERN.test(paymentId) ||
    typeof signature !== 'string' ||
    !RAZORPAY_SIGNATURE_PATTERN.test(signature)
  ) {
    // Incomplete or unexpected Checkout result: the server's own state decides instead.
    return null;
  }
  return {
    razorpayOrderId: orderId,
    razorpayPaymentId: paymentId,
    razorpaySignature: signature,
  };
}

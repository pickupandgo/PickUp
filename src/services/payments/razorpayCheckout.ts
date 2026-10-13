import { Platform } from 'react-native';
import RazorpayCheckout from 'react-native-razorpay';
import { classifyCheckoutError } from './checkoutErrors';
import type { CheckoutDto } from './paymentsApi';
import type { CheckoutSuccess } from './topUpFlow';

export interface CheckoutDisplay {
  /** Merchant name shown at the top of Checkout. */
  readonly name: string;
  readonly description: string;
  /** Driver's phone number (E.164), only to prefill Checkout. */
  readonly contact?: string;
  readonly themeColor?: string;
}

/**
 * Opens Razorpay Checkout for an order created by our server. Only server-issued values are
 * passed (public key id, order id, amount); the key secret never exists in the app.
 * Rejects with a CheckoutError.
 */
export async function openRazorpayCheckout(
  checkout: CheckoutDto,
  display: CheckoutDisplay,
): Promise<CheckoutSuccess> {
  try {
    return await RazorpayCheckout.open({
      key: checkout.keyId,
      order_id: checkout.orderId,
      amount: checkout.amountPaise,
      currency: checkout.currency,
      name: display.name,
      description: display.description,
      ...(display.contact ? { prefill: { contact: display.contact } } : {}),
      ...(display.themeColor ? { theme: { color: display.themeColor } } : {}),
    });
  } catch (error) {
    const failure = classifyCheckoutError(error, Platform.OS);
    if (__DEV__ && failure.kind === 'unavailable') {
      // Usually means the app was not rebuilt after installing react-native-razorpay.
      console.warn(
        'Razorpay Checkout could not open:',
        error instanceof Error
          ? error.message
          : `code ${String(failure.nativeCode)}`,
      );
    }
    throw failure;
  }
}

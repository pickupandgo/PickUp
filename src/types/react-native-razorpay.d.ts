// Types for react-native-razorpay 3.x, which ships no TypeScript declarations.
declare module 'react-native-razorpay' {
  export interface RazorpayCheckoutOptions {
    /** Public key id (rzp_test_... / rzp_live_...). Never the key secret. */
    key: string;
    /** Amount in paise; must equal the order amount. */
    amount: number;
    currency: 'INR';
    order_id: string;
    name?: string;
    description?: string;
    image?: string;
    prefill?: { name?: string; email?: string; contact?: string };
    theme?: { color?: string };
    /** Seconds before Checkout stops accepting the payment. */
    timeout?: number;
    retry?: { enabled?: boolean; max_count?: number };
  }

  export interface RazorpaySuccessData {
    razorpay_payment_id: string;
    razorpay_order_id?: string;
    razorpay_signature?: string;
  }

  export interface RazorpayErrorData {
    code: number;
    description: string;
  }

  const RazorpayCheckout: {
    open(options: RazorpayCheckoutOptions): Promise<RazorpaySuccessData>;
  };
  export default RazorpayCheckout;
}

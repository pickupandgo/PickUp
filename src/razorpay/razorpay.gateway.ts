import type { CreateOrderInput, RazorpayOrder, RazorpayPayment } from './razorpay.types';

/**
 * Port for the Razorpay REST API. The HTTP implementation is used in production; tests use an
 * in-memory fake. Implementations throw RazorpayApiError or RazorpayUnavailableError.
 *
 * Callers must never hold database locks while calling these methods.
 */
export abstract class RazorpayGateway {
  /** POST /v1/orders */
  abstract createOrder(input: CreateOrderInput): Promise<RazorpayOrder>;

  /** GET /v1/orders?receipt=... Used to recover an order whose creation response was lost. */
  abstract findOrderByReceipt(receipt: string): Promise<RazorpayOrder | null>;

  /** GET /v1/payments/:id */
  abstract fetchPayment(paymentId: string): Promise<RazorpayPayment>;

  /** POST /v1/payments/:id/capture */
  abstract capturePayment(paymentId: string, amountPaise: number): Promise<RazorpayPayment>;

  /** GET /v1/orders/:id/payments */
  abstract fetchOrderPayments(orderId: string): Promise<RazorpayPayment[]>;

  /** GET /v1/orders/:id. Used to map a payment-link order back to its collection (receipt). */
  abstract fetchOrder(orderId: string): Promise<RazorpayOrder>;
}

import { z } from 'zod';

export const RAZORPAY_ORDER_ID_PATTERN = /^order_[A-Za-z0-9]{6,40}$/;
export const RAZORPAY_PAYMENT_ID_PATTERN = /^pay_[A-Za-z0-9]{6,40}$/;
export const RAZORPAY_REFUND_ID_PATTERN = /^rfnd_[A-Za-z0-9]{6,40}$/;

/** Razorpay payment states that matter to us. Unknown future states are treated as "not paid". */
export const RazorpayPaymentState = {
  CREATED: 'created',
  AUTHORIZED: 'authorized',
  CAPTURED: 'captured',
  REFUNDED: 'refunded',
  FAILED: 'failed',
} as const;

export interface RazorpayOrder {
  readonly id: string;
  readonly amount: number;
  readonly currency: string;
  readonly receipt: string | null;
  /** created | attempted | paid */
  readonly status: string;
}

export interface RazorpayPayment {
  readonly id: string;
  readonly amount: number;
  readonly currency: string;
  /** created | authorized | captured | refunded | failed */
  readonly status: string;
  readonly orderId: string | null;
  readonly method: string | null;
  /**
   * How much of it Razorpay has refunded (amount_refunded), when the response says so. Read
   * only by reconciliation (payment flow Phase 7); never used to apply a payment.
   */
  readonly amountRefunded?: number | null;
}

export interface CreateOrderInput {
  readonly amountPaise: number;
  /** Our payment id. Razorpay allows at most 40 characters. */
  readonly receipt: string;
  /** Non-sensitive metadata. Razorpay allows at most 15 pairs of 256 characters. */
  readonly notes: Readonly<Record<string, string>>;
}

export const razorpayOrderSchema = z.looseObject({
  id: z.string().regex(RAZORPAY_ORDER_ID_PATTERN),
  entity: z.literal('order'),
  amount: z.number().int().nonnegative(),
  currency: z.string().length(3),
  receipt: z.string().nullable().optional(),
  status: z.string(),
});

/** Payment entity as returned by the REST API and inside webhook payloads. */
export const razorpayPaymentSchema = z.looseObject({
  id: z.string().regex(RAZORPAY_PAYMENT_ID_PATTERN),
  entity: z.literal('payment'),
  amount: z.number().int().nonnegative(),
  currency: z.string().length(3),
  status: z.string(),
  order_id: z.string().nullable().optional(),
  method: z.string().nullable().optional(),
});

/**
 * Refund entity as returned by the refunds API and inside refund.* webhook payloads. The fields
 * money depends on (id, payment, amount, currency, status) are strict; notes and acquirer_data
 * are read leniently (Razorpay sends [] for empty notes).
 */
export const razorpayRefundSchema = z.looseObject({
  id: z.string().regex(RAZORPAY_REFUND_ID_PATTERN),
  entity: z.literal('refund'),
  amount: z.number().int().positive(),
  currency: z.string().length(3),
  payment_id: z.string().regex(RAZORPAY_PAYMENT_ID_PATTERN),
  /** pending | processed | failed */
  status: z.string().min(1).max(30),
  receipt: z.string().max(100).nullish(),
  notes: z.unknown().optional(),
  acquirer_data: z.unknown().optional(),
  speed_processed: z.string().max(20).nullish(),
  created_at: z.number().int().nonnegative().nullish(),
});

export const razorpayRefundCollectionSchema = z.looseObject({
  entity: z.literal('collection'),
  items: z.array(razorpayRefundSchema),
});

export const razorpayOrderCollectionSchema = z.looseObject({
  entity: z.literal('collection'),
  items: z.array(razorpayOrderSchema),
});

export const razorpayPaymentCollectionSchema = z.looseObject({
  entity: z.literal('collection'),
  items: z.array(razorpayPaymentSchema),
});

export function toRazorpayOrder(raw: z.infer<typeof razorpayOrderSchema>): RazorpayOrder {
  return {
    id: raw.id,
    amount: raw.amount,
    currency: raw.currency,
    receipt: raw.receipt ?? null,
    status: raw.status,
  };
}

export function toRazorpayPayment(raw: z.infer<typeof razorpayPaymentSchema>): RazorpayPayment {
  // Lenient on purpose: an unexpected amount_refunded never makes a payment unreadable.
  const refunded: unknown = (raw as Record<string, unknown>).amount_refunded;
  return {
    id: raw.id,
    amount: raw.amount,
    currency: raw.currency,
    status: raw.status,
    orderId: raw.order_id ?? null,
    method: raw.method ?? null,
    amountRefunded:
      typeof refunded === 'number' && Number.isSafeInteger(refunded) && refunded >= 0
        ? refunded
        : null,
  };
}

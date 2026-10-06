import { z } from 'zod';

export const RAZORPAY_ORDER_ID_PATTERN = /^order_[A-Za-z0-9]{6,40}$/;
export const RAZORPAY_PAYMENT_ID_PATTERN = /^pay_[A-Za-z0-9]{6,40}$/;

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
  return {
    id: raw.id,
    amount: raw.amount,
    currency: raw.currency,
    status: raw.status,
    orderId: raw.order_id ?? null,
    method: raw.method ?? null,
  };
}

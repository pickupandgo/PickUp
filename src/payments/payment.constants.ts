export const PaymentPurpose = {
  BOOKING: 'BOOKING',
  DRIVER_WALLET_TOPUP: 'DRIVER_WALLET_TOPUP',
} as const;
export type PaymentPurpose = (typeof PaymentPurpose)[keyof typeof PaymentPurpose];

export const PAYMENT_PROVIDER_RAZORPAY = 'RAZORPAY';

/** Where a confirmation attempt came from. Recorded on the ledger entry metadata. */
export type ConfirmationSource = 'CHECKOUT_VERIFY' | 'WEBHOOK' | 'ADMIN_SYNC' | 'DRIVER_REFRESH';

/** Result of trying to apply a provider payment (wallet credit, booking payment, collection). */
export const ConfirmationOutcome = {
  /** The payment was applied now. */
  APPLIED: 'APPLIED',
  /** The same provider payment was already applied; nothing changed. */
  ALREADY_APPLIED: 'ALREADY_APPLIED',
  /** Razorpay does not report the payment as captured yet (pending, failed, ...). */
  NOT_CAPTURED: 'NOT_CAPTURED',
  /** Provider amount or currency differs from the server-created order. Not applied. */
  AMOUNT_MISMATCH: 'AMOUNT_MISMATCH',
  /** Provider payment does not belong to this order. Not applied. */
  ORDER_MISMATCH: 'ORDER_MISMATCH',
  /** The order was already paid by a different provider payment. Not applied. */
  DUPLICATE_ORDER_PAYMENT: 'DUPLICATE_ORDER_PAYMENT',
  /** Our payment record is no longer pending (failed or refunded). Not applied. */
  PAYMENT_NOT_PENDING: 'PAYMENT_NOT_PENDING',
  /** The booking was already paid another way (second payment for one booking). Not applied. */
  DUPLICATE_BOOKING_PAYMENT: 'DUPLICATE_BOOKING_PAYMENT',
  /** The booking is cancelled or completed, so an authorized payment was not captured. */
  BOOKING_NOT_PAYABLE: 'BOOKING_NOT_PAYABLE',
  /** Captured money arrived for a cancelled booking. Recorded as paid; refund review (D-22). */
  PAID_AFTER_CANCELLATION: 'PAID_AFTER_CANCELLATION',
  /**
   * Captured money arrived for a drop that was resolved as undelivered meanwhile. Recorded as
   * paid for that drop; refund review (payment flow Phase 6).
   */
  PAID_FOR_CLOSED_DROP: 'PAID_FOR_CLOSED_DROP',
} as const;
export type ConfirmationOutcome = (typeof ConfirmationOutcome)[keyof typeof ConfirmationOutcome];

/** Outcomes that mean money may have moved without a matching effect: needs a human. */
export const ANOMALY_OUTCOMES: ReadonlySet<ConfirmationOutcome> = new Set([
  ConfirmationOutcome.AMOUNT_MISMATCH,
  ConfirmationOutcome.ORDER_MISMATCH,
  ConfirmationOutcome.DUPLICATE_ORDER_PAYMENT,
  ConfirmationOutcome.PAYMENT_NOT_PENDING,
  ConfirmationOutcome.DUPLICATE_BOOKING_PAYMENT,
  ConfirmationOutcome.BOOKING_NOT_PAYABLE,
  ConfirmationOutcome.PAID_AFTER_CANCELLATION,
  ConfirmationOutcome.PAID_FOR_CLOSED_DROP,
]);

/** Webhook-only outcomes, stored on payment_events.outcome. */
export const WebhookOutcome = {
  IGNORED_EVENT_TYPE: 'IGNORED_EVENT_TYPE',
  PAYMENT_ATTEMPT_FAILED: 'PAYMENT_ATTEMPT_FAILED',
  UNKNOWN_ORDER: 'UNKNOWN_ORDER',
  MISSING_ORDER_ID: 'MISSING_ORDER_ID',
  UNSUPPORTED_PURPOSE: 'UNSUPPORTED_PURPOSE',
  UNSUPPORTED_PAYLOAD: 'UNSUPPORTED_PAYLOAD',
  /** A collection (payment link / QR) event for a collection this service did not create. */
  UNKNOWN_COLLECTION: 'UNKNOWN_COLLECTION',
  /** The collection is still open at the provider; nothing to apply yet. */
  COLLECTION_NOT_PAID: 'COLLECTION_NOT_PAID',
  /** The collection expired or was cancelled at the provider and is now FAILED. */
  COLLECTION_CLOSED: 'COLLECTION_CLOSED',
  /** A dispute was recorded; see payment_disputes for the earning hold result. */
  DISPUTE_RECORDED: 'DISPUTE_RECORDED',
} as const;
export type WebhookOutcome = (typeof WebhookOutcome)[keyof typeof WebhookOutcome];

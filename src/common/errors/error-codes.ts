/**
 * Stable, client-facing error codes. Apps branch on `error.code`, never on message text.
 * Adding codes is safe; renaming or removing one is a breaking API change.
 */
export const ErrorCode = {
  // Authentication and authorization
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  AUTH_INVALID_TOKEN: 'AUTH_INVALID_TOKEN',
  AUTH_PROVIDER_UNAVAILABLE: 'AUTH_PROVIDER_UNAVAILABLE',
  USER_NOT_PROVISIONED: 'USER_NOT_PROVISIONED',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  FORBIDDEN: 'FORBIDDEN',
  /**
   * The action needs a fresh re-authentication (phone OTP) on top of the session.
   * `details.reason`: NOT_PHONE_SIGN_IN, PHONE_MISMATCH or REAUTHENTICATION_REQUIRED.
   */
  STEP_UP_REQUIRED: 'STEP_UP_REQUIRED',
  /** The sign-in has no verified phone number (Firebase `phone_number` claim). */
  PHONE_VERIFICATION_REQUIRED: 'PHONE_VERIFICATION_REQUIRED',
  /** The verified phone already belongs to another account; it is never re-linked. */
  PHONE_ALREADY_REGISTERED: 'PHONE_ALREADY_REGISTERED',
  /** The sign-in belongs to a driver or admin account, which can't also be a customer. */
  ACCOUNT_ROLE_CONFLICT: 'ACCOUNT_ROLE_CONFLICT',

  // Request handling
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  RATE_LIMITED: 'RATE_LIMITED',
  CONFLICT: 'CONFLICT',
  IDEMPOTENCY_KEY_REQUIRED: 'IDEMPOTENCY_KEY_REQUIRED',
  IDEMPOTENCY_KEY_INVALID: 'IDEMPOTENCY_KEY_INVALID',
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',

  // Wallet
  DRIVER_NOT_APPROVED: 'DRIVER_NOT_APPROVED',
  WALLET_NOT_FOUND: 'WALLET_NOT_FOUND',
  WALLET_BLOCKED: 'WALLET_BLOCKED',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  AMOUNT_OUT_OF_RANGE: 'AMOUNT_OUT_OF_RANGE',

  // Payments
  PAYMENT_NOT_FOUND: 'PAYMENT_NOT_FOUND',
  PAYMENT_ORDER_MISMATCH: 'PAYMENT_ORDER_MISMATCH',
  INVALID_PAYMENT_SIGNATURE: 'INVALID_PAYMENT_SIGNATURE',
  PAYMENT_NOT_PAYABLE: 'PAYMENT_NOT_PAYABLE',
  PAYMENT_VERIFICATION_FAILED: 'PAYMENT_VERIFICATION_FAILED',
  PAYMENT_PROVIDER_ERROR: 'PAYMENT_PROVIDER_ERROR',
  PAYMENT_PROVIDER_UNAVAILABLE: 'PAYMENT_PROVIDER_UNAVAILABLE',

  // Webhooks
  WEBHOOK_SIGNATURE_INVALID: 'WEBHOOK_SIGNATURE_INVALID',
  WEBHOOK_MALFORMED: 'WEBHOOK_MALFORMED',

  // Internal (trip engine) API
  INTERNAL_API_DISABLED: 'INTERNAL_API_DISABLED',
  INTERNAL_AUTH_INVALID: 'INTERNAL_AUTH_INVALID',

  // Bookings and trips
  CUSTOMER_NOT_FOUND: 'CUSTOMER_NOT_FOUND',
  DRIVER_NOT_FOUND: 'DRIVER_NOT_FOUND',
  BOOKING_NOT_FOUND: 'BOOKING_NOT_FOUND',
  BOOKING_REF_CONFLICT: 'BOOKING_REF_CONFLICT',
  /** The payment method is not offered for new bookings (PREPAID_UPI is retired). */
  PAYMENT_METHOD_NOT_OFFERED: 'PAYMENT_METHOD_NOT_OFFERED',
  BOOKING_NOT_PAYABLE: 'BOOKING_NOT_PAYABLE',
  BOOKING_ALREADY_PAID: 'BOOKING_ALREADY_PAID',
  BOOKING_CLOSED: 'BOOKING_CLOSED',
  TRIP_NOT_FOUND: 'TRIP_NOT_FOUND',
  TRIP_ALREADY_ASSIGNED: 'TRIP_ALREADY_ASSIGNED',
  INVALID_TRIP_TRANSITION: 'INVALID_TRIP_TRANSITION',
  /**
   * The goods can't be handed over (or the trip completed) before payment. `details.stage`:
   * PICKUP (with `amountPaise`) or DROP (with `stopSequence` and `amountPaise`) for a handover.
   */
  PAYMENT_REQUIRED: 'PAYMENT_REQUIRED',
  /** The booking has no drop with this sequence (historical bookings have no drops). */
  STOP_NOT_FOUND: 'STOP_NOT_FOUND',
  /**
   * The drop can't make this move now. `details`: from, to, currentStop (the drop that matters
   * now, or null), tripStatus, and reason (TRIP_NOT_UNDER_WAY, OUT_OF_ORDER or INVALID_TRANSITION).
   */
  INVALID_STOP_TRANSITION: 'INVALID_STOP_TRANSITION',
  /** Priced per drop: the trip is delivered once every drop is finished. `details.pendingStops`. */
  STOPS_PENDING: 'STOPS_PENDING',
  /**
   * Priced per drop: report the drop's own status, the trip follows from its drops (409). For a
   * collection of a booking paid drop by drop: name the drop being paid for (422, payment flow
   * Phase 4).
   */
  STOP_REQUIRED: 'STOP_REQUIRED',

  // Fare (pricing versions and quotes)
  /** No pricing version is in effect, so no fare can be quoted. */
  PRICING_NOT_CONFIGURED: 'PRICING_NOT_CONFIGURED',
  PRICING_VERSION_INVALID: 'PRICING_VERSION_INVALID',
  PRICING_VERSION_OVERLAP: 'PRICING_VERSION_OVERLAP',
  PRICING_VERSION_NOT_FOUND: 'PRICING_VERSION_NOT_FOUND',
  /** The pricing version in effect has no rates for this vehicle category. */
  VEHICLE_CATEGORY_NOT_PRICED: 'VEHICLE_CATEGORY_NOT_PRICED',
  QUOTE_NOT_FOUND: 'QUOTE_NOT_FOUND',
  /** The quote's validity passed; ask for a new quote and show the new price. */
  QUOTE_EXPIRED: 'QUOTE_EXPIRED',
  /** The quote was already used for another booking. */
  QUOTE_ALREADY_USED: 'QUOTE_ALREADY_USED',
  /** More drops than a booking may have right now. `details.maxDrops` is the current limit. */
  TOO_MANY_DROPS: 'TOO_MANY_DROPS',
  /** The quote carries tax, which can't be booked until a tax rule is approved. */
  TAX_NOT_SUPPORTED: 'TAX_NOT_SUPPORTED',

  // Collections (pickup / delivery payments)
  /**
   * Nothing is owed here now. `details.stage`; for a booking paid drop by drop also `reason`
   * (STOP_ALREADY_PAID or NOT_CURRENT), `stopSequence`, `stopStatus` and `currentStop`.
   */
  COLLECTION_NOT_ALLOWED: 'COLLECTION_NOT_ALLOWED',
  COLLECTION_NOT_FOUND: 'COLLECTION_NOT_FOUND',
  COLLECTION_AMOUNT_MISMATCH: 'COLLECTION_AMOUNT_MISMATCH',
  COLLECTION_PROVIDER_NOT_CONFIGURED: 'COLLECTION_PROVIDER_NOT_CONFIGURED',
  COLLECTION_IN_PROGRESS: 'COLLECTION_IN_PROGRESS',

  // Platform fee rules
  FEE_RULE_NOT_CONFIGURED: 'FEE_RULE_NOT_CONFIGURED',
  FEE_RULE_AMBIGUOUS: 'FEE_RULE_AMBIGUOUS',
  FEE_RULE_INVALID: 'FEE_RULE_INVALID',
  FEE_RULE_OVERLAP: 'FEE_RULE_OVERLAP',
  FEE_RULE_NOT_FOUND: 'FEE_RULE_NOT_FOUND',

  // Earnings, bank accounts and payouts
  EARNING_NOT_FOUND: 'EARNING_NOT_FOUND',
  EARNING_INVALID_STATE: 'EARNING_INVALID_STATE',
  BANK_ACCOUNT_NOT_FOUND: 'BANK_ACCOUNT_NOT_FOUND',
  BANK_ACCOUNT_EXISTS: 'BANK_ACCOUNT_EXISTS',
  BANK_ACCOUNT_INVALID_STATE: 'BANK_ACCOUNT_INVALID_STATE',
  BANK_ACCOUNT_REJECTED_BY_PROVIDER: 'BANK_ACCOUNT_REJECTED_BY_PROVIDER',
  PAYOUT_PROVIDER_NOT_CONFIGURED: 'PAYOUT_PROVIDER_NOT_CONFIGURED',
  PAYOUT_PROVIDER_ERROR: 'PAYOUT_PROVIDER_ERROR',
  PAYOUT_PROVIDER_UNAVAILABLE: 'PAYOUT_PROVIDER_UNAVAILABLE',
  PAYOUT_BATCH_NOT_FOUND: 'PAYOUT_BATCH_NOT_FOUND',
  PAYOUT_NOT_FOUND: 'PAYOUT_NOT_FOUND',
  /** A bank-account change is already waiting for validation and admin approval. */
  BANK_ACCOUNT_CHANGE_PENDING: 'BANK_ACCOUNT_CHANGE_PENDING',
  BANK_CHANGE_REQUEST_NOT_FOUND: 'BANK_CHANGE_REQUEST_NOT_FOUND',
  /** The step-up window (10 minutes) passed: start a new change request. */
  BANK_CHANGE_REQUEST_EXPIRED: 'BANK_CHANGE_REQUEST_EXPIRED',
  /** The change request was already used, cancelled or superseded. `details.status` says which. */
  BANK_CHANGE_REQUEST_CLOSED: 'BANK_CHANGE_REQUEST_CLOSED',
  BANK_VALIDATION_NOT_FOUND: 'BANK_VALIDATION_NOT_FOUND',
  /** The bank validation does not allow approval (not completed, account not active, ...). */
  BANK_VALIDATION_NOT_ACCEPTABLE: 'BANK_VALIDATION_NOT_ACCEPTABLE',
  /** The bank's registered name is not an exact KYC match and no resolution was recorded. */
  BANK_NAME_MISMATCH_UNRESOLVED: 'BANK_NAME_MISMATCH_UNRESOLVED',
  DRIVER_KYC_NAME_MISSING: 'DRIVER_KYC_NAME_MISSING',

  // Merchant settlements
  SETTLEMENT_TRACKING_DISABLED: 'SETTLEMENT_TRACKING_DISABLED',

  // Refunds (admin only, payment flow Phase 6)
  REFUND_NOT_FOUND: 'REFUND_NOT_FOUND',
  /**
   * The named source can't be refunded this way: not a collection or booking payment of this
   * booking (and drop), or not the means it was paid by (cash returns only for cash). 422.
   */
  REFUND_SOURCE_INVALID: 'REFUND_SOURCE_INVALID',
  /**
   * Nothing is refundable here now: the booking is still live (only a cancelled or completed
   * booking is refunded), the source isn't completed/paid, or it was already refunded in full.
   * `details.reason`, and `refundablePaise` when it applies. 409.
   */
  REFUND_SOURCE_NOT_REFUNDABLE: 'REFUND_SOURCE_NOT_REFUNDABLE',
  /** A refund of this source is already PENDING or PROCESSING. `details.refundId`. 409. */
  REFUND_IN_PROGRESS: 'REFUND_IN_PROGRESS',
  /**
   * The amount isn't allowed: partial refunds are off (REFUND_PARTIAL_ALLOWED=false) and it
   * differs from what is left, or it exceeds what is left. `details.refundablePaise`. 422.
   */
  REFUND_AMOUNT_NOT_ALLOWED: 'REFUND_AMOUNT_NOT_ALLOWED',
  /** The booking's refund case is not allowed by configuration (L-7). `details.refundCase`. 409. */
  REFUND_CASE_NOT_ALLOWED: 'REFUND_CASE_NOT_ALLOWED',
  /** A cash return needs the admin's decision on the cash platform fee (feeTreatment). 422. */
  REFUND_FEE_TREATMENT_REQUIRED: 'REFUND_FEE_TREATMENT_REQUIRED',
  /** The booking's earning is in a payout being executed; retry once that payout resolves. 409. */
  REFUND_EARNING_IN_PAYOUT: 'REFUND_EARNING_IN_PAYOUT',
  /** The refund can't make this move now (e.g. cancel a refund already sent). `details.status`. 409. */
  REFUND_INVALID_STATE: 'REFUND_INVALID_STATE',
  /** Provider refunds are off on this server (REFUND_PROVIDER=disabled). 503. */
  REFUND_PROVIDER_NOT_CONFIGURED: 'REFUND_PROVIDER_NOT_CONFIGURED',
  /** Razorpay refused or could not be asked; the refund stays as recorded. 502. */
  REFUND_PROVIDER_ERROR: 'REFUND_PROVIDER_ERROR',

  // Platform
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

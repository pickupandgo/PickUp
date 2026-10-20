/**
 * Port for booking-linked online collection objects (PW 6): a Razorpay Payment Link or a
 * Razorpay QR Code, always created by the server for the booking's confirmed fare and always
 * paid into Nikhil Enterprises' Razorpay account. Never a driver's personal UPI id.
 *
 * Implementations throw RazorpayApiError (definitive) or RazorpayUnavailableError (retryable).
 * Callers must never hold database locks while calling these methods.
 */

export type CollectionProduct = 'PAYMENT_LINK' | 'QR_CODE';

export type CollectionLinkStatus =
  /** Open and payable. */
  | 'ACTIVE'
  /** Paid in full; `payments` lists the captured payment(s). */
  | 'PAID'
  /** Some money arrived but not the full amount (should never happen: partial payments are off). */
  | 'PARTIALLY_PAID'
  | 'EXPIRED'
  | 'CANCELLED';

export interface CollectionLinkPayment {
  /** Razorpay payment id, pay_... */
  readonly id: string;
  readonly amount: number;
  readonly currency: string;
  /** Razorpay payment status; only `captured` counts as money received. */
  readonly status: string;
  readonly method: string | null;
  readonly orderId: string | null;
}

export interface CollectionLinkState {
  readonly product: CollectionProduct;
  /** Provider id: plink_... or qr_... */
  readonly referenceId: string;
  readonly status: CollectionLinkStatus;
  /** Payment link short URL, or QR code image URL. */
  readonly url: string | null;
  readonly amountPaise: number;
  readonly currency: string;
  readonly expiresAt: Date | null;
  readonly orderId: string | null;
  readonly payments: readonly CollectionLinkPayment[];
}

export interface CreateCollectionLinkInput {
  /** Our collection id: the provider reference_id and a note, so every event maps back to it. */
  readonly collectionId: string;
  readonly bookingId: string;
  /** What the QR is for, kept in its notes: the pickup, or a delivery (one drop, or all). */
  readonly stage: 'PICKUP' | 'DELIVERY';
  /** The drop it pays for (a booking paid drop by drop); null for the whole booking. */
  readonly stop: { readonly id: string; readonly sequence: number } | null;
  /** The obligation's amount, resolved on the server. */
  readonly amountPaise: number;
  readonly expiresAt: Date;
  readonly description: string;
}

export abstract class CollectionLinkGateway {
  abstract create(
    product: CollectionProduct,
    input: CreateCollectionLinkInput,
  ): Promise<CollectionLinkState>;

  abstract fetch(product: CollectionProduct, referenceId: string): Promise<CollectionLinkState>;

  /**
   * Cancels (payment link) or closes (QR code) the object so it can no longer be paid. When it
   * can't be cancelled any more (already paid, expired), returns its current state instead.
   */
  abstract cancel(product: CollectionProduct, referenceId: string): Promise<CollectionLinkState>;

  /**
   * The QR code a payment was made to, or null. QR payments carry no order id, so this is how a
   * payment.captured event is mapped back to its collection.
   */
  abstract findQrCodeIdByPayment(paymentId: string): Promise<string | null>;
}

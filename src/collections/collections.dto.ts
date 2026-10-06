import { IsIn, IsInt, Max, Min } from 'class-validator';

export const COLLECTION_METHODS = ['CASH', 'ONLINE_QR'] as const;
export type CollectionMethodValue = (typeof COLLECTION_METHODS)[number];

export class CreateCollectionRequest {
  /** CASH: the driver took cash. ONLINE_QR: show the customer a booking-linked Razorpay QR. */
  @IsIn(COLLECTION_METHODS)
  method!: CollectionMethodValue;

  /**
   * The amount, in paise. Must equal the booking's confirmed fare; it is a confirmation only.
   * The server never derives fees or earnings from it.
   */
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  amountPaise!: number;
}

export class CollectionQrView {
  /** PAYMENT_LINK: render `url` as a QR code. QR_CODE: `url` is the QR image. */
  product!: 'PAYMENT_LINK' | 'QR_CODE';
  url!: string | null;
  expiresAt!: string | null;
}

export class CollectionResponse {
  collectionId!: string;
  bookingId!: string;
  tripId!: string;
  stage!: string;
  method!: CollectionMethodValue;
  /** PENDING (QR shown, not paid yet), COMPLETED, FAILED (QR expired or cancelled), REVERSED. */
  status!: string;
  amountPaise!: number;
  /** CASH only: platform fee debited from the driver wallet. */
  platformFeePaise!: number | null;
  /** ONLINE_QR only. */
  qr!: CollectionQrView | null;
  providerPaymentId!: string | null;
  paymentMethod!: string | null;
  failureReason!: string | null;
  completedAt!: string | null;
  createdAt!: string;
  /** True when this request was already processed and nothing new happened. */
  replayed!: boolean;
}

export class AdminCollectionResponse extends CollectionResponse {
  collectedByDriverId!: string;
  provider!: string | null;
  providerReferenceId!: string | null;
  providerOrderId!: string | null;
  feeRuleId!: string | null;
  walletTransactionId!: string | null;
  idempotencyKey!: string;
}

export class SyncCollectionResponse {
  collection!: AdminCollectionResponse;
  outcome!: string;
}

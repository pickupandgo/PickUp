import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PaymentGateView } from '../bookings/bookings.dto';

export const COLLECTION_METHODS = ['CASH', 'ONLINE_QR'] as const;
export type CollectionMethodValue = (typeof COLLECTION_METHODS)[number];

export class CreateCollectionRequest {
  /** CASH: the driver took cash. ONLINE_QR: show the customer a booking-linked Razorpay QR. */
  @IsIn(COLLECTION_METHODS)
  method!: CollectionMethodValue;

  /**
   * The drop being paid for. Required for a booking paid drop by drop (pay at delivery, priced
   * per drop): only the drop the driver is at, before it is paid. Refused for any other booking,
   * which is collected for the whole booking.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(25)
  stopSequence?: number;

  /**
   * The amount, in paise: a confirmation of what the trip view says is owed (the booking's
   * payable amount, or the drop's). The server resolves the amount itself from the frozen fare and
   * refuses a different one. It never derives fees or earnings from it.
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
  /** The drop this collection pays for; null for the whole booking. */
  stopSequence!: number | null;
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

/** What the driver app gets back: the collection, and the booking's payment state right now. */
export class DriverCollectionResponse extends CollectionResponse {
  /** UNPAID, PARTIALLY_PAID (some drops paid) or PAID, as the server recorded it. */
  bookingPaymentStatus!: string;
  /** Whether the goods may be handed over now, and what is owed first. */
  paymentGate!: PaymentGateView;
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

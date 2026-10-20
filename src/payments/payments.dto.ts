import { IsInt, Matches, Max, Min } from 'class-validator';
import { CustomerBookingResponse } from '../bookings/bookings.dto';
import { RAZORPAY_ORDER_ID_PATTERN, RAZORPAY_PAYMENT_ID_PATTERN } from '../razorpay/razorpay.types';
import { WalletResponse } from '../wallet/wallet.dto';

type PaymentStatusValue = 'PENDING' | 'PAID' | 'FAILED' | 'REFUND_PENDING' | 'REFUNDED';

export class CreateTopUpRequest {
  /** Amount to add, in paise (100 paise = Rs 1). Bounded by WALLET_TOPUP_MIN/MAX_PAISE. */
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  amountPaise!: number;
}

/** The three values Razorpay Checkout returns on success. */
export class VerifyTopUpRequest {
  @Matches(RAZORPAY_ORDER_ID_PATTERN, { message: 'razorpayOrderId is invalid' })
  razorpayOrderId!: string;

  @Matches(RAZORPAY_PAYMENT_ID_PATTERN, { message: 'razorpayPaymentId is invalid' })
  razorpayPaymentId!: string;

  @Matches(/^[a-fA-F0-9]{64}$/, { message: 'razorpaySignature is invalid' })
  razorpaySignature!: string;
}

export class RazorpayCheckoutParams {
  /** Public Razorpay key id for Checkout. Safe in apps; the key secret never leaves the server. */
  keyId!: string;
  orderId!: string;
  /** Must be passed to Checkout unchanged. */
  amountPaise!: number;
  currency!: 'INR';
}

export class TopUpResponse {
  paymentId!: string;
  status!: PaymentStatusValue;
  amountPaise!: number;
  currency!: 'INR';
  /** Values to open Razorpay Checkout with. Present only while the payment is PENDING. */
  checkout!: RazorpayCheckoutParams | null;
  providerPaymentId!: string | null;
  paymentMethod!: string | null;
  createdAt!: string;
  updatedAt!: string;
}

export class VerifyTopUpResponse {
  payment!: TopUpResponse;
  /** Razorpay's state for the submitted payment: captured, authorized, failed, ... */
  providerStatus!: string;
  /** Wallet after the credit; null until the top-up is PAID. */
  wallet!: WalletResponse | null;
}

export class AdminPaymentResponse extends TopUpResponse {
  userId!: string;
  purpose!: string;
  bookingId!: string | null;
  razorpayOrderId!: string | null;
}

export class SyncAttemptResponse {
  providerPaymentId!: string;
  providerStatus!: string;
  outcome!: string;
}

export class SyncPaymentResponse {
  payment!: AdminPaymentResponse;
  attempts!: SyncAttemptResponse[];
}

export class WebhookAckResponse {
  received!: true;
}

export class BookingPaymentResponse extends TopUpResponse {
  bookingId!: string;
}

export class BookingPaymentStateResponse {
  booking!: CustomerBookingResponse;
  /** The latest payment attempt, or null if the customer has not started paying. */
  payment!: BookingPaymentResponse | null;
}

export class VerifyBookingPaymentResponse {
  booking!: CustomerBookingResponse;
  payment!: BookingPaymentResponse;
  /** Razorpay's state for the submitted payment: captured, authorized, failed, ... */
  providerStatus!: string;
}

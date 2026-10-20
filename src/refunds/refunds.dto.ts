import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';

export const REFUND_KINDS = ['PROVIDER', 'CASH_RETURNED'] as const;
export const REFUND_STATUSES = [
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'REFUSED',
  'CANCELLED',
] as const;
export const FEE_TREATMENTS = ['KEPT', 'CREDITED_TO_WALLET'] as const;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * An admin's refund request. The amount is always computed by the server from what the source
 * collected and what was already refunded; `amountPaise` only confirms it (or, with partial
 * refunds enabled, chooses less). Name exactly one source of this booking.
 */
export class CreateRefundRequest {
  @IsUUID('4')
  bookingId!: string;

  /** A completed collection of this booking (QR for PROVIDER, cash for CASH_RETURNED). */
  @IsOptional()
  @IsUUID('4')
  sourceCollectionId?: string;

  /** A paid prepaid booking payment of this booking (historical PREPAID_UPI bookings). */
  @IsOptional()
  @IsUUID('4')
  sourcePaymentId?: string;

  /** Optional cross-check: the drop the source collection paid for. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(25)
  stopSequence?: number;

  /** PROVIDER: refund through Razorpay. CASH_RETURNED: the cash was handed back. */
  @IsIn(REFUND_KINDS)
  kind!: (typeof REFUND_KINDS)[number];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  amountPaise?: number;

  /** Why the money goes back (ticket, complaint, decision reference). Stored and audited. */
  @Transform(trim)
  @IsString()
  @Length(10, 500)
  reason!: string;

  /** CASH_RETURNED only, required: what happens to the cash platform fee the wallet paid. */
  @IsOptional()
  @IsIn(FEE_TREATMENTS)
  feeTreatment?: (typeof FEE_TREATMENTS)[number];
}

export class CancelRefundRequest {
  /** Why the refund is withdrawn. Stored on the refund and in the audit trail. */
  @Transform(trim)
  @IsString()
  @Length(10, 500)
  reason!: string;
}

export class ListRefundsQuery {
  @IsOptional()
  @IsUUID('4')
  bookingId?: string;

  @IsOptional()
  @IsIn(REFUND_STATUSES)
  status?: (typeof REFUND_STATUSES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class RefundResponse {
  refundId!: string;
  bookingId!: string;
  /** The drop the refunded collection paid for; null for money of the whole booking. */
  stopSequence!: number | null;
  sourceCollectionId!: string | null;
  sourcePaymentId!: string | null;
  kind!: (typeof REFUND_KINDS)[number];
  status!: (typeof REFUND_STATUSES)[number];
  /** What the booking's facts showed at the request. Recorded for review; decides nothing. */
  refundCase!: string;
  amountPaise!: number;
  currency!: string;
  reason!: string;
  requestedByUserId!: string;
  provider!: string | null;
  providerPaymentId!: string | null;
  providerRefundId!: string | null;
  providerStatus!: string | null;
  /** The bank's reference for a processed refund (ARN / RRN), once reported. */
  providerReference!: string | null;
  feeTreatment!: (typeof FEE_TREATMENTS)[number] | null;
  feeCreditPaise!: number | null;
  walletTransactionId!: string | null;
  failureReason!: string | null;
  submitAttempts!: number;
  lastSubmittedAt!: string | null;
  completedAt!: string | null;
  failedAt!: string | null;
  cancelledAt!: string | null;
  cancelledByUserId!: string | null;
  cancellationReason!: string | null;
  createdAt!: string;
  updatedAt!: string;
}

export class CreateRefundResponse {
  refund!: RefundResponse;
  /** False when this Idempotency-Key was already used: the original refund is returned. */
  created!: boolean;
  /**
   * Provider refunds: what sending it did on this request (PROCESSING, COMPLETED, FAILED,
   * REFUSED, PENDING_RETRY when the outcome is unknown and it will be retried, SKIPPED when a
   * submission is already in flight). Null for cash returns.
   */
  submission!: string | null;
}

export class SyncRefundResponse {
  refund!: RefundResponse;
  outcome!: string;
}

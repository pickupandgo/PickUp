import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';

export const EARNING_STATUSES = [
  'AWAITING_SETTLEMENT',
  'PAYABLE',
  'ON_HOLD',
  'IN_PAYOUT',
  'PAID',
  'SETTLED_IN_CASH',
] as const;
export type EarningStatusValue = (typeof EARNING_STATUSES)[number];

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ListEarningsQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  /** `nextCursor` from the previous page. */
  @IsOptional()
  @IsUUID('4')
  cursor?: string;

  @IsOptional()
  @IsIn(EARNING_STATUSES)
  status?: EarningStatusValue;
}

export class AdminListEarningsQuery extends ListEarningsQuery {
  @IsOptional()
  @IsUUID('4')
  driverId?: string;
}

export class EarningDecisionRequest {
  /** Why the earning is held or released (ticket, dispute id, ...). Stored in the audit trail. */
  @Transform(trim)
  @IsString()
  @Length(10, 500)
  reason!: string;
}

export class EarningResponse {
  earningId!: string;
  bookingId!: string;
  tripId!: string;
  /**
   * ONLINE: paid to Nikhil Enterprises, net share paid out weekly. CASH: driver kept the cash.
   * MIXED: a booking paid drop by drop, partly in cash and partly online (its online part is paid
   * out once payment flow Phase 5 is in place; until then it stays AWAITING_SETTLEMENT).
   */
  settlement!: 'ONLINE' | 'CASH' | 'MIXED';
  status!: EarningStatusValue;
  /** Confirmed fare the customer paid, in paise. */
  grossAmountPaise!: number;
  platformFeePaise!: number;
  /** Approved deductions other than the platform fee. 0 in V1. */
  otherDeductionsPaise!: number;
  /** Tax deducted at source. 0 while the TDS policy is DISABLED. */
  tdsAmountPaise!: number;
  tdsPolicy!: string;
  /** gross - fee - other deductions - TDS. */
  netAmountPaise!: number;
  /** ONLINE only: true once Razorpay has settled the customer payment to Nikhil Enterprises. */
  merchantSettled!: boolean;
  /** When the earning became eligible for a payout (ONLINE, after settlement). */
  payableAt!: string | null;
  paidAt!: string | null;
  holdReason!: string | null;
  createdAt!: string;
}

export class AdminEarningResponse extends EarningResponse {
  driverId!: string;
  feeRuleId!: string;
  taxRuleId!: string | null;
  paymentId!: string | null;
  collectionId!: string | null;
  paymentSettlementId!: string | null;
  heldAt!: string | null;
  heldByUserId!: string | null;
}

export class EarningPageResponse {
  items!: EarningResponse[];
  nextCursor!: string | null;
}

export class AdminEarningPageResponse {
  items!: AdminEarningResponse[];
  nextCursor!: string | null;
}

/** Totals per state, in paise. The wallet balance is not part of this and never was. */
export class EarningSummaryResponse {
  /** ONLINE earnings whose customer payment is not settled yet. Not payable until it is. */
  awaitingSettlementPaise!: number;
  /** Settled ONLINE earnings waiting for the next Monday payout. */
  payablePaise!: number;
  inPayoutPaise!: number;
  onHoldPaise!: number;
  paidPaise!: number;
  settledInCashPaise!: number;
  grossPaise!: number;
  platformFeePaise!: number;
  tripCount!: number;
}

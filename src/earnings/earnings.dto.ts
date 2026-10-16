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
   * MIXED: a booking paid drop by drop, partly in cash (already with the driver) and partly online
   * (its net paid out once every online drop is settled).
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
  /** Collected in cash: already in the driver's hand. cash + online = gross. */
  cashCollectedPaise!: number;
  /** Collected online (prepaid or QR): with Nikhil Enterprises until paid out. */
  onlineCollectedPaise!: number;
  /** Platform fee on the cash part, already debited from the wallet. */
  cashFeePaise!: number;
  /** Platform fee on the online part, kept from the payout. */
  onlineFeePaise!: number;
  /** Cash collected minus its fee: the driver's share already kept. */
  netCashPaise!: number;
  /** Online collected minus its fee. */
  netOnlinePaise!: number;
  /** What a payout carries for this earning: 0 for CASH, the online net otherwise. */
  payoutAmountPaise!: number;
  /** Online money Razorpay has already settled to Nikhil Enterprises. */
  onlineSettledPaise!: number;
  /** True once every online payment of the earning is settled (never for CASH). */
  merchantSettled!: boolean;
  /** When the earning became eligible for a payout (after every online settlement). */
  payableAt!: string | null;
  paidAt!: string | null;
  holdReason!: string | null;
  createdAt!: string;
}

/** One collection funding an earning, and its merchant settlement (online only). */
export class EarningSourceView {
  collectionId!: string;
  /** The drop it paid for (a booking paid drop by drop); null for the whole booking. */
  stopSequence!: number | null;
  method!: string;
  amountPaise!: number;
  platformFeePaise!: number;
  /** amount - platform fee: what this collection contributes to the earning. */
  netAmountPaise!: number;
  /** Online only: settled to Nikhil Enterprises (cash needs no settlement). */
  settled!: boolean;
  settlementId!: string | null;
  providerSettlementId!: string | null;
  settledAt!: string | null;
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
  /** Every collection funding the earning (none for a prepaid or a pre-Phase 4 earning). */
  sources!: EarningSourceView[];
}

export class EarningPageResponse {
  items!: EarningResponse[];
  nextCursor!: string | null;
}

export class AdminEarningPageResponse {
  items!: AdminEarningResponse[];
  nextCursor!: string | null;
}

/**
 * Totals per state, in paise. The wallet balance is not part of this and never was. A MIXED
 * earning counts its cash part (already kept) under settledInCashPaise and its payout amount under
 * its status.
 */
export class EarningSummaryResponse {
  /** Payout amounts whose online payments are not all settled yet. Not payable until they are. */
  awaitingSettlementPaise!: number;
  /** Settled payout amounts waiting for the next Monday payout. */
  payablePaise!: number;
  inPayoutPaise!: number;
  onHoldPaise!: number;
  paidPaise!: number;
  /** The driver's share of cash already kept (cash collected minus its fee). */
  settledInCashPaise!: number;
  grossPaise!: number;
  platformFeePaise!: number;
  tripCount!: number;
}

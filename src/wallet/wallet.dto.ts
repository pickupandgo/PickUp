import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

type WalletStatusValue = 'ACTIVE' | 'LOW_BALANCE' | 'BLOCKED';
type EntryTypeValue = 'TOPUP' | 'CASH_RIDE_FEE' | 'REFUND_REVERSAL' | 'ADJUSTMENT';
const DIRECTIONS = ['CREDIT', 'DEBIT'] as const;

export class WalletResponse {
  walletId!: string;
  status!: WalletStatusValue;
  /** Balance in paise (100 paise = Rs 1). */
  balancePaise!: number;
  currency!: 'INR';
  updatedAt!: string;
}

export class WalletTransactionResponse {
  id!: string;
  type!: EntryTypeValue;
  direction!: (typeof DIRECTIONS)[number];
  /** Always positive; `direction` says whether it was added or removed. */
  amountPaise!: number;
  balanceAfterPaise!: number;
  /** Position in this wallet's ledger: 1, 2, 3, ... with no gaps. */
  sequence!: number;
  referenceType!: string;
  referenceId!: string;
  providerPaymentId!: string | null;
  reason!: string | null;
  createdAt!: string;
}

export class AdminWalletTransactionResponse extends WalletTransactionResponse {
  providerOrderId!: string | null;
  providerEventId!: string | null;
  performedByUserId!: string | null;
  idempotencyKey!: string;
}

export class WalletTransactionPageResponse {
  items!: WalletTransactionResponse[];
  /** Pass as `cursor` to fetch the next (older) page; null when there are no more entries. */
  nextCursor!: string | null;
}

export class AdminWalletTransactionPageResponse {
  items!: AdminWalletTransactionResponse[];
  nextCursor!: string | null;
}

export class AdminWalletResponse extends WalletResponse {
  driverId!: string;
  /** Number of ledger entries applied to this wallet. */
  version!: number;
  createdAt!: string;
}

export class ListTransactionsQuery {
  /** Page size, 1-100. Defaults to 20. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  /** `nextCursor` from the previous page. */
  @IsOptional()
  @IsString()
  @Matches(/^[1-9][0-9]{0,17}$/, { message: 'cursor is invalid' })
  cursor?: string;
}

export class CreateAdjustmentRequest {
  @IsIn(DIRECTIONS)
  direction!: (typeof DIRECTIONS)[number];

  /** Amount in paise. Capped by ADMIN_ADJUSTMENT_MAX_PAISE. */
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  amountPaise!: number;

  /** Why the adjustment is needed (ticket number, incident). Stored on the ledger entry. */
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(10, 500)
  reason!: string;
}

export class AdjustmentResponse {
  transaction!: AdminWalletTransactionResponse;
  wallet!: AdminWalletResponse;
  /** True when this Idempotency-Key was already processed and nothing changed. */
  replayed!: boolean;
}

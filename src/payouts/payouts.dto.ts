import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export const BANK_ACCOUNT_STATUSES = [
  'PENDING_VERIFICATION',
  'VERIFIED',
  'REJECTED',
  'SUSPENDED',
] as const;
export const PAYOUT_STATUSES = [
  'PREPARED',
  'SUBMITTING',
  'SUBMITTED',
  'PROCESSED',
  'FAILED',
  'REVERSED',
] as const;

export class SubmitBankAccountRequest {
  /** Name exactly as on the bank account. */
  @Transform(trim)
  @IsString()
  @Matches(/^[A-Za-z][A-Za-z .'-]{1,118}[A-Za-z.]$/, {
    message: 'accountHolderName must be 3-120 letters, spaces, dots, apostrophes or hyphens',
  })
  accountHolderName!: string;

  @Transform(upper)
  @IsString()
  @Matches(/^[A-Z]{4}0[A-Z0-9]{6}$/, { message: 'ifsc must be a valid 11-character IFSC' })
  ifsc!: string;

  /** Sent to the payout provider only; only the last 4 digits are stored. */
  @Transform(trim)
  @IsString()
  @Matches(/^[0-9]{9,18}$/, { message: 'accountNumber must be 9-18 digits' })
  accountNumber!: string;

  /** Must equal accountNumber (guards against a typo sending money to someone else). */
  @Transform(trim)
  @IsString()
  @Matches(/^[0-9]{9,18}$/, { message: 'confirmAccountNumber must be 9-18 digits' })
  confirmAccountNumber!: string;
}

export class ApproveBankAccountRequest {
  /** The bank validation to approve on. Defaults to the account's latest validation. */
  @IsOptional()
  @IsUUID('4')
  verificationId?: string;

  /**
   * Required when the bank's registered name is not an exact match of the driver's KYC name:
   * what the admin checked and why the difference is acceptable (stored with the audit trail).
   */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(10, 500)
  mismatchResolution?: string;
}

export class BankAccountDecisionRequest {
  @Transform(trim)
  @IsString()
  @Length(10, 500)
  reason!: string;
}

export class ListBankAccountsQuery {
  @IsOptional()
  @IsIn(BANK_ACCOUNT_STATUSES)
  status?: (typeof BANK_ACCOUNT_STATUSES)[number];
}

export class PrepareBatchRequest {
  /** Earnings payable up to this instant are included. Defaults to now. */
  @IsOptional()
  @IsISO8601({ strict: true })
  cutoffAt?: string;
}

export class ListPayoutsQuery {
  @IsOptional()
  @IsIn(PAYOUT_STATUSES)
  status?: (typeof PAYOUT_STATUSES)[number];

  @IsOptional()
  @IsUUID('4')
  driverId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

/** What the app must do before confirming a bank-account change request. */
export class StepUpChallengeResponse {
  /**
   * FIREBASE_PHONE_REAUTH: re-authenticate the signed-in Firebase user with an OTP sent to the
   * registered phone, then call confirm with the fresh ID token.
   */
  method!: string;
  /** The registered number the OTP must be sent to, masked (+91******3210). */
  phoneNumberHint!: string;
  /** The re-authentication must happen after this instant. */
  notBefore!: string;
}

export class BankAccountChangeRequestResponse {
  changeRequestId!: string;
  /** PENDING_STEP_UP, COMPLETED, CANCELLED or EXPIRED. */
  status!: string;
  createdAt!: string;
  /** Confirm before this instant (10 minutes after createdAt). */
  expiresAt!: string;
  /** Present while the request waits for the step-up. */
  stepUp!: StepUpChallengeResponse | null;
}

/** For admins approving an account: how the driver proved it was them. */
export class BankAccountChangeEvidenceResponse {
  changeRequestId!: string;
  stepUpMethod!: string;
  /** The OTP sign-in (token auth_time); always after requestedAt. */
  stepUpAuthTime!: string | null;
  stepUpVerifiedAt!: string | null;
  requestedAt!: string;
}

export class BankAccountResponse {
  bankAccountId!: string;
  accountHolderName!: string;
  ifsc!: string;
  /** Only the last 4 digits are ever stored or shown. */
  accountNumberLast4!: string;
  /** PENDING_VERIFICATION, VERIFIED, REJECTED or SUSPENDED. */
  status!: string;
  /** True only for VERIFIED: the only status that receives payouts. */
  payoutsEnabled!: boolean;
  /**
   * Latest bank validation: NOT_STARTED, IN_PROGRESS, COMPLETED or FAILED. The name the bank
   * reported is shown to admins only.
   */
  validationStatus!: string;
  verifiedAt!: string | null;
  statusReason!: string | null;
  createdAt!: string;
}

export class BankValidationResponse {
  validationId!: string;
  provider!: string;
  providerValidationId!: string;
  method!: string;
  /** CREATED (waiting for the bank), COMPLETED or FAILED. */
  status!: string;
  /** ACTIVE or INVALID once completed. */
  accountStatus!: string | null;
  registeredName!: string | null;
  nameMatchScore!: number | null;
  /** MATCH, PARTIAL, MISMATCH or UNAVAILABLE against comparedName. */
  nameMatchResult!: string | null;
  comparedName!: string | null;
  utr!: string | null;
  failureReason!: string | null;
  requestedByUserId!: string | null;
  completedAt!: string | null;
  createdAt!: string;
}

export class AdminBankAccountResponse extends BankAccountResponse {
  driverId!: string;
  provider!: string;
  providerContactId!: string;
  providerFundAccountId!: string;
  changeRequestId!: string | null;
  verifiedByUserId!: string | null;
  verificationReference!: string | null;
  approvedVerificationId!: string | null;
  nameMatchResolution!: string | null;
  statusChangedByUserId!: string | null;
}

export class AdminBankAccountDetailResponse extends AdminBankAccountResponse {
  /** The driver's KYC legal name the bank name is compared with. */
  driverLegalName!: string | null;
  /**
   * The step-up verified change request that added the account. Null only for accounts added
   * before step-up verification existed (they can't be approved).
   */
  changeRequest!: BankAccountChangeEvidenceResponse | null;
  /** Newest first. */
  validations!: BankValidationResponse[];
}

export class PayoutItemResponse {
  earningId!: string;
  amountPaise!: number;
  status!: string;
}

export class DriverPayoutResponse {
  payoutId!: string;
  /** Sum of the carried earnings (net of platform fee). */
  grossAmountPaise!: number;
  /** Tax deducted at source. 0 while the TDS policy is DISABLED. */
  tdsAmountPaise!: number;
  otherDeductionsPaise!: number;
  /** Amount transferred: gross - TDS - other deductions. */
  amountPaise!: number;
  /** PREPARED, SUBMITTING, SUBMITTED, PROCESSED, FAILED, REVERSED */
  status!: string;
  /** Bank reference once the transfer is processed. */
  utr!: string | null;
  bankAccountLast4!: string;
  processedAt!: string | null;
  failedAt!: string | null;
  createdAt!: string;
  items!: PayoutItemResponse[];
}

export class AdminPayoutResponse {
  payoutId!: string;
  batchId!: string;
  driverId!: string;
  bankAccountId!: string;
  grossAmountPaise!: number;
  tdsAmountPaise!: number;
  otherDeductionsPaise!: number;
  tdsPolicy!: string;
  taxRuleId!: string | null;
  amountPaise!: number;
  mode!: string;
  status!: string;
  provider!: string;
  providerPayoutId!: string | null;
  providerStatus!: string | null;
  utr!: string | null;
  failureReason!: string | null;
  attempts!: number;
  submittedAt!: string | null;
  processedAt!: string | null;
  failedAt!: string | null;
  reversedAt!: string | null;
  createdAt!: string;
  items!: PayoutItemResponse[];
}

export class PayoutBatchResponse {
  batchId!: string;
  cycleKey!: string;
  origin!: string;
  cutoffAt!: string;
  status!: string;
  payoutCount!: number;
  totalAmountPaise!: number;
  createdByUserId!: string | null;
  executedAt!: string | null;
  completedAt!: string | null;
  createdAt!: string;
}

export class PayoutBatchDetailResponse extends PayoutBatchResponse {
  payouts!: AdminPayoutResponse[];
}

export class PrepareBatchResponse {
  batch!: PayoutBatchResponse;
  /** False when this Idempotency-Key already prepared a batch. */
  created!: boolean;
}

export class ExecuteBatchResponse {
  batch!: PayoutBatchResponse;
  results!: { payoutId: string; result: string }[];
}

export class SyncPayoutResponse {
  payout!: AdminPayoutResponse;
  outcome!: string;
}

/** The weekly payout schedule (system configuration: PAYOUT_SCHEDULE_*). */
export class PayoutScheduleResponse {
  enabled!: boolean;
  /** ISO weekday, 1 = Monday. */
  weekday!: number;
  weekdayName!: string;
  /** HH:MM in timeZone. */
  time!: string;
  timeZone!: string;
  autoExecute!: boolean;
  lastRunAt!: string;
  lastRunKey!: string;
  nextRunAt!: string;
}

export class RunScheduleResponse {
  /** This cycle's batch, or null when the schedule is disabled or the run failed. */
  batch!: PayoutBatchResponse | null;
}

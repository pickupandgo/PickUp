import {
  bool,
  invalid,
  list,
  nullableText,
  nullableTimestamp,
  oneOf,
  record,
  text,
  timestamp,
  UUID_PATTERN,
  wholeNumber,
} from './responseChecks';

/*
 * Driver earnings, weekly payouts and the payout bank account (raj_backend /v1/earnings,
 * /v1/payouts, /v1/bank-account). Every state and amount comes from the server; the app never
 * derives "payable" or "paid" itself. The wallet balance is a separate thing and never appears
 * here.
 */

export type EarningStatusDto =
  /** Customer paid online; Razorpay has not settled it to Nikhil Enterprises yet. */
  | 'AWAITING_SETTLEMENT'
  /** Settled: goes out in the next Monday payout. */
  | 'PAYABLE'
  /** Held for review (dispute, reversed payout, admin). */
  | 'ON_HOLD'
  /** In a payout that has not finished yet. */
  | 'IN_PAYOUT'
  | 'PAID'
  /** Cash trip: the driver kept the fare; the fee came from the wallet. */
  | 'SETTLED_IN_CASH';

export const EARNING_STATUSES: readonly EarningStatusDto[] = [
  'AWAITING_SETTLEMENT',
  'PAYABLE',
  'ON_HOLD',
  'IN_PAYOUT',
  'PAID',
  'SETTLED_IN_CASH',
];

export interface EarningDto {
  readonly earningId: string;
  readonly bookingId: string;
  readonly tripId: string;
  readonly settlement: 'ONLINE' | 'CASH';
  readonly status: EarningStatusDto;
  readonly grossAmountPaise: number;
  readonly platformFeePaise: number;
  readonly otherDeductionsPaise: number;
  readonly tdsAmountPaise: number;
  /** gross - platform fee - other deductions - TDS. */
  readonly netAmountPaise: number;
  readonly merchantSettled: boolean;
  readonly payableAt: string | null;
  readonly paidAt: string | null;
  readonly createdAt: string;
}

export interface EarningPageDto {
  readonly items: readonly EarningDto[];
  readonly nextCursor: string | null;
}

/** Net totals per state, in paise. */
export interface EarningsSummaryDto {
  readonly awaitingSettlementPaise: number;
  readonly payablePaise: number;
  readonly inPayoutPaise: number;
  readonly onHoldPaise: number;
  readonly paidPaise: number;
  readonly settledInCashPaise: number;
  readonly grossPaise: number;
  readonly platformFeePaise: number;
  readonly tripCount: number;
}

export type PayoutStatusDto =
  | 'PREPARED'
  | 'SUBMITTING'
  | 'SUBMITTED'
  | 'PROCESSED'
  | 'FAILED'
  | 'REVERSED';

export interface PayoutDto {
  readonly payoutId: string;
  readonly grossAmountPaise: number;
  readonly tdsAmountPaise: number;
  readonly otherDeductionsPaise: number;
  /** What reaches the bank: gross - TDS - other deductions. */
  readonly amountPaise: number;
  readonly status: PayoutStatusDto;
  /** Bank reference once processed. */
  readonly utr: string | null;
  readonly bankAccountLast4: string;
  readonly processedAt: string | null;
  readonly failedAt: string | null;
  readonly createdAt: string;
  readonly earningCount: number;
}

export type BankAccountStatusDto =
  | 'PENDING_VERIFICATION'
  | 'VERIFIED'
  | 'REJECTED'
  | 'SUSPENDED';

export interface BankAccountDto {
  readonly bankAccountId: string;
  readonly accountHolderName: string;
  readonly ifsc: string;
  /** Only the last 4 digits ever leave the server. */
  readonly accountNumberLast4: string;
  readonly status: BankAccountStatusDto;
  /** True only for VERIFIED accounts. */
  readonly payoutsEnabled: boolean;
  readonly validationStatus:
    | 'NOT_STARTED'
    | 'IN_PROGRESS'
    | 'COMPLETED'
    | 'FAILED';
}

const SETTLEMENTS = ['ONLINE', 'CASH'] as const;
const PAYOUT_STATUSES: readonly PayoutStatusDto[] = [
  'PREPARED',
  'SUBMITTING',
  'SUBMITTED',
  'PROCESSED',
  'FAILED',
  'REVERSED',
];
const BANK_STATUSES: readonly BankAccountStatusDto[] = [
  'PENDING_VERIFICATION',
  'VERIFIED',
  'REJECTED',
  'SUSPENDED',
];
const VALIDATION_STATUSES = [
  'NOT_STARTED',
  'IN_PROGRESS',
  'COMPLETED',
  'FAILED',
] as const;
const LAST4_PATTERN = /^[0-9]{4}$/;
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export function parseEarning(value: unknown): EarningDto {
  const json = record(value, 'earning');
  const gross = wholeNumber(json.grossAmountPaise, 'earning gross');
  const fee = wholeNumber(json.platformFeePaise, 'earning fee');
  const other = wholeNumber(json.otherDeductionsPaise, 'earning deductions');
  const tds = wholeNumber(json.tdsAmountPaise, 'earning TDS');
  const net = wholeNumber(json.netAmountPaise, 'earning net');
  if (net !== gross - fee - other - tds) {
    // The server's own invariant; refuse to show numbers that do not add up.
    invalid('earning amounts');
  }
  return {
    earningId: text(json.earningId, 'earning id', UUID_PATTERN),
    bookingId: text(json.bookingId, 'booking id', UUID_PATTERN),
    tripId: text(json.tripId, 'trip id', UUID_PATTERN),
    settlement: oneOf(json.settlement, SETTLEMENTS, 'earning settlement'),
    status: oneOf(json.status, EARNING_STATUSES, 'earning status'),
    grossAmountPaise: gross,
    platformFeePaise: fee,
    otherDeductionsPaise: other,
    tdsAmountPaise: tds,
    netAmountPaise: net,
    merchantSettled: bool(json.merchantSettled, 'settlement flag'),
    payableAt: nullableTimestamp(json.payableAt, 'payable time'),
    paidAt: nullableTimestamp(json.paidAt, 'paid time'),
    createdAt: timestamp(json.createdAt, 'earning time'),
  };
}

export function parseEarningPage(value: unknown): EarningPageDto {
  const json = record(value, 'earnings page');
  return {
    items: list(json.items, 'earnings list').map(parseEarning),
    nextCursor: nullableText(json.nextCursor, 'earnings cursor', UUID_PATTERN),
  };
}

export function parseEarningsSummary(value: unknown): EarningsSummaryDto {
  const json = record(value, 'earnings summary');
  return {
    awaitingSettlementPaise: wholeNumber(
      json.awaitingSettlementPaise,
      'awaiting settlement',
    ),
    payablePaise: wholeNumber(json.payablePaise, 'payable'),
    inPayoutPaise: wholeNumber(json.inPayoutPaise, 'in payout'),
    onHoldPaise: wholeNumber(json.onHoldPaise, 'on hold'),
    paidPaise: wholeNumber(json.paidPaise, 'paid'),
    settledInCashPaise: wholeNumber(json.settledInCashPaise, 'cash'),
    grossPaise: wholeNumber(json.grossPaise, 'gross'),
    platformFeePaise: wholeNumber(json.platformFeePaise, 'platform fee'),
    tripCount: wholeNumber(json.tripCount, 'trip count'),
  };
}

export function parsePayout(value: unknown): PayoutDto {
  const json = record(value, 'payout');
  const gross = wholeNumber(json.grossAmountPaise, 'payout gross');
  const tds = wholeNumber(json.tdsAmountPaise, 'payout TDS');
  const other = wholeNumber(json.otherDeductionsPaise, 'payout deductions');
  const amount = wholeNumber(json.amountPaise, 'payout amount');
  if (amount !== gross - tds - other) {
    invalid('payout amounts');
  }
  return {
    payoutId: text(json.payoutId, 'payout id', UUID_PATTERN),
    grossAmountPaise: gross,
    tdsAmountPaise: tds,
    otherDeductionsPaise: other,
    amountPaise: amount,
    status: oneOf(json.status, PAYOUT_STATUSES, 'payout status'),
    utr: nullableText(json.utr, 'payout UTR'),
    bankAccountLast4: text(
      json.bankAccountLast4,
      'bank account',
      LAST4_PATTERN,
    ),
    processedAt: nullableTimestamp(json.processedAt, 'processed time'),
    failedAt: nullableTimestamp(json.failedAt, 'failed time'),
    createdAt: timestamp(json.createdAt, 'payout time'),
    earningCount: list(json.items, 'payout items').length,
  };
}

export function parsePayouts(value: unknown): readonly PayoutDto[] {
  return list(value, 'payouts').map(parsePayout);
}

export function parseBankAccount(value: unknown): BankAccountDto {
  const json = record(value, 'bank account');
  const status = oneOf(json.status, BANK_STATUSES, 'bank account status');
  const payoutsEnabled = bool(json.payoutsEnabled, 'payouts flag');
  if (payoutsEnabled !== (status === 'VERIFIED')) {
    invalid('bank account state');
  }
  return {
    bankAccountId: text(json.bankAccountId, 'bank account id', UUID_PATTERN),
    accountHolderName: text(json.accountHolderName, 'account holder'),
    ifsc: text(json.ifsc, 'IFSC', IFSC_PATTERN),
    accountNumberLast4: text(
      json.accountNumberLast4,
      'account number',
      LAST4_PATTERN,
    ),
    status,
    payoutsEnabled,
    validationStatus: oneOf(
      json.validationStatus,
      VALIDATION_STATUSES,
      'validation status',
    ),
  };
}

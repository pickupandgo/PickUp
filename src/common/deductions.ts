/**
 * Server-side breakdown of what a driver is owed, for earnings and for payouts:
 *
 *   gross - platform fee - other approved deductions - TDS = net
 *
 * Clients never send any of these numbers (DTOs whitelist their fields and reject unknown ones,
 * so tdsRate, tdsAmount or netPayable in a request is a 400).
 *
 * TDS policy (OPEN_DECISIONS D-57): DISABLED. Whether driver payouts are subject to TDS, and the
 * exact rule, waits for the CA. Until then TDS is 0, no tax rule is referenced, and TDS_ENABLED
 * cannot be turned on. When a rule is approved it will be a versioned tax_rules row, computed
 * here with the shared HALF_UP money utility and snapshotted (policy, rule id, amount) on each
 * earning or payout when it is recorded; recorded amounts never change afterwards (triggers).
 */

export type TdsPolicy = 'DISABLED' | 'TAX_RULE';

export interface DeductionSnapshot {
  readonly otherDeductionsPaise: bigint;
  readonly tdsAmountPaise: bigint;
  readonly tdsPolicy: TdsPolicy;
  readonly taxRuleId: string | null;
}

export interface EarningBreakdown extends DeductionSnapshot {
  readonly grossAmountPaise: bigint;
  readonly platformFeePaise: bigint;
  readonly netAmountPaise: bigint;
}

export interface PayoutBreakdown extends DeductionSnapshot {
  /** Sum of the carried earnings' net amounts. */
  readonly grossAmountPaise: bigint;
  /** What is transferred to the bank account. */
  readonly amountPaise: bigint;
}

/** The only policy in force until a CA-approved rule exists. */
const NO_DEDUCTIONS: DeductionSnapshot = Object.freeze({
  otherDeductionsPaise: 0n,
  tdsAmountPaise: 0n,
  tdsPolicy: 'DISABLED',
  taxRuleId: null,
});

/** Breakdown of one trip earning. The fee comes from the booking's pinned fee rule. */
export function computeEarningBreakdown(
  grossAmountPaise: bigint,
  platformFeePaise: bigint,
): EarningBreakdown {
  if (grossAmountPaise <= 0n) {
    throw new RangeError('Gross amount must be positive');
  }
  if (platformFeePaise < 0n || platformFeePaise > grossAmountPaise) {
    throw new RangeError('Platform fee must be between 0 and the gross amount');
  }
  const deductions = NO_DEDUCTIONS;
  const net =
    grossAmountPaise -
    platformFeePaise -
    deductions.otherDeductionsPaise -
    deductions.tdsAmountPaise;
  if (net < 0n) {
    throw new RangeError('Deductions exceed the gross amount');
  }
  return { grossAmountPaise, platformFeePaise, netAmountPaise: net, ...deductions };
}

/** Breakdown of one payout carrying earnings whose net amounts sum to `grossAmountPaise`. */
export function computePayoutBreakdown(grossAmountPaise: bigint): PayoutBreakdown {
  if (grossAmountPaise <= 0n) {
    throw new RangeError('Payout gross must be positive');
  }
  const deductions = NO_DEDUCTIONS;
  const amount = grossAmountPaise - deductions.tdsAmountPaise - deductions.otherDeductionsPaise;
  if (amount < 0n) {
    throw new RangeError('Deductions exceed the payout gross');
  }
  return { grossAmountPaise, amountPaise: amount, ...deductions };
}

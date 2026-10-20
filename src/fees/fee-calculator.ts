/**
 * Platform-fee arithmetic. Everything is integer paise held as bigint; rule values are fixed-point
 * with 4 decimals (NUMERIC(12,4)), so no floating point is ever involved. Rounding is HALF_UP to
 * the nearest paisa through the shared money utility (OPEN_DECISIONS D-44).
 */
import { MONEY_ROUNDING_MODE, percentOfPaise, RATE_SCALE } from '../common/money';

export type FeeRuleType = 'FIXED' | 'PERCENTAGE';
/** Fee rules record their rounding mode; HALF_UP is the only one allowed (CHECK in SQL). */
export type RoundingMode = typeof MONEY_ROUNDING_MODE;

export const FEE_RULE_TYPES: readonly FeeRuleType[] = ['FIXED', 'PERCENTAGE'];
export const ROUNDING_MODES: readonly RoundingMode[] = [MONEY_ROUNDING_MODE];

/** NUMERIC(12,4): up to 8 integer digits and 4 decimals. */
export const FEE_VALUE_PATTERN = /^(0|[1-9][0-9]{0,7})(\.[0-9]{1,4})?$/;
const SCALE = RATE_SCALE;

export interface FeeFormula {
  readonly ruleType: FeeRuleType;
  /** The rule value multiplied by 10^4, e.g. 10% = 100000n, Rs 5 fixed (500 paise) = 5000000n. */
  readonly scaledValue: bigint;
  readonly roundingMode: RoundingMode;
}

export class FeeFormulaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeeFormulaError';
  }
}

/** Parses a decimal string such as "10", "10.5" or "2.2500" into a value scaled by 10^4. */
export function parseScaledValue(value: string): bigint {
  const trimmed = value.trim();
  if (!FEE_VALUE_PATTERN.test(trimmed)) {
    throw new FeeFormulaError('Fee value must be a non-negative number with at most 4 decimals');
  }
  const [whole = '0', fraction = ''] = trimmed.split('.');
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(4, '0'));
}

/** Formats a scaled value back to a decimal string with 4 decimals, e.g. 100000n -> "10.0000". */
export function formatScaledValue(scaled: bigint): string {
  const whole = scaled / SCALE;
  const fraction = (scaled % SCALE).toString().padStart(4, '0');
  return `${whole}.${fraction}`;
}

/** Throws when the formula breaks the rules the database also enforces (CHECK constraints). */
export function assertValidFormula(formula: FeeFormula): void {
  if ((formula.roundingMode as string) !== MONEY_ROUNDING_MODE) {
    throw new FeeFormulaError('Fees are always rounded HALF_UP to the nearest paisa');
  }
  if (formula.scaledValue < 0n) {
    throw new FeeFormulaError('Fee value cannot be negative');
  }
  if (formula.ruleType === 'PERCENTAGE' && formula.scaledValue >= 100n * SCALE) {
    throw new FeeFormulaError('A percentage fee must be below 100%');
  }
  if (formula.ruleType === 'FIXED' && formula.scaledValue % SCALE !== 0n) {
    throw new FeeFormulaError('A fixed fee must be a whole number of paise');
  }
}

/**
 * Platform fee for a fare. PERCENTAGE: fare x value / 100, rounded HALF_UP to whole paise.
 * FIXED: the value in paise. The fee can never exceed the fare.
 *
 * Examples: Rs 500 fare (50000 paise) at 10% -> 5000 paise fee, 45000 paise driver share.
 *           Rs 123.45 (12345 paise) at 10% -> 1234.5 -> 1235 paise (Rs 12.35).
 */
export function computePlatformFee(formula: FeeFormula, farePaise: bigint): bigint {
  assertValidFormula(formula);
  if (farePaise <= 0n) {
    throw new FeeFormulaError('Fare must be positive');
  }

  const fee =
    formula.ruleType === 'FIXED'
      ? formula.scaledValue / SCALE
      : percentOfPaise(farePaise, formula.scaledValue);

  if (fee > farePaise) {
    throw new FeeFormulaError('The platform fee would exceed the fare');
  }
  return fee;
}

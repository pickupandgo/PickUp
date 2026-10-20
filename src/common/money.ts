/**
 * Money helpers. Amounts are integer paise held as bigint inside the service and the database.
 * API responses use JSON numbers, which is exact for any balance below 2^53 paise.
 *
 * Every fractional money calculation (platform fee today, TDS once a CA-approved rule exists)
 * goes through the functions below, so rounding is the same everywhere: HALF_UP to the nearest
 * paisa (OPEN_DECISIONS D-44). No floating point is ever involved.
 *
 *   Rs 123.45 x 10% = Rs 12.345  ->  12345 paise x 10% = 1234.5 paise  ->  1235 paise (Rs 12.35)
 */

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER);

/** The only rounding mode for money in this system. */
export const MONEY_ROUNDING_MODE = 'HALF_UP' as const;
export type MoneyRoundingMode = typeof MONEY_ROUNDING_MODE;

/** Rates (fee percent, tax percent) are fixed-point with 4 decimals: 10% = 100000n. */
export const RATE_SCALE = 10_000n;

/** Converts a paise bigint to a JSON-safe number, refusing values that would lose precision. */
export function paiseToNumber(value: bigint): number {
  if (value > MAX_SAFE || value < MIN_SAFE) {
    throw new RangeError('Amount exceeds the JSON-safe integer range');
  }
  return Number(value);
}

/** Converts a validated integer number of paise to bigint. */
export function numberToPaise(value: number): bigint {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError('Amount must be a safe integer number of paise');
  }
  return BigInt(value);
}

/**
 * numerator / denominator rounded HALF_UP to an integer: an exact half goes up, anything below
 * goes down. Defined for non-negative numerators and positive denominators only, which covers
 * every money calculation here (fees and deductions are never negative).
 */
export function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new RangeError('Denominator must be positive');
  }
  if (numerator < 0n) {
    throw new RangeError('Numerator must not be negative');
  }
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

/**
 * `scaledPercent` percent of `amountPaise`, rounded HALF_UP to whole paise.
 * `scaledPercent` is the percentage times RATE_SCALE, e.g. 10% = 100000n, 2.5% = 25000n.
 */
export function percentOfPaise(amountPaise: bigint, scaledPercent: bigint): bigint {
  if (amountPaise < 0n) {
    throw new RangeError('Amount must not be negative');
  }
  if (scaledPercent < 0n) {
    throw new RangeError('Percentage must not be negative');
  }
  return divideHalfUp(amountPaise * scaledPercent, 100n * RATE_SCALE);
}

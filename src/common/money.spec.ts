import {
  divideHalfUp,
  MONEY_ROUNDING_MODE,
  numberToPaise,
  paiseToNumber,
  percentOfPaise,
} from './money';

describe('money', () => {
  it('rounds HALF_UP only', () => {
    expect(MONEY_ROUNDING_MODE).toBe('HALF_UP');
  });

  it.each([
    [10n, 4n, 3n], // 2.5 -> 3
    [9n, 4n, 2n], // 2.25 -> 2
    [11n, 4n, 3n], // 2.75 -> 3
    [8n, 4n, 2n], // exact
    [0n, 7n, 0n],
    [1n, 2n, 1n], // 0.5 -> 1
    [1n, 3n, 0n], // 0.333 -> 0
  ] as const)('divideHalfUp(%p, %p) = %p', (numerator, denominator, expected) => {
    expect(divideHalfUp(numerator, denominator)).toBe(expected);
  });

  it('computes the approved example exactly: 10% of Rs 123.45 is Rs 12.35', () => {
    expect(percentOfPaise(12_345n, 100_000n)).toBe(1_235n);
    expect(percentOfPaise(50_000n, 100_000n)).toBe(5_000n);
  });

  it('refuses negative inputs and non-positive denominators', () => {
    expect(() => divideHalfUp(-1n, 2n)).toThrow(RangeError);
    expect(() => divideHalfUp(1n, 0n)).toThrow(RangeError);
    expect(() => percentOfPaise(-1n, 100_000n)).toThrow(RangeError);
    expect(() => percentOfPaise(100n, -1n)).toThrow(RangeError);
  });

  it('converts between JSON numbers and paise without losing precision', () => {
    expect(paiseToNumber(45_000n)).toBe(45_000);
    expect(numberToPaise(45_000)).toBe(45_000n);
    expect(() => paiseToNumber(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow(RangeError);
    expect(() => numberToPaise(1.5)).toThrow(RangeError);
  });
});

import {
  assertValidFormula,
  computePlatformFee,
  type FeeFormula,
  FeeFormulaError,
  formatScaledValue,
  parseScaledValue,
} from './fee-calculator';

function percentage(value: string): FeeFormula {
  return { ruleType: 'PERCENTAGE', scaledValue: parseScaledValue(value), roundingMode: 'HALF_UP' };
}

function fixed(value: string): FeeFormula {
  return { ruleType: 'FIXED', scaledValue: parseScaledValue(value), roundingMode: 'HALF_UP' };
}

describe('fee calculator', () => {
  it('applies the approved V1 example: 10% of Rs 500 is Rs 50, driver keeps Rs 450', () => {
    const fee = computePlatformFee(percentage('10'), 50_000n);
    expect(fee).toBe(5_000n);
    expect(50_000n - fee).toBe(45_000n);
  });

  it('rounds HALF_UP to the nearest paisa: 10% of Rs 123.45 (Rs 12.345) is Rs 12.35', () => {
    expect(computePlatformFee(percentage('10'), 12_345n)).toBe(1_235n);
  });

  it.each([
    [12_344n, 1_234n], // 1234.4 -> down
    [12_345n, 1_235n], // 1234.5 -> exact half goes up
    [12_346n, 1_235n], // 1234.6 -> up
    [12_349n, 1_235n], // 1234.9 -> up
    [12_341n, 1_234n], // 1234.1 -> down
  ] as const)('10%% of %p paise is %p', (fare, expected) => {
    expect(computePlatformFee(percentage('10'), fare)).toBe(expected);
  });

  it('handles fractional percentages exactly, without floating point', () => {
    // 2.5% of 999 paise = 24.975 paise
    expect(computePlatformFee(percentage('2.5'), 999n)).toBe(25n);
    // 2.5% of 980 paise = 24.5 paise (exact half)
    expect(computePlatformFee(percentage('2.5'), 980n)).toBe(25n);
    // 33.3333% of 3 paise = 0.999999 paise
    expect(computePlatformFee(percentage('33.3333'), 3n)).toBe(1n);
    // 0.0001% of 1 paise = 0.000001 paise
    expect(computePlatformFee(percentage('0.0001'), 1n)).toBe(0n);
  });

  it('stays exact for very large fares', () => {
    const fare = 9_007_199_254_740_993n; // above 2^53
    // 10% = 900719925474099.3 -> 900719925474099
    expect(computePlatformFee(percentage('10'), fare)).toBe(900_719_925_474_099n);
  });

  it('supports a zero percentage and fixed fees in paise', () => {
    expect(computePlatformFee(percentage('0'), 50_000n)).toBe(0n);
    expect(computePlatformFee(fixed('2500'), 50_000n)).toBe(2_500n);
  });

  it('refuses formulas the database would also refuse', () => {
    expect(() => computePlatformFee(percentage('100'), 50_000n)).toThrow(FeeFormulaError);
    expect(() => computePlatformFee(fixed('10.5'), 50_000n)).toThrow(/whole number of paise/);
    expect(() => computePlatformFee(fixed('60000'), 50_000n)).toThrow(/exceed the fare/);
    expect(() => computePlatformFee(percentage('10'), 0n)).toThrow(/positive/);
  });

  it('refuses any rounding mode other than HALF_UP', () => {
    const down = { ...percentage('10'), roundingMode: 'DOWN' } as unknown as FeeFormula;
    expect(() => assertValidFormula(down)).toThrow(/HALF_UP/);
    expect(() => computePlatformFee(down, 12_345n)).toThrow(FeeFormulaError);
  });

  it.each(['-1', '1e3', '10.12345', 'abc', '', '123456789', '01'])(
    'rejects the value %p',
    (value) => {
      expect(() => parseScaledValue(value)).toThrow(FeeFormulaError);
    },
  );

  it('round-trips values with 4 decimals', () => {
    expect(formatScaledValue(parseScaledValue('10'))).toBe('10.0000');
    expect(formatScaledValue(parseScaledValue('0.05'))).toBe('0.0500');
    expect(formatScaledValue(parseScaledValue('99999999.9999'))).toBe('99999999.9999');
  });
});

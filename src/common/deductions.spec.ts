import { computeEarningBreakdown, computePayoutBreakdown } from './deductions';

describe('deductions (TDS policy DISABLED)', () => {
  it('breaks down the approved example: Rs 500 fare, Rs 50 fee, Rs 450 net, no TDS', () => {
    expect(computeEarningBreakdown(50_000n, 5_000n)).toEqual({
      grossAmountPaise: 50_000n,
      platformFeePaise: 5_000n,
      otherDeductionsPaise: 0n,
      tdsAmountPaise: 0n,
      tdsPolicy: 'DISABLED',
      taxRuleId: null,
      netAmountPaise: 45_000n,
    });
  });

  it('transfers the full payout gross while TDS is disabled', () => {
    expect(computePayoutBreakdown(45_000n)).toEqual({
      grossAmountPaise: 45_000n,
      amountPaise: 45_000n,
      otherDeductionsPaise: 0n,
      tdsAmountPaise: 0n,
      tdsPolicy: 'DISABLED',
      taxRuleId: null,
    });
  });

  it('refuses impossible inputs', () => {
    expect(() => computeEarningBreakdown(0n, 0n)).toThrow(RangeError);
    expect(() => computeEarningBreakdown(100n, 101n)).toThrow(RangeError);
    expect(() => computeEarningBreakdown(100n, -1n)).toThrow(RangeError);
    expect(() => computePayoutBreakdown(0n)).toThrow(RangeError);
  });
});

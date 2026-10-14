import { allocatePlatformFee, FeeAllocationError } from './fee-allocation';

const stops = (...fares: number[]) =>
  fares.map((fare, index) => ({ sequence: index + 1, farePaise: BigInt(fare) }));

const sum = (values: readonly bigint[]) => values.reduce((total, value) => total + value, 0n);

describe('allocatePlatformFee', () => {
  it('gives a single stop the whole fee', () => {
    expect(allocatePlatformFee(5_000n, stops(50_000))).toEqual([5_000n]);
  });

  it('splits exactly when the fee divides evenly', () => {
    // Rs 300 + Rs 250 + Rs 200 at 10%: Rs 30, Rs 25, Rs 20.
    expect(allocatePlatformFee(7_500n, stops(30_000, 25_000, 20_000))).toEqual([
      3_000n,
      2_500n,
      2_000n,
    ]);
  });

  it('hands leftover paise to the largest remainders, so the shares add up exactly', () => {
    // A 1000 paise fee over fares 3334 + 3334 + 3333 (Rs 100.01). Exact shares 333.37, 333.37
    // and 333.27 -> floors 333 + 333 + 333 = 999, one paisa left over. The first two remainders
    // tie, so the lower sequence gets it.
    const shares = allocatePlatformFee(1_000n, stops(3_334, 3_334, 3_333));
    expect(shares).toEqual([334n, 333n, 333n]);
    expect(sum(shares)).toBe(1_000n);
  });

  it('breaks equal remainders by sequence, not by input order', () => {
    const shuffled = [
      { sequence: 3, farePaise: 100n },
      { sequence: 1, farePaise: 100n },
      { sequence: 2, farePaise: 100n },
    ];
    // 2 paise over three equal fares: floors 0, remainders equal; sequences 1 and 2 get them.
    expect(allocatePlatformFee(2n, shuffled)).toEqual([0n, 1n, 1n]);
  });

  it('keeps every share within one paisa of its exact proportional share', () => {
    const fares = [12_345, 6_789, 101, 99_999, 55_555];
    const total = BigInt(fares.reduce((a, b) => a + b, 0));
    for (const fee of [0n, 1n, 7n, 1_234n, 17_480n, total]) {
      const shares = allocatePlatformFee(fee, stops(...fares));
      expect(sum(shares)).toBe(fee);
      shares.forEach((share, index) => {
        const floor = (fee * BigInt(fares[index] ?? 0)) / total;
        expect(share >= floor && share <= floor + 1n).toBe(true);
      });
    }
  });

  it('is deterministic', () => {
    const input = stops(7_001, 2_999, 4_444, 1);
    expect(allocatePlatformFee(1_445n, input)).toEqual(allocatePlatformFee(1_445n, input));
  });

  it('handles a zero fee and a fee equal to the whole fare', () => {
    expect(allocatePlatformFee(0n, stops(100, 200))).toEqual([0n, 0n]);
    expect(allocatePlatformFee(300n, stops(100, 200))).toEqual([100n, 200n]);
  });

  it('stays exact far beyond the floating point safe range', () => {
    // Rs 5,00,000 split over 25 drops at 99.99%.
    const fares = Array.from({ length: 25 }, (_unused, index) => 1_999_999 + index);
    const total = fares.reduce((a, b) => a + b, 0);
    const fee = (BigInt(total) * 9_999n) / 10_000n;
    const shares = allocatePlatformFee(fee, stops(...fares));
    expect(sum(shares)).toBe(fee);
  });

  it.each([
    ['no stops', 100n, []],
    ['a zero fare', 10n, [{ sequence: 1, farePaise: 0n }]],
    ['a negative fee', -1n, stops(100)],
    ['a fee above the fare', 101n, stops(100)],
    [
      'duplicate sequences',
      10n,
      [
        { sequence: 1, farePaise: 100n },
        { sequence: 1, farePaise: 100n },
      ],
    ],
    ['a zero sequence', 10n, [{ sequence: 0, farePaise: 100n }]],
  ])('refuses %s', (_name, fee, input) => {
    expect(() => allocatePlatformFee(fee, input)).toThrow(FeeAllocationError);
  });
});

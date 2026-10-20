import {
  type FundingCollection,
  type SourceSettlement,
  earningFunding,
  onlineSettlementProgress,
  prepaidSplit,
} from './earning-funding';

const cash = (id: string, amount: bigint): FundingCollection => ({
  collectionId: id,
  method: 'CASH',
  amountPaise: amount,
  platformFeePaise: amount / 10n,
});
const online = (id: string, amount: bigint): FundingCollection => ({
  ...cash(id, amount),
  method: 'ONLINE_QR',
});

describe('earningFunding', () => {
  it('keeps one collection as the earning source, as before', () => {
    expect(earningFunding([online('qr', 50_000n)])).toEqual({
      grossPaise: 50_000n,
      platformFeePaise: 5_000n,
      settlement: 'ONLINE',
      collectionId: 'qr',
      collections: [online('qr', 50_000n)],
      split: {
        cashCollectedPaise: 0n,
        onlineCollectedPaise: 50_000n,
        cashFeePaise: 0n,
        onlineFeePaise: 5_000n,
        payoutAmountPaise: 45_000n,
      },
    });
    expect(earningFunding([cash('cash', 50_000n)])).toMatchObject({
      settlement: 'CASH',
      collectionId: 'cash',
      split: { cashCollectedPaise: 50_000n, cashFeePaise: 5_000n, payoutAmountPaise: 0n },
    });
  });

  it('funds one earning from several drops, keeping the source of every amount', () => {
    const drops = [cash('drop-1', 20_000n), online('drop-2', 10_000n), cash('drop-3', 20_000n)];
    expect(earningFunding(drops)).toEqual({
      grossPaise: 50_000n,
      platformFeePaise: 5_000n,
      settlement: 'MIXED',
      collectionId: null,
      collections: drops,
      // The cash is in the driver's hand (its Rs 40 fee already debited); only the QR drop's
      // net (Rs 100 - Rs 10) is owed by a payout.
      split: {
        cashCollectedPaise: 40_000n,
        onlineCollectedPaise: 10_000n,
        cashFeePaise: 4_000n,
        onlineFeePaise: 1_000n,
        payoutAmountPaise: 9_000n,
      },
    });
  });

  it('splits every combination exactly: cash + cash, QR + QR, cash + QR, QR + cash + QR', () => {
    const cases: [FundingCollection[], string, bigint, bigint, bigint][] = [
      [[cash('a', 20_000n), cash('b', 30_000n)], 'CASH', 50_000n, 0n, 0n],
      [[online('a', 20_000n), online('b', 30_000n)], 'ONLINE', 0n, 50_000n, 45_000n],
      [[cash('a', 20_000n), online('b', 30_000n)], 'MIXED', 20_000n, 30_000n, 27_000n],
      [
        [online('a', 12_345n), cash('b', 10_000n), online('c', 7_655n)],
        'MIXED',
        10_000n,
        20_000n,
        18_001n,
      ],
    ];
    for (const [collections, settlement, cashPaise, onlinePaise, payout] of cases) {
      const funding = earningFunding(collections);
      expect(funding.settlement).toBe(settlement);
      expect(funding.split.cashCollectedPaise).toBe(cashPaise);
      expect(funding.split.onlineCollectedPaise).toBe(onlinePaise);
      expect(funding.split.payoutAmountPaise).toBe(payout);
      // The parts always add up to the earning.
      expect(funding.split.cashCollectedPaise + funding.split.onlineCollectedPaise).toBe(
        funding.grossPaise,
      );
      expect(funding.split.cashFeePaise + funding.split.onlineFeePaise).toBe(
        funding.platformFeePaise,
      );
      const netCash = funding.split.cashCollectedPaise - funding.split.cashFeePaise;
      expect(netCash + payout).toBe(funding.grossPaise - funding.platformFeePaise);
    }
  });

  it('counts only what was collected (an undelivered unpaid drop adds nothing)', () => {
    expect(earningFunding([cash('drop-1', 20_000n)])).toMatchObject({
      grossPaise: 20_000n,
      platformFeePaise: 2_000n,
    });
  });

  it('needs at least one collection', () => {
    expect(() => earningFunding([])).toThrow(/at least one completed collection/);
  });
});

describe('prepaidSplit', () => {
  it('is all online and pays out the full net', () => {
    expect(prepaidSplit(50_000n, 5_000n)).toEqual({
      cashCollectedPaise: 0n,
      onlineCollectedPaise: 50_000n,
      cashFeePaise: 0n,
      onlineFeePaise: 5_000n,
      payoutAmountPaise: 45_000n,
    });
  });
});

describe('onlineSettlementProgress', () => {
  const at = (iso: string) => new Date(iso);
  const source = (
    id: string,
    method: string,
    amount: bigint,
    settledAt: Date | null,
  ): SourceSettlement => ({ collectionId: id, method, amountPaise: amount, settledAt });

  it('is settled only once every online collection is, at the latest settlement', () => {
    const first = source('qr-1', 'ONLINE_QR', 12_000n, at('2026-10-20T10:00:00Z'));
    const cashDrop = source('cash', 'CASH', 10_000n, null);
    const pending = source('qr-2', 'ONLINE_QR', 8_000n, null);
    expect(onlineSettlementProgress([first, cashDrop, pending])).toEqual({
      onlineCollectedPaise: 20_000n,
      onlineSettledPaise: 12_000n,
      unsettledCollectionIds: ['qr-2'],
      fullySettled: false,
      settledAt: null,
    });
    const second = { ...pending, settledAt: at('2026-10-21T09:00:00Z') };
    expect(onlineSettlementProgress([first, cashDrop, second])).toEqual({
      onlineCollectedPaise: 20_000n,
      onlineSettledPaise: 20_000n,
      unsettledCollectionIds: [],
      fullySettled: true,
      settledAt: at('2026-10-21T09:00:00Z'),
    });
  });

  it('never calls an earning without online money settled', () => {
    expect(onlineSettlementProgress([source('cash', 'CASH', 10_000n, null)])).toMatchObject({
      fullySettled: false,
      onlineCollectedPaise: 0n,
    });
  });
});

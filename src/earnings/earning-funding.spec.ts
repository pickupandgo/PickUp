import { type FundingCollection, earningFunding } from './earning-funding';

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
    });
    expect(earningFunding([cash('cash', 50_000n)])).toMatchObject({
      settlement: 'CASH',
      collectionId: 'cash',
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
    });
  });

  it('is CASH when every drop was cash and ONLINE when every drop was paid online', () => {
    expect(earningFunding([cash('a', 20_000n), cash('b', 30_000n)])).toMatchObject({
      settlement: 'CASH',
      collectionId: null,
      grossPaise: 50_000n,
    });
    expect(earningFunding([online('a', 20_000n), online('b', 30_000n)])).toMatchObject({
      settlement: 'ONLINE',
      collectionId: null,
      platformFeePaise: 5_000n,
    });
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

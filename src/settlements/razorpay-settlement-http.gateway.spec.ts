import type { AppConfig } from '../config/app-config';
import { RazorpayUnavailableError } from '../razorpay/razorpay.errors';
import { daysBack, localDay } from './merchant-settlements.service';
import { RazorpaySettlementHttpGateway } from './razorpay-settlement-http.gateway';

const config = {
  razorpay: {
    keyId: 'rzp_test_AbCdEf123456',
    keySecret: 'test_key_secret_value_123',
    apiBaseUrl: 'https://api.razorpay.com',
    timeoutMs: 1000,
  },
} as unknown as AppConfig;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function item(overrides: Record<string, unknown> = {}) {
  return {
    entity_id: 'pay_ABCDEFGHIJKLMN',
    type: 'payment',
    amount: 50_000,
    fee: 1_180,
    tax: 180,
    settled: true,
    on_hold: false,
    settled_at: 1_791_100_000,
    settlement_id: 'setl_ABCDEFGHIJKLMN',
    settlement_utr: 'UTR123',
    order_id: 'order_ABCDEFGHIJKLMN',
    payment_id: null,
    ...overrides,
  };
}

describe('RazorpaySettlementHttpGateway', () => {
  let fetchMock: jest.SpyInstance;
  const gateway = new RazorpaySettlementHttpGateway(config);
  const day = { year: 2026, month: 10, day: 5 };

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => fetchMock.mockRestore());

  it('reads settled payments from the settlement recon API for one date', async () => {
    fetchMock.mockResolvedValue(json({ entity: 'collection', count: 1, items: [item()] }));
    await expect(gateway.listSettledPayments(day)).resolves.toEqual([
      {
        providerPaymentId: 'pay_ABCDEFGHIJKLMN',
        providerSettlementId: 'setl_ABCDEFGHIJKLMN',
        settlementUtr: 'UTR123',
        settledAt: new Date(1_791_100_000 * 1000),
        amountPaise: 50_000,
        feePaise: 1_180,
        taxPaise: 180,
        orderId: 'order_ABCDEFGHIJKLMN',
      },
    ]);
    const url = new URL((fetchMock.mock.calls[0] as [URL])[0].toString());
    expect(url.pathname).toBe('/v1/settlements/recon/combined');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      year: '2026',
      month: '10',
      day: '5',
      count: '1000',
      skip: '0',
    });
  });

  it('never treats unsettled, held, refunded or malformed entries as settled', async () => {
    fetchMock.mockResolvedValue(
      json({
        entity: 'collection',
        items: [
          item({ settled: false }),
          item({ on_hold: true }),
          item({ type: 'refund', entity_id: 'rfnd_ABCDEFGHIJKLMN' }),
          item({ settlement_id: null }),
          item({ settled_at: null }),
          item({ entity_id: 'pay_../x' }),
        ],
      }),
    );
    await expect(gateway.listSettledPayments(day)).resolves.toEqual([]);
  });

  it('pages through large days with skip', async () => {
    const page = Array.from({ length: 1000 }, (_, index) =>
      item({ entity_id: `pay_PAGEONE${String(index).padStart(6, '0')}` }),
    );
    fetchMock
      .mockResolvedValueOnce(json({ entity: 'collection', items: page }))
      .mockResolvedValueOnce(json({ entity: 'collection', items: [item()] }));
    const settled = await gateway.listSettledPayments(day);
    expect(settled).toHaveLength(1001);
    const second = new URL((fetchMock.mock.calls[1] as [URL])[0].toString());
    expect(second.searchParams.get('skip')).toBe('1000');
  });

  it('reports outages as retryable', async () => {
    fetchMock.mockResolvedValue(json({ error: { code: 'SERVER_ERROR' } }, 502));
    await expect(gateway.listSettledPayments(day)).rejects.toBeInstanceOf(RazorpayUnavailableError);
  });
});

describe('settlement dates', () => {
  it('uses India dates, oldest first', () => {
    // 2 Oct 2026 20:00 UTC is 3 Oct 01:30 IST.
    expect(localDay(new Date('2026-10-02T20:00:00Z'))).toEqual({ year: 2026, month: 10, day: 3 });
    expect(daysBack(new Date('2026-10-02T20:00:00Z'), 3)).toEqual([
      { year: 2026, month: 10, day: 1 },
      { year: 2026, month: 10, day: 2 },
      { year: 2026, month: 10, day: 3 },
    ]);
    expect(daysBack(new Date('2026-03-01T06:00:00Z'), 2)).toEqual([
      { year: 2026, month: 2, day: 28 },
      { year: 2026, month: 3, day: 1 },
    ]);
  });
});

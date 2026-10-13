import { readFileSync } from 'fs';
import path from 'path';
import {
  EARNING_STATUSES,
  type BankAccountDto,
} from '../src/services/payments/earningsDto';
import { createPaymentsApi } from '../src/services/payments/paymentsApi';
import type { PaymentsClient } from '../src/services/payments/paymentsClient';
import { PaymentsApiError } from '../src/services/payments/paymentsErrors';
import {
  bankNotice,
  EARNING_STATUS_VIEW,
  PAYOUT_STATUS_VIEW,
  SUMMARY_TILES,
} from '../src/screens/earnings/earningsPresentation';

const EARNING_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const BOOKING_ID = '6f1c1a3e-2a4b-4c5d-8e9f-0a1b2c3d4e5f';
const TRIP_ID = '7d444840-9dc0-41ae-9a3c-7b5e2b8f0c11';
const PAYOUT_ID = 'c0ffee00-1234-4abc-8def-000000000001';

function fakeClient(
  response: unknown,
): PaymentsClient & { request: jest.Mock } {
  return {
    request: jest.fn(async () => {
      if (response instanceof Error) {
        throw response;
      }
      return response;
    }),
  };
}

function earningBody(overrides: Record<string, unknown> = {}) {
  return {
    earningId: EARNING_ID,
    bookingId: BOOKING_ID,
    tripId: TRIP_ID,
    settlement: 'ONLINE',
    status: 'AWAITING_SETTLEMENT',
    grossAmountPaise: 50_000,
    platformFeePaise: 5_000,
    otherDeductionsPaise: 0,
    tdsAmountPaise: 0,
    tdsPolicy: 'DISABLED',
    netAmountPaise: 45_000,
    merchantSettled: false,
    payableAt: null,
    paidAt: null,
    holdReason: null,
    createdAt: '2026-10-06T08:00:00.000Z',
    ...overrides,
  };
}

function payoutBody(overrides: Record<string, unknown> = {}) {
  return {
    payoutId: PAYOUT_ID,
    grossAmountPaise: 45_000,
    tdsAmountPaise: 0,
    otherDeductionsPaise: 0,
    amountPaise: 45_000,
    status: 'PROCESSED',
    utr: 'UTR9876543210',
    bankAccountLast4: '2222',
    processedAt: '2026-10-12T05:31:00.000Z',
    failedAt: null,
    createdAt: '2026-10-12T05:30:00.000Z',
    items: [{ earningId: EARNING_ID, amountPaise: 45_000, status: 'PAID' }],
    ...overrides,
  };
}

const summaryBody = {
  awaitingSettlementPaise: 27_000,
  payablePaise: 45_000,
  inPayoutPaise: 0,
  onHoldPaise: 0,
  paidPaise: 90_000,
  settledInCashPaise: 45_000,
  grossPaise: 230_000,
  platformFeePaise: 23_000,
  tripCount: 5,
};

function bankBody(overrides: Record<string, unknown> = {}) {
  return {
    bankAccountId: PAYOUT_ID,
    accountHolderName: 'Ramesh Kumar',
    ifsc: 'HDFC0001234',
    accountNumberLast4: '2222',
    status: 'VERIFIED',
    payoutsEnabled: true,
    validationStatus: 'COMPLETED',
    verifiedAt: '2026-10-06T08:00:00.000Z',
    statusReason: null,
    createdAt: '2026-10-06T07:00:00.000Z',
    ...overrides,
  };
}

describe('earnings API', () => {
  it('reads the totals per state', async () => {
    const client = fakeClient(summaryBody);
    await expect(
      createPaymentsApi(client).getEarningsSummary(),
    ).resolves.toEqual(summaryBody);
    expect(client.request).toHaveBeenCalledWith({
      method: 'GET',
      path: '/v1/earnings/summary',
    });
    for (const bad of [
      { payablePaise: -1 },
      { paidPaise: 1.5 },
      { tripCount: '5' },
    ]) {
      await expect(
        createPaymentsApi(
          fakeClient({ ...summaryBody, ...bad }),
        ).getEarningsSummary(),
      ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    }
  });

  it('pages through earnings of one state', async () => {
    const client = fakeClient({
      items: [earningBody()],
      nextCursor: EARNING_ID,
    });
    const page = await createPaymentsApi(client).listEarnings({
      status: 'AWAITING_SETTLEMENT',
      limit: 20,
      cursor: TRIP_ID,
    });
    expect(client.request).toHaveBeenCalledWith({
      method: 'GET',
      path: '/v1/earnings',
      query: { status: 'AWAITING_SETTLEMENT', limit: 20, cursor: TRIP_ID },
    });
    expect(page).toMatchObject({
      nextCursor: EARNING_ID,
      items: [
        {
          status: 'AWAITING_SETTLEMENT',
          grossAmountPaise: 50_000,
          platformFeePaise: 5_000,
          netAmountPaise: 45_000,
          merchantSettled: false,
        },
      ],
    });
    // Never handed to the screens: admin-written hold notes stay on the server side of the app.
    expect(page.items[0]).not.toHaveProperty('holdReason');
  });

  it('checks the filter and cursor before any request', async () => {
    const client = fakeClient({ items: [], nextCursor: null });
    const api = createPaymentsApi(client);
    await expect(
      api.listEarnings({ cursor: '1; drop' }),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      api.listEarnings({ status: 'WITHDRAWN' as 'PAID' }),
    ).rejects.toBeInstanceOf(RangeError);
    expect(client.request).not.toHaveBeenCalled();
  });

  it('refuses earnings whose amounts do not add up or whose state is unknown', async () => {
    for (const bad of [
      { netAmountPaise: 46_000 },
      { tdsAmountPaise: 100 },
      { status: 'WITHDRAWN' },
      { settlement: 'WALLET' },
    ]) {
      await expect(
        createPaymentsApi(
          fakeClient({ items: [earningBody(bad)], nextCursor: null }),
        ).listEarnings(),
      ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    }
  });

  it('lists payouts with what reached the bank', async () => {
    const client = fakeClient([payoutBody()]);
    const payouts = await createPaymentsApi(client).listPayouts();
    expect(client.request).toHaveBeenCalledWith({
      method: 'GET',
      path: '/v1/payouts',
    });
    expect(payouts[0]).toMatchObject({
      amountPaise: 45_000,
      status: 'PROCESSED',
      utr: 'UTR9876543210',
      bankAccountLast4: '2222',
      earningCount: 1,
    });
    await expect(
      createPaymentsApi(
        fakeClient([payoutBody({ amountPaise: 44_000 })]),
      ).listPayouts(),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('reads the payout bank account, or none', async () => {
    await expect(
      createPaymentsApi(fakeClient(bankBody())).getBankAccount(),
    ).resolves.toMatchObject({ status: 'VERIFIED', payoutsEnabled: true });
    await expect(
      createPaymentsApi(
        fakeClient(new PaymentsApiError('BANK_ACCOUNT_NOT_FOUND', 'none', 404)),
      ).getBankAccount(),
    ).resolves.toBeNull();
    await expect(
      createPaymentsApi(
        fakeClient(new PaymentsApiError('NETWORK_ERROR', 'offline', 0)),
      ).getBankAccount(),
    ).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    // Only a VERIFIED account receives payouts; anything else is a broken answer.
    await expect(
      createPaymentsApi(
        fakeClient(bankBody({ status: 'SUSPENDED', payoutsEnabled: true })),
      ).getBankAccount(),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});

describe('earnings presentation', () => {
  it('shows every server state, with payable as the hero and the rest as tiles', () => {
    expect(Object.keys(EARNING_STATUS_VIEW).sort()).toEqual(
      [...EARNING_STATUSES].sort(),
    );
    expect(SUMMARY_TILES.map(tile => tile.status).sort()).toEqual(
      EARNING_STATUSES.filter(status => status !== 'PAYABLE').sort(),
    );
    expect(EARNING_STATUS_VIEW.ON_HOLD.variant).toBe('warning');
  });

  it('says where payouts go, or why they cannot go yet', () => {
    const account = (overrides: Partial<BankAccountDto>): BankAccountDto => ({
      bankAccountId: PAYOUT_ID,
      accountHolderName: 'Ramesh Kumar',
      ifsc: 'HDFC0001234',
      accountNumberLast4: '2222',
      status: 'VERIFIED',
      payoutsEnabled: true,
      validationStatus: 'COMPLETED',
      ...overrides,
    });
    expect(bankNotice(null)).toEqual({
      key: 'earnings.bankMissing',
      ok: false,
    });
    expect(bankNotice(account({}))).toMatchObject({
      key: 'earnings.bankVerified',
      ok: true,
      vars: { ifsc: 'HDFC0001234', last4: '2222' },
    });
    expect(
      bankNotice(
        account({ status: 'PENDING_VERIFICATION', payoutsEnabled: false }),
      ),
    ).toMatchObject({ key: 'earnings.bankPending', ok: false });
    for (const status of ['SUSPENDED', 'REJECTED'] as const) {
      expect(
        bankNotice(account({ status, payoutsEnabled: false })),
      ).toMatchObject({
        key: 'earnings.bankInactive',
        ok: false,
      });
    }
  });
});

describe('translations for the collection and earnings screens', () => {
  const root = path.join(__dirname, '..');
  const i18n = readFileSync(path.join(root, 'src/i18n/index.tsx'), 'utf8');
  const [enPart, hiPart] = i18n.split('const hi: Dict = {');
  const keysIn = (source: string) =>
    new Set(
      [...source.matchAll(/'([a-zA-Z]+\.[a-zA-Z]+)':/g)].map(match => match[1]),
    );
  const en = keysIn(enPart);
  const hi = keysIn(hiPart);

  const sources = [
    'src/screens/trip/CollectPaymentScreen.tsx',
    'src/components/molecules/CollectPaymentBanner.tsx',
    'src/screens/earnings/EarningsHistoryScreen.tsx',
    'src/screens/earnings/earningsPresentation.ts',
  ].map(file => readFileSync(path.join(root, file), 'utf8'));
  const used = new Set(
    sources.flatMap(source =>
      [
        ...source.matchAll(
          /['"]((?:collect|earnings|wallet|common)\.[a-zA-Z]+)['"]/g,
        ),
      ].map(match => match[1]),
    ),
  );

  it('finds the keys the screens use', () => {
    expect(used.size).toBeGreaterThan(50);
    expect(used.has('collect.confirmCashMsg')).toBe(true);
    expect(used.has('earnings.awaitingSettlement')).toBe(true);
    for (const view of Object.values(PAYOUT_STATUS_VIEW)) {
      expect(used.has(view.labelKey)).toBe(true);
    }
  });

  it('has every key in English and Hindi', () => {
    const missing = [...used].filter(key => !en.has(key) || !hi.has(key));
    expect(missing).toEqual([]);
  });
});

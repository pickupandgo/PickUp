import type { AppConfig } from '../config/app-config';
import { RazorpayApiError, RazorpayUnavailableError } from '../razorpay/razorpay.errors';
import { RazorpayXHttpGateway } from './razorpayx-http.gateway';

const config = {
  razorpay: { apiBaseUrl: 'https://api.razorpay.com', timeoutMs: 1000 },
  payouts: {
    razorpayx: {
      accountNumber: '7878780080316316',
      keyId: 'rzp_test_XKey123456',
      keySecret: 'x_key_secret_value_123',
      webhookSecrets: ['x_webhook_secret_value_0123456789abcdef'],
    },
  },
} as unknown as AppConfig;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const payout = {
  id: 'pout_ABCDEFGHIJKLMN',
  entity: 'payout',
  fund_account_id: 'fa_ABCDEFGHIJKLMN',
  amount: 45_000,
  currency: 'INR',
  status: 'processing',
  utr: null,
  mode: 'IMPS',
  reference_id: '0b6a2b1e-9b3c-4f0e-8f8e-2a6d4c1b7e90',
  status_details: null,
};

describe('RazorpayXHttpGateway', () => {
  let fetchMock: jest.SpyInstance;
  const gateway = new RazorpayXHttpGateway(config);

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => fetchMock.mockRestore());

  function lastRequest(): { url: string; init: RequestInit; headers: Record<string, string> } {
    const call = fetchMock.mock.calls.at(-1) as [URL, RequestInit];
    return {
      url: call[0].toString(),
      init: call[1],
      headers: call[1].headers as Record<string, string>,
    };
  }

  it('sends payouts with X-Payout-Idempotency and the business account, never the payee account', async () => {
    fetchMock.mockResolvedValue(json(payout));
    const result = await gateway.createPayout({
      idempotencyKey: payout.reference_id,
      referenceId: payout.reference_id,
      fundAccountId: payout.fund_account_id,
      amountPaise: 45_000,
      mode: 'IMPS',
      narration: 'Nikhil Enterprises Payout',
      queueIfLowBalance: true,
      notes: { payout_id: payout.reference_id },
    });

    expect(result).toMatchObject({
      id: payout.id,
      status: 'processing',
      referenceId: payout.reference_id,
    });
    const { url, init, headers } = lastRequest();
    expect(url).toBe('https://api.razorpay.com/v1/payouts');
    expect(headers['X-Payout-Idempotency']).toBe(payout.reference_id);
    expect(headers['authorization']).toBe(
      `Basic ${Buffer.from('rzp_test_XKey123456:x_key_secret_value_123').toString('base64')}`,
    );
    expect(JSON.parse(init.body as string)).toEqual({
      account_number: '7878780080316316',
      fund_account_id: payout.fund_account_id,
      amount: 45_000,
      currency: 'INR',
      mode: 'IMPS',
      purpose: 'payout',
      queue_if_low_balance: true,
      reference_id: payout.reference_id,
      narration: 'Nikhil Enterprises Payout',
      notes: { payout_id: payout.reference_id },
    });
  });

  it('creates a vendor contact and a bank fund account', async () => {
    fetchMock.mockResolvedValueOnce(json({ id: 'cont_ABCDEFGHIJKLMN', entity: 'contact' }));
    await expect(
      gateway.createContact({ driverId: payout.reference_id, name: 'Ramesh Kumar!' }),
    ).resolves.toEqual({ contactId: 'cont_ABCDEFGHIJKLMN' });
    expect(JSON.parse(lastRequest().init.body as string)).toMatchObject({
      name: 'Ramesh Kumar',
      type: 'vendor',
      reference_id: payout.reference_id,
    });

    fetchMock.mockResolvedValueOnce(json({ id: 'fa_ABCDEFGHIJKLMN', entity: 'fund_account' }));
    await gateway.createBankFundAccount({
      contactId: 'cont_ABCDEFGHIJKLMN',
      holderName: 'Ramesh Kumar',
      ifsc: 'HDFC0001234',
      accountNumber: '123456789012',
    });
    expect(JSON.parse(lastRequest().init.body as string)).toEqual({
      contact_id: 'cont_ABCDEFGHIJKLMN',
      account_type: 'bank_account',
      bank_account: { name: 'Ramesh Kumar', ifsc: 'HDFC0001234', account_number: '123456789012' },
    });
  });

  it('finds a payout by our reference id', async () => {
    fetchMock.mockResolvedValue(json({ entity: 'collection', count: 1, items: [payout] }));
    await expect(gateway.findPayoutByReference(payout.reference_id)).resolves.toMatchObject({
      id: payout.id,
    });
    expect(lastRequest().url).toBe(
      `https://api.razorpay.com/v1/payouts?account_number=7878780080316316&reference_id=${payout.reference_id}&count=10`,
    );
  });

  it('reads the failure reason from status_details', async () => {
    fetchMock.mockResolvedValue(
      json({
        ...payout,
        status: 'failed',
        status_details: { reason: 'beneficiary_bank_failure', description: 'Bank offline' },
      }),
    );
    await expect(gateway.fetchPayout(payout.id)).resolves.toMatchObject({
      status: 'failed',
      failureReason: 'Bank offline',
    });
  });

  it('distinguishes definitive rejections from retryable failures', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: { code: 'BAD_REQUEST_ERROR' } }, 400));
    await expect(gateway.fetchPayout(payout.id)).rejects.toBeInstanceOf(RazorpayApiError);
    fetchMock.mockResolvedValueOnce(json({ error: { code: 'SERVER_ERROR' } }, 503));
    await expect(gateway.fetchPayout(payout.id)).rejects.toBeInstanceOf(RazorpayUnavailableError);
  });

  it('validates an existing fund account with a penny drop from the business account', async () => {
    fetchMock.mockResolvedValue(
      json({
        id: 'fav_ABCDEFGHIJKLMN',
        entity: 'fund_account.validation',
        fund_account: { id: 'fa_ABCDEFGHIJKLMN' },
        status: 'created',
        amount: 100,
        currency: 'INR',
        results: { account_status: null, registered_name: null },
        utr: null,
      }),
    );
    const result = await gateway.validateBankAccount({
      fundAccountId: 'fa_ABCDEFGHIJKLMN',
      notes: { bank_account_id: 'acc-1' },
    });
    expect(result).toMatchObject({
      id: 'fav_ABCDEFGHIJKLMN',
      status: 'created',
      accountStatus: null,
    });
    const { url, init } = lastRequest();
    expect(url).toBe('https://api.razorpay.com/v1/fund_accounts/validations');
    expect(JSON.parse(init.body as string)).toEqual({
      account_number: '7878780080316316',
      fund_account: { id: 'fa_ABCDEFGHIJKLMN' },
      amount: 100,
      currency: 'INR',
      notes: { bank_account_id: 'acc-1' },
    });
  });

  it('reads both documented validation result shapes', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        id: 'fav_ABCDEFGHIJKLMN',
        status: 'completed',
        fund_account: { id: 'fa_ABCDEFGHIJKLMN' },
        results: { account_status: 'active', registered_name: 'RAMESH KUMAR' },
        utr: 'UTR1',
      }),
    );
    await expect(gateway.fetchBankValidation('fav_ABCDEFGHIJKLMN')).resolves.toMatchObject({
      status: 'completed',
      accountStatus: 'active',
      registeredName: 'RAMESH KUMAR',
      nameMatchScore: null,
      utr: 'UTR1',
    });
    fetchMock.mockResolvedValueOnce(
      json({
        id: 'fav_ABCDEFGHIJKLMN',
        status: 'completed',
        validation_results: {
          account_status: 'active',
          registered_name: 'R KUMAR',
          name_match_score: 82,
        },
      }),
    );
    await expect(gateway.fetchBankValidation('fav_ABCDEFGHIJKLMN')).resolves.toMatchObject({
      registeredName: 'R KUMAR',
      nameMatchScore: 82,
    });
    await expect(gateway.fetchBankValidation('fav_../../payouts')).rejects.toBeInstanceOf(
      RangeError,
    );
  });

  it('refuses unsafe input before calling RazorpayX', async () => {
    await expect(gateway.fetchPayout('pout_../../contacts')).rejects.toBeInstanceOf(RangeError);
    await expect(
      gateway.createPayout({
        idempotencyKey: 'bad key with spaces and way too long for the header limit',
        referenceId: 'r',
        fundAccountId: 'fa_ABCDEFGHIJKLMN',
        amountPaise: 45_000,
        mode: 'IMPS',
        narration: 'x',
        queueIfLowBalance: true,
        notes: {},
      }),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      gateway.createPayout({
        idempotencyKey: payout.reference_id,
        referenceId: payout.reference_id,
        fundAccountId: 'fa_ABCDEFGHIJKLMN',
        amountPaise: 99,
        mode: 'IMPS',
        narration: 'x',
        queueIfLowBalance: true,
        notes: {},
      }),
    ).rejects.toBeInstanceOf(RangeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

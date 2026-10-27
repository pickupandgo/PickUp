import {
  classifyCheckoutError,
  CheckoutError,
} from '../src/services/payments/checkoutErrors';
import { newIdempotencyKey } from '../src/services/payments/idempotency';
import {
  formatRupees,
  paiseToRupees,
  rupeesToPaise,
} from '../src/services/payments/money';
import { createPaymentsApi } from '../src/services/payments/paymentsApi';
import {
  createPaymentsClient,
  type PaymentsClient,
  type TokenProvider,
} from '../src/services/payments/paymentsClient';
import {
  describePaymentsError,
  PaymentsApiError,
} from '../src/services/payments/paymentsErrors';
import {
  toTransaction,
  toWalletBalance,
} from '../src/services/wallet/walletMapping';

const BASE_URL = 'https://payments.example.test';
const PAYMENT_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const SIGNATURE = 'a'.repeat(64);

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as unknown as Response;
}

function errorBody(
  code: string,
  requestId = 'req-1',
  details?: Record<string, unknown>,
) {
  return {
    error: { code, message: `server says ${code}`, requestId, details },
  };
}

function topUpBody(overrides: Record<string, unknown> = {}) {
  return {
    paymentId: PAYMENT_ID,
    status: 'PENDING',
    amountPaise: 50_000,
    currency: 'INR',
    checkout: {
      keyId: 'rzp_test_AbCdEf123456',
      orderId: 'order_ABCdef123456',
      amountPaise: 50_000,
      currency: 'INR',
    },
    providerPaymentId: null,
    paymentMethod: null,
    createdAt: '2026-10-02T10:00:00.000Z',
    updatedAt: '2026-10-02T10:00:00.000Z',
    ...overrides,
  };
}

type FetchMock = jest.Mock<Promise<Response>, [string, RequestInit]>;

function fetchMock(
  impl?: (url: string, init: RequestInit) => Promise<Response>,
): FetchMock {
  return impl ? jest.fn(impl) : jest.fn();
}

function makeClient(
  fetchImpl: FetchMock,
  getToken: TokenProvider = async () => 'token-1',
  baseUrl = BASE_URL,
) {
  return createPaymentsClient({
    baseUrl,
    getToken,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: async () => undefined,
  });
}

function fakeClient(
  response: unknown,
): PaymentsClient & { request: jest.Mock } {
  return { request: jest.fn(async () => response) };
}

describe('paymentsClient', () => {
  it('sends the bearer token, JSON body and idempotency key', async () => {
    const fetchImpl = fetchMock(async () => jsonResponse(201, { ok: true }));
    const client = makeClient(fetchImpl);

    await expect(
      client.request({
        method: 'POST',
        path: '/v1/wallet/topups',
        body: { amountPaise: 100 },
        idempotencyKey: 'key-1234567890abcdef',
      }),
    ).resolves.toEqual({ ok: true });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/v1/wallet/topups`);
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"amountPaise":100}');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer token-1',
      'Content-Type': 'application/json',
      'Idempotency-Key': 'key-1234567890abcdef',
    });
  });

  it('encodes query parameters and skips undefined ones', async () => {
    const fetchImpl = fetchMock(async () => jsonResponse(200, {}));
    const client = makeClient(fetchImpl);

    await client.request({
      method: 'GET',
      path: '/v1/wallet/transactions',
      query: { limit: 20, cursor: undefined },
    });

    expect(fetchImpl.mock.calls[0][0]).toBe(
      `${BASE_URL}/v1/wallet/transactions?limit=20`,
    );
  });

  it('normalizes baseUrl ending with /v1 without duplicating /v1', async () => {
    const fetchImpl = fetchMock(async () => jsonResponse(200, { ok: true }));
    const client = makeClient(fetchImpl, undefined, `${BASE_URL}/v1/`);

    await client.request({
      method: 'GET',
      path: '/v1/wallet',
    });

    expect(fetchImpl.mock.calls[0][0]).toBe(`${BASE_URL}/v1/wallet`);
  });

  it('refreshes the Firebase token once when the server rejects it', async () => {
    const fetchImpl = fetchMock()
      .mockResolvedValueOnce(jsonResponse(401, errorBody('AUTH_INVALID_TOKEN')))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const getToken = jest.fn(async (force: boolean) =>
      force ? 'fresh' : 'stale',
    );
    const client = makeClient(fetchImpl, getToken);

    await expect(
      client.request({ method: 'GET', path: '/v1/wallet' }),
    ).resolves.toEqual({
      ok: true,
    });
    expect(getToken.mock.calls).toEqual([[false], [true]]);
    expect(fetchImpl.mock.calls[1][1].headers).toMatchObject({
      Authorization: 'Bearer fresh',
    });
  });

  it('gives up after one token refresh', async () => {
    const fetchImpl = fetchMock(async () =>
      jsonResponse(401, errorBody('AUTH_INVALID_TOKEN')),
    );
    const client = makeClient(fetchImpl);

    await expect(
      client.request({ method: 'GET', path: '/v1/wallet' }),
    ).rejects.toMatchObject({
      code: 'AUTH_INVALID_TOKEN',
      status: 401,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('retries 503 and network failures, then succeeds', async () => {
    const fetchImpl = fetchMock()
      .mockResolvedValueOnce(
        jsonResponse(503, errorBody('SERVICE_UNAVAILABLE')),
      )
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const client = makeClient(fetchImpl);

    await expect(
      client.request({ method: 'GET', path: '/v1/wallet' }),
    ).resolves.toEqual({
      ok: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('retries a gateway error without a JSON body', async () => {
    const gatewayError = {
      status: 502,
      ok: false,
      text: async () => '<html>Bad Gateway</html>',
    } as unknown as Response;
    const fetchImpl = fetchMock()
      .mockResolvedValueOnce(gatewayError)
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const client = makeClient(fetchImpl);

    await expect(
      client.request({ method: 'GET', path: '/v1/wallet' }),
    ).resolves.toEqual({
      ok: true,
    });
  });

  it('does not retry client errors and keeps the server error details', async () => {
    const fetchImpl = fetchMock(async () =>
      jsonResponse(
        400,
        errorBody('AMOUNT_OUT_OF_RANGE', 'req-42', {
          minPaise: 100,
          maxPaise: 1000000,
        }),
      ),
    );
    const client = makeClient(fetchImpl);

    const error = await client
      .request({
        method: 'POST',
        path: '/v1/wallet/topups',
        body: { amountPaise: 1 },
      })
      .catch((e: unknown) => e);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(error).toBeInstanceOf(PaymentsApiError);
    expect(error).toMatchObject({
      code: 'AMOUNT_OUT_OF_RANGE',
      status: 400,
      requestId: 'req-42',
      details: { minPaise: 100, maxPaise: 1000000 },
    });
  });

  it('reports a timeout when the server does not answer', async () => {
    const fetchImpl = fetchMock(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    );
    const client = createPaymentsClient({
      baseUrl: BASE_URL,
      getToken: async () => 'token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 10,
      maxAttempts: 1,
    });

    await expect(
      client.request({ method: 'GET', path: '/v1/wallet' }),
    ).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
  });

  it('only accepts fixed /v1 API paths', async () => {
    const fetchImpl = fetchMock();
    const client = makeClient(fetchImpl);

    await expect(
      client.request({ method: 'GET', path: 'https://evil.example/v1/wallet' }),
    ).rejects.toThrow('Invalid payments API path');
    await expect(
      client.request({ method: 'GET', path: '/v1/../admin' }),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('paymentsApi', () => {
  it('parses a pending top-up with its Checkout details', async () => {
    const api = createPaymentsApi(fakeClient(topUpBody()));

    await expect(api.startTopUp(50_000, newIdempotencyKey())).resolves.toEqual({
      paymentId: PAYMENT_ID,
      status: 'PENDING',
      amountPaise: 50_000,
      checkout: {
        keyId: 'rzp_test_AbCdEf123456',
        orderId: 'order_ABCdef123456',
        amountPaise: 50_000,
        currency: 'INR',
      },
    });
  });

  it('rejects a Checkout amount that differs from the top-up amount', async () => {
    const body = topUpBody({
      checkout: { ...topUpBody().checkout, amountPaise: 1 },
    });
    const api = createPaymentsApi(fakeClient(body));

    await expect(
      api.startTopUp(50_000, newIdempotencyKey()),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('rejects anything that is not a Razorpay public key id', async () => {
    const body = topUpBody({
      checkout: { ...topUpBody().checkout, keyId: 'not-a-key' },
    });
    const api = createPaymentsApi(fakeClient(body));

    await expect(
      api.startTopUp(50_000, newIdempotencyKey()),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('rejects non-INR wallets', async () => {
    const api = createPaymentsApi(
      fakeClient({
        walletId: 'w1',
        status: 'ACTIVE',
        balancePaise: 100,
        currency: 'USD',
        updatedAt: 'x',
      }),
    );

    await expect(api.getWallet()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('validates inputs before calling the server', async () => {
    const client = fakeClient({});
    const api = createPaymentsApi(client);

    await expect(api.startTopUp(10.5, newIdempotencyKey())).rejects.toThrow(
      RangeError,
    );
    await expect(api.startTopUp(100, 'short')).rejects.toThrow(RangeError);
    await expect(api.getTopUp('../admin')).rejects.toThrow(RangeError);
    await expect(api.listTransactions({ cursor: '0' })).rejects.toThrow(
      RangeError,
    );
    await expect(
      api.verifyTopUp(PAYMENT_ID, {
        razorpayOrderId: 'order_ABCdef123456',
        razorpayPaymentId: 'pay_ABCdef123456',
        razorpaySignature: 'not-hex',
      }),
    ).rejects.toThrow(RangeError);
    expect(client.request).not.toHaveBeenCalled();
  });

  it('sends only the three Checkout fields for verification', async () => {
    const client = fakeClient({
      payment: topUpBody({ status: 'PAID', checkout: null }),
      providerStatus: 'captured',
      wallet: {
        walletId: 'w1',
        status: 'ACTIVE',
        balancePaise: 150_000,
        currency: 'INR',
        updatedAt: '2026-10-02T10:01:00.000Z',
      },
    });
    const api = createPaymentsApi(client);

    const result = await api.verifyTopUp(PAYMENT_ID, {
      razorpayOrderId: 'order_ABCdef123456',
      razorpayPaymentId: 'pay_ABCdef123456',
      razorpaySignature: SIGNATURE,
    });

    expect(result.payment.status).toBe('PAID');
    expect(result.wallet?.balancePaise).toBe(150_000);
    expect(client.request).toHaveBeenCalledWith({
      method: 'POST',
      path: `/v1/wallet/topups/${PAYMENT_ID}/verify`,
      body: {
        razorpayOrderId: 'order_ABCdef123456',
        razorpayPaymentId: 'pay_ABCdef123456',
        razorpaySignature: SIGNATURE,
      },
    });
  });

  it('parses a transactions page', async () => {
    const api = createPaymentsApi(
      fakeClient({
        items: [
          {
            id: 't1',
            type: 'TOPUP',
            direction: 'CREDIT',
            amountPaise: 50_000,
            balanceAfterPaise: 50_000,
            sequence: 1,
            referenceType: 'RAZORPAY_PAYMENT',
            referenceId: PAYMENT_ID,
            providerPaymentId: 'pay_ABCdef123456',
            reason: null,
            createdAt: '2026-10-02T10:01:00.000Z',
          },
        ],
        nextCursor: null,
      }),
    );

    const page = await api.listTransactions({ limit: 20 });
    expect(page.nextCursor).toBeNull();
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      type: 'TOPUP',
      direction: 'CREDIT',
      amountPaise: 50_000,
    });
  });
});

describe('newIdempotencyKey', () => {
  it('creates RFC 4122 v4 UUIDs the server accepts', () => {
    const key = newIdempotencyKey();
    expect(key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(key).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
  });

  it('sets the version and variant bits for any random input', () => {
    const allOnes = newIdempotencyKey(bytes => bytes.fill(255));
    const allZeros = newIdempotencyKey(bytes => bytes.fill(0));
    expect(allOnes).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(allZeros).toBe('00000000-0000-4000-8000-000000000000');
  });

  it('does not repeat', () => {
    const keys = new Set(
      Array.from({ length: 500 }, () => newIdempotencyKey()),
    );
    expect(keys.size).toBe(500);
  });
});

describe('money', () => {
  it('converts whole rupees to paise and back', () => {
    expect(rupeesToPaise(500)).toBe(50_000);
    expect(paiseToRupees(12_345)).toBe(123.45);
    expect(() => rupeesToPaise(0)).toThrow(RangeError);
    expect(() => rupeesToPaise(10.5)).toThrow(RangeError);
  });

  it('formats rupees with paise only when needed', () => {
    expect(formatRupees(2450)).toBe('₹2,450');
    expect(formatRupees(67.5)).toBe('₹67.50');
    expect(formatRupees(100000)).toBe('₹1,00,000');
  });
});

describe('classifyCheckoutError', () => {
  it('uses Android numbering on Android', () => {
    expect(classifyCheckoutError({ code: 0 }, 'android').kind).toBe(
      'cancelled',
    );
    expect(classifyCheckoutError({ code: 2 }, 'android').kind).toBe('network');
    expect(classifyCheckoutError({ code: 6 }, 'android').kind).toBe(
      'unavailable',
    );
    expect(classifyCheckoutError({ code: 3 }, 'android').kind).toBe('failed');
  });

  it('uses iOS numbering on iOS', () => {
    expect(classifyCheckoutError({ code: 2 }, 'ios').kind).toBe('cancelled');
    expect(classifyCheckoutError({ code: 0 }, 'ios').kind).toBe('network');
    expect(classifyCheckoutError({ code: 1 }, 'ios').kind).toBe('failed');
  });

  it('treats a thrown exception as Checkout being unavailable', () => {
    const error = classifyCheckoutError(
      new TypeError("Cannot read property 'open'"),
      'android',
    );
    expect(error).toBeInstanceOf(CheckoutError);
    expect(error.kind).toBe('unavailable');
  });
});

describe('describePaymentsError', () => {
  it('shows the allowed range for an out-of-range amount', () => {
    const error = new PaymentsApiError('AMOUNT_OUT_OF_RANGE', 'x', 400, 'r', {
      minPaise: 100,
      maxPaise: 1_000_000,
    });
    expect(describePaymentsError(error)).toBe(
      'Enter an amount between ₹1 and ₹10,000.',
    );
  });

  it('never shows raw server messages', () => {
    expect(
      describePaymentsError(
        new PaymentsApiError('SOMETHING_NEW', 'internal detail', 500),
      ),
    ).toBe('Something went wrong. Please try again.');
    expect(describePaymentsError(new Error('stack trace'))).toBe(
      'Something went wrong. Please try again.',
    );
  });
});

describe('walletMapping', () => {
  it('maps the wallet to rupees without inventing a minimum balance', () => {
    expect(
      toWalletBalance({
        walletId: 'w1',
        status: 'LOW_BALANCE',
        balancePaise: 12_345,
        updatedAt: '2026-10-02T10:00:00.000Z',
      }),
    ).toEqual({
      balance: 123.45,
      currency: '₹',
      minimumBalance: null,
      isLowBalance: true,
      status: 'LOW_BALANCE',
    });
  });

  it('maps ledger entries to display transactions', () => {
    const topUp = toTransaction({
      id: 't1',
      type: 'TOPUP',
      direction: 'CREDIT',
      amountPaise: 50_000,
      balanceAfterPaise: 50_000,
      sequence: 1,
      providerPaymentId: 'pay_ABCdef123456',
      reason: null,
      createdAt: '2026-10-02T10:01:00.000Z',
    });
    expect(topUp).toMatchObject({
      id: 't1',
      type: 'credit',
      category: 'recharge',
      amount: 500,
      title: 'Wallet Recharge',
      description: 'Ref pay_ABCdef123456',
      referenceId: 'pay_ABCdef123456',
    });
    expect(topUp.date).toContain('2026');

    const adjustment = toTransaction({
      id: 't2',
      type: 'ADJUSTMENT',
      direction: 'DEBIT',
      amountPaise: 1_050,
      balanceAfterPaise: 48_950,
      sequence: 2,
      providerPaymentId: null,
      reason: 'Correction for ticket 1234',
      createdAt: 'not a date',
    });
    expect(adjustment).toMatchObject({
      type: 'debit',
      category: 'adjustment',
      amount: 10.5,
      title: 'Wallet Adjustment',
      description: 'Correction for ticket 1234',
      date: '',
      time: '',
    });
  });
});

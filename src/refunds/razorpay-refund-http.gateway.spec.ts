import type { AppConfig } from '../config/app-config';
import { RazorpayApiError, RazorpayUnavailableError } from '../razorpay/razorpay.errors';
import { RazorpayRefundHttpGateway } from './razorpay-refund-http.gateway';
import { findOurRefund } from './refund.gateway';

const config = {
  razorpay: {
    keyId: 'rzp_test_AbCdEf123456',
    keySecret: 'test_key_secret_value_123',
    apiBaseUrl: 'https://api.razorpay.com',
    timeoutMs: 1000,
  },
} as unknown as AppConfig;

const REFUND_ID = '0b6a2b1e-9b3c-4f0e-8f8e-2a6d4c1b7e90';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function refund(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rfnd_ABCDEFGHIJKLMN',
    entity: 'refund',
    amount: 45_000,
    currency: 'INR',
    payment_id: 'pay_ABCDEFGHIJKLMN',
    notes: { refund_id: REFUND_ID, booking_id: 'booking-1' },
    receipt: REFUND_ID,
    acquirer_data: { arn: null },
    created_at: 1_791_100_000,
    batch_id: null,
    status: 'pending',
    speed_processed: 'normal',
    speed_requested: 'normal',
    ...overrides,
  };
}

describe('RazorpayRefundHttpGateway', () => {
  let fetchMock: jest.SpyInstance;
  const gateway = new RazorpayRefundHttpGateway(config);

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

  it('refunds the payment with X-Refund-Idempotency and our refund id as the receipt', async () => {
    fetchMock.mockResolvedValue(json(refund()));
    const result = await gateway.createRefund({
      refundId: REFUND_ID,
      providerPaymentId: 'pay_ABCDEFGHIJKLMN',
      amountPaise: 45_000,
      notes: { refund_id: REFUND_ID, booking_id: 'booking-1' },
    });
    expect(result).toEqual({
      id: 'rfnd_ABCDEFGHIJKLMN',
      paymentId: 'pay_ABCDEFGHIJKLMN',
      amount: 45_000,
      currency: 'INR',
      status: 'pending',
      receipt: REFUND_ID,
      notes: { refund_id: REFUND_ID, booking_id: 'booking-1' },
      reference: null,
    });
    const { url, init, headers } = lastRequest();
    expect(url).toBe('https://api.razorpay.com/v1/payments/pay_ABCDEFGHIJKLMN/refund');
    expect(init.method).toBe('POST');
    expect(headers['X-Refund-Idempotency']).toBe(REFUND_ID);
    expect(headers['authorization']).toBe(
      `Basic ${Buffer.from('rzp_test_AbCdEf123456:test_key_secret_value_123').toString('base64')}`,
    );
    expect(JSON.parse(init.body as string)).toEqual({
      amount: 45_000,
      speed: 'normal',
      receipt: REFUND_ID,
      notes: { refund_id: REFUND_ID, booking_id: 'booking-1' },
    });
  });

  it('reads a processed refund with its bank reference, and empty notes sent as []', async () => {
    fetchMock.mockResolvedValue(
      json(refund({ status: 'processed', acquirer_data: { arn: '74836185829' }, notes: [] })),
    );
    await expect(gateway.fetchRefund('rfnd_ABCDEFGHIJKLMN')).resolves.toMatchObject({
      status: 'processed',
      reference: '74836185829',
      notes: {},
    });
    expect(lastRequest().url).toBe('https://api.razorpay.com/v1/refunds/rfnd_ABCDEFGHIJKLMN');
  });

  it('lists a payment refunds and finds ours by receipt or notes', async () => {
    fetchMock.mockResolvedValue(
      json({
        entity: 'collection',
        count: 2,
        items: [
          refund({ id: 'rfnd_DASHBOARD0001', receipt: null, notes: [] }),
          refund({ receipt: null }),
        ],
      }),
    );
    const refunds = await gateway.listPaymentRefunds('pay_ABCDEFGHIJKLMN');
    expect(refunds.map((entry) => entry.id)).toEqual(['rfnd_DASHBOARD0001', 'rfnd_ABCDEFGHIJKLMN']);
    expect(findOurRefund(refunds, REFUND_ID)?.id).toBe('rfnd_ABCDEFGHIJKLMN');
    expect(findOurRefund(refunds, 'another-refund')).toBeNull();
    expect(lastRequest().url).toBe(
      'https://api.razorpay.com/v1/payments/pay_ABCDEFGHIJKLMN/refunds?count=100',
    );
  });

  it('refuses responses that are not a refund of ours', async () => {
    for (const body of [
      refund({ entity: 'payment' }),
      refund({ id: 'pay_ABCDEFGHIJKLMN' }),
      refund({ payment_id: 'pay_../x' }),
      refund({ amount: 0 }),
      refund({ amount: 12.5 }),
      { error: null },
    ]) {
      fetchMock.mockResolvedValueOnce(json(body));
      await expect(gateway.fetchRefund('rfnd_ABCDEFGHIJKLMN')).rejects.toMatchObject({
        name: 'RazorpayApiError',
        errorCode: 'UNEXPECTED_RESPONSE',
      });
    }
  });

  it('distinguishes definitive rejections from retryable failures', async () => {
    fetchMock.mockResolvedValueOnce(
      json(
        {
          error: {
            code: 'BAD_REQUEST_ERROR',
            description: 'The refund amount provided is greater than amount captured',
          },
        },
        400,
      ),
    );
    await expect(
      gateway.createRefund({
        refundId: REFUND_ID,
        providerPaymentId: 'pay_ABCDEFGHIJKLMN',
        amountPaise: 45_000,
        notes: {},
      }),
    ).rejects.toMatchObject({ name: 'RazorpayApiError', httpStatus: 400 });
    fetchMock.mockResolvedValueOnce(json({ error: { code: 'SERVER_ERROR' } }, 503));
    await expect(gateway.fetchRefund('rfnd_ABCDEFGHIJKLMN')).rejects.toBeInstanceOf(
      RazorpayUnavailableError,
    );
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(gateway.listPaymentRefunds('pay_ABCDEFGHIJKLMN')).rejects.toBeInstanceOf(
      RazorpayUnavailableError,
    );
    fetchMock.mockResolvedValueOnce(json({ error: { code: 'BAD_REQUEST_ERROR' } }, 404));
    await expect(gateway.fetchRefund('rfnd_ABCDEFGHIJKLMN')).rejects.toBeInstanceOf(
      RazorpayApiError,
    );
  });

  it('refuses unsafe input before calling Razorpay', async () => {
    await expect(gateway.fetchRefund('rfnd_../../payments')).rejects.toBeInstanceOf(RangeError);
    await expect(gateway.listPaymentRefunds('pay_../refunds')).rejects.toBeInstanceOf(RangeError);
    const valid = {
      refundId: REFUND_ID,
      providerPaymentId: 'pay_ABCDEFGHIJKLMN',
      amountPaise: 45_000,
      notes: {},
    };
    await expect(
      gateway.createRefund({ ...valid, providerPaymentId: 'pay_x/../../orders' }),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      gateway.createRefund({ ...valid, refundId: 'bad key with spaces, too long for a receipt' }),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(gateway.createRefund({ ...valid, amountPaise: 0 })).rejects.toBeInstanceOf(
      RangeError,
    );
    await expect(gateway.createRefund({ ...valid, amountPaise: 10.5 })).rejects.toBeInstanceOf(
      RangeError,
    );
    await expect(
      gateway.createRefund({
        ...valid,
        notes: Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`k${i}`, 'v'])),
      }),
    ).rejects.toBeInstanceOf(RangeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

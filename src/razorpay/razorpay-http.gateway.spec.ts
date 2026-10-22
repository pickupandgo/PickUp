import type { AppConfig } from '../config/app-config';
import { RazorpayHttpGateway } from './razorpay-http.gateway';
import { RazorpayApiError, RazorpayUnavailableError } from './razorpay.errors';

const config = {
  razorpay: {
    keyId: 'rzp_test_UnitKey123',
    keySecret: 'unit_key_secret_value',
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

const order = {
  id: 'order_ABCDEFGHIJKLMN',
  entity: 'order',
  amount: 50000,
  amount_paid: 0,
  currency: 'INR',
  receipt: '0b6a2b1e-9b3c-4f0e-8f8e-2a6d4c1b7e90',
  status: 'created',
};

const payment = {
  id: 'pay_ABCDEFGHIJKLMN',
  entity: 'payment',
  amount: 50000,
  currency: 'INR',
  status: 'captured',
  order_id: order.id,
  method: 'upi',
};

describe('RazorpayHttpGateway', () => {
  let fetchMock: jest.SpyInstance;
  const gateway = new RazorpayHttpGateway(config);

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => fetchMock.mockRestore());

  function lastRequest(): { url: string; init: RequestInit } {
    const call = fetchMock.mock.calls.at(-1) as [URL, RequestInit];
    return { url: call[0].toString(), init: call[1] };
  }

  it('creates orders with Basic auth, INR and our receipt', async () => {
    fetchMock.mockResolvedValue(json(order));
    const created = await gateway.createOrder({
      amountPaise: 50000,
      receipt: order.receipt,
      notes: { payment_id: order.receipt },
    });

    expect(created).toEqual({
      id: order.id,
      amount: 50000,
      currency: 'INR',
      receipt: order.receipt,
      status: 'created',
    });
    const { url, init } = lastRequest();
    expect(url).toBe('https://api.razorpay.com/v1/orders');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    const headers = init.headers as Record<string, string>;
    expect(headers['authorization']).toBe(
      `Basic ${Buffer.from('rzp_test_UnitKey123:unit_key_secret_value').toString('base64')}`,
    );
    expect(JSON.parse(init.body as string)).toEqual({
      amount: 50000,
      currency: 'INR',
      receipt: order.receipt,
      notes: { payment_id: order.receipt },
    });
  });

  it('maps a 4xx into a definitive RazorpayApiError with the provider code', async () => {
    fetchMock.mockResolvedValue(
      json({ error: { code: 'BAD_REQUEST_ERROR', description: 'Amount is invalid' } }, 400),
    );
    const error = await gateway.fetchPayment(payment.id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RazorpayApiError);
    expect(error).toMatchObject({ httpStatus: 400, errorCode: 'BAD_REQUEST_ERROR' });
  });

  it.each([500, 502, 503, 429])('treats HTTP %p as retryable', async (status) => {
    fetchMock.mockResolvedValue(json({ error: { code: 'SERVER_ERROR' } }, status));
    await expect(gateway.fetchPayment(payment.id)).rejects.toBeInstanceOf(RazorpayUnavailableError);
  });

  it('treats network failures and timeouts as retryable', async () => {
    fetchMock.mockRejectedValue(new DOMException('The operation was aborted', 'TimeoutError'));
    await expect(gateway.fetchPayment(payment.id)).rejects.toBeInstanceOf(RazorpayUnavailableError);
  });

  it('rejects responses that do not look like a Razorpay payment', async () => {
    fetchMock.mockResolvedValue(json({ id: 'pay_ABCDEFGHIJKLMN', entity: 'refund' }));
    await expect(gateway.fetchPayment(payment.id)).rejects.toMatchObject({
      httpStatus: 502,
      errorCode: 'UNEXPECTED_RESPONSE',
    });
  });

  it('refuses ids that could change the request path, without calling Razorpay', async () => {
    await expect(gateway.fetchPayment('pay_x/../../orders')).rejects.toBeInstanceOf(RangeError);
    await expect(gateway.fetchOrderPayments('order_../x')).rejects.toBeInstanceOf(RangeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('captures for the given amount', async () => {
    fetchMock.mockResolvedValue(json(payment));
    await gateway.capturePayment(payment.id, 50000);
    const { url, init } = lastRequest();
    expect(url).toBe(`https://api.razorpay.com/v1/payments/${payment.id}/capture`);
    expect(JSON.parse(init.body as string)).toEqual({ amount: 50000, currency: 'INR' });
  });

  it('finds an order by receipt', async () => {
    fetchMock.mockResolvedValue(json({ entity: 'collection', count: 1, items: [order] }));
    await expect(gateway.findOrderByReceipt(order.receipt)).resolves.toMatchObject({
      id: order.id,
    });
    expect(lastRequest().url).toBe(
      `https://api.razorpay.com/v1/orders?receipt=${order.receipt}&count=10`,
    );
  });

  it('returns null when no order has the receipt', async () => {
    fetchMock.mockResolvedValue(json({ entity: 'collection', count: 0, items: [] }));
    await expect(gateway.findOrderByReceipt(order.receipt)).resolves.toBeNull();
  });

  it('lists the payments of an order', async () => {
    fetchMock.mockResolvedValue(json({ entity: 'collection', count: 1, items: [payment] }));
    await expect(gateway.fetchOrderPayments(order.id)).resolves.toEqual([
      {
        id: payment.id,
        amount: 50000,
        currency: 'INR',
        status: 'captured',
        orderId: order.id,
        method: 'upi',
      },
    ]);
  });

  it('validates order input against Razorpay limits before sending', async () => {
    await expect(
      gateway.createOrder({ amountPaise: 10.5, receipt: 'r', notes: {} }),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      gateway.createOrder({ amountPaise: 100, receipt: 'x'.repeat(41), notes: {} }),
    ).rejects.toBeInstanceOf(RangeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

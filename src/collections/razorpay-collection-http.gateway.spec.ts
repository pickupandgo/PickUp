import type { AppConfig } from '../config/app-config';
import { RazorpayCollectionHttpGateway } from './razorpay-collection-http.gateway';

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

const collectionId = '0b6a2b1e-9b3c-4f0e-8f8e-2a6d4c1b7e90';
const bookingId = '1c7b3c2f-0c4d-4a1f-9f9f-3b7e5d2c8f01';
const link = {
  id: 'plink_ABCDEFGHIJKLMN',
  entity: 'payment_link',
  amount: 50_000,
  amount_paid: 0,
  currency: 'INR',
  status: 'created',
  short_url: 'https://rzp.io/i/AbCdEf',
  expire_by: 1_900_000_000,
  order_id: '',
  reference_id: collectionId,
  payments: null,
  notes: { collection_id: collectionId, booking_id: bookingId },
};

describe('RazorpayCollectionHttpGateway', () => {
  let fetchMock: jest.SpyInstance;
  const gateway = new RazorpayCollectionHttpGateway(config);

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => fetchMock.mockRestore());

  function lastRequest(): { url: string; init: RequestInit } {
    const call = fetchMock.mock.calls.at(-1) as [URL, RequestInit];
    return { url: call[0].toString(), init: call[1] };
  }

  it('creates a fixed-amount payment link referenced by our collection id', async () => {
    fetchMock.mockResolvedValue(json(link));
    const state = await gateway.create('PAYMENT_LINK', {
      collectionId,
      bookingId,
      stage: 'PICKUP',
      stop: null,
      amountPaise: 50_000,
      expiresAt: new Date(1_900_000_000_000),
      description: 'PickUp booking ENG-1',
    });

    expect(state).toMatchObject({
      product: 'PAYMENT_LINK',
      referenceId: link.id,
      status: 'ACTIVE',
      url: link.short_url,
      amountPaise: 50_000,
      orderId: null,
      payments: [],
    });
    const { url, init } = lastRequest();
    expect(url).toBe('https://api.razorpay.com/v1/payment_links');
    expect(JSON.parse(init.body as string)).toEqual({
      amount: 50_000,
      currency: 'INR',
      accept_partial: false,
      reference_id: collectionId,
      description: 'PickUp booking ENG-1',
      expire_by: 1_900_000_000,
      reminder_enable: false,
      notify: { sms: false, email: false },
      notes: { collection_id: collectionId, booking_id: bookingId, stage: 'PICKUP' },
    });
  });

  it('reports a paid link with its captured payment', async () => {
    fetchMock.mockResolvedValue(
      json({
        ...link,
        status: 'paid',
        amount_paid: 50_000,
        order_id: 'order_ABCDEFGHIJKLMN',
        payments: [
          { payment_id: 'pay_ABCDEFGHIJKLMN', amount: 50_000, status: 'captured', method: 'upi' },
        ],
      }),
    );
    await expect(gateway.fetch('PAYMENT_LINK', link.id)).resolves.toMatchObject({
      status: 'PAID',
      orderId: 'order_ABCDEFGHIJKLMN',
      payments: [{ id: 'pay_ABCDEFGHIJKLMN', amount: 50_000, status: 'captured', currency: 'INR' }],
    });
  });

  it('returns the current state when a link can no longer be cancelled', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json(
          {
            error: { code: 'BAD_REQUEST_ERROR', description: 'cannot cancel an already paid link' },
          },
          400,
        ),
      )
      .mockResolvedValueOnce(json({ ...link, status: 'paid', payments: [] }));
    await expect(gateway.cancel('PAYMENT_LINK', link.id)).resolves.toMatchObject({
      status: 'PAID',
    });
    expect(fetchMock.mock.calls.map((call) => (call[0] as URL).toString())).toEqual([
      `https://api.razorpay.com/v1/payment_links/${link.id}/cancel`,
      `https://api.razorpay.com/v1/payment_links/${link.id}`,
    ]);
  });

  it('creates single-use fixed-amount UPI QR codes and reads their payments', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        id: 'qr_ABCDEFGHIJKLMN',
        entity: 'qr_code',
        status: 'active',
        image_url: 'https://rzp.io/i/qr123',
        payment_amount: 30_000,
        payments_amount_received: 0,
        payments_count_received: 0,
        close_by: 1_900_000_000,
        notes: [],
      }),
    );
    const created = await gateway.create('QR_CODE', {
      collectionId,
      bookingId,
      stage: 'DELIVERY',
      stop: { id: 'b5f1c0de-0000-4000-8000-000000000002', sequence: 2 },
      amountPaise: 30_000,
      expiresAt: new Date(1_900_000_000_000),
      description: 'PickUp booking ENG-2, drop 2',
    });
    expect(created).toMatchObject({
      product: 'QR_CODE',
      status: 'ACTIVE',
      url: 'https://rzp.io/i/qr123',
    });
    expect(JSON.parse(lastRequest().init.body as string)).toMatchObject({
      type: 'upi_qr',
      usage: 'single_use',
      fixed_amount: true,
      payment_amount: 30_000,
      close_by: 1_900_000_000,
      // The obligation it pays for: the collection, its booking, the stage and the drop.
      notes: {
        collection_id: collectionId,
        booking_id: bookingId,
        stage: 'DELIVERY',
        booking_stop_id: 'b5f1c0de-0000-4000-8000-000000000002',
        stop_sequence: '2',
      },
    });

    fetchMock
      .mockResolvedValueOnce(
        json({
          id: 'qr_ABCDEFGHIJKLMN',
          entity: 'qr_code',
          status: 'closed',
          close_reason: 'paid',
          payment_amount: 30_000,
          payments_amount_received: 30_000,
          payments_count_received: 1,
        }),
      )
      .mockResolvedValueOnce(
        json({
          entity: 'collection',
          count: 1,
          items: [
            {
              id: 'pay_QRPAYMENT00001',
              entity: 'payment',
              amount: 30_000,
              currency: 'INR',
              status: 'captured',
              order_id: null,
              method: 'upi',
            },
          ],
        }),
      );
    await expect(gateway.fetch('QR_CODE', 'qr_ABCDEFGHIJKLMN')).resolves.toMatchObject({
      status: 'PAID',
      payments: [{ id: 'pay_QRPAYMENT00001', orderId: null }],
    });
  });

  it('refuses ids that could change the request path', async () => {
    await expect(gateway.fetch('PAYMENT_LINK', 'plink_../../orders')).rejects.toBeInstanceOf(
      RangeError,
    );
    await expect(gateway.cancel('QR_CODE', 'qr_x/../y')).rejects.toBeInstanceOf(RangeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

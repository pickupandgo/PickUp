import {
  collectAvailability,
  requiredFeePaise,
  shouldReuseKey,
  watchCollection,
} from '../src/services/payments/collectionFlow';
import {
  isRazorpayUrl,
  type CollectionDto,
  type DriverTripDto,
} from '../src/services/payments/collectionsDto';
import { createPaymentsApi } from '../src/services/payments/paymentsApi';
import type { PaymentsClient } from '../src/services/payments/paymentsClient';
import { PaymentsApiError } from '../src/services/payments/paymentsErrors';
import { qrMatrix, qrPath } from '../src/services/payments/qrMatrix';

const TRIP_ID = '6f1c1a3e-2a4b-4c5d-8e9f-0a1b2c3d4e5f';
const BOOKING_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const COLLECTION_ID = '7d444840-9dc0-41ae-9a3c-7b5e2b8f0c11';
const KEY = 'c0ffee00-1234-4abc-8def-000000000001';
const LINK = 'https://rzp.io/rzp/AbCdEf12';

function fakeClient(
  ...responses: unknown[]
): PaymentsClient & { request: jest.Mock } {
  const queue = [...responses];
  return {
    request: jest.fn(async () => {
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (next instanceof Error) {
        throw next;
      }
      return next;
    }),
  };
}

function tripBody(
  payment: Record<string, unknown> = {},
  overrides: Record<string, unknown> = {},
) {
  return {
    tripId: TRIP_ID,
    bookingId: BOOKING_ID,
    externalRef: 'ENG-1001',
    status: 'DELIVERED',
    assignedAt: '2026-10-06T08:00:00.000Z',
    completedAt: null,
    payment: {
      method: 'PAY_AT_DELIVERY',
      status: 'UNPAID',
      farePaise: 50_000,
      platformFeePaise: 5_000,
      driverSharePaise: 45_000,
      collectionStage: 'DELIVERY',
      collectionOpen: true,
      ...payment,
    },
    ...overrides,
  };
}

function collectionBody(overrides: Record<string, unknown> = {}) {
  return {
    collectionId: COLLECTION_ID,
    bookingId: BOOKING_ID,
    tripId: TRIP_ID,
    stage: 'DELIVERY',
    method: 'ONLINE_QR',
    status: 'PENDING',
    amountPaise: 50_000,
    platformFeePaise: null,
    qr: {
      product: 'PAYMENT_LINK',
      url: LINK,
      expiresAt: '2026-10-06T09:00:00.000Z',
    },
    providerPaymentId: null,
    paymentMethod: null,
    failureReason: null,
    completedAt: null,
    createdAt: '2026-10-06T08:30:00.000Z',
    replayed: false,
    ...overrides,
  };
}

const asCollection = (overrides: Record<string, unknown> = {}) =>
  collectionBody(overrides) as unknown as CollectionDto;

describe('trip and collection API', () => {
  it('lists running trips and keeps the server fare split', async () => {
    const client = fakeClient([tripBody()]);
    const trips = await createPaymentsApi(client).listActiveTrips();
    expect(client.request).toHaveBeenCalledWith({
      method: 'GET',
      path: '/v1/trips',
      query: { active: 'true' },
    });
    expect(trips[0]).toMatchObject({
      tripId: TRIP_ID,
      externalRef: 'ENG-1001',
      payment: {
        farePaise: 50_000,
        platformFeePaise: 5_000,
        driverSharePaise: 45_000,
        collectionOpen: true,
      },
    });
  });

  it('refuses a fare split that does not add up', async () => {
    const client = fakeClient([tripBody({ driverSharePaise: 46_000 })]);
    await expect(
      createPaymentsApi(client).listActiveTrips(),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('reads one trip and refuses another trip in the answer', async () => {
    const api = createPaymentsApi(fakeClient(tripBody()));
    await expect(api.getTrip(TRIP_ID)).resolves.toMatchObject({
      tripId: TRIP_ID,
    });
    const other = createPaymentsApi(
      fakeClient(tripBody({}, { tripId: COLLECTION_ID })),
    );
    await expect(other.getTrip(TRIP_ID)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('checks inputs before any request', async () => {
    const client = fakeClient(collectionBody());
    const api = createPaymentsApi(client);
    await expect(api.getTrip('../wallet')).rejects.toBeInstanceOf(RangeError);
    await expect(
      api.startCollection(TRIP_ID, { method: 'CASH', amountPaise: 0 }, KEY),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      api.startCollection(TRIP_ID, { method: 'CASH', amountPaise: 100.5 }, KEY),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      api.startCollection(
        TRIP_ID,
        { method: 'UPI' as 'CASH', amountPaise: 50_000 },
        KEY,
      ),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      api.startCollection(
        TRIP_ID,
        { method: 'CASH', amountPaise: 50_000 },
        'short',
      ),
    ).rejects.toBeInstanceOf(RangeError);
    expect(client.request).not.toHaveBeenCalled();
  });

  it('starts a collection with the idempotency key and the server fare', async () => {
    const client = fakeClient(collectionBody());
    const collection = await createPaymentsApi(client).startCollection(
      TRIP_ID,
      { method: 'ONLINE_QR', amountPaise: 50_000 },
      KEY,
    );
    expect(client.request).toHaveBeenCalledWith({
      method: 'POST',
      path: `/v1/trips/${TRIP_ID}/collections`,
      body: { method: 'ONLINE_QR', amountPaise: 50_000 },
      idempotencyKey: KEY,
    });
    expect(collection).toMatchObject({
      status: 'PENDING',
      qr: { product: 'PAYMENT_LINK', url: LINK },
    });
  });

  it('records cash with the fee the server debited', async () => {
    const client = fakeClient(
      collectionBody({
        method: 'CASH',
        status: 'COMPLETED',
        platformFeePaise: 5_000,
        qr: null,
        completedAt: '2026-10-06T08:31:00.000Z',
      }),
    );
    await expect(
      createPaymentsApi(client).startCollection(
        TRIP_ID,
        { method: 'CASH', amountPaise: 50_000 },
        KEY,
      ),
    ).resolves.toMatchObject({ status: 'COMPLETED', platformFeePaise: 5_000 });
  });

  it('never acts on a collection other than the one asked for', async () => {
    for (const overrides of [
      { amountPaise: 49_999 },
      { method: 'CASH', qr: null },
      { tripId: COLLECTION_ID },
    ]) {
      const api = createPaymentsApi(fakeClient(collectionBody(overrides)));
      await expect(
        api.startCollection(
          TRIP_ID,
          { method: 'ONLINE_QR', amountPaise: 50_000 },
          KEY,
        ),
      ).rejects.toMatchObject({ code: 'AMOUNT_MISMATCH' });
    }
  });

  it('refuses a QR that is not a Razorpay link, or a pending QR without one', async () => {
    for (const qr of [
      {
        product: 'PAYMENT_LINK',
        url: 'https://evil.example/pay',
        expiresAt: null,
      },
      { product: 'PAYMENT_LINK', url: 'http://rzp.io/i/abc', expiresAt: null },
      { product: 'PAYMENT_LINK', url: null, expiresAt: null },
    ]) {
      const api = createPaymentsApi(fakeClient(collectionBody({ qr })));
      await expect(
        api.startCollection(
          TRIP_ID,
          { method: 'ONLINE_QR', amountPaise: 50_000 },
          KEY,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    }
  });

  it('polls one collection of one trip', async () => {
    const client = fakeClient(
      collectionBody({ status: 'COMPLETED', qr: null }),
    );
    const api = createPaymentsApi(client);
    await expect(
      api.getCollection(TRIP_ID, COLLECTION_ID),
    ).resolves.toMatchObject({
      status: 'COMPLETED',
    });
    expect(client.request).toHaveBeenCalledWith({
      method: 'GET',
      path: `/v1/trips/${TRIP_ID}/collections/${COLLECTION_ID}`,
    });
    const wrong = createPaymentsApi(
      fakeClient(collectionBody({ collectionId: BOOKING_ID })),
    );
    await expect(
      wrong.getCollection(TRIP_ID, COLLECTION_ID),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});

describe('isRazorpayUrl', () => {
  it.each([
    ['https://rzp.io/rzp/AbCdEf12', true],
    ['https://rzp.io/i/AbCdEf12', true],
    ['https://api.razorpay.com/v1/payment_links/plink_x', true],
    ['https://razorpay.com/payment-link/x?y=1', true],
    ['http://rzp.io/i/AbCdEf12', false],
    ['https://rzp.io.evil.com/i/x', false],
    ['https://rzp.io@evil.com/i/x', false],
    ['https://razorpay.com.evil.com/x', false],
    ['https://evil.com/rzp.io', false],
    ['https://rzp.io:8443/i/x', false],
    // eslint-disable-next-line no-script-url -- negative case: never shown as a QR
    ['javascript:alert(1)', false],
    ['https://rzp.io/i/a b', false],
  ])('%s -> %s', (url, expected) => {
    expect(isRazorpayUrl(url)).toBe(expected);
  });
});

describe('collectAvailability', () => {
  const trip = (payment: Record<string, unknown>) =>
    tripBody(payment) as unknown as DriverTripDto;

  it('is open only while the server says so', () => {
    expect(collectAvailability(trip({}))).toEqual({ kind: 'open' });
    expect(collectAvailability(trip({ collectionOpen: false }))).toEqual({
      kind: 'not_yet',
      stage: 'DELIVERY',
    });
    expect(
      collectAvailability(
        trip({
          method: 'PAY_AT_PICKUP',
          collectionStage: 'PICKUP',
          collectionOpen: false,
        }),
      ),
    ).toEqual({ kind: 'not_yet', stage: 'PICKUP' });
  });

  it('has nothing to collect once paid or when prepaid', () => {
    expect(collectAvailability(trip({ status: 'PAID' }))).toEqual({
      kind: 'paid',
      prepaid: false,
    });
    expect(
      collectAvailability(
        trip({
          method: 'PREPAID_UPI',
          collectionStage: null,
          collectionOpen: false,
        }),
      ),
    ).toEqual({ kind: 'paid', prepaid: true });
  });
});

describe('watchCollection', () => {
  const sleep = async () => undefined;

  it('waits until the server reports the QR paid', async () => {
    const getCollection = jest
      .fn()
      .mockResolvedValueOnce(asCollection())
      .mockResolvedValueOnce(
        asCollection({ status: 'COMPLETED', paymentMethod: 'upi' }),
      );
    const result = await watchCollection(asCollection(), {
      api: { getCollection },
      sleep,
    });
    expect(result).toMatchObject({
      kind: 'paid',
      collection: { paymentMethod: 'upi' },
    });
    expect(getCollection).toHaveBeenCalledTimes(2);
    expect(getCollection).toHaveBeenCalledWith(TRIP_ID, COLLECTION_ID);
  });

  it('keeps the QR through network errors and rate limits', async () => {
    const getCollection = jest
      .fn()
      .mockRejectedValueOnce(
        new PaymentsApiError('NETWORK_ERROR', 'offline', 0),
      )
      .mockRejectedValueOnce(
        new PaymentsApiError('RATE_LIMITED', 'slow down', 429),
      )
      .mockResolvedValueOnce(asCollection({ status: 'COMPLETED' }));
    await expect(
      watchCollection(asCollection(), { api: { getCollection }, sleep }),
    ).resolves.toMatchObject({ kind: 'paid' });
    expect(getCollection).toHaveBeenCalledTimes(3);
  });

  it('reports an expired or cancelled QR so a new one can be shown', async () => {
    const getCollection = jest
      .fn()
      .mockResolvedValue(
        asCollection({ status: 'FAILED', qr: null, failureReason: 'EXPIRED' }),
      );
    await expect(
      watchCollection(asCollection(), { api: { getCollection }, sleep }),
    ).resolves.toMatchObject({ kind: 'failed' });
  });

  it('stops when the screen is closed, and at the time limit', async () => {
    const getCollection = jest.fn().mockResolvedValue(asCollection());
    let open = true;
    const abandoned = watchCollection(asCollection(), {
      api: { getCollection },
      sleep: async () => {
        open = false;
      },
      isAbandoned: () => !open,
    });
    await expect(abandoned).resolves.toMatchObject({ kind: 'stopped' });
    expect(getCollection).not.toHaveBeenCalled();

    await expect(
      watchCollection(asCollection(), {
        api: { getCollection },
        sleep,
        maxPolls: 3,
      }),
    ).resolves.toMatchObject({ kind: 'stopped' });
    expect(getCollection).toHaveBeenCalledTimes(3);
  });

  it('stops on a malformed server answer instead of guessing', async () => {
    const getCollection = jest
      .fn()
      .mockRejectedValue(new PaymentsApiError('INVALID_RESPONSE', 'bad', 0));
    await expect(
      watchCollection(asCollection(), { api: { getCollection }, sleep }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});

describe('collection errors', () => {
  it('reads the wallet fee a cash trip needs', () => {
    expect(
      requiredFeePaise(
        new PaymentsApiError('INSUFFICIENT_BALANCE', 'low', 409, 'req', {
          requiredFeePaise: 5_000,
        }),
      ),
    ).toBe(5_000);
    expect(
      requiredFeePaise(
        new PaymentsApiError('INSUFFICIENT_BALANCE', 'low', 409),
      ),
    ).toBeNull();
    expect(
      requiredFeePaise(new PaymentsApiError('BOOKING_CLOSED', 'closed', 409)),
    ).toBeNull();
  });

  it('reuses the idempotency key only while the outcome is unknown', () => {
    expect(
      shouldReuseKey(new PaymentsApiError('NETWORK_ERROR', 'offline', 0)),
    ).toBe(true);
    expect(shouldReuseKey(new PaymentsApiError('HTTP_503', 'down', 503))).toBe(
      true,
    );
    expect(
      shouldReuseKey(new PaymentsApiError('INVALID_RESPONSE', 'bad', 0)),
    ).toBe(true);
    expect(
      shouldReuseKey(new PaymentsApiError('INSUFFICIENT_BALANCE', 'low', 409)),
    ).toBe(false);
    expect(shouldReuseKey(new Error('boom'))).toBe(false);
  });
});

describe('qrMatrix', () => {
  it('encodes a payment link as a square QR with its three finder patterns', () => {
    const matrix = qrMatrix(LINK);
    const size = matrix.length;
    expect(size).toBeGreaterThanOrEqual(21);
    expect((size - 17) % 4).toBe(0);
    expect(matrix.every(row => row.length === size)).toBe(true);
    // Each finder pattern has a dark 7x7 outer ring.
    for (const [top, left] of [
      [0, 0],
      [0, size - 7],
      [size - 7, 0],
    ]) {
      for (let i = 0; i < 7; i += 1) {
        expect(matrix[top][left + i]).toBe(true);
        expect(matrix[top + 6][left + i]).toBe(true);
        expect(matrix[top + i][left]).toBe(true);
        expect(matrix[top + i][left + 6]).toBe(true);
      }
    }
    expect(qrMatrix(LINK)).toEqual(matrix);
  });

  it('draws one square per dark module, inside the quiet zone', () => {
    const matrix = qrMatrix(LINK);
    const dark = matrix.flat().filter(Boolean).length;
    const path = qrPath(matrix, 4);
    expect(path.match(/M/g)).toHaveLength(dark);
    expect(path.startsWith('M4 4h1v1h-1z')).toBe(true);
  });

  it('refuses empty or oversized input', () => {
    expect(() => qrMatrix('')).toThrow(RangeError);
    expect(() => qrMatrix('x'.repeat(2049))).toThrow(RangeError);
  });
});

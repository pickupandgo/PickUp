import {
  cashShortfallPaise,
  collectAvailability,
  dropHandoverAllowed,
  isCollectable,
  pickupHandoverAllowed,
  requiredFeePaise,
  shouldReuseKey,
  watchCollection,
} from '../src/services/payments/collectionFlow';
import {
  isRazorpayUrl,
  parsePaymentGate,
  parseTrip,
  type CollectionDto,
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

/**
 * The payment gate of a trip (Phase 8: GET /v1/trips/:id carries it). Default: an older booking
 * paid at delivery for the whole booking, delivered and not paid yet.
 */
function gateBody(overrides: Record<string, unknown> = {}) {
  return {
    stage: 'DROP',
    stopSequence: null,
    paymentState: 'PAYMENT_REQUIRED',
    amountPaise: 50_000,
    cashFeePaise: 5_000,
    handoverAllowed: false,
    collectionId: null,
    lastFailure: null,
    ...overrides,
  };
}

// Phase 9: the fixture carries the Phase 8 fields (paymentGate, stops). The payment gate is
// required: the app decides collections and OTPs from it only (review G).
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
      paymentGate: gateBody(),
      stops: [],
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

  it('reads the payment gate and the drops of a booking paid drop by drop', async () => {
    const client = fakeClient(
      tripBody({
        status: 'PARTIALLY_PAID',
        paymentGate: gateBody({
          stopSequence: 2,
          amountPaise: 30_000,
          cashFeePaise: 3_000,
        }),
        stops: [
          {
            sequence: 1,
            payablePaise: 20_000,
            status: 'DELIVERED',
            paid: true,
          },
          { sequence: 2, payablePaise: 30_000, status: 'ARRIVED', paid: false },
        ],
      }),
    );
    await expect(
      createPaymentsApi(client).getTrip(TRIP_ID),
    ).resolves.toMatchObject({
      payment: {
        status: 'PARTIALLY_PAID',
        paymentGate: { stage: 'DROP', stopSequence: 2, amountPaise: 30_000 },
        stops: [
          { sequence: 1, paid: true },
          { sequence: 2, paid: false },
        ],
      },
    });
  });

  it('refuses a trip without its payment gate (handovers stay locked)', async () => {
    const client = fakeClient(tripBody({ paymentGate: undefined }));
    await expect(
      createPaymentsApi(client).getTrip(TRIP_ID),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
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

  it("names the drop for a booking paid drop by drop, and checks the answer is that drop's", async () => {
    const client = fakeClient(
      collectionBody({
        amountPaise: 30_000,
        stopSequence: 2,
        bookingPaymentStatus: 'PARTIALLY_PAID',
        paymentGate: gateBody({
          stopSequence: 2,
          amountPaise: 30_000,
          paymentState: 'PAYMENT_PROCESSING',
          collectionId: COLLECTION_ID,
        }),
      }),
    );
    const collection = await createPaymentsApi(client).startCollection(
      TRIP_ID,
      { method: 'ONLINE_QR', amountPaise: 30_000, stopSequence: 2 },
      KEY,
    );
    expect(client.request).toHaveBeenCalledWith({
      method: 'POST',
      path: `/v1/trips/${TRIP_ID}/collections`,
      body: { method: 'ONLINE_QR', amountPaise: 30_000, stopSequence: 2 },
      idempotencyKey: KEY,
    });
    expect(collection).toMatchObject({
      stopSequence: 2,
      bookingPaymentStatus: 'PARTIALLY_PAID',
      paymentGate: { paymentState: 'PAYMENT_PROCESSING' },
    });

    const otherDrop = createPaymentsApi(
      fakeClient(collectionBody({ amountPaise: 30_000, stopSequence: 3 })),
    );
    await expect(
      otherDrop.startCollection(
        TRIP_ID,
        { method: 'ONLINE_QR', amountPaise: 30_000, stopSequence: 2 },
        KEY,
      ),
    ).rejects.toMatchObject({ code: 'AMOUNT_MISMATCH' });

    const invalid = fakeClient(collectionBody());
    for (const stopSequence of [0, 26, 1.5]) {
      await expect(
        createPaymentsApi(invalid).startCollection(
          TRIP_ID,
          { method: 'CASH', amountPaise: 30_000, stopSequence },
          KEY,
        ),
      ).rejects.toBeInstanceOf(RangeError);
    }
    expect(invalid.request).not.toHaveBeenCalled();
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

// Updated in Phase 9. These tests used to derive availability from `collectionOpen` and the
// booking's payment status, and asserted that a PREPAID_UPI booking is always "paid", even
// while UNPAID (the bug review G names). The Phase 8 contract makes the payment gate the only
// source: the same cases (open, not yet at pickup / delivery, paid, prepaid) are kept, now built
// from the gate, and the prepaid-while-unpaid case asserts the fix.
describe('collectAvailability (payment gate only)', () => {
  const trip = (
    gate: Record<string, unknown>,
    payment: Record<string, unknown> = {},
  ) => parseTrip(tripBody({ ...payment, paymentGate: gateBody(gate) }));

  it('is open only while the gate says the payment is owed now', () => {
    expect(collectAvailability(trip({}))).toEqual({
      kind: 'open',
      stage: 'DROP',
      amountPaise: 50_000,
      cashFeePaise: 5_000,
      stopSequence: null,
      lastFailure: null,
    });
    expect(
      collectAvailability(
        trip({
          paymentState: 'PAYMENT_FAILED',
          collectionId: COLLECTION_ID,
          lastFailure: 'EXPIRED',
        }),
      ),
    ).toMatchObject({ kind: 'open', lastFailure: 'EXPIRED' });
    // collectionOpen is not what decides.
    expect(
      collectAvailability(
        trip({ paymentState: 'NOT_YET' }, { collectionOpen: true }),
      ),
    ).toEqual({ kind: 'not_yet', stage: 'DELIVERY' });
    expect(
      collectAvailability(
        trip(
          { stage: 'PICKUP', paymentState: 'NOT_YET' },
          {
            method: 'PAY_AT_PICKUP',
            collectionStage: 'PICKUP',
            collectionOpen: false,
          },
        ),
      ),
    ).toEqual({ kind: 'not_yet', stage: 'PICKUP' });
  });

  it('resumes an open QR instead of opening a second one', () => {
    expect(
      collectAvailability(
        trip({
          paymentState: 'PAYMENT_PROCESSING',
          collectionId: COLLECTION_ID,
        }),
      ),
    ).toMatchObject({
      kind: 'processing',
      collectionId: COLLECTION_ID,
      amountPaise: 50_000,
    });
  });

  it('collects one drop at a time for a booking paid drop by drop', () => {
    expect(
      collectAvailability(
        trip({ stopSequence: 2, amountPaise: 30_000, cashFeePaise: 3_000 }),
      ),
    ).toEqual({
      kind: 'open',
      stage: 'DROP',
      amountPaise: 30_000,
      cashFeePaise: 3_000,
      stopSequence: 2,
      lastFailure: null,
    });
  });

  it('has nothing to collect once paid or when prepaid', () => {
    expect(
      collectAvailability(
        trip(
          { paymentState: 'PAYMENT_CONFIRMED', handoverAllowed: true },
          { status: 'PAID' },
        ),
      ),
    ).toEqual({ kind: 'paid', prepaid: false, stopSequence: null });
    expect(
      collectAvailability(
        trip(
          {
            stage: null,
            paymentState: 'PAYMENT_CONFIRMED',
            cashFeePaise: null,
            handoverAllowed: true,
          },
          {
            method: 'PREPAID_UPI',
            status: 'PAID',
            collectionStage: null,
            collectionOpen: false,
          },
        ),
      ),
    ).toEqual({ kind: 'paid', prepaid: true, stopSequence: null });
  });

  it('never treats a prepaid booking that is still unpaid as paid', () => {
    expect(
      collectAvailability(
        trip(
          {
            stage: null,
            paymentState: 'PAYMENT_REQUIRED',
            cashFeePaise: null,
            handoverAllowed: true,
          },
          {
            method: 'PREPAID_UPI',
            status: 'UNPAID',
            collectionStage: null,
            collectionOpen: false,
          },
        ),
      ),
    ).toEqual({ kind: 'awaiting_customer' });
  });

  it('marks only owed or open payments as collectable', () => {
    expect(isCollectable(trip({}))).toBe(true);
    expect(
      isCollectable(
        trip({
          paymentState: 'PAYMENT_PROCESSING',
          collectionId: COLLECTION_ID,
        }),
      ),
    ).toBe(true);
    expect(isCollectable(trip({ paymentState: 'NOT_YET' }))).toBe(false);
    expect(
      isCollectable(
        trip({ paymentState: 'PAYMENT_CONFIRMED', handoverAllowed: true }),
      ),
    ).toBe(false);
  });
});

describe('payment gate: handovers', () => {
  const gate = (overrides: Record<string, unknown>) =>
    parsePaymentGate(gateBody(overrides));

  it('locks the pickup OTP until the payment backend allows the handover', () => {
    const pickup = { stage: 'PICKUP', amountPaise: 50_000 };
    // Pay at pickup, unpaid / QR open / last QR failed: locked.
    expect(pickupHandoverAllowed(gate({ ...pickup }))).toBe(false);
    expect(
      pickupHandoverAllowed(
        gate({
          ...pickup,
          paymentState: 'PAYMENT_PROCESSING',
          collectionId: COLLECTION_ID,
        }),
      ),
    ).toBe(false);
    expect(
      pickupHandoverAllowed(
        gate({ ...pickup, paymentState: 'PAYMENT_FAILED' }),
      ),
    ).toBe(false);
    // Not arrived yet as far as the backend knows.
    expect(
      pickupHandoverAllowed(gate({ ...pickup, paymentState: 'NOT_YET' })),
    ).toBe(false);
    // Paid: allowed.
    expect(
      pickupHandoverAllowed(
        gate({
          ...pickup,
          paymentState: 'PAYMENT_CONFIRMED',
          handoverAllowed: true,
        }),
      ),
    ).toBe(true);
    // Pay at delivery: nothing owed at the pickup, the pickup proceeds without payment.
    expect(
      pickupHandoverAllowed(
        gate({
          stage: 'PICKUP',
          paymentState: 'NOT_REQUIRED',
          amountPaise: null,
          cashFeePaise: null,
          handoverAllowed: true,
        }),
      ),
    ).toBe(true);
    // A drop's gate never opens the pickup; no gate opens nothing.
    expect(
      pickupHandoverAllowed(
        gate({
          handoverAllowed: true,
          paymentState: 'NOT_REQUIRED',
          amountPaise: null,
        }),
      ),
    ).toBe(false);
    expect(pickupHandoverAllowed(null)).toBe(false);
  });

  it("opens a drop's OTP only for that drop, once it is paid (or nothing is owed)", () => {
    const paidDrop2 = gate({
      stopSequence: 2,
      amountPaise: 30_000,
      paymentState: 'PAYMENT_CONFIRMED',
      handoverAllowed: true,
    });
    expect(dropHandoverAllowed(paidDrop2, 2)).toBe(true);
    expect(dropHandoverAllowed(paidDrop2, 3)).toBe(false);
    expect(
      dropHandoverAllowed(gate({ stopSequence: 2, amountPaise: 30_000 }), 2),
    ).toBe(false);
    // Paid at pickup: the drops are handed over freely.
    expect(
      dropHandoverAllowed(
        gate({
          stopSequence: 1,
          paymentState: 'NOT_REQUIRED',
          amountPaise: null,
          cashFeePaise: null,
          handoverAllowed: true,
        }),
        1,
      ),
    ).toBe(true);
    expect(dropHandoverAllowed(null, 1)).toBe(false);
  });

  it('refuses a gate that is owed without an amount, or malformed', () => {
    expect(() => parsePaymentGate(gateBody({ amountPaise: null }))).toThrow(
      PaymentsApiError,
    );
    expect(() =>
      parsePaymentGate(gateBody({ handoverAllowed: 'yes' })),
    ).toThrow(PaymentsApiError);
    expect(() => parsePaymentGate(gateBody({ paymentState: 'PAID' }))).toThrow(
      PaymentsApiError,
    );
    expect(() => parsePaymentGate(gateBody({ stopSequence: 0 }))).toThrow(
      PaymentsApiError,
    );
  });
});

describe('cash fee against the wallet', () => {
  it('shows the shortfall only when the balance does not cover the fee', () => {
    expect(cashShortfallPaise(5_000, 2_000)).toBe(3_000);
    expect(cashShortfallPaise(5_000, 5_000)).toBeNull();
    expect(cashShortfallPaise(null, 0)).toBeNull();
    expect(cashShortfallPaise(5_000, null)).toBeNull();
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

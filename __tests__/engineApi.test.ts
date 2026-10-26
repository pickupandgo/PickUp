/**
 * Engine client contract (Phase 8): booking carries only {quoteId, paymentMethod, driverId} and
 * never a fare; identity is the Firebase token; OTPs come from the gated endpoint; cancellations
 * send a reason and no client identity.
 */
jest.mock('../src/config/env', () => ({
  env: { apiBaseUrl: 'https://engine.test', paymentsApiBaseUrl: 'https://pay.test', googleMapsApiKey: '' },
  hasApiConfig: () => true,
  hasPaymentsConfig: () => true,
  assertApiConfig: () => undefined,
}));

const mockGetIdToken = jest.fn(async (_force?: boolean) => 'tok-1');
let mockCurrentUser: { getIdToken: typeof mockGetIdToken } | null = { getIdToken: mockGetIdToken };
jest.mock('@react-native-firebase/auth', () => ({
  __esModule: true,
  getAuth: () => ({ currentUser: mockCurrentUser }),
}));

import {
  createRide,
  cancelRide,
  cancelTrip,
  getRideOtps,
  getActiveTripForCustomer,
} from '../src/api/engine';

type FetchCall = { url: string; init: RequestInit };
const calls: FetchCall[] = [];

function ok(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}
function httpError(status: number, body: unknown = {}): Response {
  return {
    ok: false,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const bodyOf = (call: FetchCall): any => JSON.parse(String(call.init.body ?? '{}'));
const authOf = (call: FetchCall): string | undefined =>
  (call.init.headers as Record<string, string>)?.Authorization;

beforeEach(() => {
  calls.length = 0;
  mockCurrentUser = { getIdToken: mockGetIdToken };
  mockGetIdToken.mockClear();
  mockGetIdToken.mockImplementation(async () => 'tok-1');
});

describe('createRide (booking registration)', () => {
  const RIDE = {
    id: 'ride-1',
    status: 'REQUESTED',
    paymentMethod: 'PAY_AT_PICKUP',
    paymentBookingId: 'b-1',
  };

  it('sends only quoteId, paymentMethod and driverId — never a fare or client identity', async () => {
    globalThis.fetch = jest.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return ok({ success: true, ride: RIDE });
    }) as unknown as typeof fetch;

    await createRide({
      quoteId: 'q-1',
      paymentMethod: 'PAY_AT_PICKUP',
      pickup: { address: 'A' },
      drops: [{ address: 'B', receiver: { name: 'R', phone: '9' } }],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://engine.test/rides');
    expect(calls[0].init.method).toBe('POST');
    const body = bodyOf(calls[0]);
    expect(body).toMatchObject({
      quoteId: 'q-1',
      paymentMethod: 'PAY_AT_PICKUP',
    });
    // The client is never authoritative for money or identity.
    for (const forbidden of [
      'fare',
      'farePaise',
      'amount',
      'amountPaise',
      'payablePaise',
      'taxPaise',
      'platformFeePaise',
      'price',
      'customerId',
      'driverId',
    ]) {
      expect(body).not.toHaveProperty(forbidden);
    }
    // Carries the Firebase bearer token.
    expect(authOf(calls[0])).toBe('Bearer tok-1');
  });

  it('is never retried (a retry could duplicate the booking)', async () => {
    globalThis.fetch = jest.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      throw new TypeError('network down');
    }) as unknown as typeof fetch;

    await expect(
      createRide({ quoteId: 'q', paymentMethod: 'PAY_AT_DELIVERY' }),
    ).rejects.toBeTruthy();
    // retries: 0 → exactly one attempt.
    expect(calls).toHaveLength(1);
  });
});

describe('gated OTPs', () => {
  it('reads GET /rides/:id/otps and surfaces the withheld reason without an OTP', async () => {
    globalThis.fetch = jest.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return ok({
        success: true,
        rideId: 'ride-1',
        paymentMethod: 'PAY_AT_PICKUP',
        paymentStatus: 'UNPAID',
        pickup: { otp: null, withheld: 'PAYMENT_REQUIRED' },
        stops: [{ sequence: 1, otp: null, withheld: 'PAYMENT_REQUIRED' }],
      });
    }) as unknown as typeof fetch;

    const otps = await getRideOtps('ride-1');
    expect(calls[0].url).toBe('https://engine.test/rides/ride-1/otps');
    expect(otps.pickup.otp).toBeNull();
    expect(otps.pickup.withheld).toBe('PAYMENT_REQUIRED');
    expect(otps.stops[0].otp).toBeNull();
  });

  it('exposes the OTP once the server releases it', async () => {
    globalThis.fetch = jest.fn(async () =>
      ok({
        success: true,
        rideId: 'ride-1',
        paymentMethod: 'PAY_AT_DELIVERY',
        paymentStatus: 'UNPAID',
        pickup: { otp: '4821', withheld: null },
        stops: [{ sequence: 1, otp: '1122', withheld: null }],
      }),
    ) as unknown as typeof fetch;
    const otps = await getRideOtps('ride-1');
    expect(otps.pickup.otp).toBe('4821');
    expect(otps.stops[0].otp).toBe('1122');
  });
});

describe('cancellation', () => {
  it('sends a reason and no client identity', async () => {
    globalThis.fetch = jest.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return ok({ success: true, ride: { id: 'ride-1', status: 'CANCELLED' } });
    }) as unknown as typeof fetch;
    await cancelRide('ride-1', 'Changed my mind');
    expect(calls[0].url).toBe('https://engine.test/rides/ride-1/cancel');
    expect(bodyOf(calls[0])).toEqual({ reason: 'Changed my mind' });
    expect(bodyOf(calls[0])).not.toHaveProperty('customerId');
  });

  it('cancelTrip sends a reason and no client identity', async () => {
    globalThis.fetch = jest.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return ok({ success: true, trip: { id: 't-1', status: 'CANCELLED' } });
    }) as unknown as typeof fetch;
    await cancelTrip('t-1', 'No longer needed');
    expect(bodyOf(calls[0])).toEqual({ reason: 'No longer needed' });
    expect(bodyOf(calls[0])).not.toHaveProperty('customerId');
  });
});

describe('auth token', () => {
  it('refreshes the Firebase token once on a 401 and retries', async () => {
    let n = 0;
    mockGetIdToken.mockImplementation(async (force?: boolean) => (force ? 'tok-fresh' : 'tok-stale'));
    globalThis.fetch = jest.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      n += 1;
      return n === 1 ? httpError(401, { message: 'expired' }) : ok({ success: true, trip: null });
    }) as unknown as typeof fetch;

    await getActiveTripForCustomer('uid-1');
    expect(calls).toHaveLength(2);
    expect(authOf(calls[0])).toBe('Bearer tok-stale');
    expect(authOf(calls[1])).toBe('Bearer tok-fresh');
    expect(mockGetIdToken).toHaveBeenLastCalledWith(true);
  });

  it('uses the customer uid in the customer-scoped path', async () => {
    globalThis.fetch = jest.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return ok({ success: true, trip: null });
    }) as unknown as typeof fetch;
    await getActiveTripForCustomer('uid-ABC');
    expect(calls[0].url).toBe('https://engine.test/trips/active/customer/uid-ABC');
  });
});

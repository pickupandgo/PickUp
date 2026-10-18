/**
 * Payments backend client (Phase 8): the quote request carries no amount; the booking payment
 * view carries the gate and per-drop state; the Firebase token is sent and refreshed once on 401.
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
  createFareQuote,
  getBookingPayment,
  registerCustomer,
  isQuoteBookable,
} from '../src/api/payments';
import type { FareQuote } from '../src/api/types';

type FetchCall = { url: string; init: RequestInit };
const calls: FetchCall[] = [];
const ok = (body: unknown): Response =>
  ({ ok: true, status: 200, text: async () => JSON.stringify(body) } as unknown as Response);
const httpError = (status: number, body: unknown = {}): Response =>
  ({ ok: false, status, text: async () => JSON.stringify(body) } as unknown as Response);
const bodyOf = (c: FetchCall): any => JSON.parse(String(c.init.body ?? '{}'));

beforeEach(() => {
  calls.length = 0;
  mockCurrentUser = { getIdToken: mockGetIdToken };
  mockGetIdToken.mockClear();
  mockGetIdToken.mockImplementation(async () => 'tok-1');
});

const QUOTE = {
  quoteId: 'q-1',
  vehicleCategory: 'MINI_TRUCK',
  weightKg: 10,
  pickup: { latitude: 26.29, longitude: 73.02 },
  distanceMeters: 4200,
  farePaise: 26000,
  taxPaise: 0,
  payablePaise: 26000,
  currency: 'INR',
  drops: [{ sequence: 1, latitude: 26.3, longitude: 73.03, distanceMeters: 4200, farePaise: 26000, taxPaise: 0, payablePaise: 26000 }],
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
  redeemed: false,
  createdAt: new Date().toISOString(),
};

describe('createFareQuote', () => {
  it('sends locations, vehicle and weight only — never an amount', async () => {
    globalThis.fetch = jest.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return ok(QUOTE);
    }) as unknown as typeof fetch;

    await createFareQuote({
      pickup: { latitude: 26.29, longitude: 73.02, address: 'A' },
      drops: [{ latitude: 26.3, longitude: 73.03, address: 'B' }],
      vehicleCategory: 'MINI_TRUCK',
      weightKg: 10,
    });

    expect(calls[0].url).toBe('https://pay.test/v1/fare/quotes');
    const body = bodyOf(calls[0]);
    expect(body).toEqual({
      pickup: { latitude: 26.29, longitude: 73.02 },
      drops: [{ latitude: 26.3, longitude: 73.03 }],
      vehicleCategory: 'MINI_TRUCK',
      weightKg: 10,
    });
    for (const forbidden of ['farePaise', 'amountPaise', 'payablePaise', 'fare', 'price']) {
      expect(body).not.toHaveProperty(forbidden);
    }
    // No address/receiver PII is sent to pricing, only coordinates.
    expect(body.pickup).not.toHaveProperty('address');
    expect(body.drops[0]).not.toHaveProperty('address');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
  });
});

describe('registerCustomer', () => {
  it('POSTs /v1/customers/me', async () => {
    globalThis.fetch = jest.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return ok({ customerId: 'c-1', phone: '+91...', status: 'ACTIVE', createdAt: new Date().toISOString() });
    }) as unknown as typeof fetch;
    const account = await registerCustomer();
    expect(calls[0].url).toBe('https://pay.test/v1/customers/me');
    expect(calls[0].init.method).toBe('POST');
    expect(account.customerId).toBe('c-1');
  });
});

describe('getBookingPayment', () => {
  it('returns the payment gate and per-drop state the UI must reflect', async () => {
    globalThis.fetch = jest.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return ok({
        bookingId: 'b-1',
        externalRef: 'ENG-1',
        status: 'ASSIGNED',
        paymentMethod: 'PAY_AT_DELIVERY',
        paymentStatus: 'PARTIALLY_PAID',
        farePaise: 50000,
        confirmedAt: new Date().toISOString(),
        tripStatus: 'DROP_PROGRESS',
        stops: [
          { sequence: 1, payablePaise: 20000, state: 'DELIVERED' },
          { sequence: 2, payablePaise: 30000, state: 'ARRIVED' },
        ],
        paymentGate: {
          stage: 'DROP',
          stopSequence: 2,
          paymentState: 'PAYMENT_REQUIRED',
          amountPaise: 30000,
          handoverAllowed: false,
        },
      });
    }) as unknown as typeof fetch;

    const booking = await getBookingPayment('b-1');
    expect(calls[0].url).toBe('https://pay.test/v1/bookings/b-1');
    expect(booking.paymentStatus).toBe('PARTIALLY_PAID');
    expect(booking.paymentGate).toEqual({
      stage: 'DROP',
      stopSequence: 2,
      paymentState: 'PAYMENT_REQUIRED',
      amountPaise: 30000,
      handoverAllowed: false,
    });
    // One drop's state never implies another's.
    expect(booking.stops[0].state).toBe('DELIVERED');
    expect(booking.stops[1].state).toBe('ARRIVED');
  });
});

describe('auth token refresh', () => {
  it('refreshes once on a 401 and retries', async () => {
    let n = 0;
    mockGetIdToken.mockImplementation(async (force?: boolean) => (force ? 'fresh' : 'stale'));
    globalThis.fetch = jest.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      n += 1;
      return n === 1 ? httpError(401) : ok(QUOTE);
    }) as unknown as typeof fetch;
    await getBookingPayment('b-1');
    expect(calls).toHaveLength(2);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer stale');
    expect((calls[1].init.headers as Record<string, string>).Authorization).toBe('Bearer fresh');
  });
});

describe('isQuoteBookable', () => {
  it('is false once expired or already redeemed', () => {
    expect(isQuoteBookable(QUOTE as FareQuote)).toBe(true);
    expect(isQuoteBookable({ ...QUOTE, redeemed: true } as FareQuote)).toBe(false);
    expect(
      isQuoteBookable({ ...QUOTE, expiresAt: new Date(Date.now() - 1000).toISOString() } as FareQuote),
    ).toBe(false);
  });
});

import { readFileSync } from 'fs';
import path from 'path';
import type { EngineRequest } from '../src/services/engine/engineClient';
import * as engine from '../src/services/engine/dispatch';

jest.mock('@react-native-firebase/auth', () => ({
  getAuth: () => ({ currentUser: { uid: 'driverUid123' } }),
  getIdToken: jest.fn(async () => 'token'),
}));
jest.mock('../src/config/env', () => ({
  env: {
    API_BASE_URL: 'https://engine.example.in',
    IS_MOCK_MODE: false,
    REQUEST_TIMEOUT_MS: 5000,
  },
}));

/** Every request the driver app sent, and the engine's queued answers. */
const mockRequests: EngineRequest[] = [];
let mockAnswers: unknown[] = [];

jest.mock('../src/services/engine/engineClient', () => {
  const actual = jest.requireActual('../src/services/engine/engineClient');
  return {
    ...actual,
    getEngineClient: () => ({
      request: async (request: EngineRequest) => {
        mockRequests.push(request);
        const next =
          mockAnswers.length > 1 ? mockAnswers.shift() : mockAnswers[0];
        if (next instanceof Error) {
          throw next;
        }
        return next;
      },
    }),
  };
});

const requests = mockRequests;

const TRIP_ID = '11111111-1111-4111-8111-111111111111';
const RIDE_ID = '22222222-2222-4222-8222-222222222222';
const STOP_1 = '33333333-3333-4333-8333-333333333331';
const STOP_2 = '33333333-3333-4333-8333-333333333332';
const PAYMENT_TRIP_ID = '44444444-4444-4444-8444-444444444444';

/** A trip as the Phase 8 engine returns it (trip-views.ts): no OTP anywhere. */
function tripView(overrides: Record<string, unknown> = {}) {
  return {
    id: TRIP_ID,
    rideId: RIDE_ID,
    customerId: 'customer-1',
    driverId: 'driverUid123',
    externalRef: 'ENG-1001',
    paymentBookingId: '55555555-5555-4555-8555-555555555555',
    paymentTripId: PAYMENT_TRIP_ID,
    paymentMethod: 'PAY_AT_DELIVERY',
    pickup: { latitude: 26.29, longitude: 73.02, address: 'Sardarpura' },
    drop: { latitude: 26.3, longitude: 73.03, address: 'Ratanada' },
    stops: [
      {
        id: STOP_1,
        sequence: 1,
        location: { latitude: 26.3, longitude: 73.03, address: 'Ratanada' },
        status: 'PENDING',
        payablePaise: 20_000,
        fareFromPreviousStop: 200,
        otpVerified: false,
      },
      {
        id: STOP_2,
        sequence: 2,
        location: { latitude: 26.31, longitude: 73.04, address: 'Paota' },
        status: 'PENDING',
        payablePaise: 30_000,
        fareFromPreviousStop: 300,
        otpVerified: false,
      },
    ],
    currentStopIndex: 0,
    currentStop: null,
    totalStops: 2,
    completedStops: 0,
    remainingStops: 2,
    status: 'DRIVER_ASSIGNED',
    weight: 10,
    vehicleType: 'MINI_TRUCK',
    fare: 500,
    payablePaise: 50_000,
    totalDistanceKm: 4.2,
    createdAt: '2026-10-02T08:00:00.000Z',
    updatedAt: '2026-10-02T08:00:00.000Z',
    ...overrides,
  };
}

const action = (trip: Record<string, unknown>, extra = {}) => ({
  success: true,
  tripStatus: trip.status,
  changed: true,
  trip,
  paymentSync: 'DELIVERED',
  ...extra,
});

beforeEach(() => {
  requests.length = 0;
  mockAnswers = [];
});

describe('engine routes (Phase 8 contract)', () => {
  it('sends each driver action as exactly one call to its route, with no driverId', async () => {
    mockAnswers = [action(tripView())];
    await engine.arriveAtPickup(TRIP_ID);
    await engine.verifyPickupOtp(TRIP_ID, '1234');
    await engine.startTrip(TRIP_ID);
    await engine.arriveAtStop(TRIP_ID, STOP_1);
    await engine.verifyStopOtp(TRIP_ID, STOP_1, '5678');
    await engine.confirmStopDelivery(TRIP_ID, STOP_1, 'file:///proof.jpg');
    await engine.failStop(TRIP_ID, STOP_1, 'Receiver not home');
    await engine.completeTrip(TRIP_ID);

    expect(requests.map(r => [r.method, r.path, r.body])).toEqual([
      ['POST', `/trips/${TRIP_ID}/arrive`, undefined],
      ['POST', `/trips/${TRIP_ID}/pickup/verify-otp`, { otp: '1234' }],
      ['POST', `/trips/${TRIP_ID}/start`, undefined],
      ['POST', `/trips/${TRIP_ID}/stop/arrive`, { stopId: STOP_1 }],
      [
        'POST',
        `/trips/${TRIP_ID}/stop/verify-otp`,
        { stopId: STOP_1, otp: '5678' },
      ],
      [
        'POST',
        `/trips/${TRIP_ID}/stop/confirm-delivery`,
        { stopId: STOP_1, photo: { uri: 'file:///proof.jpg' } },
      ],
      [
        'POST',
        `/trips/${TRIP_ID}/stop/fail`,
        { stopId: STOP_1, reason: 'Receiver not home' },
      ],
      ['POST', `/trips/${TRIP_ID}/complete`, undefined],
    ]);
  });

  it('takes identity from the token: no body ever names a driver', async () => {
    mockAnswers = [{ success: true, ride: {}, trip: tripView() }];
    await engine.acceptRideRequest(RIDE_ID);
    await engine.rejectRideRequest(RIDE_ID);
    await engine.setDriverAvailability('driverUid123', true);
    await engine.updateDriverLocation('driverUid123', 26.29, 73.02);
    for (const request of requests) {
      expect(JSON.stringify(request.body ?? {})).not.toMatch(
        /driverId|customerId/,
      );
    }
    expect(requests.map(r => r.path)).toEqual([
      `/rides/${RIDE_ID}/accept`,
      `/rides/${RIDE_ID}/reject`,
      '/drivers/driverUid123/availability',
      '/drivers/driverUid123/location',
    ]);
  });

  it('refuses ids that are not ids before any request', async () => {
    await expect(engine.arriveAtPickup('../rides')).rejects.toThrow(RangeError);
    await expect(engine.arriveAtStop(TRIP_ID, 'stop-1')).rejects.toThrow(
      RangeError,
    );
    await expect(engine.acceptRideRequest('x/../y')).rejects.toThrow(
      RangeError,
    );
    await expect(engine.fetchRideRequests('a/b')).rejects.toThrow(RangeError);
    expect(requests).toHaveLength(0);
  });

  it('uses no removed or bypass route anywhere in the driver engine client', () => {
    const source = readFileSync(
      path.join(__dirname, '../src/services/engine/dispatch.ts'),
      'utf8',
    );
    // Only in the module comment that lists them as removed.
    const code = source.replace(/\/\*\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/pickup\/confirm/);
    expect(code).not.toMatch(/drop\/confirm/);
    expect(code).not.toMatch(/rides\/[^\s']*\/verify-otp/);
    expect(code).not.toMatch(/withAuth/);
    expect(code).not.toMatch(/advanceTripTo/);
    expect(code).not.toMatch(/\botp\?:/);
  });
});

describe('engine trip DTO', () => {
  it('reads the Phase 8 trip view, with its payment trip id and drops', async () => {
    mockAnswers = [{ success: true, trip: tripView() }];
    const trip = await engine.getTripById(TRIP_ID);
    expect(trip).toMatchObject({
      id: TRIP_ID,
      paymentTripId: PAYMENT_TRIP_ID,
      externalRef: 'ENG-1001',
      status: 'DRIVER_ASSIGNED',
      currentStopIndex: 0,
      stops: [
        { id: STOP_1, sequence: 1, status: 'PENDING', payablePaise: 20_000 },
        { id: STOP_2, sequence: 2, status: 'PENDING', payablePaise: 30_000 },
      ],
    });
  });

  it('keeps no OTP even if one were sent', async () => {
    mockAnswers = [
      {
        success: true,
        trip: {
          ...tripView(),
          otp: '9071',
          stops: tripView().stops.map(s => ({ ...s, otp: '4826' })),
        },
      },
    ];
    const trip = await engine.getTripById(TRIP_ID);
    expect(JSON.stringify(trip)).not.toMatch(/9071|4826|"otp"/);
  });

  it('accepts a trip whose payment trip id is still pending', async () => {
    mockAnswers = [{ success: true, trip: tripView({ paymentTripId: null }) }];
    await expect(engine.getTripById(TRIP_ID)).resolves.toMatchObject({
      paymentTripId: null,
    });
  });

  it('refuses a response it cannot act on', async () => {
    for (const bad of [
      tripView({ status: 'TELEPORTED' }),
      tripView({ stops: 'none' }),
      tripView({ currentStopIndex: -1 }),
      tripView({ paymentTripId: 'not-a-uuid' }),
      tripView({ stops: [{ ...tripView().stops[0], status: 'DONE' }] }),
    ]) {
      mockAnswers = [{ success: true, trip: bad }];
      await expect(engine.getTripById(TRIP_ID)).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
      });
    }
  });

  it('reads a pending completion (202) as pending, never as completed', async () => {
    mockAnswers = [
      action(tripView({ status: 'DELIVERED' }), {
        changed: false,
        completion: 'PENDING',
        waitingFor: 'PAYMENT_REQUIRED',
        paymentSync: 'PENDING',
      }),
    ];
    await expect(engine.completeTrip(TRIP_ID)).resolves.toMatchObject({
      completion: 'PENDING',
      waitingFor: 'PAYMENT_REQUIRED',
      changed: false,
      trip: { status: 'DELIVERED' },
    });
  });

  it('returns the trip of an acceptance (a repeat returns the same trip)', async () => {
    mockAnswers = [
      { success: true, ride: {}, trip: tripView(), paymentSync: 'DELIVERED' },
    ];
    const first = await engine.acceptRideRequest(RIDE_ID);
    const again = await engine.acceptRideRequest(RIDE_ID);
    expect(first?.id).toBe(TRIP_ID);
    expect(again?.id).toBe(TRIP_ID);
  });
});

describe('engine trip -> app trip', () => {
  const toApp = (overrides: Record<string, unknown>) =>
    engine.engineTripToActiveTrip(engine.parseEngineTrip(tripView(overrides)));

  it('keeps the pickup current until the trip is started', () => {
    for (const status of [
      'DRIVER_ASSIGNED',
      'DRIVER_ARRIVED',
      'PICKUP_VERIFIED',
    ]) {
      const trip = toApp({ status });
      expect(trip.engineStatus).toBe(status);
      expect(trip.currentStopIndex).toBe(0);
      expect(trip.stops[0]).toMatchObject({
        type: 'pickup',
        status: 'current',
      });
    }
    expect(toApp({ status: 'PICKUP_VERIFIED' }).status).toBe('pickup_verified');
  });

  it('follows the current drop by its engine index', () => {
    const stops = tripView().stops;
    const trip = toApp({
      status: 'DROP_PROGRESS',
      currentStopIndex: 1,
      stops: [
        { ...stops[0], status: 'DELIVERED' },
        { ...stops[1], status: 'ARRIVED', otpVerified: true },
      ],
    });
    expect(trip.status).toBe('arrived_drop');
    expect(trip.currentStopIndex).toBe(2);
    expect(trip.stops.map(s => s.status)).toEqual([
      'completed',
      'completed',
      'current',
    ]);
    expect(trip.stops[2]).toMatchObject({
      id: STOP_2,
      sequence: 2,
      engineStatus: 'ARRIVED',
      otpVerified: true,
      payablePaise: 30_000,
    });
    expect(trip.paymentTripId).toBe(PAYMENT_TRIP_ID);
  });

  it('marks a failed drop as still open (not silently completed)', () => {
    const stops = tripView().stops;
    const trip = toApp({
      status: 'DROP_PROGRESS',
      stops: [
        { ...stops[0], status: 'DELIVERY_FAILED', failureReason: 'Closed' },
        stops[1],
      ],
    });
    expect(trip.stops[1]).toMatchObject({
      status: 'current',
      engineStatus: 'DELIVERY_FAILED',
      failureReason: 'Closed',
    });
  });

  it('maps an offer with the engine deadline and every drop', () => {
    const offer = engine.rideRequestToOffer({
      rideId: RIDE_ID,
      pickup: { latitude: 26.29, longitude: 73.02, address: 'Sardarpura' },
      drop: { latitude: 26.3, longitude: 73.03 },
      drops: [
        { latitude: 26.3, longitude: 73.03, address: 'Ratanada' },
        { latitude: 26.31, longitude: 73.04, address: 'Paota' },
      ],
      fare: 500,
      status: 'REQUESTED',
      createdAt: '2026-10-02T08:00:00.000Z',
      expiresAt: '2026-10-02T08:00:30.000Z',
    });
    expect(offer.expiresAt).toBe(Date.parse('2026-10-02T08:00:30.000Z'));
    expect(offer.dropStops.map(d => d.address)).toEqual(['Ratanada', 'Paota']);
  });
});

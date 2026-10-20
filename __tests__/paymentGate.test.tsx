import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { AppState } from 'react-native';
import {
  usePaymentGate,
  type UsePaymentGateResult,
} from '../src/hooks/usePaymentGate';
import { parseTrip } from '../src/services/payments/collectionsDto';
import { PaymentsApiError } from '../src/services/payments/paymentsErrors';
import type { ActiveTrip } from '../src/types/trip';

jest.mock('../src/config/env', () => ({
  env: {
    API_BASE_URL: 'https://engine.example.in',
    PAYMENTS_API_BASE_URL: 'https://payments.example.in',
    IS_MOCK_MODE: false,
    REQUEST_TIMEOUT_MS: 5000,
  },
}));

/** The payments API the hook reads (null: payments not configured in this build). */
const mockPayments: { api: Record<string, jest.Mock> | null } = { api: null };
jest.mock('../src/services/payments', () => ({
  getPaymentsApi: () => mockPayments.api,
}));
// Screens are focused in these tests: run focus effects like plain effects.
jest.mock('@react-navigation/native', () => {
  const mockReact = require('react');
  return {
    useFocusEffect: (effect: () => void | (() => void)) =>
      mockReact.useEffect(effect, [effect]),
  };
});

const ENGINE_TRIP_ID = '11111111-1111-4111-8111-111111111111';
const BACKEND_TRIP_ID = '6f1c1a3e-2a4b-4c5d-8e9f-0a1b2c3d4e5f';

const backendTrip = (paymentState = 'PAYMENT_REQUIRED') =>
  parseTrip({
    tripId: BACKEND_TRIP_ID,
    bookingId: '0f8fad5b-d9cb-469f-a165-70867728950e',
    externalRef: 'ENG-1001',
    status: 'DRIVER_ARRIVED',
    assignedAt: '2026-10-02T08:00:00.000Z',
    completedAt: null,
    payment: {
      method: 'PAY_AT_PICKUP',
      status: 'UNPAID',
      farePaise: 50_000,
      platformFeePaise: 5_000,
      driverSharePaise: 45_000,
      collectionStage: 'PICKUP',
      collectionOpen: true,
      paymentGate: {
        stage: 'PICKUP',
        stopSequence: null,
        paymentState,
        amountPaise: 50_000,
        cashFeePaise: 5_000,
        handoverAllowed: paymentState === 'PAYMENT_CONFIRMED',
        collectionId: null,
        lastFailure: null,
      },
      stops: [],
    },
  });

function engineTrip(overrides: Partial<ActiveTrip> = {}): ActiveTrip {
  return {
    id: ENGINE_TRIP_ID,
    status: 'arrived_pickup',
    engineStatus: 'DRIVER_ARRIVED',
    stops: [],
    currentStopIndex: 0,
    estimatedEarning: 500,
    currency: '₹',
    totalDistanceKm: 4,
    loadType: 'other',
    goodsType: 'other',
    vehicleId: 'unknown',
    vehicleRegistration: 'unknown',
    paymentTripId: BACKEND_TRIP_ID,
    externalRef: 'ENG-1001',
    ...overrides,
  };
}

let latest: UsePaymentGateResult | null = null;
const Probe: React.FC<{ trip: ActiveTrip | null }> = ({ trip }) => {
  latest = usePaymentGate(trip);
  return null;
};

let appStateHandlers: Array<(state: string) => void> = [];

async function mount(trip: ActiveTrip | null) {
  await ReactTestRenderer.act(async () => {
    ReactTestRenderer.create(<Probe trip={trip} />);
  });
}

const advance = (ms: number) =>
  ReactTestRenderer.act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  jest.useFakeTimers();
  latest = null;
  appStateHandlers = [];
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_type, handler) => {
      appStateHandlers.push(handler as (state: string) => void);
      return { remove: jest.fn() } as unknown as ReturnType<
        typeof AppState.addEventListener
      >;
    });
  mockPayments.api = {
    getTrip: jest.fn(async () => backendTrip()),
    listActiveTrips: jest.fn(async () => [backendTrip()]),
    getCollection: jest.fn(),
  };
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('payment gate polling (review G: every 3 s on the pickup and drop screens)', () => {
  it('reads the gate of the payment trip at once, then every 3 s', async () => {
    await mount(engineTrip());
    const api = mockPayments.api!;
    expect(api.getTrip).toHaveBeenCalledWith(BACKEND_TRIP_ID);
    expect(latest?.view.kind).toBe('ready');
    expect(latest?.gate?.paymentState).toBe('PAYMENT_REQUIRED');

    await advance(2_999);
    expect(api.getTrip).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(api.getTrip).toHaveBeenCalledTimes(2);
    api.getTrip.mockResolvedValue(backendTrip('PAYMENT_CONFIRMED'));
    await advance(3_000);
    expect(api.getTrip).toHaveBeenCalledTimes(3);
    expect(latest?.gate?.handoverAllowed).toBe(true);
  });

  it('backs off on errors and keeps handovers locked until a good read', async () => {
    const api = mockPayments.api!;
    api.getTrip.mockRejectedValue(
      new PaymentsApiError('NETWORK_ERROR', 'offline', 0),
    );
    await mount(engineTrip());
    expect(latest?.gate).toBeNull();
    expect(latest?.error).not.toBeNull();

    await advance(3_000);
    expect(api.getTrip).toHaveBeenCalledTimes(1); // backed off to 6 s
    await advance(3_000);
    expect(api.getTrip).toHaveBeenCalledTimes(2);
    await advance(6_000);
    expect(api.getTrip).toHaveBeenCalledTimes(2); // then 12 s
    await advance(6_000);
    expect(api.getTrip).toHaveBeenCalledTimes(3);
  });

  it('reads again at once when the app comes back (after a lost connection)', async () => {
    await mount(engineTrip());
    const api = mockPayments.api!;
    expect(api.getTrip).toHaveBeenCalledTimes(1);
    await ReactTestRenderer.act(async () => {
      appStateHandlers.forEach(handler => handler('active'));
    });
    expect(api.getTrip).toHaveBeenCalledTimes(2);
  });

  it('never uses a malformed gate, even after a good one', async () => {
    await mount(engineTrip());
    const api = mockPayments.api!;
    expect(latest?.gate).not.toBeNull();
    api.getTrip.mockRejectedValue(
      new PaymentsApiError('INVALID_RESPONSE', 'bad gate', 0),
    );
    await advance(3_000);
    expect(latest?.gate).toBeNull();
    expect(latest?.view.kind).toBe('loading');
  });
});

describe('engine trip -> payment trip', () => {
  it('falls back to the booking reference while the engine has no payment trip id', async () => {
    await mount(engineTrip({ paymentTripId: null }));
    const api = mockPayments.api!;
    expect(api.listActiveTrips).toHaveBeenCalled();
    expect(api.getTrip).toHaveBeenCalledWith(BACKEND_TRIP_ID);
    expect(latest?.view.kind).toBe('ready');
  });

  it('waits (locked) while the payment backend has not confirmed the assignment', async () => {
    const api = mockPayments.api!;
    api.listActiveTrips.mockResolvedValue([]);
    await mount(engineTrip({ paymentTripId: null }));
    expect(api.getTrip).not.toHaveBeenCalled();
    expect(latest?.view.kind).toBe('syncing');
    expect(latest?.gate).toBeNull();
  });

  it('stays locked when this build has no payment backend', async () => {
    mockPayments.api = null;
    await mount(engineTrip());
    expect(latest?.view.kind).toBe('unavailable');
    expect(latest?.gate).toBeNull();
  });
});

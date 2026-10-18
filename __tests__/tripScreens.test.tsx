import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { PrimaryButton } from '../src/components/atoms/PrimaryButton';
import { SecondaryButton } from '../src/components/atoms/SecondaryButton';
import { OTPInput } from '../src/components/atoms/OTPInput';
import type { UsePaymentGateResult } from '../src/hooks/usePaymentGate';
import { EngineApiError } from '../src/services/engine/engineClient';
import {
  parsePaymentGate,
  parseTrip,
} from '../src/services/payments/collectionsDto';
import { TripController } from '../src/services/trip/TripController';
import { otpVerificationLabels } from '../src/data/mockData';
import type { ActiveTrip, TripStop } from '../src/types/trip';
import { ArrivedAtPickupScreen } from '../src/screens/trip/ArrivedAtPickupScreen';
import { PickupOTPScreen } from '../src/screens/trip/PickupOTPScreen';
import { DropOTPScreen } from '../src/screens/trip/DropOTPScreen';
import { DeliveryProofPreviewScreen } from '../src/screens/trip/DeliveryProofPreviewScreen';

jest.mock('@react-native-firebase/auth', () => ({
  getAuth: () => ({ currentUser: { uid: 'driver-1' } }),
  getIdToken: jest.fn(async () => 'token'),
}));
jest.mock('../src/config/env', () => ({
  env: {
    API_BASE_URL: 'https://engine.example.in',
    PAYMENTS_API_BASE_URL: 'https://payments.example.in',
    IS_MOCK_MODE: false,
    REQUEST_TIMEOUT_MS: 5000,
  },
}));

/** What the engine and the payment backend answered, as the screens' hooks return it. */
const mockState: {
  trip: ActiveTrip | null;
  gate: UsePaymentGateResult | null;
} = {
  trip: null,
  gate: null,
};
jest.mock('../src/hooks/useActiveTrip', () => ({
  useLiveTrip: () => mockState.trip,
  useActiveTrip: () => mockState.trip,
}));
jest.mock('../src/hooks/usePaymentGate', () => ({
  usePaymentGate: () => mockState.gate,
}));
jest.mock('../src/location', () => ({
  useDriverLocation: () => ({ currentLocation: null }),
}));
// AsyncStorage (the language setting) ships ESM only; the screens render in English keys.
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
  },
}));

const TRIP_ID = '11111111-1111-4111-8111-111111111111';
const STOP_ID = '33333333-3333-4333-8333-333333333331';
const BACKEND_TRIP_ID = '6f1c1a3e-2a4b-4c5d-8e9f-0a1b2c3d4e5f';
const VERIFY = otpVerificationLabels.verifyLabel;

const pickup: TripStop = {
  id: `${TRIP_ID}-pickup`,
  type: 'pickup',
  label: 'Pickup',
  address: 'Sardarpura',
  latitude: 26.29,
  longitude: 73.02,
  status: 'current',
};

function drop(overrides: Partial<TripStop> = {}): TripStop {
  return {
    id: STOP_ID,
    type: 'drop',
    label: 'Drop-off 1',
    address: 'Ratanada',
    latitude: 26.3,
    longitude: 73.03,
    status: 'current',
    sequence: 1,
    engineStatus: 'ARRIVED',
    otpVerified: false,
    ...overrides,
  };
}

function trip(
  engineStatus: string,
  stops: TripStop[],
  current = 0,
): ActiveTrip {
  return {
    id: TRIP_ID,
    status: 'in_transit',
    engineStatus,
    stops,
    currentStopIndex: current,
    estimatedEarning: 500,
    currency: '₹',
    totalDistanceKm: 4,
    loadType: 'other',
    goodsType: 'other',
    vehicleId: 'unknown',
    vehicleRegistration: 'unknown',
    paymentTripId: BACKEND_TRIP_ID,
  };
}

function gate(raw: Record<string, unknown> | null): UsePaymentGateResult {
  if (!raw) {
    return {
      view: { kind: 'loading' },
      gate: null,
      error: null,
      paidWith: null,
      refresh: jest.fn(),
    };
  }
  const paymentGate = parsePaymentGate({
    stage: 'PICKUP',
    stopSequence: null,
    paymentState: 'PAYMENT_REQUIRED',
    amountPaise: 50_000,
    cashFeePaise: 5_000,
    handoverAllowed: false,
    collectionId: null,
    lastFailure: null,
    ...raw,
  });
  const backendTrip = parseTrip({
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
      paymentGate: { ...paymentGate },
      stops: [],
    },
  });
  return {
    view: {
      kind: 'ready',
      engineTripId: TRIP_ID,
      trip: backendTrip,
      gate: paymentGate,
    },
    gate: paymentGate,
    error: null,
    paidWith: null,
    refresh: jest.fn(),
  };
}

const navigation = () =>
  ({ navigate: jest.fn(), goBack: jest.fn(), popToTop: jest.fn() } as any);

async function render(element: React.ReactElement) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(element);
  });
  return renderer;
}

const buttons = (renderer: ReactTestRenderer.ReactTestRenderer) =>
  [
    ...renderer.root.findAllByType(PrimaryButton),
    ...renderer.root.findAllByType(SecondaryButton),
  ].map(
    b => b.props as { label: string; disabled?: boolean; onPress: () => void },
  );

const button = (renderer: ReactTestRenderer.ReactTestRenderer, label: string) =>
  buttons(renderer).find(b => b.label === label);

const texts = (renderer: ReactTestRenderer.ReactTestRenderer) =>
  JSON.stringify(renderer.toJSON());

afterEach(() => {
  jest.restoreAllMocks();
  mockState.trip = null;
  mockState.gate = null;
});

describe('pickup screen (review G table)', () => {
  const route = { params: { tripId: TRIP_ID, stopId: pickup.id } } as any;

  it('offers only ARRIVED while on the way', async () => {
    mockState.trip = trip('DRIVER_ASSIGNED', [
      pickup,
      drop({ engineStatus: 'PENDING' }),
    ]);
    mockState.gate = gate(null);
    const arrive = jest
      .spyOn(TripController.prototype, 'arriveAtPickup')
      .mockResolvedValue({ trip: mockState.trip, changed: true });
    const r = await render(
      <ArrivedAtPickupScreen navigation={navigation()} route={route} />,
    );
    expect(button(r, 'trip.enterSenderOtp')).toBeUndefined();
    expect(button(r, 'trip.startTrip')).toBeUndefined();
    await ReactTestRenderer.act(async () =>
      button(r, 'trip.arrived')!.onPress(),
    );
    expect(arrive).toHaveBeenCalledWith(TRIP_ID);
  });

  it('keeps ENTER SENDER OTP locked while the pickup payment is owed, and offers COLLECT', async () => {
    mockState.trip = trip('DRIVER_ARRIVED', [
      pickup,
      drop({ engineStatus: 'PENDING' }),
    ]);
    mockState.gate = gate({});
    const nav = navigation();
    const r = await render(
      <ArrivedAtPickupScreen navigation={nav} route={route} />,
    );
    expect(button(r, 'trip.enterSenderOtp')?.disabled).toBe(true);
    expect(button(r, 'trip.startTrip')).toBeUndefined();
    await ReactTestRenderer.act(async () =>
      button(r, 'trip.collectPayment')!.onPress(),
    );
    // The collect screen works on the payment backend's trip id.
    expect(nav.navigate).toHaveBeenCalledWith('CollectPayment', {
      tripId: BACKEND_TRIP_ID,
    });
  });

  it('unlocks ENTER SENDER OTP once the payment backend allows the handover', async () => {
    mockState.trip = trip('DRIVER_ARRIVED', [
      pickup,
      drop({ engineStatus: 'PENDING' }),
    ]);
    mockState.gate = gate({
      paymentState: 'PAYMENT_CONFIRMED',
      handoverAllowed: true,
    });
    const r = await render(
      <ArrivedAtPickupScreen navigation={navigation()} route={route} />,
    );
    expect(button(r, 'trip.enterSenderOtp')?.disabled).toBe(false);
  });

  it('lets a pay-at-delivery pickup proceed without payment', async () => {
    mockState.trip = trip('DRIVER_ARRIVED', [
      pickup,
      drop({ engineStatus: 'PENDING' }),
    ]);
    mockState.gate = gate({
      paymentState: 'NOT_REQUIRED',
      amountPaise: null,
      cashFeePaise: null,
      handoverAllowed: true,
    });
    const r = await render(
      <ArrivedAtPickupScreen navigation={navigation()} route={route} />,
    );
    expect(button(r, 'trip.enterSenderOtp')?.disabled).toBe(false);
    expect(button(r, 'trip.collectPayment')).toBeUndefined();
  });

  it('offers START TRIP only after a verified pickup, and stays put if it fails', async () => {
    mockState.trip = trip('PICKUP_VERIFIED', [
      pickup,
      drop({ engineStatus: 'PENDING' }),
    ]);
    mockState.gate = gate(null);
    const start = jest
      .spyOn(TripController.prototype, 'startTrip')
      .mockRejectedValue(
        new EngineApiError('PAYMENT_BACKEND_UNAVAILABLE', 'x', 503),
      );
    const nav = navigation();
    const r = await render(
      <ArrivedAtPickupScreen navigation={nav} route={route} />,
    );
    expect(button(r, 'trip.enterSenderOtp')).toBeUndefined();
    await ReactTestRenderer.act(async () =>
      button(r, 'trip.startTrip')!.onPress(),
    );
    expect(start).toHaveBeenCalledTimes(1);
    expect(nav.navigate).not.toHaveBeenCalled();
    expect(texts(r)).toContain('trip.errBackendUnavailable');
  });
});

describe('pickup OTP screen', () => {
  const route = { params: { tripId: TRIP_ID, stopId: pickup.id } } as any;

  it('cannot verify before the payment backend allows the handover', async () => {
    mockState.trip = trip('DRIVER_ARRIVED', [pickup]);
    mockState.gate = gate({});
    const verify = jest.spyOn(TripController.prototype, 'verifyPickupOTP');
    const r = await render(
      <PickupOTPScreen navigation={navigation()} route={route} />,
    );
    await ReactTestRenderer.act(async () =>
      r.root.findByType(OTPInput).props.onChange('1234'),
    );
    expect(button(r, VERIFY)?.disabled).toBe(true);
    expect(texts(r)).toContain('trip.otpLocked');
    expect(verify).not.toHaveBeenCalled();
  });

  it('verifies only the pickup once allowed (the trip is started separately)', async () => {
    mockState.trip = trip('DRIVER_ARRIVED', [pickup]);
    mockState.gate = gate({
      paymentState: 'PAYMENT_CONFIRMED',
      handoverAllowed: true,
    });
    const verify = jest
      .spyOn(TripController.prototype, 'verifyPickupOTP')
      .mockResolvedValue({
        trip: trip('PICKUP_VERIFIED', [pickup]),
        changed: true,
      });
    const start = jest.spyOn(TripController.prototype, 'startTrip');
    const r = await render(
      <PickupOTPScreen navigation={navigation()} route={route} />,
    );
    await ReactTestRenderer.act(async () =>
      r.root.findByType(OTPInput).props.onChange('1234'),
    );
    const verifyButton = button(r, VERIFY)!;
    expect(verifyButton.disabled).toBe(false);
    await ReactTestRenderer.act(async () => verifyButton.onPress());
    expect(verify).toHaveBeenCalledWith(TRIP_ID, '1234');
    expect(start).not.toHaveBeenCalled();
  });
});

describe('drop screen (review G table)', () => {
  const route = { params: { tripId: TRIP_ID, stopId: STOP_ID } } as any;
  const dropGate = (raw: Record<string, unknown>) =>
    gate({
      stage: 'DROP',
      stopSequence: 1,
      amountPaise: 20_000,
      cashFeePaise: 2_000,
      ...raw,
    });

  it('locks the drop OTP of an unpaid pay-at-delivery drop and offers COLLECT', async () => {
    mockState.trip = trip(
      'DROP_PROGRESS',
      [{ ...pickup, status: 'completed' }, drop()],
      1,
    );
    mockState.gate = dropGate({});
    const nav = navigation();
    const r = await render(<DropOTPScreen navigation={nav} route={route} />);
    await ReactTestRenderer.act(async () =>
      r.root.findByType(OTPInput).props.onChange('5678'),
    );
    expect(button(r, VERIFY)?.disabled).toBe(true);
    expect(texts(r)).toContain('trip.dropPaymentRequired');
    await ReactTestRenderer.act(async () =>
      button(r, 'trip.collectPayment')!.onPress(),
    );
    expect(nav.navigate).toHaveBeenCalledWith('CollectPayment', {
      tripId: BACKEND_TRIP_ID,
    });
  });

  it('opens the drop OTP once that drop is paid', async () => {
    mockState.trip = trip(
      'DROP_PROGRESS',
      [{ ...pickup, status: 'completed' }, drop()],
      1,
    );
    mockState.gate = dropGate({
      paymentState: 'PAYMENT_CONFIRMED',
      handoverAllowed: true,
    });
    const r = await render(
      <DropOTPScreen navigation={navigation()} route={route} />,
    );
    await ReactTestRenderer.act(async () =>
      r.root.findByType(OTPInput).props.onChange('5678'),
    );
    expect(button(r, VERIFY)?.disabled).toBe(false);
  });

  it('acts only on the current drop', async () => {
    const second = drop({
      id: '33333333-3333-4333-8333-333333333332',
      sequence: 2,
      label: 'Drop-off 2',
      engineStatus: 'PENDING',
      status: 'pending',
    });
    mockState.trip = trip(
      'IN_TRANSIT',
      [
        { ...pickup, status: 'completed' },
        drop({ engineStatus: 'IN_TRANSIT' }),
        second,
      ],
      1,
    );
    mockState.gate = gate(null);
    const r = await render(
      <DropOTPScreen
        navigation={navigation()}
        route={{ params: { tripId: TRIP_ID, stopId: second.id } } as any}
      />,
    );
    expect(texts(r)).toContain('trip.notCurrentStop');
    expect(r.root.findAllByType(OTPInput)).toHaveLength(0);
  });

  it('shows a failed delivery as failed (not completed), with RETRY and REFRESH', async () => {
    mockState.trip = trip(
      'DROP_PROGRESS',
      [
        { ...pickup, status: 'completed' },
        drop({ engineStatus: 'DELIVERY_FAILED', failureReason: 'Shop closed' }),
      ],
      1,
    );
    mockState.gate = gate(null);
    const retry = jest
      .spyOn(TripController.prototype, 'arriveAtDrop')
      .mockResolvedValue({ trip: mockState.trip, changed: true });
    const refresh = jest
      .spyOn(TripController.prototype, 'refreshTrip')
      .mockResolvedValue(mockState.trip);
    const r = await render(
      <DropOTPScreen navigation={navigation()} route={route} />,
    );
    expect(texts(r)).toContain('trip.failedTitle');
    expect(button(r, 'trip.nextDrop')).toBeUndefined();
    await ReactTestRenderer.act(async () =>
      button(r, 'trip.retryDelivery')!.onPress(),
    );
    expect(retry).toHaveBeenCalledWith(TRIP_ID, STOP_ID);
    await ReactTestRenderer.act(async () =>
      button(r, 'trip.refresh')!.onPress(),
    );
    expect(refresh).toHaveBeenCalledWith(TRIP_ID);
  });

  it('asks for COMPLETE TRIP when every drop is done, and never completes on its own', async () => {
    const complete = jest
      .spyOn(TripController.prototype, 'completeTrip')
      .mockResolvedValue({
        trip: trip('DELIVERED', []),
        changed: false,
        completion: 'PENDING',
      });
    mockState.trip = trip(
      'DELIVERED',
      [
        { ...pickup, status: 'completed' },
        drop({ engineStatus: 'DELIVERED', status: 'completed' }),
      ],
      1,
    );
    mockState.gate = gate(null);
    const nav = navigation();
    const r = await render(<DropOTPScreen navigation={nav} route={route} />);
    expect(complete).not.toHaveBeenCalled();
    await ReactTestRenderer.act(async () =>
      button(r, 'trip.completeTrip')!.onPress(),
    );
    expect(complete).toHaveBeenCalledWith(TRIP_ID);
    // 202: shown as pending, no completion screen.
    expect(nav.navigate).not.toHaveBeenCalledWith(
      'TripCompleted',
      expect.anything(),
    );
    expect(texts(r)).toContain('trip.completionPending');
  });
});

describe('delivery proof', () => {
  const route = {
    params: { tripId: TRIP_ID, stopId: STOP_ID, photoUri: 'file:///proof.jpg' },
  } as any;

  it('stays on the drop when the delivery is refused, and never shows success', async () => {
    mockState.trip = trip(
      'DROP_PROGRESS',
      [{ ...pickup, status: 'completed' }, drop({ otpVerified: true })],
      1,
    );
    jest
      .spyOn(TripController.prototype, 'confirmDropDelivery')
      .mockRejectedValue(
        new EngineApiError('PAYMENT_REQUIRED', 'Payment is required', 409),
      );
    const nav = navigation();
    const r = await render(
      <DeliveryProofPreviewScreen navigation={nav} route={route} />,
    );
    await ReactTestRenderer.act(async () => buttons(r)[0].onPress());
    expect(texts(r)).toContain('trip.errPaymentRequired');
    expect(texts(r)).toContain('trip.deliveryNotConfirmed');
    expect(texts(r)).not.toContain('trip.delivered');
    expect(button(r, 'trip.tryAgain')).toBeDefined();
    expect(nav.navigate).not.toHaveBeenCalled();
  });

  it('offers COMPLETE TRIP after the last drop instead of completing it', async () => {
    mockState.trip = trip(
      'DELIVERED',
      [
        { ...pickup, status: 'completed' },
        drop({ engineStatus: 'DELIVERED', status: 'completed' }),
      ],
      1,
    );
    const complete = jest.spyOn(TripController.prototype, 'completeTrip');
    const r = await render(
      <DeliveryProofPreviewScreen navigation={navigation()} route={route} />,
    );
    expect(texts(r)).toContain('trip.delivered');
    expect(button(r, 'trip.completeTrip')).toBeDefined();
    expect(complete).not.toHaveBeenCalled();
  });
});

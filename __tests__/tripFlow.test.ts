import { readFileSync } from 'fs';
import path from 'path';
import { EngineApiError } from '../src/services/engine/engineClient';
import { TripController } from '../src/services/trip/TripController';
import { TripService } from '../src/services/trip/TripService';
import { describeTripError } from '../src/services/trip/tripErrors';
import type { ActiveTrip } from '../src/types/trip';

jest.mock('@react-native-firebase/auth', () => ({
  getAuth: () => ({ currentUser: { uid: 'driver-1' } }),
  getIdToken: jest.fn(async () => 'token'),
}));
jest.mock('../src/config/env', () => ({
  env: {
    API_BASE_URL: 'https://engine.example.in',
    IS_MOCK_MODE: false,
    REQUEST_TIMEOUT_MS: 5000,
  },
}));

const TRIP_ID = '11111111-1111-4111-8111-111111111111';
const RIDE_ID = '22222222-2222-4222-8222-222222222222';
const STOP_ID = '33333333-3333-4333-8333-333333333331';

function trip(
  engineStatus: string,
  overrides: Partial<ActiveTrip> = {},
): ActiveTrip {
  return {
    id: TRIP_ID,
    rideId: RIDE_ID,
    status: 'in_transit',
    engineStatus,
    stops: [],
    currentStopIndex: 0,
    estimatedEarning: 500,
    currency: '₹',
    totalDistanceKm: 4,
    loadType: 'other',
    goodsType: 'other',
    vehicleId: 'unknown',
    vehicleRegistration: 'unknown',
    updatedAt: 1_000,
    ...overrides,
  };
}

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

type Service = Record<string, jest.Mock>;

/** Lets the background re-read that follows a failed action finish. */
const flush = () => new Promise<void>(resolve => setImmediate(() => resolve()));

function useService(service: Service) {
  jest
    .spyOn(TripService, 'getInstance')
    .mockReturnValue(
      service as unknown as ReturnType<typeof TripService.getInstance>,
    );
}

let controller: TripController;

beforeEach(() => {
  // @ts-ignore reset the singleton between tests
  TripController.instance = undefined;
  controller = TripController.getInstance();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('one engine step per driver action (review G)', () => {
  it('never chains the pickup OTP with the start of the trip', async () => {
    const service = {
      verifyPickupOTP: jest.fn().mockResolvedValue({
        trip: trip('PICKUP_VERIFIED'),
        changed: true,
      }),
      startTrip: jest.fn(),
      arriveAtPickup: jest.fn(),
    };
    useService(service);
    await controller.verifyPickupOTP(TRIP_ID, '1234');
    expect(service.verifyPickupOTP).toHaveBeenCalledTimes(1);
    expect(service.startTrip).not.toHaveBeenCalled();
    expect(service.arriveAtPickup).not.toHaveBeenCalled();
    expect(controller.getTrip()?.engineStatus).toBe('PICKUP_VERIFIED');
  });

  it('never completes the trip after the last delivery', async () => {
    const service = {
      confirmDropDelivery: jest.fn().mockResolvedValue({
        trip: trip('DELIVERED', { remainingStops: 0 }),
        changed: true,
      }),
      completeTrip: jest.fn(),
    };
    useService(service);
    const result = await controller.confirmDropDelivery(
      TRIP_ID,
      STOP_ID,
      'file:///proof.jpg',
    );
    expect(result.trip.engineStatus).toBe('DELIVERED');
    expect(service.completeTrip).not.toHaveBeenCalled();
  });

  it('completes only when asked, and reports a pending completion as pending', async () => {
    const service = {
      completeTrip: jest.fn().mockResolvedValue({
        trip: trip('DELIVERED'),
        changed: false,
        completion: 'PENDING',
        waitingFor: 'PAYMENT_REQUIRED',
      }),
    };
    useService(service);
    const result = await controller.completeTrip(TRIP_ID);
    expect(result.completion).toBe('PENDING');
    expect(controller.getTrip()?.engineStatus).toBe('DELIVERED');
  });
});

describe('duplicate taps and retries', () => {
  it('sends one request for two taps on the same action', async () => {
    const answer = deferred<{ trip: ActiveTrip; changed: boolean }>();
    const service = { arriveAtPickup: jest.fn(() => answer.promise) };
    useService(service);
    const first = controller.arriveAtPickup(TRIP_ID);
    const second = controller.arriveAtPickup(TRIP_ID);
    answer.resolve({ trip: trip('DRIVER_ARRIVED'), changed: true });
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(service.arriveAtPickup).toHaveBeenCalledTimes(1);

    // Once settled, the next tap is a new request (the engine answers changed: false).
    service.arriveAtPickup.mockResolvedValueOnce({
      trip: trip('DRIVER_ARRIVED'),
      changed: false,
    });
    await controller.arriveAtPickup(TRIP_ID);
    expect(service.arriveAtPickup).toHaveBeenCalledTimes(2);
  });

  it('keeps the trip where the engine has it after a failure, and re-reads it', async () => {
    const arrived = trip('DRIVER_ARRIVED');
    const service = {
      getActiveTrip: jest.fn().mockResolvedValue(arrived),
      verifyPickupOTP: jest.fn().mockRejectedValue(
        new EngineApiError('PAYMENT_REQUIRED', 'Payment is required', 409, {
          stage: 'PICKUP',
        }),
      ),
      getTripById: jest.fn().mockResolvedValue(arrived),
    };
    useService(service);
    await controller.loadInitialTrip();
    await expect(
      controller.verifyPickupOTP(TRIP_ID, '1234'),
    ).rejects.toMatchObject({ code: 'PAYMENT_REQUIRED' });
    await flush();
    expect(service.getTripById).toHaveBeenCalledWith(TRIP_ID);
    expect(controller.getTrip()?.engineStatus).toBe('DRIVER_ARRIVED');
  });

  it('never treats a timeout as a success', async () => {
    const assigned = trip('DRIVER_ASSIGNED');
    const service = {
      getActiveTrip: jest.fn().mockResolvedValue(assigned),
      arriveAtPickup: jest
        .fn()
        .mockRejectedValue(new EngineApiError('TIMEOUT', 'timed out', 0)),
      getTripById: jest.fn().mockResolvedValue(assigned),
    };
    useService(service);
    await controller.loadInitialTrip();
    await expect(controller.arriveAtPickup(TRIP_ID)).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
    expect(controller.getTrip()?.engineStatus).toBe('DRIVER_ASSIGNED');
  });

  it('follows the engine when a re-read after a timeout shows the step was applied', async () => {
    const service = {
      getActiveTrip: jest.fn().mockResolvedValue(trip('DRIVER_ASSIGNED')),
      arriveAtPickup: jest
        .fn()
        .mockRejectedValue(new EngineApiError('NETWORK_ERROR', 'offline', 0)),
      getTripById: jest
        .fn()
        .mockResolvedValue(trip('DRIVER_ARRIVED', { updatedAt: 2_000 })),
    };
    useService(service);
    await controller.loadInitialTrip();
    await expect(controller.arriveAtPickup(TRIP_ID)).rejects.toBeInstanceOf(
      EngineApiError,
    );
    await flush();
    expect(controller.getTrip()?.engineStatus).toBe('DRIVER_ARRIVED');
  });

  it('never lets an older answer replace a newer one', async () => {
    const service = {
      startTrip: jest.fn().mockResolvedValue({
        trip: trip('IN_TRANSIT', { updatedAt: 3_000 }),
        changed: true,
      }),
      getTripById: jest
        .fn()
        .mockResolvedValue(trip('PICKUP_VERIFIED', { updatedAt: 2_000 })),
    };
    useService(service);
    await controller.startTrip(TRIP_ID);
    await controller.loadTrip(TRIP_ID); // a slow poll that started before the start
    expect(controller.getTrip()?.engineStatus).toBe('IN_TRANSIT');
  });

  it('accepts once; an unanswered accept counts only if the engine shows this ride', async () => {
    const accepted = trip('DRIVER_ASSIGNED');
    const service = {
      acceptTrip: jest
        .fn()
        .mockRejectedValue(new EngineApiError('TIMEOUT', 'timed out', 0)),
      getActiveTrip: jest.fn().mockResolvedValue(accepted),
    };
    useService(service);
    await expect(controller.acceptOffer(RIDE_ID)).resolves.toMatchObject({
      id: TRIP_ID,
    });

    service.getActiveTrip.mockResolvedValue(
      trip('DRIVER_ASSIGNED', {
        rideId: '99999999-9999-4999-8999-999999999999',
      }),
    );
    await expect(controller.acceptOffer(RIDE_ID)).rejects.toMatchObject({
      code: 'TIMEOUT',
    });

    service.acceptTrip.mockRejectedValue(
      new EngineApiError('HTTP_409', 'Ride is already ACCEPTED.', 409),
    );
    service.getActiveTrip.mockClear();
    await expect(controller.acceptOffer(RIDE_ID)).rejects.toMatchObject({
      status: 409,
    });
    expect(service.getActiveTrip).not.toHaveBeenCalled();
  });
});

describe('failed delivery', () => {
  it('requires a reason of 3-200 characters before anything is sent', async () => {
    const service = {
      failDrop: jest.fn().mockResolvedValue({
        trip: trip('DROP_PROGRESS'),
        changed: true,
      }),
    };
    useService(service);
    await expect(controller.failDrop(TRIP_ID, STOP_ID, '  ')).rejects.toThrow(
      RangeError,
    );
    await expect(
      controller.failDrop(TRIP_ID, STOP_ID, 'x'.repeat(201)),
    ).rejects.toThrow(RangeError);
    expect(service.failDrop).not.toHaveBeenCalled();

    await controller.failDrop(TRIP_ID, STOP_ID, '  Receiver not home  ');
    expect(service.failDrop).toHaveBeenCalledWith(
      TRIP_ID,
      STOP_ID,
      'Receiver not home',
    );
  });
});

describe('error messages', () => {
  const t = (key: string) => key;

  it('uses its own message for known engine codes, the server message otherwise', () => {
    expect(
      describeTripError(new EngineApiError('PAYMENT_REQUIRED', 'x', 409), t),
    ).toBe('trip.errPaymentRequired');
    expect(describeTripError(new EngineApiError('TIMEOUT', 'x', 0), t)).toBe(
      'trip.errUnknownOutcome',
    );
    expect(
      describeTripError(new EngineApiError('IDENTITY_MISMATCH', 'x', 403), t),
    ).toBe('trip.errNotYourTrip');
    expect(
      describeTripError(
        new EngineApiError('HTTP_400', 'Invalid OTP for Stop 1.', 400),
        t,
      ),
    ).toBe('Invalid OTP for Stop 1.');
    expect(describeTripError(new Error('boom'), t)).toBe('trip.errTryAgain');
  });
});

describe('translations for the trip screens', () => {
  const root = path.join(__dirname, '..');
  const i18n = readFileSync(path.join(root, 'src/i18n/index.tsx'), 'utf8');
  const [enPart, hiPart] = i18n.split('const hi: Dict = {');
  const keysIn = (source: string) =>
    new Set(
      [...source.matchAll(/'([a-zA-Z]+\.[a-zA-Z]+)':/g)].map(match => match[1]),
    );
  const en = keysIn(enPart);
  const hi = keysIn(hiPart);
  const used = new Set(
    [
      'src/screens/trip/ArrivedAtPickupScreen.tsx',
      'src/screens/trip/PickupOTPScreen.tsx',
      'src/screens/trip/DropOTPScreen.tsx',
      'src/screens/trip/DeliveryProofCameraScreen.tsx',
      'src/screens/trip/DeliveryProofPreviewScreen.tsx',
      'src/screens/trip/CollectPaymentScreen.tsx',
      'src/components/molecules/PaymentGateNotice.tsx',
      'src/services/trip/tripErrors.ts',
    ].flatMap(file =>
      [
        ...readFileSync(path.join(root, file), 'utf8').matchAll(
          /['"]((?:trip|collect|common)\.[a-zA-Z]+)['"]/g,
        ),
      ].map(match => match[1]),
    ),
  );

  it('finds the keys the trip screens use', () => {
    expect(used.has('trip.enterSenderOtp')).toBe(true);
    expect(used.has('trip.dropPaymentRequired')).toBe(true);
    expect(used.has('trip.completeTrip')).toBe(true);
    expect(used.has('collect.walletShort')).toBe(true);
  });

  it('has every new message in English and Hindi', () => {
    const missing = [...used].filter(key => !en.has(key) || !hi.has(key));
    expect(missing).toEqual([]);
  });
});

import { TripController } from '../src/services/trip/TripController';
import { TripService } from '../src/services/trip/TripService';

// Firebase's native auth module and react-native-config cannot load under Jest (both ship ESM).
// The trip service is mocked below anyway; these only let its module graph load.
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
jest.mock('../src/services/trip/TripService');

describe('TripController', () => {
  let controller: TripController;

  beforeEach(() => {
    // @ts-ignore
    TripController.instance = undefined;
    controller = TripController.getInstance();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('initializes and attempts to fetch active trip', async () => {
    const mockTrip = {
      id: 'trip-1',
      status: 'en_route_pickup',
      stops: [],
      currentStopIndex: 0,
    };
    const mockService = {
      getActiveTrip: jest.fn().mockResolvedValue(mockTrip),
    };
    (TripService.getInstance as jest.Mock).mockReturnValue(mockService);

    await controller.loadInitialTrip();

    expect(mockService.getActiveTrip).toHaveBeenCalled();
    expect(controller.getTrip()).toEqual(mockTrip);
  });

  // Updated in Phase 9. This test used to assert
  //   updateState('trip-1', 'in_transit', { otp: '1234' })
  // i.e. that the pickup OTP drove the trip from arrival through verification to IN_TRANSIT in
  // one call (arrive + OTP + start chained). The Phase 8 contract (review G: "Never chain
  // arrive, OTP and start") makes each one its own engine step, so the equivalent assertion is
  // now: the OTP calls exactly the pickup verification, nothing else, and listeners receive the
  // engine's answer.
  it('verifies the pickup OTP as one engine step and notifies listeners', async () => {
    const verifiedTrip = {
      id: 'trip-1',
      status: 'pickup_verified',
      engineStatus: 'PICKUP_VERIFIED',
      stops: [],
      currentStopIndex: 0,
    };
    const mockService = {
      getActiveTrip: jest.fn().mockResolvedValue({
        id: 'trip-1',
        status: 'arrived_pickup',
        stops: [],
        currentStopIndex: 0,
      }),
      verifyPickupOTP: jest
        .fn()
        .mockResolvedValue({ trip: verifiedTrip, changed: true }),
      startTrip: jest.fn(),
      arriveAtPickup: jest.fn(),
    };
    (TripService.getInstance as jest.Mock).mockReturnValue(mockService);

    await controller.loadInitialTrip();
    const listener = jest.fn();
    controller.subscribe(listener);

    await controller.verifyPickupOTP('trip-1', '1234');

    expect(mockService.verifyPickupOTP).toHaveBeenCalledWith('trip-1', '1234');
    expect(mockService.arriveAtPickup).not.toHaveBeenCalled();
    expect(mockService.startTrip).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledWith(verifiedTrip);
  });
});

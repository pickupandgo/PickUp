import { TripController } from '../src/services/trip/TripController';
import { TripService } from '../src/services/trip/TripService';
import type { ActiveTrip } from '../src/types/trip';

let mockUid: string | null = 'driver-a';
jest.mock('@react-native-firebase/auth', () => ({
  getAuth: () => ({ currentUser: mockUid ? { uid: mockUid } : null }),
}));
jest.mock('../src/config/env', () => ({ env: { API_BASE_URL: 'https://engine.example', IS_MOCK_MODE: false } }));
jest.mock('../src/services/trip/TripService');
jest.mock('../src/services/trip/ArrivalDetectionService', () => ({
  ArrivalDetectionService: { getInstance: () => ({ syncTripState: async () => {} }) },
}));

const trip = (id = 'trip-a', engineStatus = 'IN_TRANSIT', updatedAt = 1): ActiveTrip => ({
  id, engineStatus, updatedAt, status: engineStatus === 'COMPLETED' ? 'completed' : 'in_transit',
  stops: [], currentStopIndex: 0, estimatedEarning: 100, currency: 'INR', totalDistanceKm: 1,
  loadType: 'other', goodsType: 'other', vehicleId: 'vehicle', vehicleRegistration: 'fixture',
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
};
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
let controller: TripController;
let service: { getActiveTrip: jest.Mock; getTripById: jest.Mock; acceptTrip: jest.Mock; startTrip: jest.Mock; completeTrip: jest.Mock };
beforeEach(() => {
  mockUid = 'driver-a';
  (TripController as any).instance = undefined;
  service = { getActiveTrip: jest.fn().mockResolvedValue(null), getTripById: jest.fn(), acceptTrip: jest.fn(), startTrip: jest.fn(), completeTrip: jest.fn() };
  (TripService.getInstance as jest.Mock).mockReturnValue(service);
  controller = TripController.getInstance();
});

test('switching identity immediately removes the previous account trip and exact-id cache', () => {
  controller.setTrip(trip());
  const listener = jest.fn(); controller.subscribe(listener);
  mockUid = 'driver-b';
  expect(controller.getTrip()).toBeNull();
  expect(controller.getResource('trip-a').trip).toBeNull();
  expect(listener).toHaveBeenLastCalledWith(null);
});

test('clearing a view fences a delayed read for that trip', async () => {
  const pending = deferred<ActiveTrip>(); service.getTripById.mockReturnValue(pending.promise);
  const read = controller.loadTrip('trip-a'); await settle();
  controller.clearTrip('trip-a'); pending.resolve(trip()); await read;
  expect(controller.getResource('trip-a').trip).toBeNull();
});

test('a full reset fences all late responses', async () => {
  const pending = deferred<ActiveTrip>(); service.getTripById.mockReturnValue(pending.promise);
  const read = controller.loadTrip('trip-a'); const rejected = expect(read).rejects.toThrow('session changed');
  await settle(); controller.clearTrip(); pending.resolve(trip()); await rejected;
  expect(controller.getTrip()).toBeNull();
});

test('old account request cleanup cannot remove the new account in-flight recovery', async () => {
  const old = deferred<ActiveTrip | null>(), fresh = deferred<ActiveTrip | null>();
  service.getActiveTrip.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  const first = controller.loadInitialTrip(); const rejected = expect(first).rejects.toThrow('session changed');
  await settle(); mockUid = 'driver-b';
  const second = controller.loadInitialTrip(); await settle();
  old.resolve(trip()); await rejected;
  expect(controller.loadInitialTrip()).toBe(second);
  fresh.resolve(trip('trip-b')); await second;
  expect(controller.getTrip()?.id).toBe('trip-b');
});

test('authoritative empty recovery retires old active UI data', async () => {
  controller.setTrip(trip()); await controller.loadInitialTrip();
  expect(controller.getTrip()).toBeNull();
  expect(controller.getResource('trip-a').trip).toBeNull();
  expect(controller.getResource().status).toBe('ready');
});

test('an exact-id read started before authoritative retirement cannot restore that stale view', async () => {
  controller.setTrip(trip()); const pending = deferred<ActiveTrip>();
  service.getTripById.mockReturnValue(pending.promise);
  const read = controller.loadTrip('trip-a'); await settle();
  await controller.loadInitialTrip(); pending.resolve(trip()); await read;
  expect(controller.getResource('trip-a')).toMatchObject({ trip: null, status: 'ready' });
});

test('failed recovery keeps known trip but exposes a retryable error; retry clears error', async () => {
  controller.setTrip(trip()); service.getActiveTrip.mockRejectedValueOnce(new Error('offline'));
  await expect(controller.loadInitialTrip()).rejects.toThrow('offline');
  expect(controller.getTrip()?.id).toBe('trip-a');
  expect(controller.getResource().status).toBe('error');
  service.getActiveTrip.mockResolvedValue(trip('trip-a', 'IN_TRANSIT', 2)); await controller.loadInitialTrip();
  expect(controller.getResource().error).toBeNull();
  expect(controller.getResource().status).toBe('ready');
});

test('empty response started before acceptance cannot erase the new assignment', async () => {
  const pending = deferred<ActiveTrip | null>(); service.getActiveTrip.mockReturnValue(pending.promise);
  const read = controller.loadInitialTrip(); await settle();
  service.acceptTrip.mockResolvedValue({ ...trip('trip-b'), rideId: 'ride-b' });
  await controller.acceptOffer('ride-b'); pending.resolve(null); await read;
  expect(controller.getTrip()?.id).toBe('trip-b');
});

test('an older poll cannot roll back a newer action result', async () => {
  controller.setTrip(trip()); const pending = deferred<ActiveTrip>();
  service.getTripById.mockReturnValue(pending.promise); const read = controller.loadTrip('trip-a'); await settle();
  service.startTrip.mockResolvedValue({ trip: trip('trip-a', 'IN_TRANSIT', 3), changed: true });
  await controller.startTrip('trip-a'); pending.resolve(trip('trip-a', 'DRIVER_ASSIGNED', 1)); await read;
  expect(controller.getTrip()?.updatedAt).toBe(3);
});

test('DELIVERED remains resumable; confirmed completion retires active slot and preserves exact summary', async () => {
  controller.setTrip(trip('trip-a', 'DELIVERED'));
  expect(controller.getTrip()?.engineStatus).toBe('DELIVERED');
  service.completeTrip.mockResolvedValue({ trip: trip('trip-a', 'COMPLETED', 2), changed: true });
  await controller.completeTrip('trip-a');
  expect(controller.getTrip()).toBeNull();
  expect(controller.getResource('trip-a').trip?.engineStatus).toBe('COMPLETED');
});

test('failed exact-id read cannot borrow another active trip', async () => {
  controller.setTrip(trip()); service.getTripById.mockRejectedValue(new Error('not found'));
  await expect(controller.loadTrip('trip-b')).rejects.toThrow('not found');
  expect(controller.getResource('trip-b')).toMatchObject({ trip: null, status: 'error' });
  expect(controller.getTrip()?.id).toBe('trip-a');
});

test('historical completion and its Home button never clear a different active trip', async () => {
  controller.setTrip(trip('trip-b'));
  service.getTripById.mockResolvedValue(trip('trip-a', 'COMPLETED'));
  await controller.loadTrip('trip-a'); controller.clearTrip('trip-a');
  expect(controller.getTrip()?.id).toBe('trip-b');
});

test('late action from account A cannot update or navigate account B through its resolved result', async () => {
  controller.setTrip(trip()); const pending = deferred<{ trip: ActiveTrip; changed: boolean }>();
  service.startTrip.mockReturnValue(pending.promise);
  const action = controller.startTrip('trip-a'); const rejected = expect(action).rejects.toThrow('session changed');
  await settle(); mockUid = 'driver-b'; controller.setTrip(trip('trip-b'));
  pending.resolve({ trip: trip('trip-a', 'IN_TRANSIT', 5), changed: true }); await rejected;
  expect(controller.getTrip()?.id).toBe('trip-b');
  expect(service.getTripById).not.toHaveBeenCalled();
});

test('mismatched server identity is rejected rather than cached under the requested trip', async () => {
  service.getTripById.mockResolvedValue(trip('trip-b'));
  await expect(controller.loadTrip('trip-a')).rejects.toThrow('different trip');
  expect(controller.getResource('trip-a').trip).toBeNull();
  expect(controller.getResource('trip-b').trip).toBeNull();
});

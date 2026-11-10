import { TrackingService, recoverTrackedTrip, type TrackingDependencies } from '../src/services/tracking/TrackingService';
import type { ActiveTrip } from '../src/types/trip';

jest.mock('../src/services/trip/TripController', () => ({ TripController: {} }));
jest.mock('../src/services/trip/TripService', () => ({ TripService: {} }));
jest.mock('../src/services/tracking/TrackingAdapter', () => ({ TrackingAdapter: {} }));
const trip = (status = 'IN_TRANSIT') => ({ id: 'trip-a', status: status === 'COMPLETED' ? 'completed' : 'in_transit', engineStatus: status } as ActiveTrip);
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function setup() {
  let notify: (value: ActiveTrip | null) => void = () => {};
  const configure = jest.fn(async (_enabled: boolean, _tripId: string | null) => {}), recover = jest.fn(async (): Promise<ActiveTrip | null> => null);
  const apply = jest.fn((value: ActiveTrip | null) => notify(value));
  const deps: TrackingDependencies = { configure, recover, subscribe: listener => { notify = listener; return jest.fn(); }, apply };
  return { service: new TrackingService(deps), configure, recover, apply, notify: (v: ActiveTrip | null) => notify(v) };
}
beforeEach(() => jest.useFakeTimers());
it('restores explicit Online preference and detaches React without stopping native sharing', async () => {
  const configure = jest.fn(async () => {});
  const saveOnline = jest.fn(async () => {});
  const availability = jest.fn(async () => {});
  const service = new TrackingService({ configure, recover: async () => null, apply: () => {},
    subscribe: () => () => {}, loadOnline: async () => true, saveOnline, availability });
  service.startSession(); await settle();
  expect(service.getOnline()).toBe(true);
  expect(configure).toHaveBeenLastCalledWith(true, null);
  configure.mockClear();
  service.detachSession(); await settle();
  expect(configure).not.toHaveBeenCalled();
  expect(saveOnline).not.toHaveBeenCalled();
  expect(availability).not.toHaveBeenCalled();
});
it('does not confirm Offline after a backend failure and rolls back failed persistence', async () => {
  const availability = jest.fn(async () => {}), saveOnline = jest.fn(async () => {});
  const service = new TrackingService({ configure: async () => {}, recover: async () => null, apply: () => {},
    subscribe: () => () => {}, loadOnline: async () => true, saveOnline, availability });
  service.startSession(); await settle();
  availability.mockRejectedValueOnce(new Error('network'));
  await expect(service.setOnline(false)).rejects.toThrow('network');
  expect(service.getOnline()).toBe(true);
  saveOnline.mockRejectedValueOnce(new Error('storage'));
  await expect(service.setOnline(false)).rejects.toThrow('storage');
  expect(availability).toHaveBeenLastCalledWith(true);
  expect(service.getOnline()).toBe(true);
  service.detachSession();
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });
it('has one publisher through acceptance, navigation-equivalent subscriptions and all trip stages', async () => {
  const h = setup(); h.service.startSession(); h.service.startSession(); await settle();
  await h.service.setOnline(true); h.notify(trip('DRIVER_ASSIGNED')); await settle();
  for (const state of ['DRIVER_ARRIVED', 'PICKUP_VERIFIED', 'IN_TRANSIT', 'DROP_PROGRESS']) { h.notify(trip(state)); await settle(); }
  expect(h.configure.mock.calls.filter(([enabled, id]) => enabled && id === 'trip-a')).toHaveLength(1);
  await h.service.setOnline(false);
  expect(h.configure).toHaveBeenLastCalledWith(true, 'trip-a');
  h.notify(trip('COMPLETED')); await settle();
  expect(h.configure).toHaveBeenLastCalledWith(false, null);
  await h.service.stopSession();
});
it('retains active sharing through a failed recovery and recovers an existing trip at startup', async () => {
  const h = setup(); h.recover.mockResolvedValueOnce(trip()); h.service.startSession(); await settle();
  expect(h.configure).toHaveBeenLastCalledWith(true, 'trip-a');
  h.recover.mockRejectedValueOnce(new Error('offline')); await h.service.recover();
  expect(h.configure).toHaveBeenLastCalledWith(true, 'trip-a');
  await h.service.stopSession(); expect(h.configure).toHaveBeenLastCalledWith(false, null);
});
it('does not apply a recovery response after signout or after a newer trip event', async () => {
  const h = setup(); let resolve!: (v: ActiveTrip | null) => void;
  h.recover.mockReturnValueOnce(new Promise(r => { resolve = r; }));
  h.service.startSession(); h.notify(trip()); await settle(); resolve(null); await settle();
  expect(h.configure).toHaveBeenLastCalledWith(true, 'trip-a');
  await h.service.stopSession();
});
it('ignores a startup recovery that finishes after signout', async () => {
  const h = setup(); let resolve!: (v: ActiveTrip | null) => void;
  h.recover.mockReturnValueOnce(new Promise(r => { resolve = r; }));
  h.service.startSession(); await h.service.stopSession();
  resolve(trip()); await settle();
  expect(h.configure).toHaveBeenLastCalledWith(false, null);
});

it('restores a cancellation from the known trip when the active index becomes empty', async () => {
  const cancelled = { ...trip(), status: 'cancelled', engineStatus: 'CANCELLED' } as ActiveTrip;
  const service = { getActiveTrip: jest.fn(async () => null), getTripById: jest.fn(async () => cancelled) };
  expect(await recoverTrackedTrip(service, () => trip())).toBe(cancelled);
  expect(service.getTripById).toHaveBeenCalledWith('trip-a');
  service.getTripById.mockClear();
  expect(await recoverTrackedTrip(service, () => cancelled)).toBeNull();
  expect(service.getTripById).not.toHaveBeenCalled();
});

it('authoritative empty recovery retires subscribed trip state as well as native tracking', async () => {
  const h = setup(); h.recover.mockResolvedValueOnce(trip()); h.service.startSession(); await settle();
  h.recover.mockResolvedValueOnce(null); await h.service.recover(); await settle();
  expect(h.apply).toHaveBeenLastCalledWith(null);
  expect(h.configure).toHaveBeenLastCalledWith(false, null);
  await h.service.stopSession();
});

it('keeps DELIVERED resumable until the engine confirms COMPLETED', async () => {
  const h = setup(); h.service.startSession(); await settle();
  h.notify(trip('DELIVERED')); await settle();
  expect(h.configure).toHaveBeenLastCalledWith(true, 'trip-a');
  h.notify(trip('COMPLETED')); await settle();
  expect(h.configure).toHaveBeenLastCalledWith(false, null);
  await h.service.stopSession();
});

it('an old-session finally cannot clear a new-session recovery', async () => {
  const h = setup(); let oldResolve!: (value: ActiveTrip | null) => void;
  let newResolve!: (value: ActiveTrip | null) => void;
  h.recover.mockReturnValueOnce(new Promise(resolve => { oldResolve = resolve; }));
  h.service.startSession(); await settle(); await h.service.stopSession();
  h.recover.mockReturnValueOnce(new Promise(resolve => { newResolve = resolve; }));
  h.service.startSession(); await settle(); oldResolve(trip()); await settle();
  h.service.recover(); expect(h.recover).toHaveBeenCalledTimes(2);
  newResolve({ ...trip(), id: 'trip-b' }); await settle();
  expect(h.configure).toHaveBeenLastCalledWith(true, 'trip-b');
  await h.service.stopSession();
});

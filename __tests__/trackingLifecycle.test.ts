import { TrackingService, type TrackingDependencies } from '../src/services/tracking/TrackingService';
import type { ActiveTrip } from '../src/types/trip';

jest.mock('../src/services/trip/TripController', () => ({ TripController: {} }));
jest.mock('../src/services/trip/TripService', () => ({ TripService: {} }));
jest.mock('../src/services/tracking/TrackingAdapter', () => ({ TrackingAdapter: {} }));
const trip = (status = 'IN_TRANSIT') => ({ id: 'trip-a', status: status === 'COMPLETED' ? 'completed' : 'in_transit', engineStatus: status } as ActiveTrip);
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function setup() {
  let notify: (value: ActiveTrip | null) => void = () => {};
  const configure = jest.fn(async (_enabled: boolean, _tripId: string | null) => {}), recover = jest.fn(async (): Promise<ActiveTrip | null> => null);
  const deps: TrackingDependencies = { configure, recover, subscribe: listener => { notify = listener; return jest.fn(); }, apply: value => notify(value) };
  return { service: new TrackingService(deps), configure, recover, notify: (v: ActiveTrip | null) => notify(v) };
}
beforeEach(() => jest.useFakeTimers());
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

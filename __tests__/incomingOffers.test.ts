import { IncomingOffers, type OfferDependencies } from '../src/services/trip/IncomingOffers';
import { offerDistances } from '../src/services/trip/offerDistances';
import type { TripOffer, ActiveTrip } from '../src/types/trip';
import type { LocationResult } from '../src/location/types';

const now = 100_000;
const point = { latitude: 26.29, longitude: 73.02 };
const offer: TripOffer = {
  id: 'ride', estimatedEarning: 800, currency: '₹', loadType: 'other', vehicleType: 'MINI_TRUCK', expiresAt: now + 30_000,
  pickupStop: { id: 'pickup', label: 'Pickup', address: 'Pickup', ...point, type: 'pickup', status: 'current' },
  dropStops: [{ id: 'drop', label: 'Drop', address: 'Drop', latitude: 26.3, longitude: 73.03, type: 'drop', status: 'pending' }], totalDistanceKm: 1,
};
const trip = { id: 'trip', rideId: 'ride', engineStatus: 'DRIVER_ASSIGNED' } as ActiveTrip;
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
function setup() {
  const deps = {
    uid: jest.fn((): string | null => 'partner'), now: jest.fn(() => now),
    fetch: jest.fn(async () => [offer]), availability: jest.fn<Promise<void>, [string, boolean]>(async () => {}),
    accept: jest.fn(async () => trip), decline: jest.fn(async () => {}),
  } satisfies OfferDependencies;
  const inbox = new IncomingOffers(deps);
  inbox.start('partner');
  return { inbox, deps };
}
test('polling reconciles an offer without accepting, retains collapse, clears cancelled/assigned offers', async () => {
  const { inbox, deps } = setup();
  await inbox.refresh();
  expect(inbox.getSnapshot().offer).toBe(offer);
  expect(deps.accept).not.toHaveBeenCalled();
  inbox.collapse(); await inbox.refresh();
  expect(inbox.getSnapshot().collapsed).toBe(true);
  deps.fetch.mockResolvedValue([]); await inbox.refresh();
  expect(inbox.getSnapshot().offer).toBeNull();
});
test.each([0, NaN, now - 1])('never offers a missing, invalid or expired deadline %s', async expiresAt => {
  const { inbox, deps } = setup(); deps.fetch.mockResolvedValue([{ ...offer, expiresAt }]);
  await inbox.refresh(); expect(inbox.getSnapshot().offer).toBeNull();
});
test('countdown expiry removes collapsed offers and rejects an expired action', async () => {
  const { inbox, deps } = setup(); await inbox.refresh(); inbox.collapse();
  deps.now.mockReturnValue(offer.expiresAt);
  expect(await inbox.respond(true)).toBeNull(); expect(deps.accept).not.toHaveBeenCalled();
  expect(inbox.getSnapshot().offer).toBeNull();
});
test('duplicate and competing Accept/Decline taps share one backend operation', async () => {
  const { inbox, deps } = setup(); await inbox.refresh();
  const response = deferred<ActiveTrip>(); deps.accept.mockReturnValue(response.promise);
  const first = inbox.respond(true), second = inbox.respond(true), decline = inbox.respond(false);
  expect(first).toBe(second); expect(first).toBe(decline);
  await Promise.resolve(); await Promise.resolve();
  response.resolve(trip);
  expect(await first).toBe(trip); expect(deps.accept).toHaveBeenCalledTimes(1); expect(deps.decline).not.toHaveBeenCalled();
  expect(inbox.getSnapshot().offer).toBeNull();
});
test.each([true, false])('rechecks backend cancellation/taken offers before action %s', async accept => {
  const { inbox, deps } = setup(); await inbox.refresh(); deps.fetch.mockResolvedValue([]);
  expect(await inbox.respond(accept)).toBeNull();
  expect(deps.accept).not.toHaveBeenCalled(); expect(deps.decline).not.toHaveBeenCalled();
});
test.each([true, false])('retains an actionable error on failed mutation %s', async accept => {
  const { inbox, deps } = setup(); await inbox.refresh();
  (accept ? deps.accept : deps.decline).mockRejectedValue(new Error('network'));
  expect(await inbox.respond(accept)).toBeNull(); expect(inbox.getSnapshot().error).toContain('Unable to confirm');
  expect(inbox.getSnapshot().offer).toBe(offer); expect(inbox.getSnapshot().busy).toBe(false);
});
test('offline and session changes discard in-flight offers and suppress mutations', async () => {
  const { inbox, deps } = setup(); await inbox.refresh();
  const pending = deferred<TripOffer[]>(); deps.fetch.mockReturnValue(pending.promise);
  const action = inbox.respond(true); await Promise.resolve(); inbox.stop();
  pending.resolve([offer]); await action;
  expect(inbox.getSnapshot().offer).toBeNull(); expect(deps.accept).not.toHaveBeenCalled();
  inbox.start('partner'); deps.uid.mockReturnValue('other');
  await inbox.refresh(); expect(deps.accept).not.toHaveBeenCalled();
});
test('late successful action after logout does not expose an old trip', async () => {
  const { inbox, deps } = setup(); await inbox.refresh();
  const pending = deferred<ActiveTrip>(); deps.accept.mockReturnValue(pending.promise);
  const action = inbox.respond(true); await Promise.resolve(); await Promise.resolve();
  inbox.reset(); deps.uid.mockReturnValue('other'); pending.resolve(trip);
  expect(await action).toBeNull(); expect(inbox.getSnapshot()).toMatchObject({ offer: null, busy: false });
});
test('screen cleanup does not turn the Partner offline during a pending presence write', async () => {
  const { inbox, deps } = setup(); const pending = deferred<void>(); deps.availability.mockReturnValueOnce(pending.promise);
  const poll = inbox.refresh(); inbox.stop(); pending.resolve(); await poll; await Promise.resolve();
  expect(deps.availability.mock.calls.map(args => args[1])).toEqual([true]); expect(deps.fetch).not.toHaveBeenCalled();
});
const fix: LocationResult = { ...point, accuracy: 20, timestamp: now, altitude: 0, speed: 0, bearing: 0, provider: 'gps' };
test('displays only actual provider legs and preserves a valid zero route', () => {
  const road = { toPickup: { distanceMeters: 5600, durationSeconds: 1020 }, delivery: { distanceMeters: 12000, durationSeconds: 2100 } };
  expect(offerDistances(offer, fix, now, road)).toEqual({ pickupKm: 5.6, deliveryKm: 12 });
  expect(offerDistances(offer, fix, now, { ...road, toPickup: { distanceMeters: 0, durationSeconds: 0 } }).pickupKm).toBe(0);
});
test.each([null, { ...fix, timestamp: now - 30001 }, { ...fix, accuracy: 101 }, { ...fix, latitude: 91 }])('unavailable/stale/inaccurate GPS never becomes a pickup estimate', location => {
  expect(offerDistances(offer, location, now).pickupKm).toBeNull();
});
test('absent provider routes never fall back to straight-line calculations', () => {
  expect(offerDistances(offer, fix, now)).toEqual({ pickupKm: null, deliveryKm: null });
  expect(offerDistances({ ...offer, dropStops: [] }, fix, now).deliveryKm).toBeNull();
  expect(offerDistances({ ...offer, dropStops: [{ ...offer.dropStops[0], longitude: 181 }] }, fix, now).deliveryKm).toBeNull();
});

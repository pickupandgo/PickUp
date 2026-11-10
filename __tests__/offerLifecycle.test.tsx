import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { NewTripOfferScreen } from '../src/screens/trip/NewTripOfferScreen';
import { EngineApiError } from '../src/services/engine/engineClient';
import type { ActiveTrip, TripOffer } from '../src/types/trip';

let mockUid = 'driver-a';
const mockAccept = jest.fn(), mockRecover = jest.fn(), mockReject = jest.fn();
jest.mock('../src/services/engine/dispatch', () => ({ getCurrentDriverId: () => mockUid, rejectRideRequest: (...args: unknown[]) => mockReject(...args) }));
jest.mock('../src/services/trip/TripController', () => ({ TripController: { getInstance: () => ({
  acceptOffer: mockAccept, loadInitialTrip: mockRecover, hasPendingAcceptance: () => false,
}) } }));
jest.mock('../src/components/organisms/TripOfferSheet', () => ({ TripOfferSheet: 'OfferSheet' }));
jest.mock('../src/components/atoms/Icon', () => 'Icon');
jest.mock('../src/map', () => ({ DriverMap: () => null, MapOverlay: ({ children }: any) => children }));
jest.mock('../src/location', () => ({ useDriverLocation: () => ({ currentLocation: null }) }));
jest.mock('../src/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
jest.mock('../src/config/env', () => ({ env: {} }));

const offer = (expiresAt = Date.now() + 60_000): TripOffer => ({
  id: 'ride-a', offerId: 'offer-a', expiresAt, estimatedEarning: 100, currency: 'INR',
  pickupStop: { id: 'pickup', type: 'pickup', status: 'current', label: 'Pickup', address: 'Test pickup', latitude: 26.2, longitude: 73 },
  dropStops: [], totalDistanceKm: 1, loadType: 'other', vehicleType: 'Mini Truck',
});
const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
const views: Renderer.ReactTestRenderer[] = [];
const setup = async (value = offer()) => {
  const navigation = { replace: jest.fn(), goBack: jest.fn(), isFocused: () => true };
  let view!: Renderer.ReactTestRenderer;
  await act(async () => { view = Renderer.create(<NewTripOfferScreen navigation={navigation as any}
    route={{ params: { offer: value, driverId: 'driver-a' } } as any} />); });
  views.push(view);
  return { view, navigation, sheet: () => view.root.findByType('OfferSheet' as any).props };
};
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-11-07T10:00:00Z')); mockUid = 'driver-a'; jest.resetAllMocks(); });
afterEach(async () => { await act(async () => { views.splice(0).forEach(view => view.unmount()); }); jest.useRealTimers(); });

test('duplicate taps send one acceptance and success is shown only after server confirmation, even across deadline', async () => {
  const pending = deferred<ActiveTrip>(); mockAccept.mockReturnValue(pending.promise);
  const h = await setup(offer(Date.now() + 1000));
  let action!: Promise<void>;
  await act(async () => { action = h.sheet().onAccept(); h.sheet().onAccept(); });
  expect(mockAccept).toHaveBeenCalledTimes(1);
  expect(h.sheet().phase).toBe('accepting'); expect(h.navigation.replace).not.toHaveBeenCalled();
  await act(async () => { jest.setSystemTime(Date.now() + 2000); h.sheet().onExpired(); });
  expect(h.sheet().phase).toBe('accepting');
  await act(async () => { pending.resolve({ id: 'confirmed-trip' } as ActiveTrip); await action; });
  expect(h.navigation.replace).toHaveBeenCalledWith('ActiveTrip', { tripId: 'confirmed-trip' });
});

test('a stale or missing-deadline offer cannot send accept/reject requests', async () => {
  for (const deadline of [Date.now() - 1, 0]) {
    const h = await setup(offer(deadline));
    await act(async () => { await h.sheet().onAccept(); await h.sheet().onDecline(); });
    expect(['expired', 'unavailable']).toContain(h.sheet().phase);
  }
  expect(mockAccept).not.toHaveBeenCalled(); expect(mockReject).not.toHaveBeenCalled();
});

test('wall clock expiry blocks a tap even when the timer did not tick while backgrounded', async () => {
  const h = await setup(); jest.setSystemTime(Date.now() + 120_000);
  await act(async () => h.sheet().onAccept());
  expect(mockAccept).not.toHaveBeenCalled(); expect(h.sheet().phase).toBe('expired');
});

test('unknown acceptance checks the authoritative active trip rather than silently accepting again', async () => {
  mockAccept.mockRejectedValue(new EngineApiError('TIMEOUT', 'timeout', 0));
  mockRecover.mockResolvedValue({ id: 'accepted-after-timeout' });
  const h = await setup(); await act(async () => h.sheet().onAccept());
  expect(h.sheet().phase).toBe('uncertain'); expect(h.navigation.replace).not.toHaveBeenCalled();
  await act(async () => h.sheet().onCheckStatus());
  expect(mockAccept).toHaveBeenCalledTimes(1);
  expect(h.navigation.replace).toHaveBeenCalledWith('ActiveTrip', { tripId: 'accepted-after-timeout' });
});

test('reject failure remains visible and does not pretend the offer was declined', async () => {
  mockReject.mockRejectedValueOnce(new EngineApiError('NETWORK_ERROR', 'offline', 0)).mockResolvedValueOnce(undefined);
  const h = await setup(); await act(async () => h.sheet().onDecline());
  expect(h.sheet().error).toBeTruthy(); expect(h.navigation.goBack).not.toHaveBeenCalled();
  await act(async () => h.sheet().onDecline()); expect(h.navigation.goBack).toHaveBeenCalledTimes(1);
});

test.each([409, 422])('server conflict/ineligibility (%s) never becomes an accepted UI', async status => {
  mockAccept.mockRejectedValue(new EngineApiError('OFFER_UNAVAILABLE', 'Offer is unavailable', status));
  const h = await setup(); await act(async () => h.sheet().onAccept());
  expect(h.sheet().phase).toBe('unavailable'); expect(h.sheet().error).toBe('Offer is unavailable');
  expect(h.navigation.replace).not.toHaveBeenCalled();
});

test('a late acceptance cannot navigate a new account', async () => {
  const pending = deferred<ActiveTrip>(); mockAccept.mockReturnValue(pending.promise);
  const h = await setup(); let action!: Promise<void>;
  await act(async () => { action = h.sheet().onAccept(); }); mockUid = 'driver-b';
  await act(async () => { pending.resolve({ id: 'old-account-trip' } as ActiveTrip); await action; });
  expect(h.navigation.replace).not.toHaveBeenCalled();
});

import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { AppState, type AppStateStatus } from 'react-native';
import { useDriverDispatch, type UseDriverDispatchResult } from '../src/hooks/useDriverDispatch';
import type { TripOffer } from '../src/types/trip';

let mockUid = 'driver-a', mockActive = false, mockAccepting = false;
const mockAvailable = jest.fn(), mockFetch = jest.fn(), mockOffer = jest.fn(), mockAvailabilityError = jest.fn();
jest.mock('../src/services/engine/dispatch', () => ({
  getCurrentDriverId: () => mockUid, setDriverAvailability: (...args: unknown[]) => mockAvailable(...args),
  fetchRideRequests: (...args: unknown[]) => mockFetch(...args), rideRequestToOffer: (value: unknown) => value,
}));
jest.mock('../src/services/trip/TripController', () => ({ TripController: { getInstance: () => ({
  getTrip: () => mockActive ? { id: 'active-trip' } : null, hasPendingAcceptance: () => mockAccepting,
}) } }));
let change: (state: AppStateStatus) => void;
let result: UseDriverDispatchResult;
let view: Renderer.ReactTestRenderer;
const pending = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
const fixture = (offerId = 'offer-a', expiresAt = Date.now() + 60_000) => ({ id: 'same-ride', offerId, expiresAt } as TripOffer);
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function Probe() { result = useDriverDispatch({ enabled: true, getLocation: () => null, onOffer: mockOffer, onAvailabilityError: mockAvailabilityError }); return null; }
const start = async () => { await act(async () => { view = Renderer.create(<Probe />); await settle(); }); };
beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-11-07T10:00:00Z')); jest.resetAllMocks();
  mockUid = 'driver-a'; mockActive = false; mockAccepting = false;
  mockAvailable.mockResolvedValue(undefined); mockFetch.mockResolvedValue([]);
  Object.assign(AppState, { currentState: 'active' });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
    change = state => { Object.assign(AppState, { currentState: state }); callback(state); };
    return { remove: jest.fn() };
  });
});
afterEach(async () => { if (view) await act(async () => view.unmount()); jest.restoreAllMocks(); jest.useRealTimers(); });

test('offers are not fetched before an availability acknowledgement', async () => {
  const ack = pending<void>(); mockAvailable.mockReturnValue(ack.promise); mockFetch.mockResolvedValue([fixture()]);
  await start(); expect(mockFetch).not.toHaveBeenCalled();
  await act(async () => { ack.resolve(); await settle(); });
  expect(mockFetch).toHaveBeenCalledTimes(1); expect(mockOffer).toHaveBeenCalledTimes(1);
  await act(async () => { jest.advanceTimersByTime(9000); await settle(); });
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

test('backgrounded or old-foreground requests cannot navigate; foreground fetches fresh data', async () => {
  const response = pending<TripOffer[]>(); mockFetch.mockReturnValueOnce(response.promise);
  await start();
  await act(async () => { change('background'); response.resolve([fixture('stale')]); await settle(); jest.advanceTimersByTime(9000); });
  expect(mockOffer).not.toHaveBeenCalled(); expect(mockFetch).toHaveBeenCalledTimes(1);
  mockFetch.mockResolvedValue([fixture('fresh')]);
  await act(async () => { change('active'); await settle(); });
  expect(mockOffer).toHaveBeenCalledWith(expect.objectContaining({ offerId: 'fresh' }), 'driver-a');
});

test('expired offers are skipped, the same offer is not replayed, and a new offer window can be shown', async () => {
  mockFetch.mockResolvedValue([fixture('expired', Date.now() - 1), fixture()]); await start();
  expect(mockOffer).toHaveBeenCalledTimes(1);
  await act(async () => { result.resume(); await settle(); }); expect(mockOffer).toHaveBeenCalledTimes(1);
  mockFetch.mockResolvedValue([fixture('new-offer')]);
  await act(async () => { result.resume(); await settle(); }); expect(mockOffer).toHaveBeenCalledTimes(2);
});

test('availability refusal is visible and prevents offer fetching', async () => {
  mockAvailable.mockRejectedValue(new Error('eligibility revoked')); await start();
  expect(mockFetch).not.toHaveBeenCalled(); expect(mockAvailabilityError).toHaveBeenCalled();
  expect(result.error).toContain('Availability could not be confirmed');
});

test.each(['active', 'accepting'])('does not advertise new work while %s', async state => {
  mockActive = state === 'active'; mockAccepting = state === 'accepting'; await start();
  expect(mockAvailable).not.toHaveBeenCalled(); expect(mockFetch).not.toHaveBeenCalled();
});

test('slow polling does not overlap and identity changes fence its response', async () => {
  const response = pending<TripOffer[]>(); mockFetch.mockReturnValue(response.promise); await start();
  await act(async () => { jest.advanceTimersByTime(9000); await settle(); }); expect(mockFetch).toHaveBeenCalledTimes(1);
  mockUid = 'driver-b';
  await act(async () => { response.resolve([fixture()]); await settle(); });
  expect(mockOffer).not.toHaveBeenCalled();
});

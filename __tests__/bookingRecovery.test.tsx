import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { findDriverAndCreateRide } from '../src/api/matching';
import { executeTripCancellation } from '../src/services/cancellationService';
import { createRide, getRide, getRideTrip, cancelRide, cancelTrip, recoverRide } from '../src/api/engine';
import { readPendingBooking, writePendingBooking } from '../src/state/pendingBooking';
import { BookingProvider, useBooking } from '../src/state/BookingContext';
import { ApiError } from '../src/api/http';

let mockUser: any = { uid: 'A' };
jest.mock('@react-native-firebase/auth', () => ({ getAuth: () => ({ currentUser: mockUser }), onAuthStateChanged: () => jest.fn() }));
jest.mock('../src/api/engine', () => ({ createRide: jest.fn(), getRide: jest.fn(), getRideTrip: jest.fn(), cancelRide: jest.fn(), cancelTrip: jest.fn(), getTrip: jest.fn(), recoverRide: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => {
 const values = new Map<string,string>();
 return { __esModule: true, default: {
   getItem: jest.fn(async (key: string) => values.get(key) ?? null),
   setItem: jest.fn(async (key: string, value: string) => { values.set(key, value); }),
   removeItem: jest.fn(async (key: string) => { values.delete(key); }),
 } };
});
const input = { quoteId: 'quote-A', paymentMethod: 'PAY_AT_DELIVERY' as const };
const ride: any = { id: 'ride-A', quoteId: input.quoteId, paymentMethod: input.paymentMethod, status: 'ACCEPTED', externalRef: 'ENG-A' };
beforeEach(async () => {
  jest.clearAllMocks(); mockUser = { uid: 'A' };
  await writePendingBooking('A', null); await writePendingBooking('B', null);
  (recoverRide as jest.Mock).mockResolvedValue(null); (getRideTrip as jest.Mock).mockResolvedValue(null);
  (createRide as jest.Mock).mockResolvedValue(ride); (getRide as jest.Mock).mockResolvedValue(ride);
});
afterEach(() => jest.useRealTimers());

it('persists the exact original request before create and publishes the ride before polling', async () => {
  (createRide as jest.Mock).mockImplementation(async () => {
    expect((await readPendingBooking('A'))?.input).toEqual(input);
    return { ...ride, status: 'REQUESTED' };
  });
  jest.useFakeTimers();
  const publish = jest.fn();
  const pending = findDriverAndCreateRide(input, { onRideCreated: publish });
  await jest.advanceTimersByTimeAsync(1);
  expect(publish).toHaveBeenCalledWith(expect.objectContaining({ id: 'ride-A', status: 'REQUESTED' }));
  await jest.advanceTimersByTimeAsync(2000);
  await pending;
  expect(createRide).toHaveBeenCalledTimes(1);
});

it('recovers a lost create response without creating another ride', async () => {
  (createRide as jest.Mock).mockRejectedValueOnce(new ApiError('network', 'response lost'));
  await expect(findDriverAndCreateRide(input)).rejects.toThrow();
  expect((await readPendingBooking('A'))?.input.quoteId).toBe(input.quoteId);
  (recoverRide as jest.Mock).mockResolvedValue(ride);
  await expect(findDriverAndCreateRide(input)).resolves.toEqual({ ride });
  expect(createRide).toHaveBeenCalledTimes(1);
});

it('coalesces concurrent creation attempts for one signed-in account', async () => {
  await Promise.all([findDriverAndCreateRide(input), findDriverAndCreateRide(input)]);
  expect(createRide).toHaveBeenCalledTimes(1);
});

it('does not post if saving the recovery identity failed', async () => {
  (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('storage unavailable'));
  await expect(findDriverAndCreateRide(input)).rejects.toThrow('storage unavailable');
  expect(createRide).not.toHaveBeenCalled();
});

it('does not overwrite an unresolved booking with a different quote', async () => {
  await writePendingBooking('A', { input });
  await expect(findDriverAndCreateRide({ ...input, quoteId: 'another' })).rejects.toThrow('previous booking');
  expect(createRide).not.toHaveBeenCalled();
  expect((await readPendingBooking('A'))?.input).toEqual(input);
});

it('restores a pending ride after provider remount without a quote draft or another POST', async () => {
  await writePendingBooking('A', { input });
  (recoverRide as jest.Mock).mockResolvedValue({ ...ride, status: 'REQUESTED', pickup: { latitude: 1, longitude: 2, address: 'Saved pickup' }, drops: [{ latitude: 3, longitude: 4, address: 'Saved drop' }] });
  let state!: ReturnType<typeof useBooking>;
  function Capture() { state = useBooking(); return null; }
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<BookingProvider><Capture /></BookingProvider>); });
  expect(state.ride?.id).toBe('ride-A'); expect(state.pendingInput).toEqual(input);
  expect(state.draft.pickup?.address).toBe('Saved pickup'); expect(state.draft.drops[0].address).toBe('Saved drop');
  expect(state.draft.quote).toBeUndefined(); expect(createRide).not.toHaveBeenCalled();
  act(() => renderer.unmount());
});

it('isolates pending booking storage by UID', async () => {
  await writePendingBooking('A', { input });
  mockUser = { uid: 'B' };
  expect(await readPendingBooking('B')).toBeNull();
});

it('never reports cancellation success without a server resource', async () => {
  await expect(executeTripCancellation({})).rejects.toThrow('No confirmed booking');
  expect(cancelRide).not.toHaveBeenCalled(); expect(cancelTrip).not.toHaveBeenCalled();
});

it('handles acceptance racing a ride cancellation by cancelling the confirmed trip', async () => {
  (cancelRide as jest.Mock).mockRejectedValue(new ApiError('http', 'accepted', 409));
  (getRide as jest.Mock).mockResolvedValue(ride);
  (getRideTrip as jest.Mock).mockResolvedValue({ id: 'trip-A' });
  (cancelTrip as jest.Mock).mockResolvedValue({ id: 'trip-A', externalRef: 'ENG-A', status: 'CANCELLED' });
  await writePendingBooking('A', { input, rideId: ride.id });
  const result = await executeTripCancellation({ ride, reason: 'Changed plans' });
  expect(cancelTrip).toHaveBeenCalledWith('trip-A', 'Changed plans', undefined);
  expect(result).toMatchObject({ success: true, tripId: 'ENG-A', feeAmount: null });
  expect(await readPendingBooking('A')).toBeNull();
});

it('reconciles a lost cancellation response using server state', async () => {
  (cancelRide as jest.Mock).mockRejectedValue(new ApiError('network', 'lost response'));
  (getRide as jest.Mock).mockResolvedValue({ ...ride, status: 'CANCELLED' });
  await expect(executeTripCancellation({ ride })).resolves.toMatchObject({ success: true, tripId: 'ENG-A' });
});

it('retains recovery identity when cancellation is pending or missing', async () => {
  await writePendingBooking('A', { input });
  (cancelRide as jest.Mock).mockResolvedValue({ ...ride, status: 'REQUESTED' });
  await expect(executeTripCancellation({ ride })).rejects.toThrow('not yet confirmed');
  expect(await readPendingBooking('A')).not.toBeNull();
  (cancelRide as jest.Mock).mockRejectedValue(new ApiError('http', 'missing', 404));
  (getRide as jest.Mock).mockRejectedValue(new ApiError('http', 'missing', 404));
  await expect(executeTripCancellation({ ride })).rejects.toThrow();
});


it('does not resurrect a cancelled ride from a late recovery response', async () => {
  await writePendingBooking('A', { input });
  let finish!: (value: any) => void;
  (recoverRide as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  let state!: ReturnType<typeof useBooking>;
  function Capture() { state = useBooking(); return null; }
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<BookingProvider><Capture /></BookingProvider>); });
  (cancelRide as jest.Mock).mockResolvedValue({ ...ride, status: 'CANCELLED' });
  await executeTripCancellation({ ride });
  act(() => state.clearActiveRide());
  await act(async () => { finish({ ...ride, status: 'REQUESTED' }); });
  expect(state.ride).toBeUndefined(); expect(await readPendingBooking('A')).toBeNull();
  act(() => renderer.unmount());
});

it('rejects a concurrent different quote rather than displaying the first booking as its result', async () => {
  const first = findDriverAndCreateRide(input);
  const second = expect(findDriverAndCreateRide({ ...input, quoteId: 'different-quote' })).rejects.toThrow('different booking');
  await first; await second;
  expect(createRide).toHaveBeenCalledTimes(1);
});


it('does not restore the journal when a stale create response arrives after confirmed cancellation', async () => {
  let finish!: (value: any) => void;
  let started!: () => void;
  const creating = new Promise<void>(resolve => { started = resolve; });
  (createRide as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; started(); }));
  const request = expect(findDriverAndCreateRide(input)).rejects.toThrow('recovery changed');
  await creating;
  (cancelRide as jest.Mock).mockResolvedValue({ ...ride, status: 'CANCELLED' });
  await executeTripCancellation({ ride });
  finish(ride);
  await request;
  expect(await readPendingBooking('A')).toBeNull();
});

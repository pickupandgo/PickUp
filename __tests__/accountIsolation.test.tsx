import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BookingProvider, useBooking } from '../src/state/BookingContext';
import { getCustomerProfile } from '../src/state/session';
import { getCachedCustomerChat, setCachedCustomerChat } from '../src/services/chatService';
import { getSavedAddresses } from '../src/state/savedAddresses';
import { useRideOtps } from '../src/hooks/useRideOtps';
import { useTripStatus } from '../src/hooks/useTripStatus';
import { getRideOtps, getTrip } from '../src/api/engine';

jest.mock('@react-native-async-storage/async-storage', () => {
  const data = new Map<string, string>();
  return { __esModule: true, default: {
    getItem: jest.fn(async (key: string) => data.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { data.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { data.delete(key); }),
  } };
});
let mockUser: any = { uid: 'A' };
let mockListener: any;
jest.mock('@react-native-firebase/auth', () => ({
  getAuth: () => ({ currentUser: mockUser }),
  onAuthStateChanged: (_: any, listener: any) => { mockListener = listener; return jest.fn(); },
}));
jest.mock('../src/api/engine', () => ({ recoverRide: jest.fn(async () => null), getRideOtps: jest.fn(), getTrip: jest.fn() }));
let renderer: ReactTestRenderer;
beforeEach(async () => { mockUser = { uid: 'A' }; jest.clearAllMocks(); await AsyncStorage.removeItem('pickup.customerProfile'); await AsyncStorage.removeItem('pickup.savedAddresses.guest'); });
afterEach(() => { if (renderer) act(() => renderer.unmount()); });

it('resets booking on account switch and ignores old setters', async () => {
  let state!: ReturnType<typeof useBooking>;
  function Capture() { state = useBooking(); return null; }
  await act(async () => { renderer = TestRenderer.create(<BookingProvider><Capture /></BookingProvider>); });
  const old = state;
  act(() => { old.setGoods({ goodsDescription: 'A private goods' }); old.setTrip({ id: 'A-trip' } as any); });
  act(() => { mockUser = { uid: 'B' }; mockListener(mockUser); });
  expect(state.customerId).toBe('B');
  expect(state.draft.goodsDescription).toBeUndefined();
  expect(state.trip).toBeUndefined();
  act(() => { old.setTrip({ id: 'late-A' } as any); });
  expect(state.trip).toBeUndefined();
  act(() => { mockUser = null; mockListener(null); });
  expect(state.customerId).toBeUndefined();
});

it('does not expose legacy global profiles to guests or another account', async () => {
  await AsyncStorage.setItem('pickup.customerProfile', JSON.stringify({ fullName: 'Legacy A' }));
  mockUser = null;
  expect(await getCustomerProfile()).toBeNull();
  mockUser = { uid: 'B' };
  expect(await getCustomerProfile()).toBeNull();
});

it('does not import shared guest addresses into another account', async () => {
  await AsyncStorage.setItem('pickup.savedAddresses.guest', JSON.stringify([{ id: 'private', addressLine1: 'Private guest address' }]));
  expect(await getSavedAddresses('B')).toEqual([]);
});

it.each(['otp', 'trip'])('ignores late %s results after resource changes', async kind => {
  const api = (kind === 'otp' ? getRideOtps : getTrip) as jest.Mock;
  let finish!: (value: any) => void;
  api.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  api.mockResolvedValueOnce({ id: 'B', pickup: { otp: null }, stops: [] });
  let value: any;
  function Capture({ id }: { id?: string }) {
    const otp = useRideOtps(kind === 'otp' ? id : undefined);
    const trip = useTripStatus(kind === 'trip' ? id : undefined);
    value = kind === 'otp' ? otp.otps : trip.trip;
    return null;
  }
  await act(async () => { renderer = TestRenderer.create(<Capture id="A" />); });
  await act(async () => { renderer.update(<Capture id="B" />); });
  expect(value?.id).toBe('B');
  await act(async () => { finish({ id: 'A', pickup: { otp: 'synthetic' } }); });
  expect(value?.id).toBe('B');
  await act(async () => { renderer.update(<Capture />); });
  expect(value).toBeUndefined();
});

it('hides a displayed OTP when the next request fails', async () => {
  (getRideOtps as jest.Mock).mockResolvedValueOnce({ pickup: { otp: 'synthetic' }, stops: [] }).mockRejectedValueOnce(new Error('unavailable'));
  let value!: ReturnType<typeof useRideOtps>;
  function Capture() { value = useRideOtps('A'); return null; }
  await act(async () => { renderer = TestRenderer.create(<Capture />); });
  expect(value.otps).toBeDefined();
  await act(async () => { value.refresh(); });
  expect(value.otps).toBeUndefined();
  expect(value.error).toBeDefined();
});


it('scopes chat cache by account and never reads the legacy conversation-only cache', async () => {
  const message = { id: 'm', text: 'Private A', sender: 'customer', timestamp: '', status: 'sent' } as const;
  await setCachedCustomerChat('conversation', [message]);
  await AsyncStorage.setItem('customer.chat.conversation', JSON.stringify([message]));
  mockUser = { uid: 'B' };
  expect(await getCachedCustomerChat('conversation')).toEqual([]);
  mockUser = { uid: 'A' };
  // Switching accounts irreversibly clears the previous account's RAM-only chat copy.
  expect(await getCachedCustomerChat('conversation')).toEqual([]);
  mockUser = null;
  expect(await getCachedCustomerChat('conversation')).toEqual([]);
});

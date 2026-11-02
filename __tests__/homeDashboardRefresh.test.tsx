import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { AppState } from 'react-native';
import { useHomeDashboard } from '../src/hooks/useHomeDashboard';
import { HomeDashboardService } from '../src/services/dashboard/HomeDashboardService';

let mockUser: { uid: string } | null = { uid: 'partner-a' };
let mockAuthListener: (user: typeof mockUser) => void;
jest.mock('@react-native-firebase/auth', () => ({
  getAuth: () => ({ currentUser: mockUser }),
  onAuthStateChanged: (_auth: unknown, listener: typeof mockAuthListener) => {
    mockAuthListener = listener; return () => {};
  },
}));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => (() => void)) => require('react').useEffect(callback, [callback]),
}));
let state: ReturnType<typeof useHomeDashboard>;
function Harness({ trip = '' }) { state = useHomeDashboard(trip); return null; }
let view: Renderer.ReactTestRenderer;
let wallet: jest.SpyInstance;
beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-11-01T12:00:00Z'));
  mockUser = { uid: 'partner-a' };
  wallet = jest.spyOn(HomeDashboardService.prototype, 'getWallet').mockResolvedValue({ balance: 0, currency: '₹', minimumBalance: null, isLowBalance: false });
  jest.spyOn(HomeDashboardService.prototype, 'getVehicles').mockRejectedValue(new Error('Vehicle network failure'));
});
afterEach(async () => {
  if (view) await act(() => view.unmount());
  jest.restoreAllMocks(); jest.useRealTimers();
});
const mount = async () => { await act(async () => { view = Renderer.create(<Harness />); }); };
test('independent resources preserve actual wallet zero when vehicle/daily data fail', async () => {
  await mount();
  expect(state.wallet.data?.balance).toBe(0);
  expect(state.vehicle.data).toBeNull(); expect(state.vehicle.error).toBe('Vehicle network failure');
  expect(state.today.data).toBeNull(); expect(state.today.error).toContain('unavailable');
});
test('trip completion transition refreshes the wallet and manual retry sees confirmed recharge balance', async () => {
  await mount();
  wallet.mockResolvedValue({ balance: 120, currency: '₹', minimumBalance: null, isLowBalance: false });
  await act(async () => { view.update(<Harness trip="trip:completed" />); });
  expect(wallet).toHaveBeenCalledTimes(2); expect(state.wallet.data?.balance).toBe(120);
  wallet.mockResolvedValue({ balance: 170, currency: '₹', minimumBalance: null, isLowBalance: false });
  await act(() => state.refresh());
  expect(state.wallet.data?.balance).toBe(170);
});
test('failed refresh removes earlier wallet value instead of presenting stale money as current', async () => {
  await mount(); wallet.mockRejectedValue(new Error('Wallet offline'));
  await act(() => state.refresh());
  expect(state.wallet.data).toBeNull(); expect(state.wallet.error).toBe('Wallet offline');
});
test('IST midnight refreshes without a frequent polling interval', async () => {
  await mount();
  await act(async () => { jest.advanceTimersByTime(6.5 * 60 * 60 * 1000); });
  expect(wallet).toHaveBeenCalledTimes(2);
});
test('resume refreshes the dashboard after a recharge or payment on another screen', async () => {
  const spy = jest.mocked(AppState.addEventListener);
  await mount();
  const listener = spy.mock.calls.filter(([event]) => event === 'change').slice(-1)[0][1];
  await act(async () => listener('active'));
  expect(wallet).toHaveBeenCalledTimes(2);
});
test('deduplicates simultaneous refreshes', async () => {
  await mount();
  let resolve!: (value: unknown) => void;
  wallet.mockImplementation(() => new Promise(done => { resolve = done; }));
  let first!: Promise<void>, second!: Promise<void>;
  await act(async () => { first = state.refresh(); second = state.refresh(); });
  expect(first).toBe(second);
  await act(async () => { resolve({ balance: 50, currency: '₹', minimumBalance: null, isLowBalance: false }); await first; });
  expect(state.wallet.data?.balance).toBe(50);
});
test('logout invalidates late financial responses', async () => {
  let resolve!: (value: unknown) => void;
  wallet.mockImplementation(() => new Promise(done => { resolve = done; }));
  await mount();
  await act(async () => { mockUser = null; mockAuthListener(null); });
  await act(async () => { resolve({ balance: 999, currency: '₹', minimumBalance: null, isLowBalance: false }); });
  expect(state.wallet.data).toBeNull(); expect(state.wallet.error).toContain('sign in');
});

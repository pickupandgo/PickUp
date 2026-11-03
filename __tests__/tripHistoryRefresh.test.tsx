import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { AppState, type AppStateStatus } from 'react-native';
import { useTripHistory } from '../src/hooks/useTripHistory';
import { tripHistoryEvents } from '../src/services/trip/tripHistoryEvents';
import { historyTrip, uid } from '../__fixtures__/tripHistory';
import type { TripHistorySource } from '../src/services/trip/TripHistoryService';
let mockFocused = true;
let mockUser: { uid: string } | null = { uid };
let mockAuthChange: (user: { uid: string } | null) => void;
let mockTripChange: (trip: { id: string; status: string; updatedAt: number } | null) => void;
let mockResume: (state: AppStateStatus) => void;
const mockSource: TripHistorySource = { list: jest.fn(async () => ({ items: [historyTrip()], counts: { all: 1, completed: 1, cancelled: 0 }, truncated: false })),
  get: jest.fn(async () => historyTrip()), enrich: jest.fn(async () => {}) };
jest.mock('../src/services/trip/TripService', () => ({ TripService: { getHistorySource: () => mockSource } }));
jest.mock('../src/services/trip/TripController', () => ({ TripController: { getInstance: () => ({ subscribe: (listener: typeof mockTripChange) => { mockTripChange = listener; listener(null); return jest.fn(); } }) } }));
jest.mock('@react-native-firebase/auth', () => ({ getAuth: () => ({ currentUser: mockUser }), onAuthStateChanged: (_auth: unknown, listener: typeof mockAuthChange) => { mockAuthChange = listener; return jest.fn(); } }));
jest.mock('@react-navigation/native', () => ({ useFocusEffect: (callback: () => void | (() => void)) => {
  const ReactModule = require('react');
  ReactModule.useEffect(() => { if (mockFocused) return callback(); }, [callback, mockFocused]);
} }));
let state: ReturnType<typeof useTripHistory>;
function Harness() { state = useTripHistory(); return null; }
let view: Renderer.ReactTestRenderer;
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks(); mockFocused = true; mockUser = { uid }; AppState.currentState = 'active';
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => { mockResume = listener; return { remove: jest.fn() }; });
});
afterEach(async () => { if (view) await act(() => view.unmount()); jest.restoreAllMocks(); jest.useRealTimers(); });
const mount = async () => { await act(async () => { view = Renderer.create(<Harness />); }); };
test('focus and return from details refresh; active polling stops on blur', async () => {
  await mount(); expect(mockSource.list).toHaveBeenCalledTimes(1);
  await act(async () => { jest.advanceTimersByTime(30_000); }); expect(mockSource.list).toHaveBeenCalledTimes(2);
  mockFocused = false; await act(() => view.update(<Harness />));
  await act(async () => { jest.advanceTimersByTime(90_000); }); expect(mockSource.list).toHaveBeenCalledTimes(2);
  mockFocused = true; await act(async () => view.update(<Harness />)); expect(mockSource.list).toHaveBeenCalledTimes(3);
});
test('foreground resume, confirmed trip transitions and validated push invalidations refresh history', async () => {
  await mount();
  await act(async () => { mockResume('active'); }); expect(mockSource.list).toHaveBeenCalledTimes(2);
  await act(async () => { mockTripChange({ id: 'actual-trip', status: 'completed', updatedAt: 10 }); }); expect(mockSource.list).toHaveBeenCalledTimes(3);
  await act(async () => { tripHistoryEvents.invalidate(); }); expect(mockSource.list).toHaveBeenCalledTimes(4);
});
test('account switch/logout clears records immediately and cannot show another account cache', async () => {
  await mount(); expect(state.items).toHaveLength(1);
  mockUser = null; await act(() => mockAuthChange(null));
  expect(state.items).toHaveLength(0); expect(state.counts).toBeNull(); expect(state.error).toMatch(/sign in/i);
});
test('backgrounding stops active refresh work and resuming reconciles again', async () => {
  await mount(); AppState.currentState = 'background'; await act(() => mockResume('background'));
  await act(async () => { jest.advanceTimersByTime(60_000); tripHistoryEvents.invalidate(); });
  expect(mockSource.list).toHaveBeenCalledTimes(1);
  AppState.currentState = 'active'; await act(async () => mockResume('active')); expect(mockSource.list).toHaveBeenCalledTimes(2);
});

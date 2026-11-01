import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { useVehiclePreview } from '../src/hooks/useVehiclePreview';
import { getVehiclePreview } from '../src/api/vehiclePreview';
jest.mock('../src/api/vehiclePreview', () => ({ PREVIEW_CATEGORIES: ['TWO_WHEELER', 'MINI_TRUCK'], getVehiclePreview: jest.fn() }));
jest.mock('@react-navigation/native', () => ({ useFocusEffect: (effect: any) => require('react').useEffect(effect, [effect]) }));
jest.mock('@react-native-firebase/auth', () => ({ getAuth: () => ({ currentUser: { uid: 'test' } }), onAuthStateChanged: (_auth: any, callback: any) => { callback({ uid: 'test' }); return jest.fn(); } }));
const fetchPreview = getVehiclePreview as jest.Mock;
let current: ReturnType<typeof useVehiclePreview>;
const pickup = { latitude: 26, longitude: 73 };
function Harness({ category, enabled = true }: { category: string; enabled?: boolean }) { current = useVehiclePreview(pickup, category, enabled); return null; }
const vehicle = (category: string, expiresAt: number) => ({ key: 'a'.repeat(20), latitude: 26.001, longitude: 73, vehicleCategory: category, capturedAt: Date.now(), expiresAt });
beforeEach(() => { jest.useFakeTimers(); fetchPreview.mockReset(); });
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });
it('clears the old category immediately and ignores its late response after switching', async () => {
  const pending: { resolve: (value: any) => void; signal: AbortSignal; category: string }[] = [];
  fetchPreview.mockImplementation((_point, category, signal) => new Promise(resolve => pending.push({ resolve, category, signal })));
  let renderer: ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<Harness category="TWO_WHEELER" />); });
  expect(pending[0].category).toBe('TWO_WHEELER');
  await act(async () => { renderer!.update(<Harness category="MINI_TRUCK" />); });
  expect(pending[0].signal.aborted).toBe(true);
  expect(current.vehicles).toEqual([]);
  await act(async () => { pending[0].resolve([vehicle('TWO_WHEELER', Date.now() + 5000)]); });
  expect(current.vehicles).toEqual([]);
  await act(async () => { pending[1].resolve([vehicle('MINI_TRUCK', Date.now() + 5000)]); });
  expect(current.vehicles[0].vehicleCategory).toBe('MINI_TRUCK');
  act(() => { renderer!.unmount(); });
  expect(pending[1].signal.aborted).toBe(true);
});
it('expires markers locally even while the next request never answers', async () => {
  fetchPreview.mockResolvedValueOnce([vehicle('TWO_WHEELER', Date.now() + 2000)]).mockImplementation(() => new Promise(() => {}));
  let renderer: ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<Harness category="TWO_WHEELER" />); });
  expect(current.vehicles).toHaveLength(1);
  act(() => { jest.advanceTimersByTime(3000); });
  expect(current.vehicles).toEqual([]);
  act(() => { renderer!.unmount(); });
});
it('does not invent preview markers on endpoint failure or unsupported category', async () => {
  fetchPreview.mockRejectedValue(new Error('Offline'));
  let renderer: ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<Harness category="TWO_WHEELER" />); });
  expect(current.status).toBe('error'); expect(current.vehicles).toEqual([]);
  await act(async () => { renderer!.update(<Harness category="CRANE" />); });
  expect(current.status).toBe('idle'); expect(current.vehicles).toEqual([]);
  act(() => { renderer!.unmount(); });
});

it('aborts and clears preview immediately when assignment disables searching', async () => {
  fetchPreview.mockResolvedValue([vehicle('MINI_TRUCK', Date.now() + 5000)]);
  let renderer: ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<Harness category="MINI_TRUCK" />); });
  expect(current.vehicles).toHaveLength(1);
  const signal = fetchPreview.mock.calls[0][2];
  await act(async () => { renderer!.update(<Harness category="MINI_TRUCK" enabled={false} />); });
  expect(signal.aborted).toBe(true); expect(current.vehicles).toEqual([]); expect(current.status).toBe('idle');
  act(() => renderer!.unmount());
});

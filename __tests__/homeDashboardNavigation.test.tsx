import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { DriverHomeScreen } from '../src/screens/home/DriverHomeScreen';
import { EarningsCard } from '../src/components/molecules/EarningsCard';
import { WalletCard } from '../src/components/molecules/WalletCard';
import { CurrentVehicleCard } from '../src/components/molecules/CurrentVehicleCard';
import { StyleSheet, Text } from 'react-native';
import { mockActiveTrip } from '../src/data/mockData';
import type { TripResource } from '../src/services/trip/TripController';
import { GoLiveSheet } from '../src/components/organisms/GoLiveSheet';
import { EngineApiError } from '../src/services/engine/engineClient';


let mockRecovery: TripResource = { sessionUid: 'fixture-driver', trip: null, status: 'ready', error: null };
const mockDispatch = jest.fn((_config: unknown) => ({ resume: jest.fn() }));
const mockAvailability = jest.fn(async (_id: string, _available: boolean) => {});
const mockNativePermission = jest.fn(async () => 'granted');
const mockNativeProvider = jest.fn(async () => true);
let mockOnline = false;
const mockOnlineListeners = new Set<() => void>();
const mockTrackingOnline = jest.fn(async (_value: boolean) => {});
beforeEach(() => {
  mockAvailability.mockReset().mockResolvedValue(undefined);
  mockNativePermission.mockReset().mockResolvedValue('granted');
  mockNativeProvider.mockReset().mockResolvedValue(true);
  mockOnline = false; mockOnlineListeners.clear();
  mockTrackingOnline.mockReset().mockImplementation(async value => {
    await mockAvailability('fixture-driver', value);
    mockOnline = value; mockOnlineListeners.forEach(listener => listener());
  });
});
jest.mock('../src/services/engine/dispatch', () => ({ getCurrentDriverId: () => 'fixture-driver', setDriverAvailability: (...args: [string, boolean]) => mockAvailability(...args) }));
jest.mock('../src/location/LocationService', () => ({ LocationService: {
  getPermissionStatus: () => mockNativePermission(), isProviderEnabled: () => mockNativeProvider(),
} }));
jest.mock('../src/services/tracking/TrackingService', () => ({ TrackingService: { getInstance: () => ({ setOnline: mockTrackingOnline, getOnline: () => mockOnline, subscribeOnline: (listener: () => void) => { mockOnlineListeners.add(listener); return () => { mockOnlineListeners.delete(listener); }; } }) } }));
afterEach(() => {
  mockRecovery = { sessionUid: 'fixture-driver', trip: null, status: 'ready', error: null };
  mockDispatch.mockClear();
});

let mockWidth = 390;
let mockFontScale = 1;
jest.mock('react-native', () => Object.defineProperties({}, {
  ...Object.getOwnPropertyDescriptors(jest.requireActual('react-native')),
  useWindowDimensions: { value: () => ({ width: mockWidth, height: 852, scale: 1, fontScale: mockFontScale }) },
}));

jest.mock('../src/components/atoms/Icon', () => 'Icon');
jest.mock('../src/components/molecules/EarningsCard', () => ({ EarningsCard: () => null }));
jest.mock('../src/components/molecules/WalletCard', () => ({ WalletCard: () => null }));
jest.mock('../src/components/molecules/CurrentVehicleCard', () => ({ CurrentVehicleCard: () => null }));
jest.mock('../src/components/molecules/CollectPaymentBanner', () => ({ CollectPaymentBanner: () => null }));
jest.mock('../src/location', () => ({ useDriverLocation: () => ({ requestPermission: jest.fn(), currentLocation: null }) }));
jest.mock('../src/hooks/useActiveTrip', () => ({ useActiveTrip: () => mockRecovery.trip, useTripResource: () => mockRecovery }));
jest.mock('../src/hooks/useIncomingDriverDispatch', () => ({ useIncomingDriverDispatch: (config: unknown) => mockDispatch(config) }));
jest.mock('../src/hooks/useConnectionHealth', () => ({ useConnectionHealth: () => 'CONNECTED' }));
jest.mock('../src/services/trip/incomingOfferRuntime', () => { const state = { error: null }; return { incomingOffers: { subscribe: () => () => {}, getSnapshot: () => state, refresh: jest.fn() } }; });
jest.mock('../src/hooks/useCollectableTrips', () => ({ useCollectableTrips: () => [] }));
jest.mock('../src/hooks/useHomeDashboard', () => ({ useHomeDashboard: () => ({
  vehicle: { data: null, loading: false, error: null }, today: { data: null, loading: false, error: 'unavailable' },
  wallet: { data: null, loading: false, error: 'unavailable' }, refresh: jest.fn(async () => {}),
}) }));
jest.mock('../src/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
jest.mock('@react-navigation/native', () => ({ useFocusEffect: () => {} }));

test('home actions navigate to the existing earnings, recharge and vehicle registration routes', async () => {
  const navigate = jest.fn();
  const navigation = { navigate: jest.fn(), getParent: () => ({ navigate }) };
  let view!: Renderer.ReactTestRenderer;
  await act(() => { view = Renderer.create(<DriverHomeScreen navigation={navigation as unknown as React.ComponentProps<typeof DriverHomeScreen>['navigation']} />); });
  await act(() => {
    view.root.findByType(EarningsCard).props.onDetailsPress();
    view.root.findByType(WalletCard).props.onRechargePress();
    view.root.findByType(CurrentVehicleCard).props.onManage();
  });
  expect(navigate.mock.calls).toEqual([
    ['EarningsTab', { screen: 'EarningsHistory' }],
    ['WalletTab', { screen: 'Recharge', initial: false }],
    ['AccountTab', { screen: 'VehicleStatus' }],
  ]);
  expect(view.root.findByType(EarningsCard).props.amount).toBeNull();
  expect(view.root.findByType(WalletCard).props.balance).toBeNull();
  await act(() => view.unmount());
});

test('a recovered active trip is resumable without Go Live and cannot start offer polling', async () => {
  mockRecovery = { ...mockRecovery, trip: mockActiveTrip };
  const navigation = { navigate: jest.fn(), getParent: jest.fn() };
  let view!: Renderer.ReactTestRenderer;
  await act(() => { view = Renderer.create(<DriverHomeScreen navigation={navigation as any} />); });
  const resume = view.root.findAll(node => node.props.accessibilityRole === 'button' &&
    node.findAll(child => child.type === Text && child.props.children === 'home.openTrip').length > 0)[0];
  expect(resume).toBeDefined();
  await act(() => resume.props.onPress());
  expect(navigation.navigate).toHaveBeenCalledWith('ActiveTrip', { tripId: mockActiveTrip.id });
  expect(mockDispatch).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
  await act(() => view.unmount());
});
test.each([[320, 1, 'row'], [390, 1, 'row'], [800, 1, 'row'], [390, 1.5, 'row']])(
  'dashboard adapts at width %i and font scale %f', async (width, fontScale, direction) => {
    mockWidth = Number(width); mockFontScale = Number(fontScale);
    let view!: Renderer.ReactTestRenderer;
    await act(() => { view = Renderer.create(<DriverHomeScreen navigation={{ getParent: () => ({ navigate: jest.fn() }) } as unknown as React.ComponentProps<typeof DriverHomeScreen>['navigation']} />); });
    const row = view.root.findByType(EarningsCard).parent!;
    expect(StyleSheet.flatten(row.props.style).flexDirection).toBe(direction);
    expect(StyleSheet.flatten(row.props.style).alignItems).toBe('stretch');
    await act(() => view.unmount());
  },
);

test('Home bell opens the shared Notifications route and never Settings', async () => {
  const navigate = jest.fn();
  let view!: Renderer.ReactTestRenderer;
  await act(() => { view = Renderer.create(<DriverHomeScreen navigation={{ navigate, getParent: () => ({ navigate: jest.fn() }) } as never} />); });
  await act(() => view.root.findAll(node => node.props.accessibilityLabel === 'Notifications' && typeof node.props.onPress === 'function')[0].props.onPress());
  expect(navigate.mock.calls).toEqual([['Notifications']]);
  await act(() => view.unmount());
});

jest.setTimeout(30_000);

const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const openLive = async () => {
  let view!: Renderer.ReactTestRenderer;
  await act(async () => { view = Renderer.create(<DriverHomeScreen navigation={{ navigate: jest.fn() } as never} />); await flush(); });
  await act(async () => { await flush(); });
  const toggle = view.root.findAll(node => node.props.testID === 'home-availability-toggle' &&
    typeof node.props.onPress === 'function')[0];
  await act(async () => toggle.props.onPress());
  return view;
};

test('Home waits for the Go Live acknowledgement and ignores repeat confirmation', async () => {
  const view = await openLive();
  let resolve!: () => void;
  mockAvailability.mockImplementation(async (_id, available) => {
    if (available) await new Promise<void>(yes => { resolve = yes; });
  });
  await act(async () => { const confirm = view.root.findByType(GoLiveSheet).props.onContinue; confirm(); confirm(); await flush(); });
  expect(mockAvailability.mock.calls.filter(call => call[1])).toHaveLength(1);
  expect(mockDispatch).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
  await act(async () => { resolve(); await flush(); });
  expect(mockDispatch).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true }));
  await act(async () => view.unmount());
});

test('denied native location permission never advertises Online', async () => {
  const view = await openLive(); mockNativePermission.mockResolvedValue('denied');
  await act(async () => { view.root.findByType(GoLiveSheet).props.onContinue(); await flush(); });
  expect(mockAvailability.mock.calls.some(call => call[1])).toBe(false);
  expect(mockTrackingOnline).not.toHaveBeenCalledWith(true);
  expect(mockDispatch).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
  await act(async () => view.unmount());
});

test('an unanswered Go Live write stays Unconfirmed and stops advertising', async () => {
  const view = await openLive();
  mockAvailability.mockRejectedValue(new EngineApiError('TIMEOUT', 'Timed out', 0));
  await act(async () => { view.root.findByType(GoLiveSheet).props.onContinue(); await flush(); });
  expect(view.root.findAllByType(Text).some(node => node.props.children === 'Unconfirmed')).toBe(true);
  expect(mockDispatch).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
  expect(mockOnline).toBe(false);
  await act(async () => view.unmount());
});

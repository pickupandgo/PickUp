import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { DriverHomeScreen } from '../src/screens/home/DriverHomeScreen';
import { EarningsCard } from '../src/components/molecules/EarningsCard';
import { WalletCard } from '../src/components/molecules/WalletCard';
import { CurrentVehicleCard } from '../src/components/molecules/CurrentVehicleCard';
import { StyleSheet } from 'react-native';

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
jest.mock('../src/hooks/useActiveTrip', () => ({ useActiveTrip: () => null }));
jest.mock('../src/hooks/useDriverDispatch', () => ({ useDriverDispatch: () => ({ resume: jest.fn() }) }));
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

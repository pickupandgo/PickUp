import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { ActiveTripScreen } from '../src/screens/trip/ActiveTripScreen';
import { NavigationScreen } from '../src/screens/trip/NavigationScreen';
import { MultiStopJourneyScreen } from '../src/screens/trip/MultiStopJourneyScreen';
import { ArrivedAtPickupScreen } from '../src/screens/trip/ArrivedAtPickupScreen';
import { TripMapSheet } from '../src/components/organisms/TripMapSheet';
import { mockActiveTrip } from '../src/data/mockData';
const mockTrip = {
  ...mockActiveTrip,
  engineStatus: 'DRIVER_ASSIGNED',
  paymentTripId: 'payment-trip',
  currentStopIndex: 0,
};
const mockRetry = jest.fn();
jest.mock('../src/hooks/useActiveTrip', () => ({
  useLiveTrip: () => mockTrip,
}));
jest.mock('../src/hooks/useArrivalDetection', () => ({
  useArrivalDetection: () => {},
}));
jest.mock('../src/hooks/useCollectableTrips', () => ({
  useCollectableTrips: () => [],
}));
jest.mock('../src/hooks/usePaymentGate', () => ({
  usePaymentGate: () => ({
    view: { kind: 'mock' },
    gate: null,
    refresh: jest.fn(),
  }),
}));
jest.mock('../src/hooks/useTripRoute', () => ({
  useTripRoute: () => ({
    route: null,
    error: { code: 'PROVIDER_ERROR', message: 'Route service unavailable' },
    retry: mockRetry,
  }),
}));
jest.mock('../src/location', () => ({
  useDriverLocation: () => ({
    currentLocation: { latitude: 26.2, longitude: 73.02, bearing: 30 },
    permissionState: 'granted',
    providerEnabled: true,
    error: null,
  }),
}));
jest.mock('../src/map', () => ({ DriverMap: 'DriverMap' }));
jest.mock('../src/components/atoms/Icon', () => 'Icon');
jest.mock('../src/components/notifications/ChatUnreadBadge', () => ({
  ChatUnreadBadge: () => null,
}));
jest.mock('../src/components/molecules/CollectPaymentBanner', () => ({
  CollectPaymentBanner: () => null,
}));
jest.mock('../src/i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
const render = async (Screen: any) => {
  const navigation = {
    navigate: jest.fn(),
    goBack: jest.fn(),
    popToTop: jest.fn(),
  };
  let view!: Renderer.ReactTestRenderer;
  await act(async () => {
    view = Renderer.create(
      <Screen
        navigation={navigation}
        route={{
          params: { tripId: mockTrip.id, stopId: mockTrip.stops[0].id },
        }}
      />,
    );
  });
  return { view, navigation };
};
test.each([
  ActiveTripScreen,
  NavigationScreen,
  MultiStopJourneyScreen,
  ArrivedAtPickupScreen,
])(
  'trip map screen passes actual overlay heights to the camera',
  async Screen => {
    const { view } = await render(Screen);
    await act(async () =>
      view.root.findByType(TripMapSheet).props.onHeightChange(280),
    );
    const map = view.root.findByType('DriverMap' as any);
    expect(map.props.viewportPadding.bottom).toBe(280);
    expect(map.props.cameraScopeKey).toBe(mockTrip.id);
    expect(map.props.showControls).toBe(true);
    expect(map.props.heading).toBe(30);
    expect(
      view.root
        .findAllByType(Text)
        .some(node => node.props.children === 'On Time'),
    ).toBe(false);
    await act(async () => view.unmount());
  },
);
test('Navigation exposes real Chat, disables unsupported Call, and retries routing without blocking the map', async () => {
  const { view, navigation } = await render(NavigationScreen);
  const call = view.root.findAll(
    node => node.props.accessibilityLabel === 'Calling unavailable',
  )[0];
  expect(call.props.disabled).toBe(true);
  expect(call.props.onPress).toBeUndefined();
  const chat = view.root.findAll(
    node => node.props.accessibilityLabel === 'Chat',
  )[0];
  await act(async () => chat.props.onPress());
  expect(navigation.navigate).toHaveBeenCalledWith('ActiveTripChat', {
    tripId: mockTrip.id,
    paymentTripId: 'payment-trip',
  });
  const retry = view.root.findAll(
    node =>
      typeof node.props.onPress === 'function' &&
      node
        .findAllByType(Text)
        .some(child => child.props.children === 'RETRY ROUTE'),
  )[0];
  await act(async () => retry.props.onPress());
  expect(mockRetry).toHaveBeenCalledTimes(1);
  expect(view.root.findAllByType('DriverMap' as any)).toHaveLength(1);
  await act(async () => view.unmount());
});

import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Pressable, StyleSheet, Text } from 'react-native';
import { TripOfferSheet } from '../src/components/organisms/TripOfferSheet';
import { IncomingTripOffer } from '../src/components/trips/IncomingTripOffer';
import type { TripOffer } from '../src/types/trip';

jest.mock('../src/components/atoms/Icon', () => 'Icon');
let mockDimensions = { width: 390, height: 844, scale: 1, fontScale: 1 };
jest.mock('react-native', () => Object.defineProperties({}, { ...Object.getOwnPropertyDescriptors(jest.requireActual('react-native')),
  Pressable: { value: 'Pressable' }, useWindowDimensions: { value: () => mockDimensions } }));
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));
jest.mock('../src/location', () => ({ useDriverLocation: () => ({ currentLocation: null }) }));
const mockSubscribe = new Set<() => void>();
const mockRespond = jest.fn();
let mockSnapshot: { offer: TripOffer | null; collapsed: boolean; busy: boolean; error: string | null };
jest.mock('../src/services/trip/incomingOfferRuntime', () => ({ incomingOffers: {
  subscribe: (fn: () => void) => { mockSubscribe.add(fn); return () => mockSubscribe.delete(fn); },
  getSnapshot: () => mockSnapshot, expire: jest.fn(), collapse: jest.fn(),
  respond: (...args: unknown[]) => mockRespond(...args),
} }));
const offer: TripOffer = {
  id: 'ride', estimatedEarning: 99999, currency: '₹', loadType: 'other', vehicleType: 'MINI_TRUCK', weightKg: 10,
  expiresAt: 130000, totalDistanceKm: 999,
  pickupStop: { id: 'p', type: 'pickup', label: 'Pickup', address: 'A long pickup address, Jodhpur', latitude: 26.29, longitude: 73.02, status: 'current' },
  dropStops: [{ id: 'd', type: 'drop', label: 'Drop', address: 'Destination, Jodhpur', latitude: 26.3, longitude: 73.03, status: 'pending' }],
};
let view: Renderer.ReactTestRenderer;
const text = () => view.root.findAllByType(Text).map(node => node.props.children).flat(Infinity).join(' ');
beforeEach(() => {
  jest.useFakeTimers(); jest.spyOn(Date, 'now').mockReturnValue(100000);
  mockSnapshot = { offer: null, collapsed: false, busy: false, error: null }; mockRespond.mockReset(); mockNavigate.mockReset();
});
afterEach(async () => { if (view) await act(() => view.unmount()); jest.restoreAllMocks(); jest.useRealTimers(); });
test('renders two truthful distances, real cargo, expiry and unavailable Partner amount', async () => {
  await act(() => { view = Renderer.create(<TripOfferSheet offer={offer} now={100000} onAccept={jest.fn()} onDecline={jest.fn()} />); });
  expect(text()).toContain('30s remaining'); expect(text()).toContain('Not supplied');
  expect(text()).not.toContain('99999'); expect(text()).not.toContain('999 km');
  expect(text()).toContain('Pickup road distance unavailable'); expect(text()).toContain('Delivery road distance unavailable');
  expect(text()).not.toContain('Straight-line'); expect(text()).toContain('10 kg');
  for (const label of ['Accept', 'Decline']) {
    const button = view.root.findAllByType(Pressable).find(node => node.findAllByType(Text).some(child => child.props.children === label))!;
    expect(StyleSheet.flatten(button.props.style).minHeight).toBeGreaterThanOrEqual(48);
  }
}, 15000); // Cold-loading React Native host components on Windows can exceed five seconds.
test('collapsed request stays accessible and expiry/busy disable both actions', async () => {
  const collapse = jest.fn();
  await act(() => { view = Renderer.create(<TripOfferSheet offer={offer} now={100000} collapsed onCollapse={collapse} onAccept={jest.fn()} onDecline={jest.fn()} />); });
  expect(text()).toContain('NEW TRIP REQUEST'); expect(text()).not.toContain('Not supplied');
  await act(() => view.root.findByType(Pressable).props.onPress()); expect(collapse).toHaveBeenCalled();
  await act(() => view.update(<TripOfferSheet offer={offer} now={140000} onAccept={jest.fn()} onDecline={jest.fn()} />));
  const actions = view.root.findAllByType(Pressable).filter(node => node.props.accessibilityState?.disabled === true);
  expect(actions).toHaveLength(2);
});
test('new offer does not navigate; only explicit confirmed Accept opens ActiveTrip once', async () => {
  const onHeight = jest.fn();
  await act(() => { view = Renderer.create(<IncomingTripOffer onHeight={onHeight} />); });
  expect(mockNavigate).not.toHaveBeenCalled();
  mockSnapshot = { ...mockSnapshot, offer };
  await act(() => { mockSubscribe.forEach(fn => fn()); });
  expect(mockNavigate).not.toHaveBeenCalled();
  mockRespond.mockResolvedValue({ id: 'trip' });
  await act(async () => {
    const card = view.root.findByType(TripOfferSheet);
    card.props.onAccept(); card.props.onAccept();
    await Promise.resolve();
  });
  expect(mockRespond).toHaveBeenCalledTimes(1);
  expect(mockNavigate.mock.calls).toEqual([['Main', { screen: 'HomeTab', params: { screen: 'ActiveTrip', params: { tripId: 'trip' } } }]]);
});
test('decline/refused or unknown acceptance never navigates', async () => {
  mockSnapshot = { ...mockSnapshot, offer }; mockRespond.mockResolvedValue(null);
  await act(() => { view = Renderer.create(<IncomingTripOffer onHeight={jest.fn()} />); });
  await act(async () => { view.root.findByType(TripOfferSheet).props.onAccept(); await Promise.resolve(); });
  await act(async () => { view.root.findByType(TripOfferSheet).props.onDecline(); await Promise.resolve(); });
  expect(mockNavigate).not.toHaveBeenCalled();
});

test.each([[320, 640, 1], [390, 844, 2], [800, 1280, 1], [844, 390, 1.5]])(
  'offer container fits %i x %i at font scale %f without covering the tab row', async (width, height, fontScale) => {
    mockDimensions = { width, height, fontScale, scale: 1 };
    mockSnapshot = { ...mockSnapshot, offer };
    const onHeight = jest.fn();
    await act(() => { view = Renderer.create(<IncomingTripOffer onHeight={onHeight} />); });
    const host = view.root.find(node => node.props.pointerEvents === 'box-none');
    const style = StyleSheet.flatten(host.props.style);
    expect(style.bottom).toBeGreaterThanOrEqual(56);
    expect(style.maxHeight).toBeLessThan(height - 56);
    host.props.onLayout({ nativeEvent: { layout: { height: 240 } } });
    expect(onHeight).toHaveBeenLastCalledWith(240);
  },
);

import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { BookingProvider, useBooking } from '../src/state/BookingContext';
import { createFareQuote } from '../src/api/payments';
import { TextInput } from 'react-native';
import ReceiverDetailsScreen from '../src/screens/logistics/ReceiverDetailsScreen';
import GoodsInsuranceScreen from '../src/screens/logistics/GoodsInsuranceScreen';
import Button from '../src/components/atoms/Button';
import ReviewBookingScreen from '../src/screens/booking/ReviewBookingScreen';
import { useQuoteValidity } from '../src/hooks/useQuoteValidity';
import { quoteMatchesDraft } from '../src/state/quoteValidation';
import type { FareQuote } from '../src/api/types';

jest.mock('@react-native-firebase/auth', () => ({ getAuth: () => ({ currentUser: { uid: 'A' } }), onAuthStateChanged: () => jest.fn() }));
jest.mock('../src/api/payments', () => ({ ...jest.requireActual('../src/api/payments'), createFareQuote: jest.fn() }));
const quote = (latitude = 3): FareQuote => ({ quoteId: 'q', vehicleCategory: 'MINI_TRUCK', weightKg: 10,
  pickup: { latitude: 1, longitude: 2 }, drops: [{ sequence: 1, latitude, longitude: 4, distanceMeters: 100, farePaise: 100, taxPaise: 0, payablePaise: 100 }],
  distanceMeters: 100, farePaise: 100, taxPaise: 0, payablePaise: 100, currency: 'INR', redeemed: false,
  expiresAt: new Date(Date.now() + 60_000).toISOString(), createdAt: new Date().toISOString() });
let renderer: ReactTestRenderer;
let mockNoDrivers = false;
const mockLeaveResult = jest.fn(), mockRetrySearch = jest.fn();
beforeEach(() => { mockNoDrivers = false; mockLeaveResult.mockClear(); mockRetrySearch.mockClear(); });
afterEach(() => { if (renderer) act(() => renderer.unmount()); jest.useRealTimers(); });

it('discards old quote responses after a same-count drop change', async () => {
  let state!: ReturnType<typeof useBooking>;
  const finish: Array<(value: FareQuote) => void> = [];
  (createFareQuote as jest.Mock).mockImplementation(() => new Promise(resolve => finish.push(resolve)));
  function Capture() { state = useBooking(); return <ReviewBookingScreen />; }
  await act(async () => { renderer = TestRenderer.create(<BookingProvider><Capture /></BookingProvider>); });
  await act(async () => {
    state.setPickup({ latitude: 1, longitude: 2, address: 'Pickup' });
    state.addDrop({ latitude: 3, longitude: 4, address: 'Drop A' });
    state.setVehicleType('Mini Truck / Tata Ace'); state.setGoods({ weightKg: 10 });
  });
  await act(async () => { state.replaceDrop(0, { latitude: 5, longitude: 4, address: 'Drop B' }); });
  expect(finish).toHaveLength(2);
  await act(async () => { finish[1](quote(5)); });
  expect(state.draft.quote?.drops[0].latitude).toBe(5);
  await act(async () => { finish[0](quote(3)); });
  expect(state.draft.quote?.drops[0].latitude).toBe(5);
  act(() => state.setQuote(quote(3)));
  expect(state.draft.quote?.drops[0].latitude).toBe(5);
});

it('invalidates the quote UI at expiry without another user action', async () => {
  jest.useFakeTimers();
  const item = quote();
  let valid = false;
  function Capture() { valid = useQuoteValidity(item); return null; }
  act(() => { renderer = TestRenderer.create(<Capture />); });
  expect(valid).toBe(true);
  await act(async () => { await jest.advanceTimersByTimeAsync(60_001); });
  expect(valid).toBe(false);
});

it('rejects reordered route, weight and vehicle mismatches', () => {
  const draft = { pickup: { latitude: 1, longitude: 2, address: '' }, drops: [{ latitude: 3, longitude: 4, address: '' }], vehicleType: 'Mini Truck / Tata Ace', weightKg: 10 };
  expect(quoteMatchesDraft(quote(), draft)).toBe(true);
  expect(quoteMatchesDraft(quote(), { ...draft, weightKg: 11 })).toBe(false);
  expect(quoteMatchesDraft(quote(), { ...draft, vehicleType: 'Pickup / Bolero' })).toBe(false);
  expect(quoteMatchesDraft(quote(), { ...draft, drops: [] })).toBe(false);
});


it('starts one in-place search and does not restart booking on focus', async () => {
  const confirmStarted = jest.fn();
  let state!: ReturnType<typeof useBooking>;
  (createFareQuote as jest.Mock).mockResolvedValue(quote());
  let focus!: () => void;
  const navigation = { navigate: jest.fn(), addListener: (_: string, callback: () => void) => { focus = callback; return jest.fn(); } };
  function Capture() { state = useBooking(); return <ReviewBookingScreen navigation={navigation} onConfirm={confirmStarted} />; }
  await act(async () => { renderer = TestRenderer.create(<BookingProvider><Capture /></BookingProvider>); });
  act(() => {
    state.setPickup({ latitude: 1, longitude: 2, address: 'Pickup' });
    state.addDrop({ latitude: 3, longitude: 4, address: 'Drop' });
    state.setVehicleType('Mini Truck / Tata Ace'); state.setGoods({ weightKg: 10 });
  });
  await act(async () => { state.setQuote(quote()); });
  const confirm = renderer.root.findByType(Button).props.onPress as () => void;
  act(() => { confirm(); confirm(); });
  expect(confirmStarted).toHaveBeenCalledTimes(1);
  expect(navigation.navigate).not.toHaveBeenCalled();
  act(() => focus());
  expect(renderer.root.findByType(Button).props.label).toBe('Finding driver...');
  expect(renderer.root.findByType(Button).props.disabled).toBe(true);
  expect(confirmStarted).toHaveBeenCalledTimes(1);
});


it('saves receiver details to the intended drop before continuing', async () => {
  let state!: ReturnType<typeof useBooking>;
  const navigate = jest.fn();
  function Capture() { state = useBooking(); return state.draft.drops.length ? <ReceiverDetailsScreen dropNumber={2} navigation={{ navigate }} /> : null; }
  await act(async () => { renderer = TestRenderer.create(<BookingProvider><Capture /></BookingProvider>); });
  act(() => { state.addDrop({ latitude: 1, longitude: 2, address: 'First' }); state.addDrop({ latitude: 3, longitude: 4, address: 'Second' }); });
  const inputs = renderer.root.findAllByType(TextInput);
  act(() => {
    (inputs[0].props.onChangeText as (s: string) => void)('Receiver Two'); (inputs[1].props.onChangeText as (s: string) => void)('0000000000'); (inputs[2].props.onChangeText as (s: string) => void)('Second gate');
  });
  act(() => (renderer.root.findByType(Button).props.onPress as () => void)());
  expect(state.draft.drops[0].receiverName).toBeUndefined();
  expect(state.draft.drops[1]).toMatchObject({ receiverName: 'Receiver Two', receiverPhone: '0000000000', instructions: 'Second gate' });
  expect(navigate).toHaveBeenCalledTimes(1);
});

it('preserves a real declared value without inventing insurance coverage', async () => {
  let state!: ReturnType<typeof useBooking>;
  function Capture() { state = useBooking(); return state.draft.declaredValue ? <GoodsInsuranceScreen /> : null; }
  await act(async () => { renderer = TestRenderer.create(<BookingProvider><Capture /></BookingProvider>); });
  act(() => state.setGoods({ declaredValue: '50000' }));
  expect(renderer.root.findByType(TextInput).props.value).toBe('50000');
  expect((renderer.root as any).findAll((node: any) => node.props.accessibilityRole === 'checkbox')).toHaveLength(0);
  const button = (renderer.root as any).findAll((node: any) => node.props.accessibilityLabel === 'Continue' && typeof node.props.onPress === 'function')[0];
  act(() => button.props.onPress());
  expect(state.draft.declaredValue).toBe('50000');
  expect(state.draft.insured).toBe(false);
});

jest.mock('../src/api/engine', () => ({ ...jest.requireActual('../src/api/engine'), recoverRide: jest.fn(async () => null) }));

jest.mock('../src/hooks/useRoute', () => ({ useRoadRoute: () => ({ status: 'idle', retry: jest.fn() }) }));


it('merges route, fare and both payment choices without visiting old pages', async () => {
  (createFareQuote as jest.Mock).mockResolvedValue(quote());
  let state!: ReturnType<typeof useBooking>;
  const navigation = { navigate: jest.fn(), addListener: () => jest.fn() };
  function Capture() { state = useBooking(); return <ReviewBookingScreen navigation={navigation} />; }
  await act(async () => { renderer = TestRenderer.create(<BookingProvider><Capture /></BookingProvider>); });
  await act(async () => {
    state.setPickup({ latitude: 1, longitude: 2, address: 'Pickup' });
    state.addDrop({ latitude: 3, longitude: 4, address: 'Drop' });
    state.setVehicleType('Mini Truck / Tata Ace');
  });
  const press = (label: string) => (renderer.root as any).findAll((node: any) => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0].props.onPress();
  act(() => { press('UPI'); press('Pay at pickup'); });
  expect(state.draft.collectionPreference).toBe('UPI');
  expect(state.draft.paymentMethod).toBe('PAY_AT_PICKUP');
  expect(state.draft.quote?.quoteId).toBe('q');
  expect(navigation.navigate).not.toHaveBeenCalled();
  const texts = renderer.root.findAllByType(require('react-native').Text).map((node: any) => node.props.children);
  expect(texts).toContain('Total');
  expect(texts).toContain('\u20B91');
  expect(texts.some(value => typeof value === 'string' && /^\?\d/.test(value))).toBe(false);
  expect(renderer.root.findByType(Button).props.label).toBe('Book Mini Truck');
  act(() => (renderer.root.findByType(Button).props.onPress as () => void)());
  expect(navigation.navigate).not.toHaveBeenCalled();
  expect(renderer.root.findByType(Button).props.label).toBe('Finding driver...');
  expect(renderer.root.findAllByType(require('react-native').Text).some((node: any) => node.props.children === 'Payment method')).toBe(false);
});

it('disables merged booking at quote expiry and permits an explicit refresh', async () => {
  jest.useFakeTimers();
  (createFareQuote as jest.Mock).mockImplementation(async () => quote());
  let state!: ReturnType<typeof useBooking>;
  function Capture() { state = useBooking(); return <ReviewBookingScreen />; }
  await act(async () => { renderer = TestRenderer.create(<BookingProvider><Capture /></BookingProvider>); });
  await act(async () => {
    state.setPickup({ latitude: 1, longitude: 2, address: 'Pickup' });
    state.addDrop({ latitude: 3, longitude: 4, address: 'Drop' });
    state.setVehicleType('Mini Truck / Tata Ace');
  });
  expect(renderer.root.findByType(Button).props.disabled).toBe(false);
  await act(async () => { await jest.advanceTimersByTimeAsync(60_001); });
  expect(renderer.root.findByType(Button).props.disabled).toBe(true);
  const retry = (renderer.root as any).findAll((node: any) => node.props.accessibilityLabel === 'Refresh fare' && typeof node.props.onPress === 'function')[0];
  await act(async () => { retry.props.onPress(); });
  expect(renderer.root.findByType(Button).props.disabled).toBe(false);
});

jest.mock('../src/hooks/useBookingSearch', () => ({ useBookingSearch: () => ({ failure: undefined, noDrivers: mockNoDrivers, leaving: false, leave: mockLeaveResult, requestBack: jest.fn(), retry: mockRetrySearch }) }));

jest.mock('../src/hooks/useVehiclePreview', () => ({ useVehiclePreview: jest.fn((_point, category, enabled) => ({ vehicles: enabled ? [{ key: 'a'.repeat(20), vehicleCategory: category, latitude: 1.01, longitude: 2.01 }] : [], status: 'ready', refresh: jest.fn() })) }));

jest.mock('../src/components/map/MapCanvas', () => { const { View } = require('react-native'); return (props: any) => <View testID="review-route-map" {...props} />; });
it('shows selected-category preview only while searching and hides it immediately on assignment', async () => {
  (createFareQuote as jest.Mock).mockImplementation(async () => quote());
  let state!: ReturnType<typeof useBooking>;
  function Capture() { state = useBooking(); return <ReviewBookingScreen />; }
  await act(async () => { renderer = TestRenderer.create(<BookingProvider><Capture /></BookingProvider>); });
  await act(async () => { state.setPickup({ latitude: 1, longitude: 2, address: 'Pickup' }); state.addDrop({ latitude: 3, longitude: 4, address: 'Drop' }); state.setVehicleType('Mini Truck / Tata Ace'); });
  const map = () => (renderer.root as any).findByProps({ testID: 'review-route-map' });
  expect(map().props.markers).toHaveLength(2);
  expect(map().props.markers[1].stopNumber).toBe(1);
  act(() => (renderer.root.findByType(Button).props.onPress as () => void)());
  expect(map().props.markers).toHaveLength(3);
  expect(map().props.markers[2]).toMatchObject({ kind: 'nearby', vehicleType: 'MINI_TRUCK', preview: true });
  expect(map().props.fitRouteOnly).toBe(true);
  act(() => state.setRide({ id: 'assigned', status: 'ACCEPTED', vehicleType: 'MINI_TRUCK' }));
  expect(map().props.markers).toHaveLength(2);
});

it('renders no-driver result in the same map screen with three actions and no search/payment clutter', async () => {
  mockNoDrivers = true;
  await act(async () => { renderer = TestRenderer.create(<BookingProvider><ReviewBookingScreen route={{ params: { searchMode: true } }} /></BookingProvider>); });
  const texts = renderer.root.findAllByType(require('react-native').Text).map((node: any) => node.props.children);
  expect(texts).toContain('No driver found yet');
  expect(texts).not.toContain('Payment method'); expect(texts).not.toContain('Fare details'); expect(texts).not.toContain('High demand in your area.');
  expect((renderer.root as any).findAll((node: any) => node.props.accessibilityLabel === 'Searching for a driver')).toHaveLength(0);
  const buttons: any[] = renderer.root.findAllByType(Button);
  expect(buttons.map((button: any) => button.props.label)).toEqual(['Try again', 'Change vehicle']);
  act(() => { buttons[0].props.onPress(); buttons[1].props.onPress(); });
  expect(mockRetrySearch).toHaveBeenCalledTimes(1); expect(mockLeaveResult).toHaveBeenCalledWith('vehicle');
  const home = (renderer.root as any).findAll((node: any) => node.props.accessibilityLabel === 'Back to Home' && typeof node.props.onPress === 'function')[0];
  act(() => home.props.onPress());
  expect(mockLeaveResult).toHaveBeenCalledWith('home');
  expect((renderer.root as any).findByProps({ testID: 'review-route-map' })).toBeDefined();
});

it('shows server delivery/platform breakup and total while keeping surge hidden', async () => {
 (createFareQuote as jest.Mock).mockImplementation(async () => ({ ...quote(), deliveryFarePaise: 4818, customerPlatformFeePaise: 482, customerPlatformFeeBps: 1000, surgeChargePaise: 0, farePaise: 5300, payablePaise: 5300, drops: [{...quote().drops[0], farePaise: 5300, payablePaise: 5300}] }));
 let state!: ReturnType<typeof useBooking>;
 function Capture() { state=useBooking(); return <ReviewBookingScreen />; }
 await act(async () => { renderer=TestRenderer.create(<BookingProvider><Capture /></BookingProvider>); });
 await act(async () => { state.setPickup({latitude:1,longitude:2,address:'Pickup'}); state.addDrop({latitude:3,longitude:4,address:'Drop'}); state.setVehicleType('Mini Truck / Tata Ace'); });
 const texts=renderer.root.findAllByType(require('react-native').Text).map((node:any)=>Array.isArray(node.props.children)?node.props.children.join(''):node.props.children);
 expect(texts).toContain('Platform fee (10%)'); expect(texts).toContain('\u20B948.18'); expect(texts).toContain('\u20B94.82'); expect(texts).toContain('\u20B953.00');
 expect(texts.some(value=>typeof value==='string' && /surge/i.test(value))).toBe(false);
 expect(state.draft.quote?.payablePaise).toBe(5300);
});

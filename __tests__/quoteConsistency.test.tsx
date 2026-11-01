import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { BookingProvider, useBooking } from '../src/state/BookingContext';
import { createFareQuote } from '../src/api/payments';
import { TextInput } from 'react-native';
import ReceiverDetailsScreen from '../src/screens/logistics/ReceiverDetailsScreen';
import GoodsInsuranceScreen from '../src/screens/logistics/GoodsInsuranceScreen';
import Button from '../src/components/atoms/Button';
import ReviewBookingScreen from '../src/screens/booking/ReviewBookingScreen';
import FareEstimateScreen from '../src/screens/booking/FareEstimateScreen';
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
afterEach(() => { if (renderer) act(() => renderer.unmount()); jest.useRealTimers(); });

it('discards old quote responses after a same-count drop change', async () => {
  let state!: ReturnType<typeof useBooking>;
  const finish: Array<(value: FareQuote) => void> = [];
  (createFareQuote as jest.Mock).mockImplementation(() => new Promise(resolve => finish.push(resolve)));
  function Capture() { state = useBooking(); return <FareEstimateScreen />; }
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


it('prevents double confirm and enables review again when it regains focus', async () => {
  let state!: ReturnType<typeof useBooking>;
  let focus!: () => void;
  const navigation = { navigate: jest.fn(), addListener: (_: string, callback: () => void) => { focus = callback; return jest.fn(); } };
  function Capture() { state = useBooking(); return <ReviewBookingScreen navigation={navigation} />; }
  await act(async () => { renderer = TestRenderer.create(<BookingProvider><Capture /></BookingProvider>); });
  act(() => {
    state.setPickup({ latitude: 1, longitude: 2, address: 'Pickup' });
    state.addDrop({ latitude: 3, longitude: 4, address: 'Drop' });
    state.setVehicleType('Mini Truck / Tata Ace'); state.setGoods({ weightKg: 10 });
  });
  act(() => state.setQuote(quote()));
  const confirm = renderer.root.findByType(Button).props.onPress as () => void;
  act(() => { confirm(); confirm(); });
  expect(navigation.navigate).toHaveBeenCalledTimes(1);
  act(() => focus());
  act(() => (renderer.root.findByType(Button).props.onPress as () => void)());
  expect(navigation.navigate).toHaveBeenCalledTimes(2);
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

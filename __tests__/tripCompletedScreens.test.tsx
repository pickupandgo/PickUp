import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { ScrollView, BackHandler } from 'react-native';
import Screen from '../src/screens/support/TripCompletedScreen';
import { BookingContext } from '../src/state/BookingContext';
const trip: any = { id: 'trip-A', rideId: 'ride-A', driverId: 'driver-A', status: 'COMPLETED', paymentBookingId: 'pay-A', payablePaise: 87670, totalDistanceKm: 24.7, vehicleType: 'THREE_WHEELER', completedAt: '2026-11-02T07:07:00Z', pickup: { address: 'Pickup A' }, stops: [{ sequence: 1, status: 'DELIVERED', location: { address: 'Drop A' } }], metadata: { specialInstructions: 'Payment preference: Cash.' } };
const snapshot: any = { trip, ride: { id: 'ride-A', quoteId: 'quote-A' }, driver: { id: 'driver-A', name: 'Driver A' } };
let mockPayment: any;
jest.mock('../src/hooks/useBookingPayment', () => ({ useBookingPayment: jest.fn(() => mockPayment) }));
jest.mock('../src/hooks/useTripStatus', () => ({ useTripStatus: () => ({}) }));
jest.mock('../src/api/engine', () => ({ getRide: jest.fn(async () => undefined) }));
jest.mock('../src/api/payments', () => ({ getFareQuote: jest.fn(async () => ({ quoteId: 'quote-A', payablePaise: 87670, deliveryFarePaise: 79700, customerPlatformFeePaise: 7970, customerPlatformFeeBps: 1000, taxPaise: 0 })) }));
const render = async (overrides: any = {}, props: any = {}) => {
  let view: any; const context: any = { completedBooking: snapshot, draft: { drops: [] }, clearActiveRide: jest.fn(), setTrip: jest.fn(), ...overrides };
  await act(async () => { view = TestRenderer.create(<BookingContext.Provider value={context}><Screen {...props} /></BookingContext.Provider>); });
  return { view, context };
};
const text = (view: any) => JSON.stringify(view.toJSON());
beforeEach(() => { jest.clearAllMocks(); mockPayment = { booking: { bookingId: 'pay-A', farePaise: 87670, paymentMethod: 'PAY_AT_DELIVERY', paymentStatus: 'UNPAID', stops: [] }, refresh: jest.fn() }; });
it('renders one completed summary from the retired snapshot, without inventing paid state', async () => {
  const { view } = await render();
  for (const value of ['Delivered successfully', 'Pickup A', 'Drop A', 'Driver A', '24.7 km', '₹876.70', 'Cash at drop', 'Payment pending']) expect(text(view)).toContain(value);
  expect(text(view)).not.toContain('Ratings unavailable');
  act(() => view.unmount());
});
it('keeps Home footer outside scroll content and sends toolbar/hardware Back home', async () => {
  const dispatch = jest.fn(); const navigation = { getParent: () => ({ dispatch }) };
  const { view, context } = await render({}, { navigation });
  const scroll = view.root.findByType(ScrollView);
  expect(scroll.findAllByProps({ testID: 'completion-fixed-footer' })).toHaveLength(0);
  expect(view.root.findByProps({ testID: 'completion-fixed-footer' })).toBeDefined();
  act(() => view.root.findByProps({ accessibilityLabel: 'Return to Home' }).props.onPress());
  act(() => view.root.findByProps({ accessibilityLabel: 'Back to Home' }).props.onPress());
  const listener = (BackHandler.addEventListener as jest.Mock).mock.calls.find(call => call[0] === 'hardwareBackPress')[1];
  act(() => listener());
  expect(dispatch).toHaveBeenCalledTimes(3);
  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ payload: { index: 0, routes: [{ name: 'MainTabs' }] } }));
  expect(context.clearActiveRide).not.toHaveBeenCalled();
  act(() => view.unmount());
});
it('shows Paid only from payment backend, and loads frozen fee breakdown on tap', async () => {
  mockPayment.booking.paymentStatus = 'PAID';
  const { view } = await render();
  expect(text(view)).toContain('Paid');
  const fetch = require('../src/api/payments').getFareQuote;
  expect(fetch).not.toHaveBeenCalled();
  await act(async () => view.root.findByProps({ accessibilityLabel: 'View fare breakdown' }).props.onPress());
  expect(fetch).toHaveBeenCalledWith('quote-A', expect.anything());
  expect(text(view)).toContain('Platform fee'); expect(text(view)).toContain('₹79.70');
  act(() => view.unmount());
});
it('keeps an explicit historical trip isolated from a different active booking', async () => {
  const { view, context } = await render({ completedBooking: undefined, trip: { ...trip, id: 'trip-B', rideId: 'ride-B' }, ride: { id: 'ride-B', quoteId: 'quote-B' }, assignedDriver: { id: 'driver-B', name: 'Driver B' } }, { route: { params: { trip } } });
  expect(text(view)).not.toContain('Driver B');
  expect(require('../src/hooks/useBookingPayment').useBookingPayment).toHaveBeenCalledWith('pay-A');
  expect(context.clearActiveRide).not.toHaveBeenCalled();
  act(() => view.unmount());
});
it('does not show success before completion or when drops were undelivered', async () => {
  const partial = { ...trip, status: 'DELIVERED', stops: [{ sequence: 1, status: 'UNDELIVERED', location: { address: 'Drop A' } }] };
  const { view } = await render({}, { route: { params: { trip: partial } } });
  expect(text(view)).toContain('Finalizing trip'); expect(text(view)).toContain('Some delivery stops need attention.');
  expect(text(view)).not.toContain('Delivered successfully');
  act(() => view.unmount());
});

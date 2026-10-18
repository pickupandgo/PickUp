/**
 * Review H / I.11: any change to the route, vehicle or weight discards the quote, forcing a
 * fresh server quote before the customer can book.
 */
jest.mock('../src/config/env', () => ({
  env: { apiBaseUrl: 'https://engine.test', paymentsApiBaseUrl: 'https://pay.test', googleMapsApiKey: '' },
  hasApiConfig: () => true,
  hasPaymentsConfig: () => true,
  assertApiConfig: () => undefined,
}));
jest.mock('@react-native-firebase/auth', () => ({
  __esModule: true,
  getAuth: () => ({ currentUser: { uid: 'uid-1' } }),
  onAuthStateChanged: jest.fn(() => () => {}),
}));

import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { BookingProvider, useBooking } from '../src/state/BookingContext';
import type { FareQuote } from '../src/api/types';
import type { ResolvedPlace } from '../src/api/geocoding';

const place = (lat: number, lng: number, label: string): ResolvedPlace => ({
  latitude: lat,
  longitude: lng,
  address: label,
} as ResolvedPlace);

const QUOTE: FareQuote = {
  quoteId: 'q-1',
  vehicleCategory: 'MINI_TRUCK',
  weightKg: 10,
  pickup: { latitude: 26.29, longitude: 73.02 },
  distanceMeters: 4200,
  farePaise: 26000,
  taxPaise: 0,
  payablePaise: 26000,
  currency: 'INR',
  drops: [],
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
  redeemed: false,
  createdAt: new Date().toISOString(),
};

let api: ReturnType<typeof useBooking>;
const Capture: React.FC = () => {
  api = useBooking();
  return null;
};

const mount = () => {
  let renderer: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <BookingProvider>
        <Capture />
      </BookingProvider>,
    );
  });
  return () => act(() => renderer.unmount());
};

describe('booking quote invalidation', () => {
  it('discards the quote when the vehicle, weight or route changes', () => {
    const unmount = mount();

    const seed = () => {
      act(() => {
        api.setPickup(place(26.29, 73.02, 'Pickup'));
        api.addDrop(place(26.3, 73.03, 'Drop 1'));
        api.setVehicleType('Mini Truck / Tata Ace');
        api.setGoods({ weightKg: 10 });
      });
      act(() => api.setQuote(QUOTE));
      expect(api.draft.quote).toBeDefined();
    };

    // Vehicle change clears the quote.
    seed();
    act(() => api.setVehicleType('Pickup / Bolero'));
    expect(api.draft.quote).toBeUndefined();

    // Weight change clears the quote.
    seed();
    act(() => api.setGoods({ weightKg: 25 }));
    expect(api.draft.quote).toBeUndefined();

    // Adding a drop (route change) clears the quote.
    seed();
    act(() => api.addDrop(place(26.31, 73.04, 'Drop 2')));
    expect(api.draft.quote).toBeUndefined();

    // Removing a drop clears the quote.
    seed();
    act(() => api.removeDrop(0));
    expect(api.draft.quote).toBeUndefined();

    unmount();
  });

  it('keeps the payment method independent of a quote refresh', () => {
    const unmount = mount();
    act(() => {
      api.setPaymentMethod('PAY_AT_DELIVERY');
      api.setQuote(QUOTE);
    });
    act(() => api.setVehicleType('Mini Truck / Tata Ace'));
    // The quote is gone, but the chosen method stays.
    expect(api.draft.quote).toBeUndefined();
    expect(api.draft.paymentMethod).toBe('PAY_AT_DELIVERY');
    unmount();
  });

  it('exposes the signed-in uid as the customer id', () => {
    const unmount = mount();
    expect(api.customerId).toBe('uid-1');
    unmount();
  });
});

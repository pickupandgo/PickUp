import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { Text, Pressable } from 'react-native';
import TripCompletedScreen from '../src/screens/support/TripCompletedScreen';
import TripCompletedSummaryScreen from '../src/screens/support/TripCompletedSummaryScreen';
import { BookingContext } from '../src/state/BookingContext';
import type { Trip, Ride, NearbyDriver } from '../src/api/types';

jest.mock('../src/config/env', () => ({
  env: {
    apiBaseUrl: 'https://engine.test',
    paymentsApiBaseUrl: 'https://pay.test',
    googleMapsApiKey: 'mock-key',
  },
  hasApiConfig: () => true,
  hasPaymentsConfig: () => true,
  assertApiConfig: () => undefined,
}));

describe('TripCompleted screens with Real Data', () => {
  const mockRealTrip: Trip = {
    id: 'b7c89f01-2345-6789-abcd-ef0123456789',
    rideId: 'ride-real-999',
    customerId: 'cust-real-1',
    driverId: 'drv-real-1',
    externalRef: 'TRP-CUSTOM-99',
    status: 'COMPLETED',
    fare: 540,
    payablePaise: 54000,
    totalDistanceKm: 18.2,
    createdAt: '2026-10-28T04:00:00.000Z',
    updatedAt: '2026-10-28T05:15:00.000Z',
    completedAt: '2026-10-28T05:15:00.000Z',
    currentStopIndex: 1,
    paymentMethod: 'PAY_AT_DELIVERY',
    pickup: {
      latitude: 12.9716,
      longitude: 77.5946,
      address: 'Indiranagar Metro Station, 100ft Road',
    },
    drop: {
      latitude: 12.9279,
      longitude: 77.6271,
      address: 'Koramangala 4th Block, 80ft Road',
    },
    stops: [
      {
        id: 'stop-1',
        sequence: 1,
        status: 'DELIVERED',
        location: {
          latitude: 12.9279,
          longitude: 77.6271,
          address: 'Koramangala 4th Block, 80ft Road',
        },
      },
    ],
  };

  const mockRealDriver: NearbyDriver = {
    id: 'drv-real-1',
    name: 'Vikram Singh',
    vehicleType: 'TATA_ACE',
    distanceKm: 0.5,
    latitude: 12.9716,
    longitude: 77.5946,
    isAvailable: false,
    ...({ vehicleNumber: 'KA 05 MN 9876' } as any),
  };

  const createBookingContextValue = (overrides?: any) => ({
    customerId: 'cust-real-1',
    draft: {
      drops: [],
      paymentMethod: 'PAY_AT_DELIVERY' as const,
      vehicleType: 'TATA_ACE',
    },
    primaryDrop: undefined,
    canEstimate: false,
    setPickup: jest.fn(),
    setPendingDrop: jest.fn(),
    commitPendingDrop: jest.fn(),
    addDrop: jest.fn(),
    replaceDrop: jest.fn(),
    removeDrop: jest.fn(),
    setVehicleType: jest.fn(),
    setGoods: jest.fn(),
    setInsured: jest.fn(),
    setSender: jest.fn(),
    setReceiver: jest.fn(),
    setQuote: jest.fn(),
    setPaymentMethod: jest.fn(),
    resetDraft: jest.fn(),
    startNewBooking: jest.fn(),
    ride: undefined,
    trip: mockRealTrip,
    assignedDriver: mockRealDriver,
    setRide: jest.fn(),
    setTrip: jest.fn(),
    setAssignedDriver: jest.fn(),
    clearActiveRide: jest.fn(),
    ...overrides,
  });

  describe('TripCompletedScreen (Screenshot 2)', () => {
    it('renders real trip details from BookingContext instead of mock values', () => {
      const mockNav = { navigate: jest.fn(), replace: jest.fn(), goBack: jest.fn() };
      let renderer: ReactTestRenderer;

      act(() => {
        renderer = TestRenderer.create(
          <BookingContext.Provider value={createBookingContextValue()}>
            <TripCompletedScreen navigation={mockNav} />
          </BookingContext.Provider>
        );
      });

      const root = renderer!.root;
      const allTexts = root.findAllByType(Text).map((t: any) => t.props.children);

      // Verify real Trip ID
      expect(allTexts).toContain('TRP-CUSTOM-99');

      // Verify real Distance
      expect(allTexts).toContain('18.2 km');

      // Verify real Vehicle display name
      expect(allTexts).toContain('Mini Truck / Tata Ace');

      // Verify real Driver Name
      expect(allTexts).toContain('Vikram Singh');

      // Verify real Total Fare
      expect(allTexts).toContain('₹540');

      // Verify real Route Addresses
      expect(allTexts).toContain('Indiranagar Metro Station, 100ft Road');
      expect(allTexts).toContain('Koramangala 4th Block, 80ft Road');
    });

    it('navigates to TripCompletedSummaryScreen when Done is pressed', () => {
      const mockNav = { navigate: jest.fn(), replace: jest.fn(), goBack: jest.fn() };
      let renderer: ReactTestRenderer;

      act(() => {
        renderer = TestRenderer.create(
          <BookingContext.Provider value={createBookingContextValue()}>
            <TripCompletedScreen navigation={mockNav} />
          </BookingContext.Provider>
        );
      });

      const root = renderer!.root as any;
      const doneBtn = root.findByProps({ label: 'Done' });
      act(() => {
        doneBtn.props.onPress();
      });

      expect(mockNav.navigate).toHaveBeenCalledWith('TripCompletedSummaryScreen');
    });
  });

  describe('TripCompletedSummaryScreen (Screenshot 1)', () => {
    it('renders real stops timeline, vehicle info, and payment status', () => {
      const mockNav = { navigate: jest.fn(), replace: jest.fn(), goBack: jest.fn(), reset: jest.fn() };
      let renderer: ReactTestRenderer;

      act(() => {
        renderer = TestRenderer.create(
          <BookingContext.Provider value={createBookingContextValue()}>
            <TripCompletedSummaryScreen navigation={mockNav} />
          </BookingContext.Provider>
        );
      });

      const root = renderer!.root;
      const allTexts = root.findAllByType(Text).map((t: any) => t.props.children);

      // Verify real stops shortened in timeline
      expect(allTexts).toContain('Indiranagar Metro Station');
      expect(allTexts).toContain('Koramangala 4th Block');

      // Verify real vehicle + plate
      expect(allTexts).toContain('Mini Truck / Tata Ace | KA 05 MN 9876');

      // Verify real payment status with actual fare
      expect(allTexts).toContain('Paid • ₹540');
    });

    it('clears active ride and resets to MainTabs when BACK TO HOME is clicked', () => {
      const clearActiveRide = jest.fn();
      const mockNav = { navigate: jest.fn(), replace: jest.fn(), goBack: jest.fn(), reset: jest.fn() };
      let renderer: ReactTestRenderer;

      act(() => {
        renderer = TestRenderer.create(
          <BookingContext.Provider value={createBookingContextValue({ clearActiveRide })}>
            <TripCompletedSummaryScreen navigation={mockNav} />
          </BookingContext.Provider>
        );
      });

      const root = renderer!.root;
      const homeText = root.findAllByType(Text).find((t: any) => t.props.children === 'BACK TO HOME');
      expect(homeText).toBeDefined();

      // Find the closest ancestor Pressable
      let homePressable = (homeText as any)!.parent;
      while (homePressable && typeof homePressable.props.onPress !== 'function') {
        homePressable = homePressable.parent;
      }
      expect(homePressable).toBeDefined();

      act(() => {
        homePressable!.props.onPress();
      });

      expect(clearActiveRide).toHaveBeenCalledTimes(1);
      expect(mockNav.reset).toHaveBeenCalledWith({
        index: 0,
        routes: [{ name: 'MainTabs' }],
      });
    });
  });
});

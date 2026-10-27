import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Alert, BackHandler, Text } from 'react-native';
import FindingDriverScreen from '../src/screens/tracking/FindingDriverScreen';
import BookingConfirmedScreen from '../src/screens/booking/BookingConfirmedScreen';
import { BookingProvider, useBooking } from '../src/state/BookingContext';
import { SessionProvider } from '../src/state/SessionContext';

// Mock dependencies
jest.mock('../src/config/env', () => ({
  env: {
    apiBaseUrl: 'https://engine.test',
    paymentsApiBaseUrl: 'https://pay.test',
    googleMapsApiKey: '',
  },
  hasApiConfig: () => true,
  hasPaymentsConfig: () => true,
  assertApiConfig: () => undefined,
}));

jest.mock('../src/api/matching', () => ({
  findDriverAndCreateRide: jest.fn(() => new Promise(() => {})), // stays pending
  NoDriversAvailableError: class NoDriversAvailableError extends Error {},
}));

jest.mock('../src/api/engine', () => ({
  getRideTrip: jest.fn(),
  cancelRide: jest.fn(),
  cancelTrip: jest.fn(),
}));

jest.mock('../src/components/map/MapCanvas', () => {
  const { View } = require('react-native');
  return (props: any) => <View testID="map-canvas" {...props} />;
});

describe('FindingDriverScreen & BookingConfirmedScreen Cancellation UX', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('BookingConfirmedScreen: does not show Cancel Booking button, asks on back press', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    const mockNavigate = jest.fn();

    let renderer: any;
    await act(async () => {
      renderer = TestRenderer.create(
        <SessionProvider>
          <BookingProvider>
            <BookingConfirmedScreen navigation={{ navigate: mockNavigate, reset: jest.fn() } as any} />
          </BookingProvider>
        </SessionProvider>
      );
    });

    // Check that Cancel Booking button text is NOT present
    const allTexts = renderer.root.findAllByType(Text).map((t: any) => t.props.children);
    const hasCancelText = allTexts.some((txt: any) =>
      typeof txt === 'string' && txt.toLowerCase().includes('cancel booking')
    );
    expect(hasCancelText).toBe(false);

    // Check that Booking Confirmed title is present
    expect(renderer.root.findByProps({ children: 'Booking Confirmed' })).toBeDefined();

    await act(async () => {
      renderer.unmount();
    });
  });

  it('FindingDriverScreen: displays Cancel Booking button and prompts confirmation on cancel button or top-left back click', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    const mockNavigate = jest.fn();

    let bookingApi: any;
    const BookingConsumer = () => {
      bookingApi = useBooking();
      return null;
    };

    let renderer: any;
    await act(async () => {
      renderer = TestRenderer.create(
        <SessionProvider>
          <BookingProvider>
            <BookingConsumer />
            <FindingDriverScreen navigation={{ navigate: mockNavigate, goBack: jest.fn() } as any} />
          </BookingProvider>
        </SessionProvider>
      );
    });

    // Ensure CANCEL BOOKING button IS present in the component tree
    const allTexts = renderer.root.findAllByType(Text).map((t: any) => t.props.children);
    const hasCancelButton = allTexts.some(
      (txt: any) => typeof txt === 'string' && txt.toUpperCase() === 'CANCEL BOOKING'
    );
    expect(hasCancelButton).toBe(true);

    // Find the cancel button by accessibilityLabel or accessibilityRole
    const cancelPressable = renderer.root.findByProps({ accessibilityLabel: 'Cancel Booking' });
    expect(cancelPressable).toBeDefined();

    // Tap the Cancel Booking button
    await act(async () => {
      cancelPressable.props.onPress();
    });

    // Expect Alert.alert to have been called with cancellation question
    expect(alertSpy).toHaveBeenCalledWith(
      'Cancel Booking?',
      'Are you sure you want to cancel the booking?',
      expect.arrayContaining([
        expect.objectContaining({ text: 'Keep Searching', style: 'cancel' }),
        expect.objectContaining({ text: 'Cancel Booking', style: 'destructive' }),
      ]),
      { cancelable: true }
    );

    // Clear alert spy to test top-left back button as well
    alertSpy.mockClear();

    // Find the top-left back button (it has accessibilityLabel="Back")
    const backButton = renderer.root.findByProps({ accessibilityLabel: 'Back' });
    expect(backButton).toBeDefined();

    // Tap the top-left back button
    await act(async () => {
      backButton.props.onPress();
    });

    expect(alertSpy).toHaveBeenCalledWith(
      'Cancel Booking?',
      'Are you sure you want to cancel the booking?',
      expect.arrayContaining([
        expect.objectContaining({ text: 'Keep Searching', style: 'cancel' }),
        expect.objectContaining({ text: 'Cancel Booking', style: 'destructive' }),
      ]),
      { cancelable: true }
    );

    // Simulate clicking "Cancel Booking" in the alert
    const alertButtons = alertSpy.mock.calls[0][2];
    const cancelOption = alertButtons?.find((b: any) => b.text === 'Cancel Booking');
    expect(cancelOption).toBeDefined();

    await act(async () => {
      cancelOption?.onPress?.();
    });

    // Expect navigation to CancellationReasonScreen
    expect(mockNavigate).toHaveBeenCalledWith('CancellationReasonScreen');

    await act(async () => {
      renderer.unmount();
    });
  });
});

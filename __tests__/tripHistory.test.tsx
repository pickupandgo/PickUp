import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import TripHistoryScreen from '../src/screens/profile/TripHistoryScreen';
import * as engineApi from '../src/api/engine';
import type { Trip } from '../src/api/types';

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

const mockSampleTrip: Trip = {
  id: 'trip-101',
  rideId: 'ride-101',
  driverId: 'driver-1',
  customerId: 'cust-1',
  status: 'COMPLETED',
  fare: 350,
  weight: 25,
  pickup: {
    latitude: 26.2389,
    longitude: 73.0243,
    address: 'Clock Tower, Jodhpur',
  },
  drop: {
    latitude: 26.2626,
    longitude: 73.0046,
    address: 'Shastri Nagar, Jodhpur',
  },
  stops: [
    {
      id: 'stop-1',
      sequence: 1,
      location: {
        latitude: 26.2626,
        longitude: 73.0046,
        address: 'Shastri Nagar, Jodhpur',
      },
      status: 'DELIVERED',
    },
  ],
  currentStopIndex: 1,
  createdAt: '2026-10-21T10:00:00.000Z',
  updatedAt: '2026-10-21T10:45:00.000Z',
};

describe('TripHistoryScreen — Empty States & Lifecycle Handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // 1. Recent tab — no previous rides
  it('1. displays "No rides yet" and "Book a Ride" button when Recent tab has zero rides', async () => {
    jest.spyOn(engineApi, 'getCustomerHistory').mockResolvedValueOnce([]);

    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <TripHistoryScreen customerId="cust-test" />
      );
    });

    const root: any = renderer!.root;
    const emptyContainer = root.findByProps({ testID: 'empty-recent-state' });
    expect(emptyContainer).toBeTruthy();

    const textNodes = root.findAllByType('Text');
    const allText = textNodes.map((n: any) => n.props.children).flat().join(' ');

    expect(allText).toContain('No rides yet');
    expect(allText).toContain(
      'Your completed and previous rides will appear here once you start riding with MultipleRide.'
    );
    expect(allText).toContain('Book a Ride');
  });

  // 2. Scheduled tab — no scheduled rides
  it('2. displays "No scheduled rides" and "Schedule a Ride" button when Scheduled tab has zero rides', async () => {
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <TripHistoryScreen initialTrips={[]} initialTab="Scheduled" />
      );
    });

    const root: any = renderer!.root;
    const emptyContainer = root.findByProps({ testID: 'empty-scheduled-state' });
    expect(emptyContainer).toBeTruthy();

    const textNodes = root.findAllByType('Text');
    const allText = textNodes.map((n: any) => n.props.children).flat().join(' ');

    expect(allText).toContain('No scheduled rides');
    expect(allText).toContain(
      "You don't have any upcoming scheduled rides. Plan your next trip with MultipleRide."
    );
    expect(allText).toContain('Schedule a Ride');
  });

  // 3. Loading state displays loader rather than empty state
  it('3. displays a loader and does NOT display empty state while fetching trips', async () => {
    let resolvePromise: (value: Trip[]) => void;
    const pendingPromise = new Promise<Trip[]>((resolve) => {
      resolvePromise = resolve;
    });

    jest.spyOn(engineApi, 'getCustomerHistory').mockReturnValueOnce(pendingPromise);

    let renderer: ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <TripHistoryScreen customerId="cust-test" />
      );
    });

    const root: any = renderer!.root;
    const loader = root.findByProps({ testID: 'trip-history-loading' });
    expect(loader).toBeTruthy();

    // Must NOT show empty state while loading
    expect(root.findAllByProps({ testID: 'empty-recent-state' })).toHaveLength(0);
    expect(root.findAllByProps({ testID: 'empty-scheduled-state' })).toHaveLength(0);

    // Resolve promise and finish loading
    await act(async () => {
      resolvePromise!([]);
    });

    expect(root.findAllByProps({ testID: 'trip-history-loading' })).toHaveLength(0);
    expect(root.findByProps({ testID: 'empty-recent-state' })).toBeTruthy();
  });

  // 4. API failure displays error and retry action; never displays empty state
  it('4. displays error message and "Try Again" action upon API failure, never empty state', async () => {
    const errorSpy = jest
      .spyOn(engineApi, 'getCustomerHistory')
      .mockRejectedValueOnce(new Error('Network error: server unreachable'));

    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <TripHistoryScreen customerId="cust-test" />
      );
    });

    const root: any = renderer!.root;

    // Error view must be rendered
    const errorContainer = root.findByProps({ testID: 'trip-history-error' });
    expect(errorContainer).toBeTruthy();

    const textNodes = root.findAllByType('Text');
    const allText = textNodes.map((n: any) => n.props.children).flat().join(' ');
    expect(allText).toContain('Unable to load rides');
    expect(allText).toContain('Network error: server unreachable');
    expect(allText).toContain('Try Again');

    // Never show empty state on API failure
    expect(root.findAllByProps({ testID: 'empty-recent-state' })).toHaveLength(0);

    // Press Try Again and verify retry
    errorSpy.mockResolvedValueOnce([mockSampleTrip]);
    const tryAgainButton = root.findByProps({ accessibilityLabel: 'Try Again' });

    await act(async () => {
      tryAgainButton.props.onPress();
    });

    // Should now show the real trip
    expect(root.findAllByProps({ testID: 'trip-history-error' })).toHaveLength(0);
    const updatedText = root
      .findAllByType('Text')
      .map((n: any) => n.props.children)
      .flat()
      .join(' ');
    expect(updatedText).toContain('Clock Tower, Jodhpur');
  });

  // 5. Real rides continue to render normally
  it('5. renders real trips normally with fare and location information', async () => {
    jest.spyOn(engineApi, 'getCustomerHistory').mockResolvedValueOnce([mockSampleTrip]);

    const onTripSelect = jest.fn();
    const mockNavigate = jest.fn();

    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <TripHistoryScreen
          customerId="cust-test"
          onTripSelect={onTripSelect}
          navigation={{ navigate: mockNavigate }}
        />
      );
    });

    const root: any = renderer!.root;
    const textNodes = root.findAllByType('Text');
    const allText = textNodes.map((n: any) => n.props.children).flat().join(' ');

    expect(allText).toContain('COMPLETED');
    expect(allText).toContain('₹350');
    expect(allText).toContain('Clock Tower, Jodhpur');
    expect(allText).toContain('Shastri Nagar, Jodhpur');
    expect(allText).toContain('25 kg');

    // Tapping the trip card triggers selection & navigation
    const tripCard = root.findByProps({
      accessibilityLabel: `Trip on ${new Date(mockSampleTrip.createdAt).toLocaleDateString()}`,
    });
    act(() => {
      tripCard.props.onPress();
    });

    expect(onTripSelect).toHaveBeenCalledWith(mockSampleTrip);
    expect(mockNavigate).toHaveBeenCalledWith('HistoricalTripDetailScreen', expect.anything());
  });

  // 6. Action buttons navigate to valid existing screens
  it('6. "Book a Ride" and "Schedule a Ride" buttons trigger navigation to booking flow', async () => {
    const mockNavigate = jest.fn();
    const onBookRide = jest.fn();
    const onScheduleRide = jest.fn();

    // Test Book a Ride in Recent tab with onBookRide
    let rendererRecent: ReactTestRenderer;
    await act(async () => {
      rendererRecent = TestRenderer.create(
        <TripHistoryScreen
          initialTrips={[]}
          initialTab="Recent"
          navigation={{ navigate: mockNavigate }}
          onBookRide={onBookRide}
        />
      );
    });

    const rootRecent: any = rendererRecent!.root;
    const bookButton = rootRecent.findByProps({
      accessibilityLabel: 'Book a Ride',
    });
    act(() => {
      bookButton.props.onPress();
    });
    expect(onBookRide).toHaveBeenCalledTimes(1);

    // Test default navigation when onBookRide is not supplied
    let rendererDefaultNav: ReactTestRenderer;
    await act(async () => {
      rendererDefaultNav = TestRenderer.create(
        <TripHistoryScreen
          initialTrips={[]}
          initialTab="Recent"
          navigation={{ navigate: mockNavigate }}
        />
      );
    });

    const rootDefaultNav: any = rendererDefaultNav!.root;
    const bookButtonDefault = rootDefaultNav.findByProps({
      accessibilityLabel: 'Book a Ride',
    });
    act(() => {
      bookButtonDefault.props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('BookingStack', {
      screen: 'AddressSearchScreen',
    });

    // Test Schedule a Ride in Scheduled tab with onScheduleRide
    let rendererScheduled: ReactTestRenderer;
    await act(async () => {
      rendererScheduled = TestRenderer.create(
        <TripHistoryScreen
          initialTrips={[]}
          initialTab="Scheduled"
          navigation={{ navigate: mockNavigate }}
          onScheduleRide={onScheduleRide}
        />
      );
    });

    const rootScheduled: any = rendererScheduled!.root;
    const scheduleButton = rootScheduled.findByProps({
      accessibilityLabel: 'Schedule a Ride',
    });
    act(() => {
      scheduleButton.props.onPress();
    });
    expect(onScheduleRide).toHaveBeenCalledTimes(1);
  });

  // 7. Tab switching displays correct data or empty state for each tab
  it('7. switching tabs smoothly toggles between Recent trips and Scheduled empty state', async () => {
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <TripHistoryScreen initialTrips={[mockSampleTrip]} initialTab="Recent" />
      );
    });

    const root: any = renderer!.root;

    // Initially in Recent with 1 trip
    expect(root.findAllByProps({ testID: 'empty-recent-state' })).toHaveLength(0);
    const textNodes = root.findAllByType('Text');
    const allText = textNodes.map((n: any) => n.props.children).flat().join(' ');
    expect(allText).toContain('Clock Tower, Jodhpur');

    // Tap Scheduled tab
    const scheduledTab = root.findByProps({ testID: 'tab-scheduled' });
    await act(async () => {
      scheduledTab.props.onPress();
    });

    // Now Scheduled empty state is shown
    expect(root.findByProps({ testID: 'empty-scheduled-state' })).toBeTruthy();
    const scheduledText = root
      .findAllByType('Text')
      .map((n: any) => n.props.children)
      .flat()
      .join(' ');
    expect(scheduledText).toContain('No scheduled rides');

    // Switch back to Recent tab
    const recentTab = root.findByProps({ testID: 'tab-recent' });
    await act(async () => {
      recentTab.props.onPress();
    });

    // Recent trip card is shown again
    expect(root.findAllByProps({ testID: 'empty-scheduled-state' })).toHaveLength(0);
    const recentText = root
      .findAllByType('Text')
      .map((n: any) => n.props.children)
      .flat()
      .join(' ');
    expect(recentText).toContain('Clock Tower, Jodhpur');
  });
});

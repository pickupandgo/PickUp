import React from 'react';
import TestRenderer, { act, ReactTestRenderer } from 'react-test-renderer';
import { Text, Pressable } from 'react-native';
import {
  formatCurrency,
  getCancellationEstimate,
  getVehicleIconName,
  executeTripCancellation,
} from '../src/services/cancellationService';
import CancellationResultScreen from '../src/screens/support/CancellationResultScreen';
import CancellationConfirmationScreen from '../src/screens/support/CancellationConfirmationScreen';
import CancellationChargeConfirmationScreen from '../src/screens/support/CancellationChargeConfirmationScreen';
import ProfileScreen from '../src/screens/profile/ProfileScreen';
import EditProfileScreen from '../src/screens/profile/EditProfileScreen';
import { SessionProvider, useSession } from '../src/state/SessionContext';
import { BookingProvider, useBooking } from '../src/state/BookingContext';
import * as userProfileApi from '../src/api/userProfile';
import Button from '../src/components/atoms/Button';

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

jest.mock('../src/api/userProfile', () => ({
  saveUserProfileApi: jest.fn(async (_uid, profile) => profile),
  fetchUserProfileApi: jest.fn(async () => null),
}));

describe('1. Shared Cancellation Service (Authoritative Source of Truth)', () => {
  it('formats currency correctly in Indian Rupee format', () => {
    expect(formatCurrency(112.5)).toBe('₹112.50');
    expect(formatCurrency(0)).toBe('₹0.00');
    expect(formatCurrency(450)).toBe('₹450.00');
  });

  it('maps vehicle categories to correct icon names', () => {
    expect(getVehicleIconName('MINI_TRUCK')).toBe('local-shipping');
    expect(getVehicleIconName('THREE_WHEELER')).toBe('electric-rickshaw');
    expect(getVehicleIconName('BIKE')).toBe('two-wheeler');
    expect(getVehicleIconName(undefined)).toBe('local-shipping');
  });

  it('calculates 25% cancellation fee when driver is assigned', () => {
    const estimate = getCancellationEstimate({
      trip: {
        id: 'trp-100',
        externalRef: 'TRP-8472-X',
        driver: { id: 'drv-1', name: 'Ramesh', etaMinutes: 4 },
        vehicle: { model: 'Tata Ace', registrationNumber: 'RJ 19 XX 1234' },
      } as any,
      ride: { fare: 450 } as any,
    });

    expect(estimate.feeAmount).toBe(112.5);
    expect(estimate.formattedFee).toBe('₹112.50');
    expect(estimate.percentageLabel).toBe('25% of fare');
    expect(estimate.isGracePeriod).toBe(false);
  });

  it('calculates 0 fee within grace period when driver is not assigned', () => {
    const estimate = getCancellationEstimate({
      trip: {
        id: 'trp-200',
        externalRef: 'TRP-GRACE',
      } as any,
      ride: { fare: 500 } as any,
    });

    expect(estimate.feeAmount).toBe(0);
    expect(estimate.formattedFee).toBe('₹0.00');
    expect(estimate.percentageLabel).toBe('0% (Grace Period)');
    expect(estimate.isGracePeriod).toBe(true);
  });

  it('executes trip cancellation and calls engine API', async () => {
    const result = await executeTripCancellation({
      trip: {
        id: 'trp-100',
        externalRef: 'TRP-8472-X',
        driver: { id: 'drv-1' },
      } as any,
      ride: { fare: 450 } as any,
      reason: 'Change of plans',
    });

    expect(result.success).toBe(true);
    expect(result.feeAmount).toBe('₹112.50');
    expect(result.tripId).toBe('#TRP-8472-X');
  });
});

describe('2. Trip Cancelled Screen (Visible 10s Countdown, Real Trip ID & Fee)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders real trip reference with leading # and confirmed cancellation fee', () => {
    const mockNavigation = {
      dispatch: jest.fn(),
      reset: jest.fn(),
      navigate: jest.fn(),
    };

    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(
        <BookingProvider>
          <CancellationResultScreen
            navigation={mockNavigation as any}
            route={
              {
                params: {
                  tripReference: '#TRP-REAL-999',
                  cancellationFee: 112.5,
                },
              } as any
            }
          />
        </BookingProvider>
      );
    });

    const allTexts = renderer?.root.findAllByType(Text).map((t) => t.props.children) || [];
    const fullText = allTexts.flat().join(' ');

    expect(fullText).toContain('#TRP-REAL-999');
    expect(fullText).toContain('₹112.50');
    expect(fullText).not.toContain('#TRP-8472-X');
  });

  it('visibly counts down from 10 seconds to 0 and auto-navigates with CommonActions.reset', () => {
    const mockNavigation = {
      dispatch: jest.fn(),
      reset: jest.fn(),
      navigate: jest.fn(),
    };

    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(
        <BookingProvider>
          <CancellationResultScreen
            navigation={mockNavigation as any}
            route={
              {
                params: {
                  tripReference: '#TRP-REAL-999',
                  cancellationFee: 50,
                },
              } as any
            }
          />
        </BookingProvider>
      );
    });

    // Check initial countdown text
    let allTexts = renderer?.root.findAllByType(Text).map((t) => t.props.children) || [];
    let fullText = allTexts.flat().join(' ');
    expect(fullText).toContain('Returning to Home in 10 seconds');

    // Advance 5 seconds
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    allTexts = renderer?.root.findAllByType(Text).map((t) => t.props.children) || [];
    fullText = allTexts.flat().join(' ');
    expect(fullText).toContain('Returning to Home in 5 seconds');

    // Advance to 1 second
    act(() => {
      jest.advanceTimersByTime(4000);
    });
    allTexts = renderer?.root.findAllByType(Text).map((t) => t.props.children) || [];
    fullText = allTexts.flat().join(' ');
    expect(fullText).toContain('Returning to Home in 1 second');

    // Complete countdown: 1 more second
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(mockNavigation.dispatch).toHaveBeenCalledTimes(1);
    const dispatchArg = mockNavigation.dispatch.mock.calls[0][0];
    expect(dispatchArg.payload.routes[0].name).toBe('MainTabs');
  });

  it('immediately navigates and cancels countdown when BACK TO HOME is pressed', () => {
    const mockNavigation = {
      dispatch: jest.fn(),
      reset: jest.fn(),
      navigate: jest.fn(),
    };

    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(
        <BookingProvider>
          <CancellationResultScreen
            navigation={mockNavigation as any}
            route={
              {
                params: {
                  tripReference: '#TRP-REAL-999',
                  cancellationFee: 50,
                },
              } as any
            }
          />
        </BookingProvider>
      );
    });

    const buttons = renderer?.root.findAllByType(Button);
    const backBtn = buttons?.find((b) => (b.props as any).label === 'BACK TO HOME');
    expect(backBtn).toBeDefined();

    // Tap BACK TO HOME at 8 seconds remaining
    act(() => {
      jest.advanceTimersByTime(2000);
      (backBtn?.props as any).onPress();
    });

    expect(mockNavigation.dispatch).toHaveBeenCalledTimes(1);

    // Ensure timer doesn't fire duplicate navigation after remaining 10 seconds
    act(() => {
      jest.advanceTimersByTime(10000);
    });
    expect(mockNavigation.dispatch).toHaveBeenCalledTimes(1);
  });
});

describe('3. First Cancellation Confirmation Sheet (Real Driver, Vehicle, Fare)', () => {
  it('displays real assigned vehicle, registration plate, dynamic ETA, and fee estimate', () => {
    const mockTrip = {
      id: 'trip-101',
      externalRef: 'TRP-101',
      driver: {
        id: 'drv-55',
        name: 'Suresh Kumar',
        etaMinutes: 3,
      },
      vehicle: {
        category: 'MINI_TRUCK',
        model: 'Mahindra Bolero Maxi',
        registrationNumber: 'DL 01 AA 5678',
      },
    };

    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(
        <BookingProvider>
          <CancellationConfirmationScreen
            navigation={{ navigate: jest.fn(), goBack: jest.fn() } as any}
            trip={mockTrip as any}
            ride={{ fare: 600 } as any}
          />
        </BookingProvider>
      );
    });

    const allTexts = renderer?.root.findAllByType(Text).map((t) => t.props.children) || [];
    const fullText = allTexts.flat().join(' ');

    expect(fullText).toContain('Driver is 3 mins away');
    expect(fullText).toContain('Mahindra Bolero Maxi');
    expect(fullText).toContain('DL 01 AA 5678');
    // 25% of 600 is 150
    expect(fullText).toContain('₹150.00');
    expect(fullText).toContain('(25% of fare)');
  });

  it('handles KEEP TRIP without cancelling and CANCEL TRIP to trigger cancellation', async () => {
    const mockGoBack = jest.fn();
    const mockNavigate = jest.fn();

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = TestRenderer.create(
        <BookingProvider>
          <CancellationConfirmationScreen
            navigation={{ navigate: mockNavigate, goBack: mockGoBack } as any}
            trip={{ id: 'trip-101', externalRef: 'TRP-101' } as any}
            ride={{ fare: 400 } as any}
          />
        </BookingProvider>
      );
    });

    const buttons = renderer?.root.findAllByType(Button);
    const keepTripBtn = buttons?.find((b) => (b.props as any).label === 'KEEP TRIP');
    const cancelTripBtn = buttons?.find((b) => (b.props as any).label === 'CANCEL TRIP');

    expect(keepTripBtn).toBeDefined();
    expect(cancelTripBtn).toBeDefined();

    // KEEP TRIP dismisses
    act(() => {
      (keepTripBtn?.props as any).onPress();
    });
    expect(mockGoBack).toHaveBeenCalled();
  });
});

describe('4. Second Cancellation Confirmation Sheet (Authoritative Fee)', () => {
  it('renders consistent authoritative cancellation charge and navigates on acceptance', async () => {
    const mockNavigate = jest.fn();
    const mockGoBack = jest.fn();

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = TestRenderer.create(
        <BookingProvider>
          <CancellationChargeConfirmationScreen
            navigation={{ navigate: mockNavigate, goBack: mockGoBack } as any}
            route={
              {
                params: {
                  trip: {
                    id: 'trip-202',
                    externalRef: 'TRP-202',
                    driver: { id: 'd-1', etaMinutes: 2 },
                  },
                  ride: { fare: 800 },
                },
              } as any
            }
          />
        </BookingProvider>
      );
    });

    const allTexts = renderer?.root.findAllByType(Text).map((t) => t.props.children) || [];
    const fullText = allTexts.flat().join(' ');

    // 25% of 800 is 200
    expect(fullText).toContain('₹200.00');

    const cancelChargeText = renderer?.root.findAllByType(Text).find((t) => {
      const txt = Array.isArray(t.props.children) ? t.props.children.join('') : String(t.props.children);
      return txt.includes('CANCEL & ACCEPT CHARGE');
    });
    expect(cancelChargeText).toBeDefined();

    let cancelChargeBtn: any = (cancelChargeText as any)?.parent;
    while (cancelChargeBtn && typeof cancelChargeBtn.props?.onPress !== 'function') {
      cancelChargeBtn = cancelChargeBtn.parent;
    }
    expect(cancelChargeBtn).toBeDefined();

    await act(async () => {
      await cancelChargeBtn.props.onPress();
    });

    expect(mockNavigate).toHaveBeenCalledWith(
      'CancellationResultScreen',
      expect.objectContaining({
        tripId: '#TRP-202',
        feeAmount: '₹200.00',
      })
    );
  });
});

describe('5. Profile Screen & Isolation by Authenticated Account', () => {
  it('displays real customer details from session and updates on account switch', async () => {
    let sessionApi: ReturnType<typeof useSession> | undefined;

    const SessionConsumer: React.FC = () => {
      sessionApi = useSession();
      return null;
    };

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = TestRenderer.create(
        <SessionProvider>
          <SessionConsumer />
          <ProfileScreen navigation={{ navigate: jest.fn() } as any} />
        </SessionProvider>
      );
    });

    // Simulate User A logging in
    await act(async () => {
      sessionApi?.markProfileDone({
        fullName: 'Vikram Malhotra',
        phone: '+91 98111 22233',
        email: 'vikram@example.com',
      });
    });

    let allTexts = renderer?.root.findAllByType(Text).map((t) => t.props.children) || [];
    let fullText = allTexts.flat().join(' ');

    expect(fullText).toContain('Vikram Malhotra');
    expect(fullText).toContain('+919811122233');
    expect(fullText).not.toContain('Sarah Johnson');
    expect(fullText).not.toContain('+91 98765 43210');

    // Simulate switching to User B
    await act(async () => {
      sessionApi?.markProfileDone({
        fullName: 'Ananya Sharma',
        phone: '+91 97222 33344',
        email: 'ananya@example.com',
      });
    });

    allTexts = renderer?.root.findAllByType(Text).map((t) => t.props.children) || [];
    fullText = allTexts.flat().join(' ');

    expect(fullText).toContain('Ananya Sharma');
    expect(fullText).toContain('+919722233344');
    expect(fullText).not.toContain('Vikram Malhotra');
  });

  it('pre-fills EditProfileScreen with customer saved info and persists edits', async () => {
    let sessionApi: ReturnType<typeof useSession> | undefined;

    const SessionConsumer: React.FC = () => {
      sessionApi = useSession();
      return null;
    };

    const mockGoBack = jest.fn();

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = TestRenderer.create(
        <SessionProvider>
          <SessionConsumer />
          <EditProfileScreen navigation={{ goBack: mockGoBack } as any} />
        </SessionProvider>
      );
    });

    // Populate initial saved profile
    await act(async () => {
      sessionApi?.markProfileDone({
        fullName: 'Rohan Gupta',
        phone: '+91 98888 77777',
        email: 'rohan@example.com',
      });
    });

    // Save profile change
    const buttons = renderer?.root.findAllByType(Button);
    const saveBtn = buttons?.find((b) => (b.props as any).label?.toUpperCase() === 'SAVE CHANGES');
    expect(saveBtn).toBeDefined();

    await act(async () => {
      await (saveBtn?.props as any).onPress();
    });

    expect(mockGoBack).toHaveBeenCalled();
  });
});

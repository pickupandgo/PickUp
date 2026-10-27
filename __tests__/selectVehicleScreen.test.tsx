import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { Text, Pressable, ActivityIndicator } from 'react-native';
import SelectVehicleScreen, {
  matchesVehicleCategory,
  formatFare,
} from '../src/screens/booking/SelectVehicleScreen';
import VehicleOptionCard from '../src/components/molecules/VehicleOptionCard';
import * as paymentsApi from '../src/api/payments';
import * as authModule from '@react-native-firebase/auth';
import * as sessionModule from '../src/state/session';
import * as nearbyHooks from '../src/hooks/useNearbyDrivers';
import { BookingContext } from '../src/state/BookingContext';
import { mockVehicleTypes } from '../src/data/mockData';
import type { FareQuote, NearbyDriver } from '../src/api/types';
import { ApiError } from '../src/api/http';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockSetVehicleType = jest.fn();
const mockSetSender = jest.fn();
const mockSetQuote = jest.fn();

const defaultPickup = {
  label: 'Railway Station',
  address: 'Station Road, Jodhpur',
  latitude: 26.2856,
  longitude: 73.0243,
};

const defaultDrop = {
  label: 'Clock Tower',
  address: 'Nai Sarak, Jodhpur',
  latitude: 26.2978,
  longitude: 73.0185,
  receiverName: 'Suresh Kumar',
  receiverPhone: '+919123456789',
};

const makeMockQuote = (category: string, payablePaise: number, expiresAt?: string): FareQuote => ({
  quoteId: `quote-${category}-${Date.now()}`,
  vehicleCategory: category,
  weightKg: 10,
  pickup: { latitude: 26.2856, longitude: 73.0243 },
  distanceMeters: 4500,
  farePaise: payablePaise,
  taxPaise: 0,
  payablePaise,
  currency: 'INR',
  drops: [
    {
      sequence: 1,
      latitude: 26.2978,
      longitude: 73.0185,
      distanceMeters: 4500,
      farePaise: payablePaise,
      taxPaise: 0,
      payablePaise,
    },
  ],
  expiresAt: expiresAt ?? new Date(Date.now() + 600_000).toISOString(),
  redeemed: false,
  createdAt: new Date().toISOString(),
});

describe('SelectVehicleScreen — Unit & Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    jest.spyOn(authModule, 'getAuth').mockReturnValue({
      currentUser: { phoneNumber: '+919876543210', uid: 'test-user-uid' } as any,
    } as any);

    jest.spyOn(authModule, 'onAuthStateChanged').mockImplementation((auth: any, callback: any) => {
      callback({ phoneNumber: '+919876543210', uid: 'test-user-uid' });
      return jest.fn();
    });

    jest.spyOn(sessionModule, 'getCustomerProfile').mockResolvedValue({
      fullName: 'Rajesh Sharma',
      email: 'rajesh@example.com',
    } as any);

    jest.spyOn(nearbyHooks, 'useNearbyDrivers').mockReturnValue({
      drivers: [],
      error: undefined,
      isLoading: false,
      refresh: jest.fn(),
    });

    jest.spyOn(paymentsApi, 'createFareQuote').mockImplementation(async (req) => {
      if (req.vehicleCategory === 'TWO_WHEELER') return makeMockQuote('TWO_WHEELER', 6500);
      if (req.vehicleCategory === 'THREE_WHEELER') return makeMockQuote('THREE_WHEELER', 16000);
      if (req.vehicleCategory === 'MINI_TRUCK') return makeMockQuote('MINI_TRUCK', 26000);
      if (req.vehicleCategory === 'PICKUP_TRUCK') return makeMockQuote('PICKUP_TRUCK', 42000);
      throw new ApiError('http', 'Category unpriced', 422);
    });
  });

  const renderWithBooking = async (
    customDraft: any = {},
    customContext: any = {}
  ): Promise<ReactTestRenderer> => {
    const draft = {
      pickup: defaultPickup,
      drops: [defaultDrop],
      senderName: 'Sender',
      senderPhone: undefined,
      ...customDraft,
    };

    const contextValue: any = {
      customerId: 'test-user-uid',
      draft,
      primaryDrop: draft.drops[0],
      setPickup: jest.fn(),
      addDrop: jest.fn(),
      setPendingDrop: jest.fn(),
      commitPendingDrop: jest.fn(),
      replaceDrop: jest.fn(),
      removeDrop: jest.fn(),
      setVehicleType: mockSetVehicleType,
      setGoods: jest.fn(),
      setInsured: jest.fn(),
      setSender: mockSetSender,
      setReceiver: jest.fn(),
      setQuote: mockSetQuote,
      setPaymentMethod: jest.fn(),
      resetDraft: jest.fn(),
      setAssignedDriver: jest.fn(),
      ...customContext,
    };

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = TestRenderer.create(
        <BookingContext.Provider value={contextValue}>
          <SelectVehicleScreen navigation={{ navigate: mockNavigate, goBack: mockGoBack }} />
        </BookingContext.Provider>
      );
    });
    return renderer!;
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Helper Function Tests
  // ───────────────────────────────────────────────────────────────────────────
  describe('Helper functions: matchesVehicleCategory and formatFare', () => {
    it('matchesVehicleCategory correctly matches diverse formats and aliases', () => {
      const bike = mockVehicleTypes.find((v) => v.id === 'bike')!;
      const threeWheeler = mockVehicleTypes.find((v) => v.id === '3-wheeler')!;
      const miniTruck = mockVehicleTypes.find((v) => v.id === 'mini-truck')!;
      const pickup = mockVehicleTypes.find((v) => v.id === 'pickup')!;

      expect(matchesVehicleCategory('2 Wheeler', bike)).toBe(true);
      expect(matchesVehicleCategory('TWO_WHEELER', bike)).toBe(true);
      expect(matchesVehicleCategory('bike', bike)).toBe(true);
      expect(matchesVehicleCategory('3 Wheeler', bike)).toBe(false);

      expect(matchesVehicleCategory('3 Wheeler', threeWheeler)).toBe(true);
      expect(matchesVehicleCategory('THREE_WHEELER', threeWheeler)).toBe(true);
      expect(matchesVehicleCategory('eLoader', threeWheeler)).toBe(true);
      expect(matchesVehicleCategory('2 Wheeler', threeWheeler)).toBe(false);

      expect(matchesVehicleCategory('Mini Truck', miniTruck)).toBe(true);
      expect(matchesVehicleCategory('MINI_TRUCK', miniTruck)).toBe(true);
      expect(matchesVehicleCategory('Tata Ace', miniTruck)).toBe(true);
      expect(matchesVehicleCategory('Pickup Truck', miniTruck)).toBe(false);

      expect(matchesVehicleCategory('Pickup Truck', pickup)).toBe(true);
      expect(matchesVehicleCategory('PICKUP_TRUCK', pickup)).toBe(true);
      expect(matchesVehicleCategory('Bolero', pickup)).toBe(true);
      expect(matchesVehicleCategory('Mini Truck', pickup)).toBe(false);

      expect(matchesVehicleCategory(undefined, bike)).toBe(false);
    });

    it('formatFare formats whole rupees and fractional paise without Est. prefix', () => {
      expect(formatFare(15000)).toBe('₹150');
      expect(formatFare(25000)).toBe('₹250');
      expect(formatFare(5000)).toBe('₹50');
      expect(formatFare(15050)).toBe('₹150.50');
      expect(formatFare(15000)).not.toContain('Est.');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Requirement 1: Sender Phone Number Display & Handling
  // ───────────────────────────────────────────────────────────────────────────
  describe('1. Display the Actual Sender Phone Number', () => {
    it('displays the authenticated customer phone number with country code (+91)', async () => {
      const renderer = await renderWithBooking();
      const allTexts = renderer.root.findAllByType(Text).map((t) => t.props.children);
      const flattened = allTexts.flat().join(' ');

      expect(flattened).toContain('+919876543210');
      expect(flattened).not.toContain('No Number');
    });

    it('displays "Phone number unavailable" fallback when user is unauthenticated or has no phone', async () => {
      jest.spyOn(authModule, 'getAuth').mockReturnValue({
        currentUser: null,
      } as any);
      jest.spyOn(authModule, 'onAuthStateChanged').mockImplementation((auth: any, callback: any) => {
        callback(null);
        return jest.fn();
      });
      jest.spyOn(sessionModule, 'getCustomerProfile').mockResolvedValue(null);

      const renderer = await renderWithBooking({ senderPhone: undefined });
      const allTexts = renderer.root.findAllByType(Text).map((t) => t.props.children);
      const flattened = allTexts.flat().join(' ');

      expect(flattened).toContain('Phone number unavailable');
      expect(flattened).not.toContain('No Number');
    });

    it('reconciles verified phone from customer profile if auth phone is not immediately present', async () => {
      jest.spyOn(authModule, 'getAuth').mockReturnValue({
        currentUser: null,
      } as any);
      jest.spyOn(authModule, 'onAuthStateChanged').mockImplementation((auth: any, callback: any) => {
        callback(null);
        return jest.fn();
      });
      jest.spyOn(sessionModule, 'getCustomerProfile').mockResolvedValue({
        fullName: 'Rajesh Sharma',
        email: 'rajesh@example.com',
        phoneNumber: '+919988776655',
      } as any);

      const renderer = await renderWithBooking({ senderPhone: undefined });
      const allTexts = renderer.root.findAllByType(Text).map((t) => t.props.children);
      const flattened = allTexts.flat().join(' ');

      expect(flattened).toContain('+919988776655');
    });

    it('reconciles and updates draft.senderPhone if previously empty', async () => {
      await renderWithBooking({ senderPhone: undefined });
      expect(mockSetSender).toHaveBeenCalledWith(
        expect.objectContaining({
          phone: '+919876543210',
        })
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Requirement 2: Replace Static Prices With Dynamic Quotes
  // ───────────────────────────────────────────────────────────────────────────
  describe('2. Replace Static Vehicle Prices With Real Fare Quotes', () => {
    it('fetches dynamic quotes for all supported vehicle categories from backend pricing flow', async () => {
      const renderer = await renderWithBooking();

      expect(paymentsApi.createFareQuote).toHaveBeenCalledWith(
        expect.objectContaining({ vehicleCategory: 'TWO_WHEELER' })
      );
      expect(paymentsApi.createFareQuote).toHaveBeenCalledWith(
        expect.objectContaining({ vehicleCategory: 'THREE_WHEELER' })
      );
      expect(paymentsApi.createFareQuote).toHaveBeenCalledWith(
        expect.objectContaining({ vehicleCategory: 'MINI_TRUCK' })
      );
      expect(paymentsApi.createFareQuote).toHaveBeenCalledWith(
        expect.objectContaining({ vehicleCategory: 'PICKUP_TRUCK' })
      );

      const cards = renderer.root.findAllByType(VehicleOptionCard);
      expect(cards.length).toBe(mockVehicleTypes.length);

      // Verify dynamic prices are displayed without 'Est.' prefix
      const bikeCard = cards.find((c) => c.props.name === 'Bike / 2-Wheeler')!;
      const miniTruckCard = cards.find((c) => c.props.name === 'Mini Truck / Tata Ace')!;

      expect(bikeCard.props.price).toBe('₹65');
      expect(bikeCard.props.price).not.toContain('Est.');
      expect(miniTruckCard.props.price).toBe('₹260');
      expect(miniTruckCard.props.price).not.toContain('Est.');
    });

    it('displays loading state while fare quotes are being fetched', async () => {
      let resolveQuotes: any;
      jest.spyOn(paymentsApi, 'createFareQuote').mockImplementation(
        () => new Promise((resolve) => { resolveQuotes = resolve; })
      );

      let renderer: ReactTestRenderer | undefined;
      await act(async () => {
        renderer = TestRenderer.create(
          <BookingContext.Provider
            value={{
              customerId: 'test-user-uid',
              draft: { pickup: defaultPickup, drops: [defaultDrop] },
              primaryDrop: defaultDrop,
              setPickup: jest.fn(),
              addDrop: jest.fn(),
              setPendingDrop: jest.fn(),
              commitPendingDrop: jest.fn(),
              replaceDrop: jest.fn(),
              removeDrop: jest.fn(),
              setVehicleType: mockSetVehicleType,
              setGoods: jest.fn(),
              setInsured: jest.fn(),
              setSender: mockSetSender,
              setReceiver: jest.fn(),
              setQuote: mockSetQuote,
              setPaymentMethod: jest.fn(),
              resetDraft: jest.fn(),
              setAssignedDriver: jest.fn(),
            } as any}
          >
            <SelectVehicleScreen />
          </BookingContext.Provider>
        );
      });

      const cards = renderer!.root.findAllByType(VehicleOptionCard);
      const miniTruckCard = cards.find((c) => c.props.name === 'Mini Truck / Tata Ace')!;
      expect(miniTruckCard.props.isLoading).toBe(true);

      // Resolve quotes
      await act(async () => {
        resolveQuotes(makeMockQuote('MINI_TRUCK', 26000));
      });
    });

    it('displays compact pricing error banner outside cards when quote API fails and never shows raw errors inside cards', async () => {
      jest.spyOn(paymentsApi, 'createFareQuote').mockRejectedValue(
        new ApiError('timeout', 'The server took too long to respond. Please try again.')
      );

      const renderer = await renderWithBooking();
      const cards = renderer.root.findAllByType(VehicleOptionCard);

      // Verify no raw server error appears inside ANY vehicle card
      for (const card of cards) {
        const cardTexts = card.findAllByType(Text).map((t) => t.props.children).flat().join(' ');
        expect(cardTexts).not.toContain('The server took too long to respond');
        expect(cardTexts).not.toContain('Request to /v1/fare/quotes timed out');
        expect(cardTexts).not.toContain('timeout');
      }

      // Vehicles with pricing errors must NOT be marked unavailable
      for (const card of cards.filter((c) => c.props.name !== 'JCB' && c.props.name !== 'Crane')) {
        expect(card.props.isUnavailable).toBe(false);
        expect(card.props.price).toBe('\u2014');
        // Ensure static production prices never leak
        expect(card.props.price).not.toBe('₹50');
        expect(card.props.price).not.toBe('₹150');
        expect(card.props.price).not.toBe('₹250');
        expect(card.props.price).not.toBe('₹400');
        expect(card.props.price).not.toContain('Est.');
      }

      // Verify single compact pricing error banner exists outside vehicle cards
      const banner = (renderer.root as any).findByProps({ testID: 'pricing-error-banner' });
      expect(banner).toBeDefined();
      const bannerTexts = banner.findAllByType(Text).map((t: any) => t.props.children).flat().join(' ');
      expect(bannerTexts).toContain('Unable to load vehicle prices. Please try again.');

      // Verify retry button exists
      const retryButton = (renderer.root as any).findByProps({ testID: 'pricing-retry-button' });
      expect(retryButton).toBeDefined();
    });

    it('retries pricing request when Retry button is pressed', async () => {
      const mockQuoteCall = jest
        .spyOn(paymentsApi, 'createFareQuote')
        .mockRejectedValueOnce(new ApiError('timeout', 'The server took too long to respond.'))
        .mockRejectedValueOnce(new ApiError('timeout', 'The server took too long to respond.'))
        .mockRejectedValueOnce(new ApiError('timeout', 'The server took too long to respond.'))
        .mockRejectedValueOnce(new ApiError('timeout', 'The server took too long to respond.'))
        .mockImplementation(async (req) => {
          if (req.vehicleCategory === 'TWO_WHEELER') return makeMockQuote('TWO_WHEELER', 6500);
          if (req.vehicleCategory === 'THREE_WHEELER') return makeMockQuote('THREE_WHEELER', 16000);
          if (req.vehicleCategory === 'MINI_TRUCK') return makeMockQuote('MINI_TRUCK', 26000);
          if (req.vehicleCategory === 'PICKUP_TRUCK') return makeMockQuote('PICKUP_TRUCK', 42000);
          throw new ApiError('http', 'Category unpriced', 422);
        });

      const renderer = await renderWithBooking();

      const initialCallCount = mockQuoteCall.mock.calls.length;
      expect(initialCallCount).toBe(4);

      // Verify banner exists initially
      expect(() => (renderer.root as any).findByProps({ testID: 'pricing-error-banner' })).not.toThrow();

      // Press retry
      const retryButton = (renderer.root as any).findByProps({ testID: 'pricing-retry-button' });
      await act(async () => {
        retryButton.props.onPress();
      });

      // Called again on retry
      expect(mockQuoteCall.mock.calls.length).toBeGreaterThan(initialCallCount);

      // Prices should now be loaded and banner dismissed
      const updatedCards = renderer.root.findAllByType(VehicleOptionCard);
      const miniTruck = updatedCards.find((c) => c.props.name === 'Mini Truck / Tata Ace')!;
      expect(miniTruck.props.price).toBe('₹260');

      const banners = (renderer.root as any).findAllByProps({ testID: 'pricing-error-banner' });
      expect(banners.length).toBe(0);
    });

    it('preserves the selected vehicle when pricing fails', async () => {
      jest.spyOn(paymentsApi, 'createFareQuote').mockRejectedValue(
        new ApiError('timeout', 'The server took too long to respond.')
      );

      const renderer = await renderWithBooking();
      const cards = renderer.root.findAllByType(VehicleOptionCard);

      // Select 3-Wheeler
      const threeWheeler = cards.find((c) => c.props.name === '3-Wheeler / E-Loader')!;
      await act(async () => {
        (threeWheeler.props as any).onPress();
      });

      const cardsAfterSelection = renderer.root.findAllByType(VehicleOptionCard);
      const threeWheelerAfter = cardsAfterSelection.find((c) => c.props.name === '3-Wheeler / E-Loader')!;
      expect(threeWheelerAfter.props.selected).toBe(true);

      // Retry
      const retryButton = (renderer.root as any).findByProps({ testID: 'pricing-retry-button' });
      await act(async () => {
        retryButton.props.onPress();
      });

      // 3-Wheeler should still remain selected
      const cardsAfterRetry = renderer.root.findAllByType(VehicleOptionCard);
      const threeWheelerFinal = cardsAfterRetry.find((c) => c.props.name === '3-Wheeler / E-Loader')!;
      expect(threeWheelerFinal.props.selected).toBe(true);
    });

    it('disables proceed button when selected vehicle quote failed or is unavailable', async () => {
      jest.spyOn(paymentsApi, 'createFareQuote').mockRejectedValue(
        new ApiError('http', 'Pricing unavailable', 500)
      );

      const renderer = await renderWithBooking();
      const proceedButton = (renderer.root as any).findByProps({
        accessibilityLabel: 'Proceed with Mini Truck',
      });

      expect(proceedButton.props.accessibilityState.disabled).toBe(true);

      // Attempt tap
      await act(async () => {
        proceedButton.props.onPress();
      });

      expect(mockSetQuote).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalledWith('GoodsDetailsScreen');
    });

    it('enables proceed button and passes valid quote ID when proceeding', async () => {
      const renderer = await renderWithBooking();
      const proceedButton = (renderer.root as any).findByProps({
        accessibilityLabel: 'Proceed with Mini Truck',
      });

      expect(proceedButton.props.accessibilityState.disabled).toBe(false);

      await act(async () => {
        proceedButton.props.onPress();
      });

      expect(mockSetVehicleType).toHaveBeenCalledWith('Mini Truck / Tata Ace');
      expect(mockSetQuote).toHaveBeenCalledWith(
        expect.objectContaining({ vehicleCategory: 'MINI_TRUCK', payablePaise: 26000 })
      );
      expect(mockNavigate).toHaveBeenCalledWith('GoodsDetailsScreen');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Requirement 3: Availability-based Driver ETA
  // ───────────────────────────────────────────────────────────────────────────
  describe('3. Show ETA Only When Nearby Drivers Are Available', () => {
    it('hides ETA completely when no eligible nearby drivers are available', async () => {
      jest.spyOn(nearbyHooks, 'useNearbyDrivers').mockReturnValue({
        drivers: [],
        error: undefined,
        isLoading: false,
        refresh: jest.fn(),
      });

      const renderer = await renderWithBooking();
      const cards = renderer.root.findAllByType(VehicleOptionCard);

      for (const card of cards) {
        expect(card.props.eta).toBeUndefined();
      }

      // Verify no ETA text is rendered in the cards
      const allTexts = renderer.root.findAllByType(Text).map((t) => t.props.children);
      const flattened = allTexts.flat().join(' ');
      expect(flattened).not.toContain('15 min');
      expect(flattened).not.toContain('20 min');
      expect(flattened).not.toContain('30 min');
      expect(flattened).not.toContain('45 min');
      expect(flattened).not.toContain('0 min');
    });

    it('shows ETA only for the category that has an eligible available driver', async () => {
      const mockBikeDriver: NearbyDriver = {
        id: 'driver-1',
        name: 'Ramesh',
        vehicleType: '2 Wheeler',
        latitude: 26.289,
        longitude: 73.025,
        isAvailable: true,
        distanceKm: 2.1,
        etaMinutes: 6,
      };

      jest.spyOn(nearbyHooks, 'useNearbyDrivers').mockReturnValue({
        drivers: [mockBikeDriver],
        error: undefined,
        isLoading: false,
        refresh: jest.fn(),
      });

      const renderer = await renderWithBooking();
      const cards = renderer.root.findAllByType(VehicleOptionCard);

      const bikeCard = cards.find((c) => c.props.name === 'Bike / 2-Wheeler')!;
      const threeWheelerCard = cards.find((c) => c.props.name === '3-Wheeler / E-Loader')!;
      const miniTruckCard = cards.find((c) => c.props.name === 'Mini Truck / Tata Ace')!;

      // Bike has an eligible driver with etaMinutes = 6
      expect(bikeCard.props.eta).toBe('6 min');

      // Others have no drivers, so ETA must be completely undefined/hidden
      expect(threeWheelerCard.props.eta).toBeUndefined();
      expect(miniTruckCard.props.eta).toBeUndefined();
    });

    it('hides ETA when nearby driver request has an error or is loading', async () => {
      jest.spyOn(nearbyHooks, 'useNearbyDrivers').mockReturnValue({
        drivers: [],
        error: new ApiError('network', 'Could not reach server'),
        isLoading: false,
        refresh: jest.fn(),
      });

      const renderer = await renderWithBooking();
      const cards = renderer.root.findAllByType(VehicleOptionCard);

      for (const card of cards) {
        expect(card.props.eta).toBeUndefined();
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Requirement 4: Route Changes and Refreshes
  // ───────────────────────────────────────────────────────────────────────────
  describe('4. Route updates and re-quoting', () => {
    it('refreshes quotes when pickup or drops change', async () => {
      const renderer = await renderWithBooking();
      const initialCallCount = (paymentsApi.createFareQuote as jest.Mock).mock.calls.length;

      // Update drops to simulate route change
      await act(async () => {
        renderer.update(
          <BookingContext.Provider
            value={{
              customerId: 'test-user-uid',
              draft: {
                pickup: defaultPickup,
                drops: [
                  defaultDrop,
                  {
                    label: 'Pal Road',
                    address: 'Pal Road, Jodhpur',
                    latitude: 26.27,
                    longitude: 73.01,
                    receiverName: 'Amit',
                    receiverPhone: '+919876500000',
                  },
                ],
              },
              primaryDrop: defaultDrop,
              setPickup: jest.fn(),
              addDrop: jest.fn(),
              setPendingDrop: jest.fn(),
              commitPendingDrop: jest.fn(),
              replaceDrop: jest.fn(),
              removeDrop: jest.fn(),
              setVehicleType: mockSetVehicleType,
              setGoods: jest.fn(),
              setInsured: jest.fn(),
              setSender: mockSetSender,
              setReceiver: jest.fn(),
              setQuote: mockSetQuote,
              setPaymentMethod: jest.fn(),
              resetDraft: jest.fn(),
              setAssignedDriver: jest.fn(),
            } as any}
          >
            <SelectVehicleScreen navigation={{ navigate: mockNavigate, goBack: mockGoBack }} />
          </BookingContext.Provider>
        );
      });

      expect((paymentsApi.createFareQuote as jest.Mock).mock.calls.length).toBeGreaterThan(initialCallCount);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Requirement 5: JCB and Crane Selection & Quote-on-Request Flow
  // ───────────────────────────────────────────────────────────────────────────
  describe('5. JCB and Crane Vehicle Selection & Quote-on-Request Flow', () => {
    it('displays "Quote on request" for JCB and Crane without fabricated prices', async () => {
      const renderer = await renderWithBooking();
      const cards = renderer.root.findAllByType(VehicleOptionCard);

      const jcbCard = cards.find((c) => c.props.name === 'JCB')!;
      const craneCard = cards.find((c) => c.props.name === 'Crane')!;

      expect(jcbCard).toBeDefined();
      expect(craneCard).toBeDefined();

      // Ensure quote-on-request flag is active
      expect(jcbCard.props.isQuoteOnRequest).toBe(true);
      expect(craneCard.props.isQuoteOnRequest).toBe(true);

      // Verify no fake or hardcoded price is rendered in the card props
      expect(jcbCard.props.price).toBe('');
      expect(craneCard.props.price).toBe('');
      expect(jcbCard.props.price).not.toContain('₹');
      expect(craneCard.props.price).not.toContain('₹');

      // Verify the rendered card texts contain "Quote on request"
      const jcbTexts = jcbCard.findAllByType(Text).map((t) => t.props.children).flat().join(' ');
      const craneTexts = craneCard.findAllByType(Text).map((t) => t.props.children).flat().join(' ');

      expect(jcbTexts).toContain('Quote on request');
      expect(craneTexts).toContain('Quote on request');
      expect(jcbTexts).not.toContain('₹');
      expect(craneTexts).not.toContain('₹');
    });

    it('allows tapping JCB card to select it, deselecting previous vehicle and updating CTA label', async () => {
      const renderer = await renderWithBooking();
      let cards = renderer.root.findAllByType(VehicleOptionCard);

      const miniTruckCardBefore = cards.find((c) => c.props.name === 'Mini Truck / Tata Ace')!;
      const jcbCardBefore = cards.find((c) => c.props.name === 'JCB')!;

      // Initially Mini Truck is selected
      expect(miniTruckCardBefore.props.selected).toBe(true);
      expect(jcbCardBefore.props.selected).toBe(false);

      // Tap JCB card
      await act(async () => {
        (jcbCardBefore.props as any).onPress();
      });

      cards = renderer.root.findAllByType(VehicleOptionCard);
      const miniTruckCardAfter = cards.find((c) => c.props.name === 'Mini Truck / Tata Ace')!;
      const jcbCardAfter = cards.find((c) => c.props.name === 'JCB')!;

      // JCB is now selected, Mini Truck is deselected
      expect(jcbCardAfter.props.selected).toBe(true);
      expect(miniTruckCardAfter.props.selected).toBe(false);

      // Verify CTA button reflects JCB and is enabled
      const proceedButton = (renderer.root as any).findByProps({
        accessibilityLabel: 'Proceed with JCB',
      });
      expect(proceedButton.props.accessibilityState.disabled).toBe(false);

      const buttonTexts = proceedButton.findAllByType(Text).map((t: any) => t.props.children).flat().join(' ');
      expect(buttonTexts).toContain('Proceed With JCB');
    });

    it('proceeds with JCB without creating a fake server quote', async () => {
      const renderer = await renderWithBooking();
      const cards = renderer.root.findAllByType(VehicleOptionCard);
      const jcbCard = cards.find((c) => c.props.name === 'JCB')!;

      await act(async () => {
        (jcbCard.props as any).onPress();
      });

      const proceedButton = (renderer.root as any).findByProps({
        accessibilityLabel: 'Proceed with JCB',
      });

      await act(async () => {
        proceedButton.props.onPress();
      });

      expect(mockSetVehicleType).toHaveBeenCalledWith('JCB');
      // Must not fabricate a quote
      expect(mockSetQuote).toHaveBeenCalledWith(undefined);
      expect(mockNavigate).toHaveBeenCalledWith('GoodsDetailsScreen');
    });

    it('allows selecting Crane, deselecting JCB and proceeding with Crane', async () => {
      const renderer = await renderWithBooking();
      let cards = renderer.root.findAllByType(VehicleOptionCard);
      const jcbCard = cards.find((c) => c.props.name === 'JCB')!;
      const craneCard = cards.find((c) => c.props.name === 'Crane')!;

      // Select JCB first
      await act(async () => {
        (jcbCard.props as any).onPress();
      });

      // Now tap Crane
      await act(async () => {
        (craneCard.props as any).onPress();
      });

      cards = renderer.root.findAllByType(VehicleOptionCard);
      const jcbCardAfter = cards.find((c) => c.props.name === 'JCB')!;
      const craneCardAfter = cards.find((c) => c.props.name === 'Crane')!;

      // Crane is selected, JCB is deselected
      expect(craneCardAfter.props.selected).toBe(true);
      expect(jcbCardAfter.props.selected).toBe(false);

      const proceedButton = (renderer.root as any).findByProps({
        accessibilityLabel: 'Proceed with Crane',
      });
      expect(proceedButton.props.accessibilityState.disabled).toBe(false);

      const buttonTexts = proceedButton.findAllByType(Text).map((t: any) => t.props.children).flat().join(' ');
      expect(buttonTexts).toContain('Proceed With Crane');

      // Tap proceed
      await act(async () => {
        proceedButton.props.onPress();
      });

      expect(mockSetVehicleType).toHaveBeenCalledWith('Crane');
      expect(mockSetQuote).toHaveBeenCalledWith(undefined);
      expect(mockNavigate).toHaveBeenCalledWith('GoodsDetailsScreen');
    });

    it('verifies all six vehicle categories can be selected one at a time and updates button label', async () => {
      const renderer = await renderWithBooking();

      const expectations = [
        { id: 'bike', expectedName: 'Bike / 2-Wheeler', expectedButton: 'Proceed With Bike' },
        { id: '3-wheeler', expectedName: '3-Wheeler / E-Loader', expectedButton: 'Proceed With 3-Wheeler' },
        { id: 'mini-truck', expectedName: 'Mini Truck / Tata Ace', expectedButton: 'Proceed With Mini Truck' },
        { id: 'pickup', expectedName: 'Pickup / Bolero', expectedButton: 'Proceed With Pickup' },
        { id: 'jcb', expectedName: 'JCB', expectedButton: 'Proceed With JCB' },
        { id: 'crane', expectedName: 'Crane', expectedButton: 'Proceed With Crane' },
      ];

      for (const item of expectations) {
        const cards = renderer.root.findAllByType(VehicleOptionCard);
        const targetCard = cards.find((c) => c.props.name === item.expectedName)!;

        await act(async () => {
          (targetCard.props as any).onPress();
        });

        const updatedCards = renderer.root.findAllByType(VehicleOptionCard);
        const selectedCount = updatedCards.filter((c) => c.props.selected).length;
        // Exactly one vehicle selected at a time
        expect(selectedCount).toBe(1);

        const activeCard = updatedCards.find((c) => c.props.name === item.expectedName)!;
        expect(activeCard.props.selected).toBe(true);

        const proceedButton = (renderer.root as any).findByProps({
          accessibilityLabel: `Proceed with ${item.expectedButton.replace('Proceed With ', '')}`,
        });
        const buttonTexts = proceedButton.findAllByType(Text).map((t: any) => t.props.children).flat().join(' ');
        expect(buttonTexts).toContain(item.expectedButton);
      }
    });
  });
});

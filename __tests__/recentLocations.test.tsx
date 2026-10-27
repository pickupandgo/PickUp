import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getRecentLocations,
  saveRecentLocation,
  clearRecentLocations,
  getRecentLocationsStorageKey,
} from '../src/state/recentLocations';
import HomeScreen from '../src/screens/home/HomeScreen';
import AddressSearchScreen from '../src/screens/booking/AddressSearchScreen';
import { BookingProvider, useBooking } from '../src/state/BookingContext';
import { saveAddress } from '../src/state/savedAddresses';

// Mock config
jest.mock('../src/config/env', () => ({
  env: { apiBaseUrl: 'https://engine.test', paymentsApiBaseUrl: 'https://pay.test', googleMapsApiKey: '' },
  hasApiConfig: () => true,
  hasPaymentsConfig: () => true,
  assertApiConfig: () => undefined,
}));

// Mock Engine API
jest.mock('../src/api/engine', () => ({
  getActiveTripForCustomer: jest.fn(async () => null),
  fetchNearbyDrivers: jest.fn(async () => []),
}));

// Mock Nearby Drivers
jest.mock('../src/hooks/useNearbyDrivers', () => ({
  useNearbyDrivers: () => ({
    drivers: [],
    error: undefined,
    isLoading: false,
    refresh: jest.fn(),
  }),
}));

// Mock Geocoding
const mockPlace = {
  address: 'Clock Tower, Ghantaghar, Jodhpur',
  latitude: 26.2978,
  longitude: 73.0243,
  placeId: 'place_clock_tower',
};

jest.mock('../src/api/geocoding', () => ({
  getCurrentPlace: jest.fn(async () => mockPlace),
  reverseGeocode: jest.fn(async () => 'Clock Tower, Jodhpur'),
  searchPlaces: jest.fn(async () => []),
  LocationPermissionDeniedError: class LocationPermissionDeniedError extends Error {},
}));

const sleep = (ms: number) => new Promise((res) => setTimeout(() => res(undefined), ms));

describe('Recent Locations Feature & Requirements', () => {
  let memoryStorage: Record<string, string> = {};

  beforeEach(() => {
    memoryStorage = {};
    (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) => {
      return memoryStorage[key] ?? null;
    });
    (AsyncStorage.setItem as jest.Mock).mockImplementation(async (key: string, val: string) => {
      memoryStorage[key] = val;
    });
    (AsyncStorage.removeItem as jest.Mock).mockImplementation(async (key: string) => {
      delete memoryStorage[key];
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('1. Storage & State Management', () => {
    it('isolates recent searches by user ID in storage key', () => {
      expect(getRecentLocationsStorageKey('user-123')).toBe('pickup.recentLocations.user-123');
      expect(getRecentLocationsStorageKey('user-456')).toBe('pickup.recentLocations.user-456');
      expect(getRecentLocationsStorageKey('')).toBe('pickup.recentLocations.guest');
      expect(getRecentLocationsStorageKey(null)).toBe('pickup.recentLocations.guest');
    });

    it('returns empty array when user has no search history', async () => {
      const list = await getRecentLocations('new-user');
      expect(list).toEqual([]);
    });

    it('saves a searched location with name, address, coordinates, and timestamp', async () => {
      const saved = await saveRecentLocation(
        {
          name: 'Clock Tower',
          address: 'Clock Tower, Ghantaghar, Jodhpur',
          latitude: 26.2978,
          longitude: 73.0243,
          placeId: 'place_clock_tower',
        },
        'user-1'
      );

      expect(saved.length).toBe(1);
      expect(saved[0].name).toBe('Clock Tower');
      expect(saved[0].address).toBe('Clock Tower, Ghantaghar, Jodhpur');
      expect(saved[0].latitude).toBe(26.2978);
      expect(saved[0].longitude).toBe(73.0243);
      expect(saved[0].placeId).toBe('place_clock_tower');
      expect(typeof saved[0].searchedAt).toBe('number');
    });

    it('orders locations descending by search time (newest search first)', async () => {
      await saveRecentLocation(
        {
          name: 'First Place',
          address: 'Address 1, Jodhpur',
          latitude: 26.29,
          longitude: 73.02,
        },
        'user-1'
      );

      // Save second place after a brief delay
      await sleep(10);

      await saveRecentLocation(
        {
          name: 'Second Place',
          address: 'Address 2, Jodhpur',
          latitude: 26.31,
          longitude: 73.04,
        },
        'user-1'
      );

      const list = await getRecentLocations('user-1');
      expect(list.length).toBe(2);
      expect(list[0].name).toBe('Second Place');
      expect(list[1].name).toBe('First Place');
      expect(list[0].searchedAt).toBeGreaterThanOrEqual(list[1].searchedAt);
    });

    it('deduplicates: searching same location moves it to top without duplicating', async () => {
      await saveRecentLocation(
        {
          name: 'Location A',
          address: 'Address A, Jodhpur',
          latitude: 26.28,
          longitude: 73.01,
          placeId: 'place_a',
        },
        'user-1'
      );

      await sleep(10);

      await saveRecentLocation(
        {
          name: 'Location B',
          address: 'Address B, Jodhpur',
          latitude: 26.30,
          longitude: 73.03,
          placeId: 'place_b',
        },
        'user-1'
      );

      let list = await getRecentLocations('user-1');
      expect(list.length).toBe(2);
      expect(list[0].name).toBe('Location B');
      expect(list[1].name).toBe('Location A');

      // Re-search Location A
      await sleep(10);
      await saveRecentLocation(
        {
          name: 'Location A Updated Name',
          address: 'Address A, Jodhpur',
          latitude: 26.28,
          longitude: 73.01,
          placeId: 'place_a',
        },
        'user-1'
      );

      list = await getRecentLocations('user-1');
      // No duplicate added: still 2 items
      expect(list.length).toBe(2);
      // Location A is now bumped to the top!
      expect(list[0].placeId).toBe('place_a');
      expect(list[1].placeId).toBe('place_b');
    });

    it('enforces user isolation: User A searches are never shown to User B', async () => {
      await saveRecentLocation(
        {
          name: 'User A Secret Location',
          address: '123 Private St, Jodhpur',
          latitude: 26.25,
          longitude: 73.00,
        },
        'user-a'
      );

      const userAList = await getRecentLocations('user-a');
      const userBList = await getRecentLocations('user-b');

      expect(userAList.length).toBe(1);
      expect(userAList[0].name).toBe('User A Secret Location');
      expect(userBList).toEqual([]);
    });

    it('persists recent searches across app restarts', async () => {
      await saveRecentLocation(
        {
          name: 'Persisted Place',
          address: 'Main Road, Jodhpur',
          latitude: 26.27,
          longitude: 73.05,
        },
        'user-persistent'
      );

      // Verify it was written to AsyncStorage
      const key = getRecentLocationsStorageKey('user-persistent');
      expect(memoryStorage[key]).toBeDefined();

      // Read back as if restarting
      const recovered = await getRecentLocations('user-persistent');
      expect(recovered.length).toBe(1);
      expect(recovered[0].name).toBe('Persisted Place');
    });

    it('clears recent searches when clearRecentLocations is called', async () => {
      await saveRecentLocation(
        {
          name: 'To Clear',
          address: 'Clear Road',
          latitude: 26.20,
          longitude: 73.00,
        },
        'user-clear'
      );

      await clearRecentLocations('user-clear');
      const list = await getRecentLocations('user-clear');
      expect(list).toEqual([]);
    });
  });

  describe('2. HomeScreen UI Integration', () => {
    it('renders empty-state message when user has no recent searches', async () => {
      let renderer: ReactTestRenderer | undefined;
      await act(async () => {
        renderer = TestRenderer.create(
          <BookingProvider>
            <HomeScreen />
          </BookingProvider>
        );
      });

      const root = renderer!.root;
      const textNodes = root.findAllByType(Text);
      const textContents = textNodes.map((n: any) => n.props.children).flat().join(' ');

      // Must display clean empty state message
      expect(textContents).toContain('No recent searches yet.');
      expect(textContents).toContain('Your recently searched locations will appear here.');

      // Must NOT display any hardcoded sample locations
      expect(textContents).not.toContain('Sardarpura Warehouse');
      expect(textContents).not.toContain('Ratanada Hub');
      expect(textContents).not.toContain('Paota Godown');

      act(() => {
        renderer?.unmount();
      });
    });

    it('renders actual saved recent locations instead of hardcoded examples', async () => {
      // Seed storage with actual searches for default guest user
      const guestKey = getRecentLocationsStorageKey(null);
      memoryStorage[guestKey] = JSON.stringify([
        {
          id: 'rec-1',
          name: 'Clock Tower Jodhpur',
          address: 'Ghantaghar, Jodhpur, Rajasthan',
          latitude: 26.2978,
          longitude: 73.0243,
          searchedAt: Date.now(),
        },
        {
          id: 'rec-2',
          name: 'Mehrangarh Fort',
          address: 'Fort Road, Jodhpur, Rajasthan',
          latitude: 26.2982,
          longitude: 73.0189,
          searchedAt: Date.now() - 5000,
        },
      ]);

      let renderer: ReactTestRenderer | undefined;
      await act(async () => {
        renderer = TestRenderer.create(
          <BookingProvider>
            <HomeScreen />
          </BookingProvider>
        );
      });

      const root = renderer!.root;
      const textNodes = root.findAllByType(Text);
      const textContents = textNodes.map((n: any) => n.props.children).flat().join(' ');

      // Contains the user's actual searches
      expect(textContents).toContain('Clock Tower Jodhpur');
      expect(textContents).toContain('Ghantaghar, Jodhpur, Rajasthan');
      expect(textContents).toContain('Mehrangarh Fort');
      expect(textContents).toContain('Fort Road, Jodhpur, Rajasthan');

      // Does not show empty state
      expect(textContents).not.toContain('No recent searches yet.');

      act(() => {
        renderer?.unmount();
      });
    });

    it('tapping a recent location sets pendingDrop and navigates without auto-booking', async () => {
      const guestKey = getRecentLocationsStorageKey(null);
      memoryStorage[guestKey] = JSON.stringify([
        {
          id: 'rec-1',
          name: 'Umaid Bhawan',
          address: 'Circuit House Rd, Jodhpur',
          latitude: 26.2809,
          longitude: 73.0475,
          searchedAt: Date.now(),
        },
      ]);

      let bookingApi: any;
      const TestConsumer = () => {
        bookingApi = useBooking();
        return null;
      };

      const mockNavigate = jest.fn();
      const mockRecentPress = jest.fn();

      let renderer: ReactTestRenderer | undefined;
      await act(async () => {
        renderer = TestRenderer.create(
          <BookingProvider>
            <TestConsumer />
            <HomeScreen
              navigation={{ navigate: mockNavigate }}
              onRecentLocationPress={mockRecentPress}
            />
          </BookingProvider>
        );
      });

      const root = renderer!.root;

      // Find the row for Umaid Bhawan
      const textNodes = root.findAllByType(Text);
      const itemNode = textNodes.find((n: any) => n.props.children === 'Umaid Bhawan');
      expect(itemNode).toBeDefined();

      // Find the clickable parent row (ListRow has onPress)
      let clickableParent: any = (itemNode as any)?.parent;
      while (clickableParent && !clickableParent.props.onPress) {
        clickableParent = clickableParent.parent;
      }
      expect(clickableParent).toBeDefined();

      // Tap on recent location
      await act(async () => {
        clickableParent.props.onPress();
      });

      // Verify location details are passed to pendingDrop
      expect(bookingApi.draft.pendingDrop).toBeDefined();
      expect(bookingApi.draft.pendingDrop.address).toBe('Circuit House Rd, Jodhpur');
      expect(bookingApi.draft.pendingDrop.latitude).toBe(26.2809);
      expect(bookingApi.draft.pendingDrop.longitude).toBe(73.0475);

      // Verify it called onRecentLocationPress
      expect(mockRecentPress).toHaveBeenCalledWith('Circuit House Rd, Jodhpur');

      // Verify it navigated to SelectDropLocationScreen in BookingStack
      expect(mockNavigate).toHaveBeenCalledWith('BookingStack', {
        screen: 'SelectDropLocationScreen',
      });

      // Verify no trip was booked / created
      expect(bookingApi.trip).toBeUndefined();

      act(() => {
        renderer?.unmount();
      });
    });
  });

  describe('3. AddressSearchScreen Integration', () => {
    it('displays empty state on AddressSearchScreen when user has no previous searches', async () => {
      let renderer: ReactTestRenderer | undefined;
      await act(async () => {
        renderer = TestRenderer.create(
          <BookingProvider>
            <AddressSearchScreen />
          </BookingProvider>
        );
      });

      const root = renderer!.root;
      const textNodes = root.findAllByType(Text);
      const textContents = textNodes.map((n: any) => n.props.children).flat().join(' ');

      expect(textContents).toContain('RECENT SEARCHES');
      expect(textContents).toContain('No recent searches yet.');
      expect(textContents).toContain('Your searched locations will appear here.');

      act(() => {
        renderer?.unmount();
      });
    });

    it('displays recent searches in AddressSearchScreen when query is empty', async () => {
      const guestKey = getRecentLocationsStorageKey(null);
      memoryStorage[guestKey] = JSON.stringify([
        {
          id: 'rec-1',
          name: 'Kaylana Lake',
          address: 'Kaylana Lake, Jodhpur',
          latitude: 26.29,
          longitude: 72.98,
          searchedAt: Date.now(),
        },
      ]);

      let renderer: ReactTestRenderer | undefined;
      await act(async () => {
        renderer = TestRenderer.create(
          <BookingProvider>
            <AddressSearchScreen />
          </BookingProvider>
        );
      });

      const root = renderer!.root;
      const textNodes = root.findAllByType(Text);
      const textContents = textNodes.map((n: any) => n.props.children).flat().join(' ');

      expect(textContents).toContain('RECENT SEARCHES');
      expect(textContents).toContain('Kaylana Lake');

      act(() => {
        renderer?.unmount();
      });
    });

    it('in pickup mode (Pick Up screen), selecting a recent search populates draft.pickup', async () => {
      const guestKey = getRecentLocationsStorageKey(null);
      memoryStorage[guestKey] = JSON.stringify([
        {
          id: 'rec-pickup',
          name: 'Jodhpur Railway Station',
          address: 'Station Rd, Ratanada, Jodhpur',
          latitude: 26.285,
          longitude: 73.021,
          searchedAt: Date.now(),
        },
      ]);

      const mockNavigate = jest.fn();
      let bookingApi: any;
      const TestConsumer = () => {
        bookingApi = useBooking();
        return null;
      };

      let renderer: ReactTestRenderer | undefined;
      await act(async () => {
        renderer = TestRenderer.create(
          <BookingProvider>
            <TestConsumer />
            <AddressSearchScreen
              route={{ params: { mode: 'pickup' } }}
              navigation={{ navigate: mockNavigate }}
            />
          </BookingProvider>
        );
      });

      const root = renderer!.root;
      const textNodes = root.findAllByType(Text);
      const itemNode = textNodes.find((n: any) => n.props.children === 'Jodhpur Railway Station');
      expect(itemNode).toBeDefined();

      let pressableParent: any = (itemNode as any)?.parent;
      while (pressableParent && !pressableParent.props.onPress) {
        pressableParent = pressableParent.parent;
      }

      await act(async () => {
        pressableParent.props.onPress();
      });

      // Verify draft.pickup was populated (NOT pendingDrop)
      expect(bookingApi.draft.pickup).toBeDefined();
      expect(bookingApi.draft.pickup.address).toBe('Station Rd, Ratanada, Jodhpur');
      expect(bookingApi.draft.pendingDrop).toBeUndefined();

      // Navigated to SelectLocationScreen with mode: pickup
      expect(mockNavigate).toHaveBeenCalledWith('SelectLocationScreen', { mode: 'pickup' });

      act(() => {
        renderer?.unmount();
      });
    });

    it('in drop mode, selecting a recent search populates draft.pendingDrop', async () => {
      const guestKey = getRecentLocationsStorageKey(null);
      memoryStorage[guestKey] = JSON.stringify([
        {
          id: 'rec-drop',
          name: 'AIIMS Jodhpur',
          address: 'Basni Industrial Area, Jodhpur',
          latitude: 26.241,
          longitude: 73.012,
          searchedAt: Date.now(),
        },
      ]);

      const mockNavigate = jest.fn();
      let bookingApi: any;
      const TestConsumer = () => {
        bookingApi = useBooking();
        return null;
      };

      let renderer: ReactTestRenderer | undefined;
      await act(async () => {
        renderer = TestRenderer.create(
          <BookingProvider>
            <TestConsumer />
            <AddressSearchScreen
              route={{ params: { mode: 'drop' } }}
              navigation={{ navigate: mockNavigate }}
            />
          </BookingProvider>
        );
      });

      const root = renderer!.root;
      const textNodes = root.findAllByType(Text);
      const itemNode = textNodes.find((n: any) => n.props.children === 'AIIMS Jodhpur');
      expect(itemNode).toBeDefined();

      let pressableParent: any = (itemNode as any)?.parent;
      while (pressableParent && !pressableParent.props.onPress) {
        pressableParent = pressableParent.parent;
      }

      await act(async () => {
        pressableParent.props.onPress();
      });

      // Verify draft.pendingDrop was populated
      expect(bookingApi.draft.pendingDrop).toBeDefined();
      expect(bookingApi.draft.pendingDrop.address).toBe('Basni Industrial Area, Jodhpur');

      // Navigated to SelectDropLocationScreen
      expect(mockNavigate).toHaveBeenCalledWith('SelectDropLocationScreen');

      act(() => {
        renderer?.unmount();
      });
    });

    it('selecting a suggestion saves it into recent locations and shares with Home screen', async () => {
      const mockNavigate = jest.fn();
      let bookingApi: any;
      const TestConsumer = () => {
        bookingApi = useBooking();
        return null;
      };

      let renderer: ReactTestRenderer | undefined;
      await act(async () => {
        renderer = TestRenderer.create(
          <BookingProvider>
            <TestConsumer />
            <AddressSearchScreen navigation={{ navigate: mockNavigate }} />
          </BookingProvider>
        );
      });

      const root = renderer!.root;

      // Tap "Current Location" quick action button
      const textNodes = root.findAllByType(Text);
      const currLocNode = textNodes.find((n: any) => n.props.children === 'Current Location');
      let pressableParent: any = (currLocNode as any)?.parent;
      while (pressableParent && !pressableParent.props.onPress) {
        pressableParent = pressableParent.parent;
      }

      await act(async () => {
        await pressableParent.props.onPress();
      });

      // Verify recent location was saved
      const recent = await getRecentLocations(null);
      expect(recent.length).toBe(1);
      expect(recent[0].address).toBe(mockPlace.address);
      expect(recent[0].latitude).toBe(mockPlace.latitude);
      expect(recent[0].longitude).toBe(mockPlace.longitude);

      // Verify pendingDrop was set and navigated
      expect(bookingApi.draft.pendingDrop.address).toBe(mockPlace.address);
      expect(mockNavigate).toHaveBeenCalledWith('SelectDropLocationScreen');

      act(() => {
        renderer?.unmount();
      });

      // Now verify Home screen displays this newly saved search!
      let homeRenderer: ReactTestRenderer | undefined;
      await act(async () => {
        homeRenderer = TestRenderer.create(
          <BookingProvider>
            <HomeScreen />
          </BookingProvider>
        );
      });

      const homeRoot = homeRenderer!.root;
      const homeTextNodes = homeRoot.findAllByType(Text);
      const homeContents = homeTextNodes.map((n: any) => n.props.children).flat().join(' ');

      expect(homeContents).toContain(mockPlace.address);

      act(() => {
        homeRenderer?.unmount();
      });
    });

    it('displays saved addresses (Home, Office) in AddressSearchScreen and allows selecting them', async () => {
      await saveAddress(
        { id: '1', title: 'Home', icon: 'home', addressLine1: 'My Home', addressLine2: 'Jodhpur', isPrimary: true },
        'guest'
      );
      await saveAddress(
        { id: '2', title: 'Office', icon: 'briefcase', addressLine1: 'My Office', addressLine2: 'Jodhpur', isPrimary: false },
        'guest'
      );

      const mockNavigate = jest.fn();
      let bookingApi: any;
      const TestConsumer = () => {
        bookingApi = useBooking();
        return null;
      };

      let renderer: ReactTestRenderer | undefined;
      await act(async () => {
        renderer = TestRenderer.create(
          <BookingProvider>
            <TestConsumer />
            <AddressSearchScreen
              route={{ params: { mode: 'pickup' } }}
              navigation={{ navigate: mockNavigate }}
            />
          </BookingProvider>
        );
      });

      const root = renderer!.root;
      const textNodes = root.findAllByType(Text);
      const textContents = textNodes.map((n: any) => n.props.children).flat().join(' ');

      // Verify Saved Places section is visible with Home and Office
      expect(textContents).toContain('SAVED PLACES');
      expect(textContents).toContain('Home');
      expect(textContents).toContain('Office');

      // Find Home item and press it
      const homeNode = textNodes.find((n: any) => n.props.children === 'Home');
      expect(homeNode).toBeDefined();

      let pressableParent: any = (homeNode as any)?.parent;
      while (pressableParent && !pressableParent.props.onPress) {
        pressableParent = pressableParent.parent;
      }

      await act(async () => {
        await pressableParent.props.onPress();
      });

      // In pickup mode, selecting Home should populate draft.pickup and navigate to SelectLocationScreen
      expect(bookingApi.draft.pickup).toBeDefined();
      expect(bookingApi.draft.pickup.address).toContain('My Home');
      expect(mockNavigate).toHaveBeenCalledWith('SelectLocationScreen', { mode: 'pickup' });

      act(() => {
        renderer?.unmount();
      });
    });
  });
});

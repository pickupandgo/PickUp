import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text, TextInput, Pressable, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import SavedAddressesScreen, { splitAddressLines } from '../src/screens/profile/SavedAddressesScreen';
import {
  getSavedAddresses,
  saveAddress,
  updateSavedAddress,
  deleteSavedAddress,
  setPrimarySavedAddress,
  DEFAULT_SAVED_ADDRESSES,
} from '../src/state/savedAddresses';

// Mock dependencies
jest.mock('react-native-vector-icons/Feather', () => 'Feather');
jest.mock('react-native-vector-icons/MaterialIcons', () => 'MaterialIcons');

jest.mock('../src/state/BookingContext', () => ({
  useBooking: () => ({
    customerId: 'cust-test-123',
  }),
}));

jest.mock('../src/api/geocoding', () => ({
  getCurrentPlace: jest.fn().mockResolvedValue({
    address: '15, Residency Road, Jodhpur, Rajasthan 342001',
    latitude: 26.28,
    longitude: 73.02,
  }),
}));

describe('Saved Addresses — Edit, Delete, and Add Address Management', () => {
  let memoryStorage: Record<string, string> = {};

  beforeEach(() => {
    jest.clearAllMocks();
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

  describe('1. savedAddresses State & AsyncStorage Logic', () => {
    it('returns empty array when AsyncStorage is empty', async () => {
      const addresses = await getSavedAddresses('user-1');
      expect(addresses.length).toBe(0);
    });

    it('saves a new address to persistent storage', async () => {
      const updated = await saveAddress(
        {
          title: 'Mom Home',
          icon: 'home',
          addressLine1: '45, Ratanada',
          addressLine2: 'Near Circuit House, Jodhpur',
          isPrimary: false,
        },
        'user-1'
      );

      expect(updated.some((a) => a.title === 'Mom Home')).toBe(true);
      const reloaded = await getSavedAddresses('user-1');
      expect(reloaded.some((a) => a.title === 'Mom Home')).toBe(true);
    });

    it('updates an existing address in storage', async () => {
      await saveAddress(
        { id: 'addr-1', title: 'Office', addressLine1: 'Tech Hub, 4th Floor', addressLine2: 'Jodhpur', isPrimary: false },
        'user-1'
      );

      const updated = await updateSavedAddress(
        'addr-1',
        {
          title: 'Head Office',
          addressLine1: 'Tech Hub, 6th Floor',
        },
        'user-1'
      );

      const modified = updated.find((a) => a.id === 'addr-1');
      expect(modified?.title).toBe('Head Office');
      expect(modified?.addressLine1).toBe('Tech Hub, 6th Floor');
    });

    it('deletes an address from storage', async () => {
      await saveAddress(
        { id: 'addr-del', title: 'Warehouse B', addressLine1: 'Plot 45', addressLine2: 'Jodhpur', isPrimary: false },
        'user-1'
      );

      const updated = await deleteSavedAddress('addr-del', 'user-1');
      expect(updated.find((a) => a.id === 'addr-del')).toBeUndefined();

      const reloaded = await getSavedAddresses('user-1');
      expect(reloaded.find((a) => a.id === 'addr-del')).toBeUndefined();
    });

    it('sets an address as primary and clears primary on others', async () => {
      await saveAddress(
        { id: 'addr-p1', title: 'Home', addressLine1: '123 St', addressLine2: 'Jodhpur', isPrimary: true },
        'user-1'
      );
      await saveAddress(
        { id: 'addr-p2', title: 'Office', addressLine1: '456 Ave', addressLine2: 'Jodhpur', isPrimary: false },
        'user-1'
      );

      const updated = await setPrimarySavedAddress('addr-p2', 'user-1');
      const newPrimary = updated.find((a) => a.id === 'addr-p2');
      const oldPrimary = updated.find((a) => a.id === 'addr-p1');

      expect(newPrimary?.isPrimary).toBe(true);
      expect(oldPrimary?.isPrimary).toBe(false);
    });
  });

  describe('2. SavedAddressesScreen UI Interactions', () => {
    beforeEach(async () => {
      await saveAddress(
        { id: '1', title: 'Home', icon: 'home', addressLine1: 'Sector C', addressLine2: 'Jodhpur', isPrimary: true },
        'cust-test-123'
      );
      await saveAddress(
        { id: '2', title: 'Office', icon: 'briefcase', addressLine1: 'Corporate Park', addressLine2: 'Jodhpur', isPrimary: false },
        'cust-test-123'
      );
      await saveAddress(
        { id: '3', title: 'Warehouse B', icon: 'box', addressLine1: 'Industrial Zone', addressLine2: 'Jodhpur', isPrimary: false },
        'cust-test-123'
      );
    });

    it('renders empty state when no saved addresses exist', async () => {
      memoryStorage = {};
      let renderer: any;
      await act(async () => {
        renderer = TestRenderer.create(<SavedAddressesScreen />);
      });

      const root = renderer.root;
      const emptyState = root.findByProps({ testID: 'saved-addresses-empty-state' });
      expect(emptyState).toBeDefined();
    });

    it('renders saved addresses with edit and delete buttons', async () => {
      let renderer: any;
      await act(async () => {
        renderer = TestRenderer.create(<SavedAddressesScreen />);
      });

      const root = renderer.root;
      // Should find address cards
      const editButton1 = root.findByProps({ testID: 'edit-address-1' });
      const deleteButton1 = root.findByProps({ testID: 'delete-address-1' });
      const addButton = root.findByProps({ testID: 'add-new-address-button' });

      expect(editButton1).toBeDefined();
      expect(deleteButton1).toBeDefined();
      expect(addButton).toBeDefined();
    });

    it('opens add modal on clicking "+ ADD NEW ADDRESS" without navigating to drop screen', async () => {
      const mockNavigate = jest.fn();
      let renderer: any;
      await act(async () => {
        renderer = TestRenderer.create(
          <SavedAddressesScreen navigation={{ navigate: mockNavigate, goBack: jest.fn() }} />
        );
      });

      const root = renderer.root;
      const addButton = root.findByProps({ testID: 'add-new-address-button' });

      await act(async () => {
        addButton.props.onPress();
      });

      // Verify it did NOT navigate to SelectDropLocationScreen or AddressSearchScreen!
      expect(mockNavigate).not.toHaveBeenCalled();

      // Verify modal is open
      const modalSheet = root.findByProps({ testID: 'address-modal-sheet' });
      expect(modalSheet).toBeDefined();

      const modalTitle = root.findAllByType(Text).find((t: any) => t.props.children === 'Add New Address');
      expect(modalTitle).toBeDefined();
    });

    it('saves a new address through the modal form', async () => {
      let renderer: any;
      await act(async () => {
        renderer = TestRenderer.create(<SavedAddressesScreen />);
      });

      const root = renderer.root;
      const addButton = root.findByProps({ testID: 'add-new-address-button' });

      // Open modal
      await act(async () => {
        addButton.props.onPress();
      });

      // Fill in fields
      const titleInput = root.findByProps({ testID: 'address-title-input' });
      const line1Input = root.findByProps({ testID: 'address-line1-input' });
      const line2Input = root.findByProps({ testID: 'address-line2-input' });

      await act(async () => {
        titleInput.props.onChangeText('Shop C');
        line1Input.props.onChangeText('Shop 12, Sojati Gate');
        line2Input.props.onChangeText('Main Market, Jodhpur, 342001');
      });

      // Submit
      const submitButton = root.findByProps({ testID: 'save-address-submit-button' });
      await act(async () => {
        await submitButton.props.onPress();
      });

      // Verify newly saved address is now in the rendered list
      const allTexts = root.findAllByType(Text).map((t: any) => t.props.children);
      expect(allTexts).toContain('Shop C');
      expect(allTexts).toContain('Shop 12, Sojati Gate');
    });

    it('opens edit modal with pre-filled address data and saves changes', async () => {
      const mockNavigate = jest.fn();
      let renderer: any;
      await act(async () => {
        renderer = TestRenderer.create(
          <SavedAddressesScreen navigation={{ navigate: mockNavigate, goBack: jest.fn() }} />
        );
      });

      const root = renderer.root;
      const editButton2 = root.findByProps({ testID: 'edit-address-2' });

      await act(async () => {
        editButton2.props.onPress();
      });

      // Ensure no navigation away to drop selection
      expect(mockNavigate).not.toHaveBeenCalled();

      // Check pre-populated title
      const titleInput = root.findByProps({ testID: 'address-title-input' });
      expect(titleInput.props.value).toBe('Office');

      // Edit title
      await act(async () => {
        titleInput.props.onChangeText('Regional Office');
      });

      // Submit edits
      const submitButton = root.findByProps({ testID: 'save-address-submit-button' });
      await act(async () => {
        await submitButton.props.onPress();
      });

      // Verify edited title appears in the list
      const allTexts = root.findAllByType(Text).map((t: any) => t.props.children);
      expect(allTexts).toContain('Regional Office');
    });

    it('triggers delete confirmation alert when delete icon is pressed', async () => {
      const alertSpy = jest.spyOn(Alert, 'alert');
      let renderer: any;
      await act(async () => {
        renderer = TestRenderer.create(<SavedAddressesScreen />);
      });

      const root = renderer.root;
      const deleteButton = root.findByProps({ testID: 'delete-address-3' });

      await act(async () => {
        deleteButton.props.onPress();
      });

      expect(alertSpy).toHaveBeenCalledWith(
        'Delete Address',
        expect.stringContaining('Warehouse B'),
        expect.any(Array)
      );

      // Execute the destructive delete button from Alert.alert arguments
      const alertButtons = alertSpy.mock.calls[0][2] as any[];
      const deleteAction = alertButtons.find((btn) => btn.style === 'destructive');
      expect(deleteAction).toBeDefined();

      await act(async () => {
        deleteAction.onPress();
      });

      // Warehouse B should now be removed from the list
      const allTexts = root.findAllByType(Text).map((t: any) => t.props.children);
      expect(allTexts).not.toContain('Warehouse B');
    });

    it('allows selecting the Other tag from the scrollable tag list', async () => {
      let renderer: any;
      await act(async () => {
        renderer = TestRenderer.create(<SavedAddressesScreen />);
      });

      const root = renderer.root;
      const addButton = root.findByProps({ testID: 'add-new-address-button' });

      await act(async () => {
        addButton.props.onPress();
      });

      // Find the "other" tag chip
      const otherChip = root.findByProps({ testID: 'tag-chip-other' });
      expect(otherChip).toBeDefined();

      await act(async () => {
        otherChip.props.onPress();
      });

      const titleInput = root.findByProps({ testID: 'address-title-input' });
      expect(titleInput.props.value).toBe('Other');
    });

    it('opens Select on Map modal and confirms picked location', async () => {
      let renderer: any;
      await act(async () => {
        renderer = TestRenderer.create(<SavedAddressesScreen />);
      });

      const root = renderer.root;
      const addButton = root.findByProps({ testID: 'add-new-address-button' });

      // Open Add Address modal
      await act(async () => {
        addButton.props.onPress();
      });

      // Click "Select on Map"
      const selectOnMapBtn = root.findByProps({ testID: 'select-on-map-button' });
      expect(selectOnMapBtn).toBeDefined();

      await act(async () => {
        await selectOnMapBtn.props.onPress();
      });

      // Verify map picker modal is visible
      const mapPickerModal = root.findByProps({ testID: 'map-picker-modal' });
      expect(mapPickerModal.props.visible).toBe(true);

      // Confirm the pinned location
      const confirmMapBtn = root.findByProps({ testID: 'map-picker-confirm-button' });
      await act(async () => {
        confirmMapBtn.props.onPress();
      });

      // Map picker should be closed
      expect(mapPickerModal.props.visible).toBe(false);

      // Address fields should now be populated from reverse geocoding
      const line1Input = root.findByProps({ testID: 'address-line1-input' });
      expect(line1Input.props.value).toContain('Residency Road');
    });

    it('renders dedicated quickLocationBar with both Select on Map and Current Location buttons', async () => {
      let renderer: any;
      await act(async () => {
        renderer = TestRenderer.create(<SavedAddressesScreen />);
      });

      const root = renderer.root;
      const addButton = root.findByProps({ testID: 'add-new-address-button' });

      await act(async () => {
        addButton.props.onPress();
      });

      const mapButton = root.findByProps({ testID: 'select-on-map-button' });
      const currentLocButton = root.findByProps({ testID: 'use-current-location-button' });

      expect(mapButton).toBeDefined();
      expect(currentLocButton).toBeDefined();
    });
  });

  describe('3. Address Parsing & Cleaning (splitAddressLines)', () => {
    it('strips leading Google Plus codes and splits building and city/pincode', () => {
      const raw = '6XCC+CW5, Chanakya Puram, Pal Gaon, Pal, Rajasthan 342014, India';
      const result = splitAddressLines(raw);

      expect(result.line1).toBe('Chanakya Puram, Pal Gaon');
      expect(result.line2).toBe('Pal, Rajasthan 342014, India');
    });

    it('splits standard multi-part addresses into two lines', () => {
      const raw = '228, Mansarover Colony, Jodhpur, Pal, Rajasthan 342014, India';
      const result = splitAddressLines(raw);

      expect(result.line1).toBe('228, Mansarover Colony');
      expect(result.line2).toBe('Jodhpur, Pal, Rajasthan 342014, India');
    });

    it('handles short or single-part address without throwing', () => {
      expect(splitAddressLines('Pal Road')).toEqual({ line1: 'Pal Road', line2: '' });
      expect(splitAddressLines('')).toEqual({ line1: '', line2: '' });
    });
  });
});


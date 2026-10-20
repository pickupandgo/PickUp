import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  saveSelectedVehicleId,
  getSelectedVehicleId,
  getVehicleDetails,
  VEHICLE_STORAGE_KEY,
} from '../src/state/vehicle';

describe('Vehicle State & Details', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  it('saves selected vehicle ID to AsyncStorage', async () => {
    await saveSelectedVehicleId('two_wheeler');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(VEHICLE_STORAGE_KEY, 'two_wheeler');
  });

  it('retrieves selected vehicle ID from AsyncStorage', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce('two_wheeler');
    const stored = await getSelectedVehicleId();
    expect(stored).toBe('two_wheeler');
    expect(AsyncStorage.getItem).toHaveBeenCalledWith(VEHICLE_STORAGE_KEY);
  });

  it('returns Bike details when two_wheeler is selected', () => {
    const details = getVehicleDetails('two_wheeler');
    expect(details.id).toBe('two_wheeler');
    expect(details.type).toBe('two_wheeler');
    expect(details.displayName).toBe('Bike / 2-Wheeler');
    expect(details.registration).toBe('RJ 19 XX 1234');
    expect(details.image).toBeDefined();
  });

  it('returns 3-Wheeler details when three_wheeler is selected', () => {
    const details = getVehicleDetails('three_wheeler');
    expect(details.id).toBe('three_wheeler');
    expect(details.displayName).toBe('3-Wheeler / E-Loader');
    expect(details.image).toBeDefined();
  });

  it('returns Bolero Pickup details when pickup is selected', () => {
    const details = getVehicleDetails('pickup');
    expect(details.id).toBe('pickup');
    expect(details.displayName).toBe('Pickup / Bolero');
    expect(details.image).toBeDefined();
  });

  it('returns JCB details when jcb is selected', () => {
    const details = getVehicleDetails('jcb');
    expect(details.id).toBe('jcb');
    expect(details.displayName).toBe('JCB');
    expect(details.image).toBeDefined();
  });

  it('returns Crane details when crane is selected', () => {
    const details = getVehicleDetails('crane');
    expect(details.id).toBe('crane');
    expect(details.displayName).toBe('Crane');
    expect(details.image).toBeDefined();
  });

  it('defaults to Tata Ace (mini_truck) when vehicleId is null or unrecognized', () => {
    const detailsDefault = getVehicleDetails(null);
    expect(detailsDefault.id).toBe('mini_truck');
    expect(detailsDefault.displayName).toBe('Tata Ace');
    expect(detailsDefault.image).toBeDefined();

    const detailsUnknown = getVehicleDetails('unknown_vehicle');
    expect(detailsUnknown.id).toBe('mini_truck');
    expect(detailsUnknown.displayName).toBe('Tata Ace');
  });

  it('supports localization function if passed', () => {
    const mockT = jest.fn((key: string) => {
      if (key === 'vehicle.twoWheeler') return 'बाइक / दोपहिया';
      return key;
    });

    const details = getVehicleDetails('two_wheeler', mockT);
    expect(mockT).toHaveBeenCalledWith('vehicle.twoWheeler');
    expect(details.displayName).toBe('बाइक / दोपहिया');
  });
});

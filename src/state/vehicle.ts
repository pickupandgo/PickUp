import AsyncStorage from '@react-native-async-storage/async-storage';
import { vehicleImages } from '../data/mockData';

export const VEHICLE_STORAGE_KEY = 'driver.selectedVehicleId';

export interface VehicleDetails {
  readonly id: string;
  readonly type: string;
  readonly name: string;
  readonly displayName: string;
  readonly registration: string;
  readonly image: any;
  readonly status: 'approved' | 'pending' | 'under_review' | 'rejected';
}

export const saveSelectedVehicleId = async (vehicleId: string): Promise<void> => {
  try {
    await AsyncStorage.setItem(VEHICLE_STORAGE_KEY, vehicleId);
  } catch (err) {
    console.warn('[vehicleState] Failed to save vehicle ID:', err);
  }
};

export const getSelectedVehicleId = async (): Promise<string | null> => {
  try {
    return await AsyncStorage.getItem(VEHICLE_STORAGE_KEY);
  } catch {
    return null;
  }
};

export const getVehicleDetails = (
  vehicleId?: string | null,
  t?: (key: string) => string,
): VehicleDetails => {
  const id = vehicleId || 'mini_truck';
  const reg = 'RJ 19 XX 1234';

  switch (id) {
    case 'two_wheeler':
    case 'bike':
      return {
        id: 'two_wheeler',
        type: 'two_wheeler',
        name: 'Bike / 2-Wheeler',
        displayName: t ? t('vehicle.twoWheeler') : 'Bike / 2-Wheeler',
        registration: reg,
        image: vehicleImages.two_wheeler,
        status: 'approved',
      };
    case 'three_wheeler':
    case '3-wheeler':
      return {
        id: 'three_wheeler',
        type: 'three_wheeler',
        name: '3-Wheeler / E-Loader',
        displayName: t ? t('vehicle.threeWheeler') : '3-Wheeler / E-Loader',
        registration: reg,
        image: vehicleImages.three_wheeler,
        status: 'approved',
      };
    case 'pickup':
      return {
        id: 'pickup',
        type: 'pickup',
        name: 'Pickup / Bolero',
        displayName: t ? t('vehicle.pickup') : 'Pickup / Bolero',
        registration: reg,
        image: vehicleImages.pickup,
        status: 'approved',
      };
    case 'jcb':
      return {
        id: 'jcb',
        type: 'jcb',
        name: 'JCB',
        displayName: t ? t('vehicle.jcb') : 'JCB',
        registration: reg,
        image: vehicleImages.jcb,
        status: 'approved',
      };
    case 'crane':
      return {
        id: 'crane',
        type: 'crane',
        name: 'Crane',
        displayName: t ? t('vehicle.crane') : 'Crane',
        registration: reg,
        image: vehicleImages.crane,
        status: 'approved',
      };
    case 'mini_truck':
    case 'mini-truck':
    default:
      return {
        id: 'mini_truck',
        type: 'mini_truck',
        name: 'Tata Ace',
        displayName: 'Tata Ace',
        registration: reg,
        image: vehicleImages.mini_truck,
        status: 'approved',
      };
  }
};

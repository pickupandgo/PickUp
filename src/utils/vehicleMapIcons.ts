import type { ImageSourcePropType } from 'react-native';

export type VehicleCategoryKey =
  | 'bike_delivery'
  | 'cargo_three_wheeler'
  | 'box_mini_truck'
  | 'pickup_truck'
  | 'backhoe_loader'
  | 'crane_truck';

export interface VehicleIconDefinition {
  readonly key: VehicleCategoryKey;
  readonly image: ImageSourcePropType;
  readonly displayName: string;
}

/**
 * 3D Vehicle map marker assets (bundled local PNGs with transparent alpha channel).
 */
export const VEHICLE_MAP_ICONS: Record<VehicleCategoryKey, ImageSourcePropType> = {
  bike_delivery: require('../assets/vehicles/map/bike_delivery.png'),
  cargo_three_wheeler: require('../assets/vehicles/map/cargo_three_wheeler.png'),
  box_mini_truck: require('../assets/vehicles/map/box_mini_truck.png'),
  pickup_truck: require('../assets/vehicles/map/pickup_truck.png'),
  backhoe_loader: require('../assets/vehicles/map/backhoe_loader.png'),
  crane_truck: require('../assets/vehicles/map/crane_truck.png'),
};

/**
 * Normalizes any backend vehicle category string into one of the 6 supported 3D icon keys.
 * Never defaults to bike when an unknown or truck type is provided; falls back to box_mini_truck.
 */
export const normalizeVehicleCategory = (rawCategory?: string | null): VehicleCategoryKey => {
  if (!rawCategory) return 'box_mini_truck';

  const clean = rawCategory.trim().toUpperCase().replace(/[\s-]+/g, '_');

  // 1. Heavy Equipment: Backhoe Loader / JCB
  if (
    clean.includes('JCB') ||
    clean.includes('BACKHOE') ||
    clean.includes('EXCAVATOR') ||
    clean.includes('EARTHMOVER')
  ) {
    return 'backhoe_loader';
  }

  // 2. Heavy Equipment: Crane
  if (
    clean.includes('CRANE') ||
    clean.includes('HYDRA')
  ) {
    return 'crane_truck';
  }

  // 3. Two-Wheeler / Bike / Scooter
  if (
    clean === 'TWO_WHEELER' ||
    clean === '2_WHEELER' ||
    clean === '2W' ||
    clean.includes('BIKE') ||
    clean.includes('MOTORCYCLE') ||
    clean.includes('SCOOTER')
  ) {
    return 'bike_delivery';
  }

  // 4. Three-Wheeler / Cargo Auto / Tempo
  if (
    clean === 'THREE_WHEELER' ||
    clean === '3_WHEELER' ||
    clean === '3W' ||
    clean.includes('TEMPO') ||
    clean.includes('AUTO') ||
    clean.includes('RICKSHAW') ||
    clean.includes('E_LOADER') ||
    clean.includes('ELOADER')
  ) {
    return 'cargo_three_wheeler';
  }

  // 5. Pickup / Open Truck / Bolero
  if (
    clean.includes('PICKUP') ||
    clean.includes('BOLERO') ||
    clean.includes('8FT') ||
    clean.includes('OPEN') ||
    clean.includes('MAXI') ||
    clean.includes('1_5_TON') ||
    clean.includes('15TON')
  ) {
    return 'pickup_truck';
  }

  // 6. Mini Truck / Tata Ace / Box Truck
  if (
    clean.includes('MINI_TRUCK') ||
    clean.includes('BOX') ||
    clean.includes('TATA_ACE') ||
    clean.includes('CHHOTA_HATHI') ||
    clean.includes('CONTAINER')
  ) {
    return 'box_mini_truck';
  }

  // Safe default for standard freight/logistics bookings
  return 'box_mini_truck';
};

/**
 * Returns the bundled local 3D vehicle image source for a vehicle category.
 */
export const getVehicleMapIcon = (category?: string | null): ImageSourcePropType => {
  const key = normalizeVehicleCategory(category);
  return VEHICLE_MAP_ICONS[key];
};

/**
 * Returns a human-friendly display name for the vehicle category.
 */
export const getVehicleCategoryDisplayName = (category?: string | null): string => {
  const key = normalizeVehicleCategory(category);
  switch (key) {
    case 'bike_delivery':
      return 'Delivery Bike';
    case 'cargo_three_wheeler':
      return 'Cargo 3-Wheeler';
    case 'box_mini_truck':
      return 'Box Mini Truck';
    case 'pickup_truck':
      return 'Pickup Truck';
    case 'backhoe_loader':
      return 'Backhoe Loader (JCB)';
    case 'crane_truck':
      return 'Crane Truck';
  }
};

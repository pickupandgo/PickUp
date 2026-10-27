import type { ImageSourcePropType } from 'react-native';
import { VEHICLE_MAP_ICONS, getVehicleMapIcon, getVehicleCategoryDisplayName } from './vehicleMapIcons';

export const VEHICLE_IMAGES: Record<string, ImageSourcePropType> = {
  bike: VEHICLE_MAP_ICONS.bike_delivery,
  three_wheeler: VEHICLE_MAP_ICONS.cargo_three_wheeler,
  mini_truck: VEHICLE_MAP_ICONS.box_mini_truck,
  pickup: VEHICLE_MAP_ICONS.pickup_truck,
  jcb: VEHICLE_MAP_ICONS.backhoe_loader,
  crane: VEHICLE_MAP_ICONS.crane_truck,
};

/**
 * Returns the matching 3D vehicle image asset based on the vehicle type or category string.
 */
export const getVehicleImage = (vehicleType?: string): ImageSourcePropType => {
  return getVehicleMapIcon(vehicleType);
};

/**
 * Returns a human-friendly display name for the vehicle type.
 */
export const getVehicleDisplayName = (vehicleType?: string): string => {
  if (!vehicleType) return 'Mini Truck / Tata Ace';
  const norm = vehicleType.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (norm.includes('bike') || norm.includes('2wheel')) return '2-Wheeler / Bike';
  if (norm.includes('3wheel') || norm.includes('auto') || norm.includes('loader')) return '3-Wheeler / E-Loader';
  if (norm.includes('jcb')) return 'JCB';
  if (norm.includes('crane')) return 'Crane';
  if (norm.includes('bolero') || norm.includes('pickup')) return 'Pickup / Bolero';
  if (norm.includes('ace') || norm.includes('mini')) return 'Mini Truck / Tata Ace';
  return vehicleType;
};

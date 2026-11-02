import React from 'react';
import { Image } from 'react-native';
import type { VehicleCategory } from '../../services/onboarding/DriverOnboardingService';

type LegacyCategory =
  | 'two_wheeler'
  | 'three_wheeler'
  | 'mini_truck'
  | 'pickup'
  | 'jcb'
  | 'crane';

// Map by the pictured vehicle: the supplied crane/backhoe and mini/pickup
// filenames are reversed visually. Keep the original files unmodified.
const artwork = {
  bike: require('../../../assets/vehicles/bike.png'),
  threeWheeler: require('../../../assets/vehicles/cargo_three_wheeler.png'),
  miniTruck: require('../../../assets/vehicles/pickup_truck.png'),
  pickup: require('../../../assets/vehicles/mini_truck.png'),
  backhoe: require('../../../assets/vehicles/crane_truck.png'),
  crane: require('../../../assets/vehicles/backhoe_loader.png'),
};
export const categoryArtwork: Record<
  VehicleCategory | LegacyCategory,
  keyof typeof artwork
> = {
  TWO_WHEELER: 'bike',
  THREE_WHEELER: 'threeWheeler',
  FOUR_WHEELER: 'miniTruck',
  MINI_TRUCK: 'miniTruck',
  PICKUP_TRUCK: 'pickup',
  two_wheeler: 'bike',
  three_wheeler: 'threeWheeler',
  mini_truck: 'miniTruck',
  pickup: 'pickup',
  jcb: 'backhoe',
  crane: 'crane',
};

export function VehicleAvatar({
  vehicle,
  size = 72,
}: {
  readonly vehicle: VehicleCategory | LegacyCategory;
  readonly size?: number;
}) {
  return (
    <Image
      source={artwork[categoryArtwork[vehicle]]}
      resizeMode="contain"
      style={{ width: size, height: size }}
      accessible={false}
      testID={`vehicle-avatar-${vehicle}`}
    />
  );
}


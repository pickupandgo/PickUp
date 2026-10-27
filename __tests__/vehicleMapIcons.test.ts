import {
  normalizeVehicleCategory,
  getVehicleMapIcon,
  getVehicleCategoryDisplayName,
  VEHICLE_MAP_ICONS,
} from '../src/utils/vehicleMapIcons';

describe('Customer App - vehicleMapIcons', () => {
  describe('normalizeVehicleCategory', () => {
    it('normalizes two-wheeler / bike variations', () => {
      expect(normalizeVehicleCategory('TWO_WHEELER')).toBe('bike_delivery');
      expect(normalizeVehicleCategory('bike')).toBe('bike_delivery');
      expect(normalizeVehicleCategory('2_WHEELER')).toBe('bike_delivery');
      expect(normalizeVehicleCategory('2W')).toBe('bike_delivery');
      expect(normalizeVehicleCategory('Delivery Motorcycle')).toBe('bike_delivery');
      expect(normalizeVehicleCategory('Scooter')).toBe('bike_delivery');
    });

    it('normalizes three-wheeler / auto / tempo variations', () => {
      expect(normalizeVehicleCategory('THREE_WHEELER')).toBe('cargo_three_wheeler');
      expect(normalizeVehicleCategory('3_WHEELER')).toBe('cargo_three_wheeler');
      expect(normalizeVehicleCategory('3w')).toBe('cargo_three_wheeler');
      expect(normalizeVehicleCategory('Tempo')).toBe('cargo_three_wheeler');
      expect(normalizeVehicleCategory('Auto Rickshaw')).toBe('cargo_three_wheeler');
      expect(normalizeVehicleCategory('E_LOADER')).toBe('cargo_three_wheeler');
    });

    it('normalizes mini truck / box truck / Tata Ace variations', () => {
      expect(normalizeVehicleCategory('MINI_TRUCK')).toBe('box_mini_truck');
      expect(normalizeVehicleCategory('Tata Ace')).toBe('box_mini_truck');
      expect(normalizeVehicleCategory('Chhota Hathi')).toBe('box_mini_truck');
      expect(normalizeVehicleCategory('box_truck')).toBe('box_mini_truck');
      expect(normalizeVehicleCategory('CONTAINER_7FT')).toBe('box_mini_truck');
    });

    it('normalizes pickup / open cargo truck variations', () => {
      expect(normalizeVehicleCategory('PICKUP')).toBe('pickup_truck');
      expect(normalizeVehicleCategory('PICKUP_8FT')).toBe('pickup_truck');
      expect(normalizeVehicleCategory('Bolero')).toBe('pickup_truck');
      expect(normalizeVehicleCategory('Bolero Maxi')).toBe('pickup_truck');
      expect(normalizeVehicleCategory('1.5 Ton Pickup')).toBe('pickup_truck');
    });

    it('normalizes backhoe loader / JCB variations', () => {
      expect(normalizeVehicleCategory('JCB')).toBe('backhoe_loader');
      expect(normalizeVehicleCategory('Backhoe Loader')).toBe('backhoe_loader');
      expect(normalizeVehicleCategory('Excavator')).toBe('backhoe_loader');
      expect(normalizeVehicleCategory('EARTHMOVER')).toBe('backhoe_loader');
    });

    it('normalizes crane / crane truck variations', () => {
      expect(normalizeVehicleCategory('CRANE')).toBe('crane_truck');
      expect(normalizeVehicleCategory('Mobile Crane')).toBe('crane_truck');
      expect(normalizeVehicleCategory('Hydra Crane')).toBe('crane_truck');
      expect(normalizeVehicleCategory('crane_truck')).toBe('crane_truck');
    });

    it('safely falls back to box_mini_truck (and never to bike) for unknown / undefined', () => {
      expect(normalizeVehicleCategory(undefined)).toBe('box_mini_truck');
      expect(normalizeVehicleCategory(null)).toBe('box_mini_truck');
      expect(normalizeVehicleCategory('')).toBe('box_mini_truck');
      expect(normalizeVehicleCategory('UNKNOWN_TRANSPORT')).toBe('box_mini_truck');
      expect(normalizeVehicleCategory('COMMERCIAL_HEAVY')).toBe('box_mini_truck');
    });
  });

  describe('getVehicleMapIcon', () => {
    it('returns a valid image asset for each category', () => {
      const bikeIcon = getVehicleMapIcon('TWO_WHEELER');
      expect(bikeIcon).toBe(VEHICLE_MAP_ICONS.bike_delivery);

      const threeWheelerIcon = getVehicleMapIcon('THREE_WHEELER');
      expect(threeWheelerIcon).toBe(VEHICLE_MAP_ICONS.cargo_three_wheeler);

      const miniTruckIcon = getVehicleMapIcon('MINI_TRUCK');
      expect(miniTruckIcon).toBe(VEHICLE_MAP_ICONS.box_mini_truck);

      const pickupIcon = getVehicleMapIcon('PICKUP');
      expect(pickupIcon).toBe(VEHICLE_MAP_ICONS.pickup_truck);

      const jcbIcon = getVehicleMapIcon('JCB');
      expect(jcbIcon).toBe(VEHICLE_MAP_ICONS.backhoe_loader);

      const craneIcon = getVehicleMapIcon('CRANE');
      expect(craneIcon).toBe(VEHICLE_MAP_ICONS.crane_truck);
    });
  });

  describe('getVehicleCategoryDisplayName', () => {
    it('returns friendly display labels', () => {
      expect(getVehicleCategoryDisplayName('TWO_WHEELER')).toBe('Delivery Bike');
      expect(getVehicleCategoryDisplayName('THREE_WHEELER')).toBe('Cargo 3-Wheeler');
      expect(getVehicleCategoryDisplayName('MINI_TRUCK')).toBe('Box Mini Truck');
      expect(getVehicleCategoryDisplayName('PICKUP')).toBe('Pickup Truck');
      expect(getVehicleCategoryDisplayName('JCB')).toBe('Backhoe Loader (JCB)');
      expect(getVehicleCategoryDisplayName('CRANE')).toBe('Crane Truck');
    });
  });
});

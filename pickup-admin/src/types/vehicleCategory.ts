export type PricingType = 'Distance Based' | 'Hourly Based';
export type CategoryStatus = 'active' | 'inactive';

export interface VehicleCategoryConfig {
  id: string;
  categoryCode: string; // e.g., 'bike', 'mini_truck'
  displayName: string;
  capacityMin?: number;
  capacityMax?: number;
  capacityUnit?: string;
  capacityDisplay: string; // e.g., 'Up to 20 kg', '500-900 kg'
  pricingType: PricingType;
  status: CategoryStatus;
  description: string;
  lastUpdated: string;
}

export interface DistancePricing {
  baseFare: number;
  perKmRate: number;
  minimumFare: number;
  additionalDropFee: number;
}

export interface HourlyPricing {
  hourlyRate: number;
  minimumBillableHours?: number;
}

export interface CategoryPricing {
  categoryId: string;
  pricingType: PricingType;
  distancePricing?: DistancePricing;
  hourlyPricing?: HourlyPricing;
}

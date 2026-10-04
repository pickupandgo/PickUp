export interface SurchargeTier {
  id: string;
  label: string; // e.g., 'Normal Traffic', 'Heavy Rain'
  type: 'percentage' | 'fixed';
  value: number;
}

export interface SurchargeRule {
  id: string;
  name: string; // e.g., 'Traffic', 'Weather'
  enabled: boolean;
  tiers: SurchargeTier[];
}

export interface CommissionRule {
  platformCommissionPercentage: number;
  status: 'active' | 'inactive';
}

export interface CancellationReason {
  id: string;
  label: string;
  enabled: boolean;
  type: 'customer' | 'driver';
}

export interface CancellationRule {
  customerDistanceThresholdMeters: number;
  customerCancellationChargePercentage: number;
  driverRepeatedThreshold: number;
  driverAutoBlockDurationHours: number;
  reasons: CancellationReason[];
}

export interface WeightBand {
  id: string;
  minKg: number;
  maxKg: number;
  charge: number;
}

export interface WeightPricingRule {
  enabled: boolean;
  bands: WeightBand[];
}

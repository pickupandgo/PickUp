import { SurchargeRule, CommissionRule, CancellationRule, WeightPricingRule } from '@/types/businessRules';

export const MOCK_SURCHARGES: SurchargeRule[] = [
  {
    id: 'SUR-001',
    name: 'Traffic Surcharge',
    enabled: true,
    tiers: [
      { id: 'T-1', label: 'Normal Traffic', type: 'percentage', value: 5 },
      { id: 'T-2', label: 'Heavy Traffic', type: 'percentage', value: 10 }
    ]
  },
  {
    id: 'SUR-002',
    name: 'Weather / Rain Surcharge',
    enabled: true,
    tiers: [
      { id: 'W-1', label: 'Rain', type: 'percentage', value: 10 },
      { id: 'W-2', label: 'Heavy Rain', type: 'percentage', value: 15 }
    ]
  }
];

export const MOCK_COMMISSION: CommissionRule = {
  platformCommissionPercentage: 10,
  status: 'active'
};

export const MOCK_CANCELLATION: CancellationRule = {
  customerDistanceThresholdMeters: 200,
  customerCancellationChargePercentage: 25,
  driverRepeatedThreshold: 3,
  driverAutoBlockDurationHours: 24,
  reasons: [
    { id: 'CR-C1', label: 'Changed my mind', enabled: true, type: 'customer' },
    { id: 'CR-C2', label: 'Wrong pickup details', enabled: true, type: 'customer' },
    { id: 'CR-C3', label: 'Driver taking too long', enabled: true, type: 'customer' },
    { id: 'CR-D1', label: 'Vehicle issue', enabled: true, type: 'driver' },
    { id: 'CR-D2', label: 'Customer unavailable', enabled: true, type: 'driver' },
    { id: 'CR-D3', label: 'Incorrect load', enabled: true, type: 'driver' }
  ]
};

export const MOCK_WEIGHT_PRICING: WeightPricingRule = {
  enabled: false, // Explicitly false as per SRS
  bands: [
    { id: 'WB-1', minKg: 0, maxKg: 100, charge: 50 },
    { id: 'WB-2', minKg: 101, maxKg: 300, charge: 100 },
    { id: 'WB-3', minKg: 301, maxKg: 500, charge: 150 }
  ]
};

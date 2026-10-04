import { VehicleCategoryConfig, CategoryPricing } from '@/types/vehicleCategory';

export const MOCK_VEHICLE_CATEGORIES: VehicleCategoryConfig[] = [
  {
    id: 'VC-001',
    categoryCode: 'bike',
    displayName: '2-Wheeler / Bike',
    capacityMin: 0,
    capacityMax: 20,
    capacityUnit: 'kg',
    capacityDisplay: 'Up to 20 kg',
    pricingType: 'Distance Based',
    status: 'active',
    description: 'For small and quick deliveries.',
    lastUpdated: '2024-03-01',
  },
  {
    id: 'VC-002',
    categoryCode: 'e_loader',
    displayName: '3-Wheeler / E-Loader',
    capacityMin: 300,
    capacityMax: 500,
    capacityUnit: 'kg',
    capacityDisplay: '300–500 kg',
    pricingType: 'Distance Based',
    status: 'active',
    description: 'Eco-friendly short distance transport.',
    lastUpdated: '2024-03-05',
  },
  {
    id: 'VC-003',
    categoryCode: 'mini_truck',
    displayName: 'Mini Truck / Tata Ace',
    capacityMin: 500,
    capacityMax: 900,
    capacityUnit: 'kg',
    capacityDisplay: '500–900 kg',
    pricingType: 'Distance Based',
    status: 'active',
    description: 'Standard city goods transport.',
    lastUpdated: '2024-03-10',
  },
  {
    id: 'VC-004',
    categoryCode: 'pickup',
    displayName: 'Pickup / Bolero',
    capacityMin: 1,
    capacityMax: 1.5,
    capacityUnit: 'Ton',
    capacityDisplay: '1–1.5 Ton',
    pricingType: 'Distance Based',
    status: 'active',
    description: 'Heavy duty transport.',
    lastUpdated: '2024-03-12',
  },
  {
    id: 'VC-005',
    categoryCode: 'jcb',
    displayName: 'JCB',
    capacityDisplay: 'Hourly',
    pricingType: 'Hourly Based',
    status: 'active',
    description: 'Earthmoving and heavy machinery.',
    lastUpdated: '2024-03-15',
  },
  {
    id: 'VC-006',
    categoryCode: 'crane',
    displayName: 'Crane',
    capacityDisplay: 'Hourly',
    pricingType: 'Hourly Based',
    status: 'active',
    description: 'Lifting and towing.',
    lastUpdated: '2024-03-15',
  }
];

export const MOCK_CATEGORY_PRICING: CategoryPricing[] = [
  {
    categoryId: 'VC-001',
    pricingType: 'Distance Based',
    distancePricing: {
      baseFare: 40,
      perKmRate: 12,
      minimumFare: 60,
      additionalDropFee: 20
    }
  },
  {
    categoryId: 'VC-002',
    pricingType: 'Distance Based',
    distancePricing: {
      baseFare: 70,
      perKmRate: 18,
      minimumFare: 100,
      additionalDropFee: 30
    }
  },
  {
    categoryId: 'VC-003',
    pricingType: 'Distance Based',
    distancePricing: {
      baseFare: 100,
      perKmRate: 25,
      minimumFare: 150,
      additionalDropFee: 40
    }
  },
  {
    categoryId: 'VC-004',
    pricingType: 'Distance Based',
    distancePricing: {
      baseFare: 150,
      perKmRate: 35,
      minimumFare: 200,
      additionalDropFee: 50
    }
  },
  {
    categoryId: 'VC-005',
    pricingType: 'Hourly Based',
    hourlyPricing: {
      hourlyRate: 1500,
      minimumBillableHours: 1
    }
  },
  {
    categoryId: 'VC-006',
    pricingType: 'Hourly Based',
    hourlyPricing: {
      hourlyRate: 2000,
      minimumBillableHours: 2
    }
  }
];

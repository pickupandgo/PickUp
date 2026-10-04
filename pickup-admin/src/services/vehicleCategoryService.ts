import type { VehicleCategoryConfig, CategoryPricing } from '@/types/vehicleCategory';
import { MOCK_VEHICLE_CATEGORIES, MOCK_CATEGORY_PRICING } from '@/mock/vehicleCategories';

const DELAY = 300;
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

let categories: VehicleCategoryConfig[] = [...MOCK_VEHICLE_CATEGORIES];
let pricingMap: CategoryPricing[] = [...MOCK_CATEGORY_PRICING];

export async function getCategories(): Promise<VehicleCategoryConfig[]> {
  await delay(DELAY);
  return [...categories];
}

export async function getCategoryById(id: string): Promise<VehicleCategoryConfig | null> {
  await delay(DELAY);
  return categories.find(c => c.id === id) ?? null;
}

export async function addCategory(category: Omit<VehicleCategoryConfig, 'id' | 'lastUpdated'>): Promise<VehicleCategoryConfig> {
  await delay(DELAY);
  const newCat: VehicleCategoryConfig = {
    ...category,
    id: `VC-${Date.now().toString().slice(-4)}`,
    lastUpdated: new Date().toISOString().split('T')[0]
  };
  categories.push(newCat);
  
  // Create default pricing
  pricingMap.push({
    categoryId: newCat.id,
    pricingType: newCat.pricingType,
    ...(newCat.pricingType === 'Distance Based' 
      ? { distancePricing: { baseFare: 0, perKmRate: 0, minimumFare: 0, additionalDropFee: 0 } }
      : { hourlyPricing: { hourlyRate: 0, minimumBillableHours: 1 } })
  });

  return newCat;
}

export async function updateCategory(id: string, updates: Partial<VehicleCategoryConfig>): Promise<void> {
  await delay(DELAY);
  categories = categories.map(c => 
    c.id === id 
      ? { ...c, ...updates, lastUpdated: new Date().toISOString().split('T')[0] } 
      : c
  );
}

export async function getPricing(): Promise<CategoryPricing[]> {
  await delay(DELAY);
  return [...pricingMap];
}

export async function getPricingByCategory(categoryId: string): Promise<CategoryPricing | null> {
  await delay(DELAY);
  return pricingMap.find(p => p.categoryId === categoryId) ?? null;
}

export async function updatePricing(categoryId: string, updates: Partial<CategoryPricing>): Promise<void> {
  await delay(DELAY);
  pricingMap = pricingMap.map(p => 
    p.categoryId === categoryId ? { ...p, ...updates } : p
  );
}

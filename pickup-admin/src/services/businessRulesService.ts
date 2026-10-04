import type { SurchargeRule, CommissionRule, CancellationRule, WeightPricingRule } from '@/types/businessRules';
import { MOCK_SURCHARGES, MOCK_COMMISSION, MOCK_CANCELLATION, MOCK_WEIGHT_PRICING } from '@/mock/businessRules';

const DELAY = 300;
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

let surcharges = [...MOCK_SURCHARGES];
let commission = { ...MOCK_COMMISSION };
let cancellation = { ...MOCK_CANCELLATION };
let weightPricing = { ...MOCK_WEIGHT_PRICING };

// SURCHARGES
export async function getSurcharges(): Promise<SurchargeRule[]> {
  await delay(DELAY);
  return [...surcharges];
}

export async function updateSurcharge(id: string, updates: Partial<SurchargeRule>): Promise<void> {
  await delay(DELAY);
  surcharges = surcharges.map(s => s.id === id ? { ...s, ...updates } : s);
}

// COMMISSION
export async function getCommission(): Promise<CommissionRule> {
  await delay(DELAY);
  return { ...commission };
}

export async function updateCommission(updates: Partial<CommissionRule>): Promise<void> {
  await delay(DELAY);
  commission = { ...commission, ...updates };
}

// CANCELLATION
export async function getCancellationRules(): Promise<CancellationRule> {
  await delay(DELAY);
  return { ...cancellation };
}

export async function updateCancellationRules(updates: Partial<CancellationRule>): Promise<void> {
  await delay(DELAY);
  cancellation = { ...cancellation, ...updates };
}

// WEIGHT PRICING
export async function getWeightPricing(): Promise<WeightPricingRule> {
  await delay(DELAY);
  return { ...weightPricing };
}

export async function updateWeightPricing(updates: Partial<WeightPricingRule>): Promise<void> {
  await delay(DELAY);
  weightPricing = { ...weightPricing, ...updates };
}

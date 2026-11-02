import { DriverOnboardingService, type DriverOnboardingSummary, type OnboardingVehicle } from '../onboarding/DriverOnboardingService';
import { getPaymentsApi } from '../payments';
import { toWalletBalance } from '../wallet/walletMapping';

/** A frontend boundary for a future server-defined daily summary, NOT an existing DTO. */
export interface DailyEarnings {
  readonly date: string;
  readonly timeZone: 'Asia/Kolkata';
  readonly currency: 'INR';
  readonly metric: 'NET_DRIVER_EARNINGS';
  readonly netAmountPaise: number;
  readonly completedTripCount: number;
}

export interface DailyEarningsSource {
  getToday(date: string): Promise<DailyEarnings>;
}

export const businessDate = (now = new Date()): string =>
  new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);

export function validateToday(value: DailyEarnings, date: string): DailyEarnings {
  if (value.date !== date || value.timeZone !== 'Asia/Kolkata' ||
      value.metric !== 'NET_DRIVER_EARNINGS' || value.currency !== 'INR' ||
      !Number.isSafeInteger(value.netAmountPaise) || value.netAmountPaise < 0 ||
      !Number.isSafeInteger(value.completedTripCount) || value.completedTripCount < 0) {
    throw new Error('Today’s earnings could not be verified. Please retry.');
  }
  return value;
}

/** Never choose an arbitrary approved historical row or activate a vehicle here. */
export function currentVehicle(summary: DriverOnboardingSummary): OnboardingVehicle | null {
  if (summary.activeVehicle) return summary.activeVehicle;
  const active = summary.vehicles.filter(vehicle => vehicle.active);
  if (active.length === 1) return active[0];
  if (active.length > 1) return null;
  // A single registration can be shown while still pending/rejected, with its actual status.
  return summary.vehicles.length === 1 ? summary.vehicles[0] : null;
}

const unavailableDailySource: DailyEarningsSource = {
  async getToday() {
    // /v1/earnings/summary is lifetime-only; it cannot safely populate TODAY.
    throw new Error('Today’s earnings are currently unavailable. View details for your earnings history.');
  },
};

export class HomeDashboardService {
  constructor(private readonly daily: DailyEarningsSource = unavailableDailySource) {}

  async getVehicles() {
    const summary = await DriverOnboardingService.getInstance().getSummary();
    const validVehicle = (vehicle: OnboardingVehicle) => vehicle &&
      typeof vehicle.id === 'string' && typeof vehicle.makeModel === 'string' &&
      typeof vehicle.registrationNumber === 'string' && typeof vehicle.active === 'boolean' &&
      ['TWO_WHEELER', 'THREE_WHEELER', 'FOUR_WHEELER', 'MINI_TRUCK', 'PICKUP_TRUCK'].includes(vehicle.category) &&
      ['DRAFT', 'SUBMITTED', 'IN_REVIEW', 'VERIFIED', 'REJECTED', 'INACTIVE'].includes(vehicle.status);
    if (!summary || !Array.isArray(summary.vehicles) || !summary.vehicles.every(validVehicle) ||
        (summary.activeVehicle != null && !validVehicle(summary.activeVehicle))) {
      throw new Error('Vehicle information could not be verified. Please retry.');
    }
    return summary;
  }

  async getWallet() {
    const api = getPaymentsApi();
    if (!api) throw new Error('Wallet balance is currently unavailable. Please try again later.');
    return toWalletBalance(await api.getWallet());
  }

  async getToday(date: string) {
    return validateToday(await this.daily.getToday(date), date);
  }
}

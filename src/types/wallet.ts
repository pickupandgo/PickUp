/**
 * Wallet and transaction type definitions.
 */

export type TransactionType = 'credit' | 'debit';

export type TransactionCategory =
  | 'trip_earning'
  | 'recharge'
  | 'platform_commission'
  | 'deduction'
  | 'bonus'
  | 'refund'
  | 'withdrawal'
  | 'adjustment';

export type PaymentMethod = 'bank_account' | 'upi' | 'card';

export type WalletStatus = 'ACTIVE' | 'LOW_BALANCE' | 'BLOCKED';

export interface WalletBalance {
  /** Rupees (may include paise, e.g. 1250.5). */
  readonly balance: number;
  /** Display symbol, e.g. "₹". */
  readonly currency: string;
  /** Rupees, or null when no minimum balance applies. */
  readonly minimumBalance: number | null;
  readonly isLowBalance: boolean;
  /** Server wallet status. A BLOCKED wallet cannot be recharged. */
  readonly status?: WalletStatus;
}

export interface Transaction {
  readonly id: string;
  readonly type: TransactionType;
  readonly category: TransactionCategory;
  readonly amount: number;
  readonly currency: string;
  readonly title: string;
  readonly description?: string;
  readonly date: string;
  readonly time: string;
  readonly referenceId?: string;
}

export interface PaymentMethodInfo {
  readonly id: string;
  readonly type: PaymentMethod;
  readonly label: string;
  readonly lastFourDigits: string;
  readonly isDefault: boolean;
}

export interface RechargeRequest {
  readonly amount: number;
  readonly paymentMethodId: string;
}

export interface EarningsSummary {
  readonly period: 'today' | 'weekly' | 'monthly';
  readonly totalEarnings: number;
  readonly totalTrips: number;
  readonly currency: string;
  readonly grossEarnings: number;
  readonly platformCommission: number;
  readonly otherDeductions: number;
  readonly netEarnings: number;
  /** Optional payment-mode split + online duration (shown on the earnings screen). */
  readonly cashEarnings?: number;
  readonly onlineEarnings?: number;
  readonly onlineHours?: number;
}

export interface TripEarnings {
  tripId: string;
  date: string;
  distance: number;
  duration: number;
  baseFare: number;
  distanceFare: number;
  timeFare: number;
  surgeMultiplier: number;
  tolls: number;
  tips: number;
  tax: number;
  platformFee: number;
  total: number;
}
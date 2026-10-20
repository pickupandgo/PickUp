import type { WalletBalance, Transaction } from '../../types/wallet';
import { mockWalletBalance, mockTransactions } from '../../data/mockData';
import { getPaymentsApi } from '../payments';
import type { PaymentsApi } from '../payments/paymentsApi';
import { PaymentsApiError } from '../payments/paymentsErrors';
import { toTransaction, toWalletBalance } from './walletMapping';

export interface TransactionPage {
  readonly items: readonly Transaction[];
  /** Pass to getTransactions for the next (older) page; null when there are no more. */
  readonly nextCursor: string | null;
}

/**
 * Read access to the driver's wallet. Money only moves through the server: recharges go
 * through the payments top-up flow (services/payments/topUpFlow), never through this service.
 */
export interface IWalletService {
  getBalance(): Promise<WalletBalance>;
  getTransactions(cursor?: string): Promise<TransactionPage>;
}

/** Where wallet data comes from in this build. */
export type WalletMode = 'backend' | 'mock' | 'unavailable';

const PAGE_SIZE = 20;

function delay(ms: number): Promise<void> {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

/** The payments + wallet backend (PAYMENTS_API_BASE_URL). */
export class BackendWalletService implements IWalletService {
  constructor(private readonly api: PaymentsApi) {}

  async getBalance(): Promise<WalletBalance> {
    return toWalletBalance(await this.api.getWallet());
  }

  async getTransactions(cursor?: string): Promise<TransactionPage> {
    const page = await this.api.listTransactions({ limit: PAGE_SIZE, cursor });
    return {
      items: page.items.map(toTransaction),
      nextCursor: page.nextCursor,
    };
  }
}

/** Development builds without a payments backend: sample data, read-only. */
export class MockWalletService implements IWalletService {
  async getBalance(): Promise<WalletBalance> {
    await delay(300);
    return mockWalletBalance;
  }

  async getTransactions(cursor?: string): Promise<TransactionPage> {
    await delay(300);
    return { items: cursor ? [] : [...mockTransactions], nextCursor: null };
  }
}

/** Release builds without a payments backend. Never falls back to sample data. */
export class UnavailableWalletService implements IWalletService {
  async getBalance(): Promise<WalletBalance> {
    throw notConfigured();
  }

  async getTransactions(): Promise<TransactionPage> {
    throw notConfigured();
  }
}

function notConfigured(): PaymentsApiError {
  return new PaymentsApiError(
    'NOT_CONFIGURED',
    'Payments backend is not configured',
    0,
  );
}

export class WalletService {
  private static instance: IWalletService | undefined;

  static getMode(): WalletMode {
    if (getPaymentsApi()) {
      return 'backend';
    }
    return __DEV__ ? 'mock' : 'unavailable';
  }

  static getInstance(): IWalletService {
    if (!WalletService.instance) {
      const api = getPaymentsApi();
      if (api) {
        WalletService.instance = new BackendWalletService(api);
      } else {
        WalletService.instance = __DEV__
          ? new MockWalletService()
          : new UnavailableWalletService();
      }
    }
    return WalletService.instance;
  }
}

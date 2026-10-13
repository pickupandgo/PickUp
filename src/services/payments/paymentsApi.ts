import {
  COLLECTION_METHODS,
  parseCollection,
  parseTrip,
  parseTrips,
  type CollectionDto,
  type CollectionMethodDto,
  type DriverTripDto,
} from './collectionsDto';
import {
  EARNING_STATUSES,
  parseBankAccount,
  parseEarningPage,
  parseEarningsSummary,
  parsePayouts,
  type BankAccountDto,
  type EarningPageDto,
  type EarningStatusDto,
  type EarningsSummaryDto,
  type PayoutDto,
} from './earningsDto';
import type { PaymentsClient } from './paymentsClient';
import { PaymentsApiError } from './paymentsErrors';
import {
  IDEMPOTENCY_KEY_PATTERN,
  invalid,
  nullableText,
  oneOf,
  record,
  text,
  UUID_PATTERN,
  wholeNumber,
} from './responseChecks';

/*
 * Typed calls to the payments backend (raj_backend, /v1). Every response is checked before use,
 * so a malformed or tampered response can never reach Razorpay Checkout, a QR code or the
 * wallet and earnings screens. Amounts are integer paise (100 paise = Rs 1), exactly as the
 * server sends them.
 */

export type WalletStatusDto = 'ACTIVE' | 'LOW_BALANCE' | 'BLOCKED';
export type PaymentStatusDto =
  | 'PENDING'
  | 'PAID'
  | 'FAILED'
  | 'REFUND_PENDING'
  | 'REFUNDED';
export type LedgerEntryTypeDto =
  | 'TOPUP'
  | 'CASH_RIDE_FEE'
  | 'REFUND_REVERSAL'
  | 'ADJUSTMENT';

export interface WalletDto {
  readonly walletId: string;
  readonly status: WalletStatusDto;
  readonly balancePaise: number;
  readonly updatedAt: string;
}

export interface WalletTransactionDto {
  readonly id: string;
  readonly type: LedgerEntryTypeDto;
  readonly direction: 'CREDIT' | 'DEBIT';
  readonly amountPaise: number;
  readonly balanceAfterPaise: number;
  readonly sequence: number;
  readonly providerPaymentId: string | null;
  readonly reason: string | null;
  readonly createdAt: string;
}

export interface TransactionPageDto {
  readonly items: readonly WalletTransactionDto[];
  readonly nextCursor: string | null;
}

export interface CheckoutDto {
  readonly keyId: string;
  readonly orderId: string;
  readonly amountPaise: number;
  readonly currency: 'INR';
}

export interface TopUpDto {
  readonly paymentId: string;
  readonly status: PaymentStatusDto;
  readonly amountPaise: number;
  readonly checkout: CheckoutDto | null;
}

export interface VerifyTopUpBody {
  readonly razorpayOrderId: string;
  readonly razorpayPaymentId: string;
  readonly razorpaySignature: string;
}

export interface VerifyTopUpDto {
  readonly payment: TopUpDto;
  /** Razorpay's state for the submitted payment: captured, authorized, failed, ... */
  readonly providerStatus: string;
  readonly wallet: WalletDto | null;
}

export interface PaymentsApi {
  getWallet(): Promise<WalletDto>;
  listTransactions(params?: {
    limit?: number;
    cursor?: string;
  }): Promise<TransactionPageDto>;
  startTopUp(amountPaise: number, idempotencyKey: string): Promise<TopUpDto>;
  getTopUp(paymentId: string): Promise<TopUpDto>;
  verifyTopUp(
    paymentId: string,
    body: VerifyTopUpBody,
  ): Promise<VerifyTopUpDto>;

  /** The driver's trips that are still running, with what to collect. */
  listActiveTrips(): Promise<readonly DriverTripDto[]>;
  getTrip(tripId: string): Promise<DriverTripDto>;
  /**
   * Records cash (and debits the platform fee from the wallet) or returns a booking-linked QR.
   * `amountPaise` must be the fare the server showed; retry with the same key, never a new one.
   */
  startCollection(
    tripId: string,
    collection: {
      readonly method: CollectionMethodDto;
      readonly amountPaise: number;
    },
    idempotencyKey: string,
  ): Promise<CollectionDto>;
  /** Current state; a pending QR is re-checked with Razorpay by the server. */
  getCollection(tripId: string, collectionId: string): Promise<CollectionDto>;

  getEarningsSummary(): Promise<EarningsSummaryDto>;
  listEarnings(params?: {
    status?: EarningStatusDto;
    limit?: number;
    cursor?: string;
  }): Promise<EarningPageDto>;
  listPayouts(): Promise<readonly PayoutDto[]>;
  /** The payout bank account, or null when none is linked yet. */
  getBankAccount(): Promise<BankAccountDto | null>;
}

export const RAZORPAY_KEY_ID_PATTERN = /^rzp_(test|live)_[A-Za-z0-9]{6,}$/;
export const RAZORPAY_ORDER_ID_PATTERN = /^order_[A-Za-z0-9]{6,40}$/;
export const RAZORPAY_PAYMENT_ID_PATTERN = /^pay_[A-Za-z0-9]{6,40}$/;
export const RAZORPAY_SIGNATURE_PATTERN = /^[a-fA-F0-9]{64}$/;
const CURSOR_PATTERN = /^[1-9][0-9]{0,17}$/;

const WALLET_STATUSES: readonly WalletStatusDto[] = [
  'ACTIVE',
  'LOW_BALANCE',
  'BLOCKED',
];
const PAYMENT_STATUSES: readonly PaymentStatusDto[] = [
  'PENDING',
  'PAID',
  'FAILED',
  'REFUND_PENDING',
  'REFUNDED',
];
const ENTRY_TYPES: readonly LedgerEntryTypeDto[] = [
  'TOPUP',
  'CASH_RIDE_FEE',
  'REFUND_REVERSAL',
  'ADJUSTMENT',
];

export function createPaymentsApi(client: PaymentsClient): PaymentsApi {
  return {
    async getWallet() {
      return parseWallet(
        await client.request({ method: 'GET', path: '/v1/wallet' }),
      );
    },

    async listTransactions(params = {}) {
      if (params.cursor !== undefined && !CURSOR_PATTERN.test(params.cursor)) {
        throw new RangeError('Invalid transactions cursor');
      }
      const json = await client.request({
        method: 'GET',
        path: '/v1/wallet/transactions',
        query: { limit: params.limit, cursor: params.cursor },
      });
      return parsePage(json);
    },

    async startTopUp(amountPaise, idempotencyKey) {
      if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
        throw new RangeError(
          'Top-up amount must be a positive whole number of paise',
        );
      }
      if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
        throw new RangeError('Invalid idempotency key');
      }
      const json = await client.request({
        method: 'POST',
        path: '/v1/wallet/topups',
        body: { amountPaise },
        idempotencyKey,
      });
      return parseTopUp(json);
    },

    async getTopUp(paymentId) {
      assertPaymentId(paymentId);
      return parseTopUp(
        await client.request({
          method: 'GET',
          path: `/v1/wallet/topups/${paymentId}`,
        }),
      );
    },

    async verifyTopUp(paymentId, body) {
      assertPaymentId(paymentId);
      if (
        !RAZORPAY_ORDER_ID_PATTERN.test(body.razorpayOrderId) ||
        !RAZORPAY_PAYMENT_ID_PATTERN.test(body.razorpayPaymentId) ||
        !RAZORPAY_SIGNATURE_PATTERN.test(body.razorpaySignature)
      ) {
        throw new RangeError('Invalid Razorpay Checkout result');
      }
      const json = await client.request({
        method: 'POST',
        path: `/v1/wallet/topups/${paymentId}/verify`,
        body: {
          razorpayOrderId: body.razorpayOrderId,
          razorpayPaymentId: body.razorpayPaymentId,
          razorpaySignature: body.razorpaySignature,
        },
      });
      return parseVerify(json);
    },

    async listActiveTrips() {
      return parseTrips(
        await client.request({
          method: 'GET',
          path: '/v1/trips',
          query: { active: 'true' },
        }),
      );
    },

    async getTrip(tripId) {
      assertUuid(tripId, 'trip id');
      const trip = parseTrip(
        await client.request({ method: 'GET', path: `/v1/trips/${tripId}` }),
      );
      if (trip.tripId !== tripId) {
        invalid('trip');
      }
      return trip;
    },

    async startCollection(tripId, collection, idempotencyKey) {
      assertUuid(tripId, 'trip id');
      if (!COLLECTION_METHODS.includes(collection.method)) {
        throw new RangeError('Invalid collection method');
      }
      if (
        !Number.isSafeInteger(collection.amountPaise) ||
        collection.amountPaise <= 0
      ) {
        throw new RangeError(
          'Collection amount must be a positive whole number of paise',
        );
      }
      if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
        throw new RangeError('Invalid idempotency key');
      }
      const result = parseCollection(
        await client.request({
          method: 'POST',
          path: `/v1/trips/${tripId}/collections`,
          body: {
            method: collection.method,
            amountPaise: collection.amountPaise,
          },
          idempotencyKey,
        }),
      );
      // Only ever act on the collection the driver asked for: this trip, method and fare.
      if (
        result.tripId !== tripId ||
        result.method !== collection.method ||
        result.amountPaise !== collection.amountPaise
      ) {
        throw new PaymentsApiError(
          'AMOUNT_MISMATCH',
          'Collection does not match the request',
          0,
        );
      }
      return result;
    },

    async getCollection(tripId, collectionId) {
      assertUuid(tripId, 'trip id');
      assertUuid(collectionId, 'collection id');
      const result = parseCollection(
        await client.request({
          method: 'GET',
          path: `/v1/trips/${tripId}/collections/${collectionId}`,
        }),
      );
      if (result.collectionId !== collectionId || result.tripId !== tripId) {
        invalid('collection');
      }
      return result;
    },

    async getEarningsSummary() {
      return parseEarningsSummary(
        await client.request({ method: 'GET', path: '/v1/earnings/summary' }),
      );
    },

    async listEarnings(params = {}) {
      if (params.cursor !== undefined && !UUID_PATTERN.test(params.cursor)) {
        throw new RangeError('Invalid earnings cursor');
      }
      if (
        params.status !== undefined &&
        !EARNING_STATUSES.includes(params.status)
      ) {
        throw new RangeError('Invalid earnings status');
      }
      return parseEarningPage(
        await client.request({
          method: 'GET',
          path: '/v1/earnings',
          query: {
            status: params.status,
            limit: params.limit,
            cursor: params.cursor,
          },
        }),
      );
    },

    async listPayouts() {
      return parsePayouts(
        await client.request({ method: 'GET', path: '/v1/payouts' }),
      );
    },

    async getBankAccount() {
      try {
        return parseBankAccount(
          await client.request({ method: 'GET', path: '/v1/bank-account' }),
        );
      } catch (error) {
        if (
          error instanceof PaymentsApiError &&
          error.code === 'BANK_ACCOUNT_NOT_FOUND'
        ) {
          return null;
        }
        throw error;
      }
    },
  };
}

function assertPaymentId(paymentId: string): void {
  assertUuid(paymentId, 'payment id');
}

function assertUuid(value: string, what: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new RangeError(`Invalid ${what}`);
  }
}

// ---- response checks -----------------------------------------------------------------------

function parseWallet(value: unknown): WalletDto {
  const json = record(value, 'wallet');
  if (json.currency !== 'INR') {
    invalid('wallet currency');
  }
  return {
    walletId: text(json.walletId, 'wallet id'),
    status: oneOf(json.status, WALLET_STATUSES, 'wallet status'),
    balancePaise: wholeNumber(json.balancePaise, 'wallet balance'),
    updatedAt: text(json.updatedAt, 'wallet timestamp'),
  };
}

function parseTransaction(value: unknown): WalletTransactionDto {
  const json = record(value, 'transaction');
  return {
    id: text(json.id, 'transaction id'),
    type: oneOf(json.type, ENTRY_TYPES, 'transaction type'),
    direction: oneOf(
      json.direction,
      ['CREDIT', 'DEBIT'] as const,
      'transaction direction',
    ),
    amountPaise: wholeNumber(json.amountPaise, 'transaction amount'),
    balanceAfterPaise: wholeNumber(
      json.balanceAfterPaise,
      'transaction balance',
    ),
    sequence: wholeNumber(json.sequence, 'transaction sequence'),
    providerPaymentId: nullableText(
      json.providerPaymentId,
      'transaction payment id',
    ),
    reason: nullableText(json.reason, 'transaction reason'),
    createdAt: text(json.createdAt, 'transaction timestamp'),
  };
}

function parsePage(value: unknown): TransactionPageDto {
  const json = record(value, 'transactions page');
  if (!Array.isArray(json.items)) {
    invalid('transactions list');
  }
  const nextCursor =
    json.nextCursor === null
      ? null
      : text(json.nextCursor, 'cursor', CURSOR_PATTERN);
  return { items: json.items.map(parseTransaction), nextCursor };
}

function parseTopUp(value: unknown): TopUpDto {
  const json = record(value, 'top-up');
  if (json.currency !== 'INR') {
    invalid('top-up currency');
  }
  const amountPaise = wholeNumber(json.amountPaise, 'top-up amount');
  let checkout: CheckoutDto | null = null;
  if (json.checkout !== null) {
    const raw = record(json.checkout, 'checkout');
    checkout = {
      keyId: text(raw.keyId, 'Razorpay key id', RAZORPAY_KEY_ID_PATTERN),
      orderId: text(
        raw.orderId,
        'Razorpay order id',
        RAZORPAY_ORDER_ID_PATTERN,
      ),
      amountPaise: wholeNumber(raw.amountPaise, 'checkout amount'),
      currency: raw.currency === 'INR' ? 'INR' : invalid('checkout currency'),
    };
    // Checkout must charge exactly the amount of this top-up.
    if (checkout.amountPaise !== amountPaise) {
      invalid('checkout amount');
    }
  }
  return {
    paymentId: text(json.paymentId, 'payment id', UUID_PATTERN),
    status: oneOf(json.status, PAYMENT_STATUSES, 'payment status'),
    amountPaise,
    checkout,
  };
}

function parseVerify(value: unknown): VerifyTopUpDto {
  const json = record(value, 'verification result');
  return {
    payment: parseTopUp(json.payment),
    providerStatus: text(json.providerStatus, 'provider status'),
    wallet: json.wallet === null ? null : parseWallet(json.wallet),
  };
}

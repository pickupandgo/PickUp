import { getAuth } from '@react-native-firebase/auth';
import { env, hasPaymentsConfig } from '../config/env';
import { ApiError } from './http';
import type {
  CustomerAccount,
  CustomerBooking,
  FareQuote,
  GeoPoint,
  PaymentMethod,
} from './types';

/**
 * Client for the payments backend (`/v1`), which owns fare, payment and the payment gate. Every
 * request carries the signed-in customer's Firebase token; the backend takes the customer's
 * identity from it, never from the body. The cached token is refreshed once on a 401. The app
 * never sends an amount or a payment status: it reads them.
 */

const DEFAULT_TIMEOUT_MS = 15_000;

const assertPaymentsConfig = (): void => {
  if (!hasPaymentsConfig()) {
    throw new ApiError('config', 'The payments backend is not configured.');
  }
};

interface PaymentsRequestOptions {
  readonly method?: 'GET' | 'POST';
  readonly body?: unknown;
  readonly idempotencyKey?: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

const buildUrl = (path: string): string => `${env.paymentsApiBaseUrl}${path}`;

const attempt = async <T>(
  path: string,
  options: PaymentsRequestOptions,
  forceRefresh: boolean
): Promise<T> => {
  const { method = 'GET', body, idempotencyKey, timeoutMs = DEFAULT_TIMEOUT_MS, signal } = options;

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onExternalAbort = () => controller.abort();
  signal?.addEventListener('abort', onExternalAbort);

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body) {
    headers['Content-Type'] = 'application/json';
  }
  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }
  const currentUser = getAuth().currentUser;
  if (currentUser) {
    try {
      headers['Authorization'] = `Bearer ${await currentUser.getIdToken(forceRefresh)}`;
    } catch (e) {
      console.warn('Failed to get Firebase token', e);
    }
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch {
    throw timedOut
      ? new ApiError('timeout', `Request to ${path} timed out`)
      : new ApiError('network', `Could not reach ${path}`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onExternalAbort);
  }

  const raw = await response.text();
  let parsed: unknown;
  if (raw.length) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      if (response.ok) {
        throw new ApiError('parse', `Malformed JSON from ${path}`);
      }
    }
  }
  if (!response.ok) {
    throw new ApiError('http', `${method} ${path} failed with ${response.status}`, response.status, parsed);
  }
  return parsed as T;
};

const paymentsRequest = async <T>(path: string, options: PaymentsRequestOptions = {}): Promise<T> => {
  assertPaymentsConfig();
  try {
    return await attempt<T>(path, options, false);
  } catch (error) {
    // The cached Firebase token may have expired: refresh once and retry.
    if (error instanceof ApiError && error.kind === 'http' && error.status === 401) {
      return attempt<T>(path, options, true);
    }
    throw error;
  }
};

// ─── Account ──────────────────────────────────────────────────────────────────

/**
 * Registers the signed-in customer, or returns the existing account. Safe to call after every
 * sign-in. The sign-in must carry a verified phone number.
 */
export const registerCustomer = async (signal?: AbortSignal): Promise<CustomerAccount> =>
  paymentsRequest<CustomerAccount>('/v1/customers/me', { method: 'POST', signal });

// ─── Fare quotes ────────────────────────────────────────────────────────────

export interface FareQuoteRequest {
  readonly pickup: GeoPoint;
  readonly drops: readonly GeoPoint[];
  readonly vehicleCategory: string;
  readonly weightKg: number;
}

/**
 * Prices a route under the pricing version in effect. The request carries locations, vehicle
 * category and weight, never an amount. The server returns the total and each drop's amount,
 * valid until `expiresAt`.
 */
export const createFareQuote = async (
  input: FareQuoteRequest,
  signal?: AbortSignal
): Promise<FareQuote> =>
  paymentsRequest<FareQuote>('/v1/fare/quotes', {
    method: 'POST',
    body: {
      pickup: { latitude: input.pickup.latitude, longitude: input.pickup.longitude },
      drops: input.drops.map((d) => ({ latitude: d.latitude, longitude: d.longitude })),
      vehicleCategory: input.vehicleCategory,
      weightKg: input.weightKg,
    },
    signal,
  });

/** Re-reads a quote (e.g. to check it is still valid / not yet redeemed before booking). */
export const getFareQuote = async (quoteId: string, signal?: AbortSignal): Promise<FareQuote> =>
  paymentsRequest<FareQuote>(`/v1/fare/quotes/${encodeURIComponent(quoteId)}`, { signal });

// ─── Booking payment view ─────────────────────────────────────────────────────

/**
 * The customer's payment view of a booking: the payment gate (whether the handover is allowed
 * and what is owed now) and each drop's amount and state. The source of truth for what the
 * payment UI shows; never inferred locally.
 */
export const getBookingPayment = async (
  bookingId: string,
  signal?: AbortSignal
): Promise<CustomerBooking> =>
  paymentsRequest<CustomerBooking>(`/v1/bookings/${encodeURIComponent(bookingId)}`, { signal });

/** True when the quote can still be booked (not expired, not already used). */
export const isQuoteBookable = (quote: FareQuote): boolean =>
  !quote.redeemed && Date.parse(quote.expiresAt) > Date.now();

export type { PaymentMethod };

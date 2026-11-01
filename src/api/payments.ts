import { withDeadline } from './deadline';
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
    throw new ApiError(
      'config',
      'The fare and booking service is not configured.',
    );
  }
};

interface PaymentsRequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly body?: unknown;
  readonly idempotencyKey?: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export const buildPaymentsUrl = (baseUrl: string, path: string): string => {
  const base = baseUrl.replace(/\/+$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const baseHasV1 = base.endsWith('/v1');
  const pathHasV1 = cleanPath.startsWith('/v1/');
  if (baseHasV1 && pathHasV1) {
    return `${base}${cleanPath.slice(3)}`;
  }
  if (!baseHasV1 && !pathHasV1) {
    return `${base}/v1${cleanPath}`;
  }
  return `${base}${cleanPath}`;
};

const buildUrl = (path: string): string =>
  buildPaymentsUrl(env.paymentsApiBaseUrl, path);

const attempt = async <T>(
  path: string,
  options: PaymentsRequestOptions,
  forceRefresh: boolean,
  ownerUid?: string,
): Promise<T> => {
  const {
    method = 'GET',
    body,
    idempotencyKey,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal,
  } = options;

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onExternalAbort = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    onExternalAbort = () => {
      reject(new ApiError('network', `Request to ${path} cancelled`));
      controller.abort();
    };
    timer = setTimeout(() => {
      reject(new ApiError('timeout', `Request to ${path} timed out`));
      controller.abort();
    }, timeoutMs);
    signal?.addEventListener('abort', onExternalAbort);
    if (signal?.aborted) onExternalAbort();
  });

  const request = async (): Promise<T> => {
    if (controller.signal.aborted)
      throw new ApiError('network', 'Request cancelled');
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body) headers['Content-Type'] = 'application/json';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    const currentUser = getAuth().currentUser;
    if (ownerUid !== undefined && currentUser?.uid !== ownerUid)
      throw new ApiError('session_changed', 'Your account changed. Please try again.');
    if (currentUser) {
      // A failed token read must never become an anonymous account request.
      headers.Authorization = `Bearer ${await currentUser.getIdToken(forceRefresh)}`;
    }
    if (controller.signal.aborted)
      throw new ApiError('network', 'Request cancelled');
    if (ownerUid !== undefined && getAuth().currentUser?.uid !== ownerUid)
      throw new ApiError('session_changed', 'Your account changed. Please try again.');
    const response = await fetch(buildUrl(path), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const raw = await response.text();
    if (ownerUid !== undefined && getAuth().currentUser?.uid !== ownerUid)
      throw new ApiError('session_changed', 'Your account changed. Please try again.');
    let parsed: unknown;
    if (raw.length) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        if (response.ok)
          throw new ApiError('parse', `Malformed JSON from ${path}`);
      }
    }
    if (!response.ok) {
      throw new ApiError(
        'http',
        `${method} ${path} failed with ${response.status}`,
        response.status,
        parsed,
      );
    }
    return parsed as T;
  };
  try {
    // Bound token acquisition and body reading as well as the fetch itself.
    return await Promise.race([interrupted, request()]);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('network', `Could not reach ${path}`);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    signal?.removeEventListener('abort', onExternalAbort);
  }
};

const requestWithRecovery = async <T>(
  path: string,
  options: PaymentsRequestOptions,
  ownerUid?: string,
): Promise<T> => {
  assertPaymentsConfig();
  try {
    return await attempt<T>(path, options, false, ownerUid);
  } catch (error) {
    if (ownerUid !== undefined && getAuth().currentUser?.uid !== ownerUid)
      throw new ApiError('session_changed', 'Your account changed. Please try again.');
    // The cached Firebase token may have expired: refresh once and retry.
    if (
      error instanceof ApiError &&
      error.kind === 'http' &&
      error.status === 401
    ) {
      return attempt<T>(path, options, true, ownerUid);
    }
    // If the customer identity is unprovisioned, auto-register and retry once
    const errBody = (error as any)?.body;
    const errCode = errBody?.error?.code || errBody?.code;
    if (
      error instanceof ApiError &&
      error.kind === 'http' &&
      error.status === 403 &&
      errCode === 'USER_NOT_PROVISIONED' &&
      path !== '/v1/customers/me'
    ) {
      await attempt<CustomerAccount>(
        '/v1/customers/me',
        { method: 'POST', signal: options.signal },
        false,
        ownerUid,
      );
      return attempt<T>(path, options, false, ownerUid);
    }
    throw error;
  }
};
export const paymentsRequest = async <T>(
  path: string,
  options: PaymentsRequestOptions = {},
): Promise<T> => {
  const ownerUid = getAuth().currentUser?.uid;
  return withDeadline(
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    options.signal,
    (reason) =>
      new ApiError(
        reason === 'timeout' ? 'timeout' : 'network',
        reason === 'timeout'
          ? 'Backend request timed out'
          : 'Backend request cancelled',
      ),
    (signal) => requestWithRecovery<T>(path, { ...options, signal }, ownerUid),
  );
};

// ─── Account ──────────────────────────────────────────────────────────────────

/** Only account reads and idempotent registration tolerate one transient retry.
 * Capture the user identity so an account switch can never replay another user's bootstrap.
 * Each attempt includes token refresh within its 30-second deadline.
 */
const accountRequest = async (
  method: 'GET' | 'POST',
  signal?: AbortSignal,
): Promise<CustomerAccount> => {
  assertPaymentsConfig();
  const identity = getAuth().currentUser?.uid;
  for (let retry = 0; ; retry++) {
    if (signal?.aborted || getAuth().currentUser?.uid !== identity) {
      throw new ApiError('network', 'Account request cancelled');
    }
    try {
      return await attempt<CustomerAccount>(
        '/v1/customers/me',
        {
          method,
          signal,
          timeoutMs: 30_000,
        },
        retry > 0,
        identity,
      );
    } catch (error) {
      const retryable =
        error instanceof ApiError &&
        (error.kind === 'network' ||
          error.kind === 'timeout' ||
          (error.kind === 'http' &&
            [401, 502, 503, 504].includes(error.status ?? 0)));
      if (
        retry >= 1 ||
        !retryable ||
        signal?.aborted ||
        getAuth().currentUser?.uid !== identity
      )
        throw error;
    }
  }
};

/**
 * Registers the signed-in customer, or returns the existing account. Safe to call after every
 * sign-in. The sign-in must carry a verified phone number.
 */
export const registerCustomer = async (
  signal?: AbortSignal,
): Promise<CustomerAccount> => accountRequest('POST', signal);

/** Reads the signed-in customer's account from the payments backend. */
export const getCustomerAccount = async (
  signal?: AbortSignal,
): Promise<CustomerAccount> => accountRequest('GET', signal);

/** Changes only customer display fields; phone and Firebase identity never come from the body. */
export const updateCustomerProfile = async (
  body: {
    name: string;
    email: string;
    age: number | null;
    address: string | null;
  },
  signal?: AbortSignal,
): Promise<CustomerAccount> =>
  paymentsRequest<CustomerAccount>('/v1/customers/me', {
    method: 'PATCH',
    body,
    signal,
  });

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
  signal?: AbortSignal,
): Promise<FareQuote> =>
  paymentsRequest<FareQuote>('/v1/fare/quotes', {
    method: 'POST',
    body: {
      pickup: {
        latitude: input.pickup.latitude,
        longitude: input.pickup.longitude,
      },
      drops: input.drops.map((d) => ({
        latitude: d.latitude,
        longitude: d.longitude,
      })),
      vehicleCategory: input.vehicleCategory,
      weightKg: input.weightKg,
    },
    signal,
  });

/** Re-reads a quote (e.g. to check it is still valid / not yet redeemed before booking). */
export const getFareQuote = async (
  quoteId: string,
  signal?: AbortSignal,
): Promise<FareQuote> =>
  paymentsRequest<FareQuote>(`/v1/fare/quotes/${encodeURIComponent(quoteId)}`, {
    signal,
  });

// ─── Booking payment view ─────────────────────────────────────────────────────

/**
 * The customer's payment view of a booking: the payment gate (whether the handover is allowed
 * and what is owed now) and each drop's amount and state. The source of truth for what the
 * payment UI shows; never inferred locally.
 */
export const getBookingPayment = async (
  bookingId: string,
  signal?: AbortSignal,
): Promise<CustomerBooking> =>
  paymentsRequest<CustomerBooking>(
    `/v1/bookings/${encodeURIComponent(bookingId)}`,
    { signal },
  );

/** True when the quote can still be booked (not expired, not already used). */
export const isQuoteBookable = (quote: FareQuote): boolean =>
  !quote.redeemed && Date.parse(quote.expiresAt) > Date.now();

export type { PaymentMethod };

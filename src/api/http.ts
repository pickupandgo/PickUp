import { withDeadline } from './deadline';
import { env, assertApiConfig } from '../config/env';
import { getAuth } from '@react-native-firebase/auth';
/** Milliseconds before a request is aborted. */
const DEFAULT_TIMEOUT_MS = 15_000;
/** Retry attempts for transient failures (network drop, 5xx). */
const DEFAULT_RETRIES = 2;

export type ApiErrorKind =
  | 'network'
  | 'timeout'
  | 'http'
  | 'parse'
  | 'config'
  | 'session_changed'
  | 'location_permission'
  | 'location_services'
  | 'location_unavailable'
  | 'location_timeout';

/**
 * Single error type for every failure mode, so screens can branch on `kind`
 * instead of string-matching messages.
 */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly body?: unknown;

  constructor(
    kind: ApiErrorKind,
    message: string,
    status?: number,
    body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.body = body;
  }

  get errorCode(): string | undefined {
    const body = this.body as any;
    return body?.error?.code || body?.code;
  }

  /** Retrying may succeed: connectivity blips and server-side faults. */
  get isRetryable(): boolean {
    if (this.kind === 'network' || this.kind === 'timeout') return true;
    return (
      this.kind === 'http' && this.status !== undefined && this.status >= 500
    );
  }

  /** Copy suitable for showing to a user. */
  get userMessage(): string {
    switch (this.kind) {
      case 'config':
        return (
          this.serverMessage ??
          (this.message && !this.message.startsWith('[object')
            ? this.message
            : 'The app is not configured to reach the server.')
        );
      case 'timeout':
        return 'The server took too long to respond. Please try again.';
      case 'location_permission':
        return 'Location permission is required to detect your pickup location.';
      case 'location_services':
        return 'Please turn on Location services to detect your pickup location.';
      case 'location_unavailable':
        return 'Unable to determine your current location. Please try again.';
      case 'location_timeout':
        return 'Location detection timed out. Please try again.';
      case 'network':
        return 'No connection to the server. Check your internet and try again.';
      case 'parse':
        return 'The server sent an unexpected response.';
      case 'http':
        if (this.status === 401)
          return this.serverMessage ?? 'Please sign in to continue.';
        if (this.status === 403) {
          if (this.errorCode === 'USER_NOT_PROVISIONED') {
            return (
              this.serverMessage ??
              'Your customer account registration is pending. Please complete your profile.'
            );
          }
          if (this.errorCode === 'ACCOUNT_ROLE_CONFLICT') {
            return (
              this.serverMessage ??
              'This account is registered as a driver and cannot be used for booking customer rides.'
            );
          }
          if (this.errorCode === 'PHONE_VERIFICATION_REQUIRED') {
            return (
              this.serverMessage ??
              'Please verify your mobile number with an OTP to continue.'
            );
          }
          return (
            this.serverMessage ??
            'This action is not permitted for your account.'
          );
        }
        if (this.status === 404) return 'Not found.';
        if (this.status === 409) {
          if (this.errorCode === 'PHONE_ALREADY_REGISTERED') {
            return (
              this.serverMessage ??
              'This mobile number is already registered to another account.'
            );
          }
          if (this.errorCode === 'ACCOUNT_ROLE_CONFLICT') {
            return (
              this.serverMessage ??
              'This account belongs to a driver or staff member.'
            );
          }
          return this.serverMessage ?? 'That action is no longer possible.';
        }
        if (this.status === 400 || this.status === 422)
          return this.serverMessage ?? 'That request was rejected.';
        if (this.status === 503) {
          if (this.errorCode === 'PRICING_NOT_CONFIGURED') {
            return (
              this.serverMessage ??
              'Fare pricing is currently unavailable for your route. Please try again shortly.'
            );
          }
          return (
            this.serverMessage ??
            'The server is temporarily unavailable. Please try again shortly.'
          );
        }
        if (this.status && this.status >= 500)
          return (
            this.serverMessage ?? 'The server had a problem. Please try again.'
          );
        return this.serverMessage ?? 'Something went wrong.';
      default:
        return this.message || 'Something went wrong.';
    }
  }

  /** NestJS puts human-readable detail in `error.message` or `message` on its error responses. */
  private get serverMessage(): string | undefined {
    const body = this.body as any;
    if (body?.error?.message && typeof body.error.message === 'string') {
      return body.error.message;
    }
    if (body?.message) {
      return Array.isArray(body.message)
        ? body.message.join(', ')
        : String(body.message);
    }
    return undefined;
  }
}

export interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH';
  readonly body?: unknown;
  readonly query?: Record<string, string | number | undefined>;
  readonly timeoutMs?: number;
  readonly retries?: number;
  /** Lets callers cancel in-flight work, e.g. on screen unmount. */
  readonly signal?: AbortSignal;
}

const buildUrl = (path: string, query?: RequestOptions['query']): string => {
  const engineBase = env.engineApiBaseUrl || env.apiBaseUrl;
  const base = `${engineBase}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return base;

  const params = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(
      ([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`,
    );

  return params.length ? `${base}?${params.join('&')}` : base;
};

const delay = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ApiError('network', 'Request cancelled'));
      return;
    }
    const cancel = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      reject(new ApiError('network', 'Request cancelled'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', cancel);
      resolve();
    }, ms);
    signal?.addEventListener('abort', cancel);
  });
const attempt = async <T>(
  path: string,
  options: RequestOptions,
  forceRefresh = false,
  ownerUid?: string,
): Promise<T> => {
  const {
    method = 'GET',
    body,
    query,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal,
  } = options;
  return withDeadline(
    timeoutMs,
    signal,
    (reason) =>
      new ApiError(
        reason === 'timeout' ? 'timeout' : 'network',
        reason === 'timeout'
          ? 'Engine request timed out'
          : 'Engine request cancelled',
      ),
    async (linked, check) => {
      const user = getAuth().currentUser;
      if (ownerUid !== undefined && user?.uid !== ownerUid)
        throw new ApiError('session_changed', 'Your account changed. Please try again.');
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (body) headers['Content-Type'] = 'application/json';
      if (user) {
        try {
          headers.Authorization = `Bearer ${await user.getIdToken(forceRefresh)}`;
        } catch {
          check();
          throw new ApiError(
            'network',
            'Could not authenticate the engine request',
          );
        }
      }
      check();
      if (ownerUid !== undefined && getAuth().currentUser?.uid !== ownerUid)
        throw new ApiError('session_changed', 'Your account changed. Please try again.');
      let response: Response;
      try {
        response = await fetch(buildUrl(path, query), {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: linked,
        });
      } catch {
        check();
        throw new ApiError('network', 'Could not reach the engine');
      }
      const raw = await response.text();
      check();
      if (ownerUid !== undefined && getAuth().currentUser?.uid !== ownerUid)
        throw new ApiError('session_changed', 'Your account changed. Please try again.');
      let parsed: unknown;
      if (raw.length) {
        try {
          parsed = JSON.parse(raw);
        } catch {
          if (response.ok)
            throw new ApiError('parse', 'Unexpected response from the engine');
        }
      }
      if (!response.ok)
        throw new ApiError(
          'http',
          `${method} ${path} failed with ${response.status}`,
          response.status,
          parsed,
        );
      return parsed as T;
    },
  );
};

/**
 * Performs a JSON request against the engine, retrying transient failures with
 * exponential backoff. Never retries 4xx, since those will fail identically.
 */
const requestWithRetry = async <T>(
  path: string,
  options: RequestOptions,
  ownerUid?: string,
): Promise<T> => {
  assertApiConfig();

  const retries =
    (options.method ?? 'GET') === 'GET'
      ? Math.max(0, Math.min(3, options.retries ?? DEFAULT_RETRIES))
      : 0;
  let lastError: ApiError | undefined;
  // The cached Firebase token may have expired; refresh once on the first 401 and retry.
  let refreshedOnAuth = false;

  for (let i = 0; i <= retries; i++) {
    try {
      return await attempt<T>(path, options, false, ownerUid);
    } catch (error) {
      const apiError =
        error && typeof error === 'object' && (error as any).name === 'ApiError'
          ? (error as ApiError)
          : new ApiError('network', String(error));

      if (
        apiError.kind === 'http' &&
        apiError.status === 401 &&
        !refreshedOnAuth &&
        !options.signal?.aborted
      ) {
        refreshedOnAuth = true;
        try {
          return await attempt<T>(path, options, true, ownerUid);
        } catch (retryError) {
          throw retryError &&
            typeof retryError === 'object' &&
            (retryError as any).name === 'ApiError'
            ? (retryError as ApiError)
            : new ApiError('network', String(retryError));
        }
      }

      if (!apiError.isRetryable || i === retries || options.signal?.aborted) {
        throw apiError;
      }
      lastError = apiError;
      await delay(300 * 2 ** i, options.signal);
    }
  }

  throw lastError ?? new ApiError('network', `Request to ${path} failed`);
};

/** One total deadline includes retries/backoff, token acquisition and the response body. */
export const request = async <T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> => {
  const ownerUid = getAuth().currentUser?.uid;
  return withDeadline(
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    options.signal,
    (reason) =>
      new ApiError(
        reason === 'timeout' ? 'timeout' : 'network',
        reason === 'timeout'
          ? 'Engine request timed out'
          : 'Engine request cancelled',
      ),
    (signal) => requestWithRetry<T>(path, { ...options, signal }, ownerUid),
  );
};

/** Normalises anything thrown into an ApiError for uniform handling. */
export const toApiError = (error: unknown): ApiError =>
  error && typeof error === 'object' && (error as any).name === 'ApiError'
    ? (error as ApiError)
    : new ApiError('network', String(error));

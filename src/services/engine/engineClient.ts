import { env } from '../../config/env';
import { getFirebaseIdToken } from '../payments/firebaseToken';
import { PaymentsApiError } from '../payments/paymentsErrors';

/*
 * HTTP client for the trip engine (Phase 8 contract, docs/PAYMENT_FLOW_FINAL_REVIEW.md G and D).
 * Same pattern as the payments client:
 *   - every request carries the signed-in driver's Firebase ID token; the engine takes the
 *     driver's identity from it, never from the request;
 *   - the token is refreshed once if the engine says it expired;
 *   - network failures, timeouts and gateway errors are retried with backoff (safe: every driver
 *     action is idempotent on the engine, a repeat answers `changed: false`);
 *   - a failure is always an EngineApiError, never a success. No answer (timeout, network) means
 *     the outcome is unknown: the caller re-reads the trip instead of guessing.
 * Tokens and request bodies are never logged.
 */

/** Returns a Firebase ID token. `forceRefresh` bypasses the SDK's cached token. */
export type EngineTokenProvider = (forceRefresh: boolean) => Promise<string>;

/** Codes that are safe to retry automatically. */
const RETRYABLE_CODES: ReadonlySet<string> = new Set([
  'NETWORK_ERROR',
  'TIMEOUT',
  'AUTH_PROVIDER_UNAVAILABLE',
  'HTTP_502',
  'HTTP_503',
  'HTTP_504',
]);

/** A stable error code from the engine: upper snake case. */
const CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;

export class EngineApiError extends Error {
  /** Stable code: the engine's (PAYMENT_REQUIRED, ...), HTTP_<status>, or a client code. */
  readonly code: string;
  /** HTTP status, or 0 when no response was received. */
  readonly status: number;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: string,
    message: string,
    status: number,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'EngineApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  /** No answer was received: the engine may or may not have applied the request. */
  get outcomeUnknown(): boolean {
    return (
      this.code === 'NETWORK_ERROR' ||
      this.code === 'TIMEOUT' ||
      this.code === 'INVALID_RESPONSE'
    );
  }

  get retryable(): boolean {
    return RETRYABLE_CODES.has(this.code);
  }
}

export interface EngineRequest {
  readonly method: 'GET' | 'POST' | 'PATCH';
  /** Fixed API path built by this app from encoded, validated ids. Never user input. */
  readonly path: string;
  readonly body?: Readonly<Record<string, unknown>>;
  /** Retry failures with no answer (default true). Polling calls pass false: the next poll retries. */
  readonly retry?: boolean;
}

export interface EngineClient {
  /** Sends the request and returns the parsed JSON body. Throws EngineApiError. */
  request(request: EngineRequest): Promise<unknown>;
}

export interface EngineClientOptions {
  readonly baseUrl: string;
  readonly getToken: EngineTokenProvider;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  /** Total tries for retryable failures. */
  readonly maxAttempts?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

const PATH_PATTERN = /^\/[A-Za-z0-9/_-]+$/;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_ATTEMPTS = 3;

const defaultSleep = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));

export function createEngineClient(options: EngineClientOptions): EngineClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const sleep = options.sleep ?? defaultSleep;

  async function token(forceRefresh: boolean): Promise<string> {
    try {
      return await options.getToken(forceRefresh);
    } catch (error) {
      if (error instanceof PaymentsApiError && error.code === 'NOT_SIGNED_IN') {
        throw new EngineApiError('NOT_SIGNED_IN', 'Not signed in', 401);
      }
      // The SDK could not refresh the token (offline): nothing was sent.
      throw new EngineApiError('NETWORK_ERROR', 'Network unavailable', 0);
    }
  }

  async function sendOnce(
    request: EngineRequest,
    bearer: string,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let status: number;
    let ok: boolean;
    let json: unknown;
    try {
      const response = await fetchImpl(`${options.baseUrl}${request.path}`, {
        method: request.method,
        headers: buildHeaders(request, bearer),
        body: request.body ? JSON.stringify(request.body) : undefined,
        signal: controller.signal,
      });
      status = response.status;
      ok = response.ok;
      json = await readJson(response);
    } catch {
      throw controller.signal.aborted
        ? new EngineApiError('TIMEOUT', 'The request timed out', 0)
        : new EngineApiError('NETWORK_ERROR', 'Network unavailable', 0);
    } finally {
      clearTimeout(timer);
    }
    if (!ok) {
      throw toEngineError(status, json);
    }
    if (json === undefined) {
      // A success we cannot read: the outcome is unknown, never assumed.
      throw new EngineApiError(
        'INVALID_RESPONSE',
        'Unexpected response from the server',
        0,
      );
    }
    return json;
  }

  return {
    async request(request) {
      if (!PATH_PATTERN.test(request.path) || request.path.includes('//')) {
        throw new Error('Invalid engine API path');
      }
      const retry = request.retry ?? true;
      let forceRefresh = false;
      for (let attempt = 1; ; attempt += 1) {
        try {
          return await sendOnce(request, await token(forceRefresh));
        } catch (error) {
          if (
            error instanceof EngineApiError &&
            error.code === 'AUTH_INVALID_TOKEN' &&
            !forceRefresh
          ) {
            // The cached Firebase token may have expired between the check and the call.
            forceRefresh = true;
            continue;
          }
          if (
            retry &&
            error instanceof EngineApiError &&
            error.retryable &&
            attempt < maxAttempts
          ) {
            await sleep(backoffMs(attempt));
            continue;
          }
          throw error;
        }
      }
    },
  };
}

function buildHeaders(
  request: EngineRequest,
  bearer: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${bearer}`,
  };
  if (request.body) {
    headers['Content-Type'] = 'application/json';
  }
  return headers;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The engine's error body: { statusCode, error, code?, message, details? }. */
function toEngineError(status: number, json: unknown): EngineApiError {
  const body = isRecord(json) ? json : {};
  const code =
    typeof body.code === 'string' && CODE_PATTERN.test(body.code)
      ? body.code
      : `HTTP_${status}`;
  const raw = body.message;
  const message =
    typeof raw === 'string'
      ? raw
      : Array.isArray(raw)
      ? raw.filter(item => typeof item === 'string').join(', ')
      : '';
  const details = isRecord(body.details) ? body.details : undefined;
  return new EngineApiError(
    code,
    (message || 'Request failed').slice(0, 300),
    status,
    details,
  );
}

function backoffMs(attempt: number): number {
  return (
    Math.min(4_000, 500 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250)
  );
}

/**
 * The engine base URL a Firebase token may be sent to: https, or plain http only in development
 * builds (an engine on the developer's laptop). Anything else is refused.
 */
export function engineBaseUrl(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const url = value.trim().replace(/\/+$/, '');
  const https = /^https:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~/-]*)?$/.test(
    url,
  );
  const devHttp =
    __DEV__ &&
    /^http:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~/-]*)?$/.test(url);
  return https || devHttp ? url : null;
}

let client: EngineClient | null = null;

/** The trip engine client. Throws NOT_CONFIGURED when no (allowed) engine URL is configured. */
export function getEngineClient(): EngineClient {
  if (!client) {
    const baseUrl = engineBaseUrl(env.API_BASE_URL);
    if (!baseUrl) {
      throw new EngineApiError(
        'NOT_CONFIGURED',
        'The trip engine is not configured',
        0,
      );
    }
    client = createEngineClient({
      baseUrl,
      getToken: getFirebaseIdToken,
      timeoutMs: env.REQUEST_TIMEOUT_MS,
    });
  }
  return client;
}

import { PaymentsApiError } from './paymentsErrors';

/** Returns a Firebase ID token. `forceRefresh` bypasses the SDK's cached token. */
export type TokenProvider = (forceRefresh: boolean) => Promise<string>;

export interface PaymentsRequest {
  readonly method: 'GET' | 'POST';
  /** Fixed API path built by this app, e.g. /v1/wallet. Never user input. */
  readonly path: string;
  readonly query?: Readonly<Record<string, string | number | undefined>>;
  readonly body?: Readonly<Record<string, unknown>>;
  readonly idempotencyKey?: string;
}

export interface PaymentsClient {
  /** Sends the request and returns the parsed JSON body. Throws PaymentsApiError. */
  request(request: PaymentsRequest): Promise<unknown>;
}

export interface PaymentsClientOptions {
  readonly baseUrl: string;
  readonly getToken: TokenProvider;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  /** Total tries for retryable failures (network, timeout, 503). */
  readonly maxAttempts?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

const PATH_PATTERN = /^\/v1\/[A-Za-z0-9/_-]+$/;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_ATTEMPTS = 3;

const defaultSleep = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * HTTP client for the payments backend:
 *   - sends the signed-in user's Firebase ID token, refreshing it once if the server says it
 *     expired;
 *   - retries network failures and 503s with backoff (safe: every payments call is idempotent);
 *   - turns the server's `{ error: { code, message, requestId } }` body into PaymentsApiError.
 * Tokens, signatures and request bodies are never logged.
 */
export function createPaymentsClient(
  options: PaymentsClientOptions,
): PaymentsClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const sleep = options.sleep ?? defaultSleep;

  async function sendOnce(
    request: PaymentsRequest,
    token: string,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let status: number;
    let ok: boolean;
    let json: unknown;
    try {
      const response = await fetchImpl(buildUrl(options.baseUrl, request), {
        method: request.method,
        headers: buildHeaders(request, token),
        body: request.body ? JSON.stringify(request.body) : undefined,
        signal: controller.signal,
      });
      status = response.status;
      ok = response.ok;
      json = await readJson(response);
    } catch {
      throw controller.signal.aborted
        ? new PaymentsApiError('TIMEOUT', 'The request timed out', 0)
        : new PaymentsApiError('NETWORK_ERROR', 'Network unavailable', 0);
    } finally {
      clearTimeout(timer);
    }
    if (ok) {
      return json;
    }
    throw toApiError(status, json);
  }

  return {
    async request(request) {
      if (!PATH_PATTERN.test(request.path)) {
        throw new Error('Invalid payments API path');
      }
      let forceRefresh = false;
      for (let attempt = 1; ; attempt += 1) {
        try {
          const token = await options.getToken(forceRefresh);
          return await sendOnce(request, token);
        } catch (error) {
          if (
            error instanceof PaymentsApiError &&
            error.code === 'AUTH_INVALID_TOKEN' &&
            !forceRefresh
          ) {
            // The cached Firebase token may have expired between the check and the call.
            forceRefresh = true;
            continue;
          }
          if (
            error instanceof PaymentsApiError &&
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

function buildUrl(baseUrl: string, request: PaymentsRequest): string {
  const query = Object.entries(request.query ?? {})
    .filter(
      (entry): entry is [string, string | number] => entry[1] !== undefined,
    )
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
    )
    .join('&');
  return `${baseUrl}${request.path}${query ? `?${query}` : ''}`;
}

function buildHeaders(
  request: PaymentsRequest,
  token: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  };
  if (request.body) {
    headers['Content-Type'] = 'application/json';
  }
  if (request.idempotencyKey) {
    headers['Idempotency-Key'] = request.idempotencyKey;
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

function toApiError(status: number, json: unknown): PaymentsApiError {
  const envelope =
    isRecord(json) && isRecord(json.error) ? json.error : undefined;
  const code =
    typeof envelope?.code === 'string' ? envelope.code : `HTTP_${status}`;
  const message =
    typeof envelope?.message === 'string' ? envelope.message : 'Request failed';
  const requestId =
    typeof envelope?.requestId === 'string' ? envelope.requestId : undefined;
  const details = isRecord(envelope?.details) ? envelope.details : undefined;
  return new PaymentsApiError(code, message, status, requestId, details);
}

function backoffMs(attempt: number): number {
  return (
    Math.min(4_000, 500 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250)
  );
}

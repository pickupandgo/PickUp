import { env, assertApiConfig } from '../config/env';

/** Milliseconds before a request is aborted. */
const DEFAULT_TIMEOUT_MS = 15_000;
/** Retry attempts for transient failures (network drop, 5xx). */
const DEFAULT_RETRIES = 2;

export type ApiErrorKind = 'network' | 'timeout' | 'http' | 'parse' | 'config';

/**
 * Single error type for every failure mode, so screens can branch on `kind`
 * instead of string-matching messages.
 */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly body?: unknown;

  constructor(kind: ApiErrorKind, message: string, status?: number, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.body = body;
  }

  /** Retrying may succeed: connectivity blips and server-side faults. */
  get isRetryable(): boolean {
    if (this.kind === 'network' || this.kind === 'timeout') return true;
    return this.kind === 'http' && this.status !== undefined && this.status >= 500;
  }

  /** Copy suitable for showing to a user. */
  get userMessage(): string {
    switch (this.kind) {
      case 'config':
        return 'The app is not configured to reach the server.';
      case 'timeout':
        return 'The server took too long to respond. Please try again.';
      case 'network':
        return 'No connection to the server. Check your internet and try again.';
      case 'parse':
        return 'The server sent an unexpected response.';
      case 'http':
        if (this.status === 404) return 'Not found.';
        if (this.status === 409) return 'That action is no longer possible.';
        if (this.status === 400) return this.serverMessage ?? 'That request was rejected.';
        if (this.status && this.status >= 500) return 'The server had a problem. Please try again.';
        return this.serverMessage ?? 'Something went wrong.';
      default:
        return 'Something went wrong.';
    }
  }

  /** NestJS puts human-readable detail in `message` on its error responses. */
  private get serverMessage(): string | undefined {
    const body = this.body as { message?: string | string[] } | undefined;
    if (!body?.message) return undefined;
    return Array.isArray(body.message) ? body.message.join(', ') : body.message;
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
  const base = `${env.apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return base;

  const params = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);

  return params.length ? `${base}?${params.join('&')}` : base;
};

const delay = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new ApiError('network', 'Request aborted'));
    });
  });

/** Combines the caller's signal with our own timeout signal. */
const linkSignals = (
  timeoutMs: number,
  external?: AbortSignal
): { signal: AbortSignal; cleanup: () => void; didTimeout: () => boolean } => {
  const controller = new AbortController();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onExternalAbort = () => controller.abort();
  external?.addEventListener('abort', onExternalAbort);

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      external?.removeEventListener('abort', onExternalAbort);
    },
  };
};

const attempt = async <T>(path: string, options: RequestOptions): Promise<T> => {
  const { method = 'GET', body, query, timeoutMs = DEFAULT_TIMEOUT_MS, signal } = options;
  const { signal: linked, cleanup, didTimeout } = linkSignals(timeoutMs, signal);

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers: body ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: linked,
    });
  } catch (cause) {
    if (didTimeout()) {
      throw new ApiError('timeout', `Request to ${path} timed out after ${timeoutMs}ms`);
    }
    throw new ApiError('network', `Could not reach ${path}`);
  } finally {
    cleanup();
  }

  const raw = await response.text();
  let parsed: unknown;
  if (raw.length) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      if (response.ok) throw new ApiError('parse', `Malformed JSON from ${path}`);
    }
  }

  if (!response.ok) {
    throw new ApiError('http', `${method} ${path} failed with ${response.status}`, response.status, parsed);
  }

  return parsed as T;
};

/**
 * Performs a JSON request against the engine, retrying transient failures with
 * exponential backoff. Never retries 4xx, since those will fail identically.
 */
export const request = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
  assertApiConfig();

  const retries = options.retries ?? DEFAULT_RETRIES;
  let lastError: ApiError | undefined;

  for (let i = 0; i <= retries; i++) {
    try {
      return await attempt<T>(path, options);
    } catch (error) {
      const apiError =
        error instanceof ApiError ? error : new ApiError('network', String(error));

      if (!apiError.isRetryable || i === retries || options.signal?.aborted) {
        throw apiError;
      }
      lastError = apiError;
      await delay(300 * 2 ** i, options.signal);
    }
  }

  throw lastError ?? new ApiError('network', `Request to ${path} failed`);
};

/** Normalises anything thrown into an ApiError for uniform handling. */
export const toApiError = (error: unknown): ApiError =>
  error instanceof ApiError ? error : new ApiError('network', String(error));

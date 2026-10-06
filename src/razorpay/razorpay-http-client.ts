import { Logger } from '@nestjs/common';
import type { ZodType } from 'zod';
import { RazorpayApiError, RazorpayUnavailableError } from './razorpay.errors';

const MAX_RESPONSE_BYTES = 512 * 1024;

export type HttpMethod = 'GET' | 'POST';

export interface RazorpayHttpClientOptions {
  readonly keyId: string;
  readonly keySecret: string;
  readonly baseUrl: string;
  readonly timeoutMs: number;
  /** Logger context, e.g. the gateway class name. */
  readonly name: string;
}

export interface RazorpayRequestOptions {
  readonly body?: Record<string, unknown>;
  readonly query?: Readonly<Record<string, string>>;
  /** Extra headers, e.g. X-Payout-Idempotency. Never put credentials here. */
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * Hardened HTTP access to the documented Razorpay / RazorpayX REST API (Basic auth with a key id
 * and secret). Every call has a timeout, never follows redirects, caps the response size, and
 * logs only method, path, status and Razorpay's error code. Credentials are never logged.
 *
 * Errors: RazorpayUnavailableError for timeouts, network failures, 5xx and 429 (retryable);
 * RazorpayApiError for definitive rejections and unusable responses.
 */
export class RazorpayHttpClient {
  private readonly logger: Logger;
  private readonly authorization: string;
  private readonly baseUrl: URL;
  private readonly timeoutMs: number;

  constructor(options: RazorpayHttpClientOptions) {
    this.logger = new Logger(options.name);
    const credentials = `${options.keyId}:${options.keySecret}`;
    this.authorization = `Basic ${Buffer.from(credentials, 'utf8').toString('base64')}`;
    this.baseUrl = new URL(options.baseUrl);
    this.timeoutMs = options.timeoutMs;
  }

  async request(
    method: HttpMethod,
    path: string,
    options: RazorpayRequestOptions = {},
  ): Promise<unknown> {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(key, value);
    }

    const startedAt = Date.now();
    let response: Response;
    let text: string;
    try {
      response = await fetch(url, {
        method,
        headers: {
          ...options.headers,
          authorization: this.authorization,
          accept: 'application/json',
          ...(options.body ? { 'content-type': 'application/json' } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      text = await response.text();
    } catch (error) {
      this.logger.warn(
        { method, path, durationMs: Date.now() - startedAt, reason: errorName(error) },
        'Razorpay request did not complete',
      );
      throw new RazorpayUnavailableError('Razorpay request did not complete', { cause: error });
    }

    if (text.length > MAX_RESPONSE_BYTES) {
      throw new RazorpayApiError(
        502,
        'RESPONSE_TOO_LARGE',
        'Razorpay response exceeded the size limit',
      );
    }
    const json = safeJsonParse(text);
    const durationMs = Date.now() - startedAt;

    if (!response.ok) {
      const providerError = extractProviderError(json);
      this.logger.warn(
        { method, path, status: response.status, code: providerError.code, durationMs },
        'Razorpay request was rejected',
      );
      if (response.status >= 500 || response.status === 429) {
        throw new RazorpayUnavailableError(`Razorpay responded with HTTP ${response.status}`);
      }
      throw new RazorpayApiError(response.status, providerError.code, providerError.description);
    }

    if (json === undefined) {
      throw new RazorpayApiError(502, 'NON_JSON_RESPONSE', 'Razorpay returned a non-JSON response');
    }
    this.logger.debug({ method, path, status: response.status, durationMs }, 'Razorpay request ok');
    return json;
  }

  parse<T>(schema: ZodType<T>, json: unknown, what: string): T {
    const result = schema.safeParse(json);
    if (!result.success) {
      this.logger.error({ what }, 'Razorpay response did not match the expected shape');
      throw new RazorpayApiError(502, 'UNEXPECTED_RESPONSE', `Unexpected ${what} response`);
    }
    return result.data;
  }
}

/** Refuses ids that could change the request path before anything is sent. */
export function assertPattern(value: string, pattern: RegExp, label: string): void {
  if (!pattern.test(value)) {
    throw new RangeError(`Invalid Razorpay ${label}`);
  }
}

export const MAX_NOTES = 15;
export const MAX_NOTE_LENGTH = 256;

export function assertNotes(notes: Readonly<Record<string, string>>): void {
  const entries = Object.entries(notes);
  if (
    entries.length > MAX_NOTES ||
    entries.some(([key, value]) => key.length > MAX_NOTE_LENGTH || value.length > MAX_NOTE_LENGTH)
  ) {
    throw new RangeError('Notes exceed Razorpay limits');
  }
}

function safeJsonParse(text: string): unknown {
  if (text.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function extractProviderError(json: unknown): { code: string | null; description: string | null } {
  if (json && typeof json === 'object' && 'error' in json) {
    const error = json.error;
    if (error && typeof error === 'object') {
      const { code, description } = error as { code?: unknown; description?: unknown };
      return {
        code: typeof code === 'string' ? code : null,
        description: typeof description === 'string' ? description : null,
      };
    }
  }
  return { code: null, description: null };
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

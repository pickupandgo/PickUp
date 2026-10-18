import { Inject, Injectable, Logger } from '@nestjs/common';
import type { z } from 'zod';
import { describeError } from '../common/errors';
import { ENGINE_CONFIG, type EngineConfig } from '../config/engine-config';
import {
  errorEnvelopeSchema,
  type InternalBooking,
  internalBookingSchema,
  type InternalFareQuote,
  internalFareQuoteSchema,
} from './payment-backend.types';

export interface BackendRequest {
  readonly method: 'GET' | 'POST';
  /** Path under the backend base URL, e.g. /v1/internal/bookings. */
  readonly path: string;
  readonly body?: Readonly<Record<string, unknown>>;
  /** Correlation id (8-64 of A-Z a-z 0-9 . _ -): the backend reuses it in its audit trail. */
  readonly requestId: string;
}

/**
 * What a call produced:
 *   OK           a 2xx answer
 *   REFUSED      a definitive answer: a 4xx with the backend's error code (the call was refused)
 *   UNAVAILABLE  no definitive answer: network error, timeout, 5xx, 408, 429, an unreadable
 *                answer, or the internal key refused (configuration). The outcome is unknown;
 *                the backend treats repeats as no-ops, so the same call can always be retried.
 */
export type BackendOutcome =
  | { readonly kind: 'OK'; readonly status: number; readonly body: unknown }
  | {
      readonly kind: 'REFUSED';
      readonly status: number;
      readonly code: string;
      readonly message: string;
      readonly details: Readonly<Record<string, unknown>> | null;
    }
  | {
      readonly kind: 'UNAVAILABLE';
      readonly status: number | null;
      readonly code: string;
      readonly message: string;
    };

export type TypedOutcome<T> =
  | { readonly kind: 'OK'; readonly status: number; readonly value: T }
  | Exclude<BackendOutcome, { readonly kind: 'OK' }>;

const MAX_RESPONSE_BYTES = 1024 * 1024;
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([408, 425, 429]);

/**
 * The payment backend's internal API (raj_backend /v1/internal/*), authenticated with
 * X-Internal-Api-Key. The engine sends identities (Firebase subjects), the quote id, statuses
 * and reasons; never an amount, a fee, a payment status or PAYMENT_CONFIRMED.
 */
@Injectable()
export class PaymentBackendClient {
  private readonly logger = new Logger(PaymentBackendClient.name);

  constructor(@Inject(ENGINE_CONFIG) private readonly config: EngineConfig) {}

  async call(request: BackendRequest): Promise<BackendOutcome> {
    const { url, internalApiKey, timeoutMs } = this.config.paymentBackend;
    let response: Response;
    try {
      response = await fetch(`${url}${request.path}`, {
        method: request.method,
        headers: {
          accept: 'application/json',
          ...(request.body ? { 'content-type': 'application/json' } : {}),
          'x-internal-api-key': internalApiKey,
          'x-request-id': request.requestId,
        },
        ...(request.body ? { body: JSON.stringify(request.body) } : {}),
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      // AbortSignal.timeout rejects with a DOMException (not always an `instanceof Error` across
      // realms): match on the name.
      const timedOut = errorName(error) === 'TimeoutError';
      return {
        kind: 'UNAVAILABLE',
        status: null,
        code: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR',
        message: describeError(error),
      };
    }

    let json: unknown = null;
    try {
      const text = await response.text();
      if (text.length > MAX_RESPONSE_BYTES) {
        return unavailable(
          response.status,
          'RESPONSE_TOO_LARGE',
          'response exceeds 1 MB',
        );
      }
      json = text.length > 0 ? (JSON.parse(text) as unknown) : null;
    } catch (error) {
      return unavailable(
        response.status,
        'UNREADABLE_RESPONSE',
        describeError(error),
      );
    }

    if (response.ok) {
      return json === null
        ? unavailable(response.status, 'UNREADABLE_RESPONSE', 'empty response')
        : { kind: 'OK', status: response.status, body: json };
    }

    const envelope = errorEnvelopeSchema.safeParse(json);
    const code = envelope.success
      ? envelope.data.error.code
      : `HTTP_${response.status}`;
    const message = envelope.success ? (envelope.data.error.message ?? '') : '';
    if (response.status === 401 || response.status === 403) {
      // The internal key was refused: a configuration error, not an answer about the booking.
      // Kept retryable so no event is lost while the key is fixed.
      this.logger.error({
        alert: 'PAYMENT_BACKEND_AUTH_FAILED',
        msg: 'The payment backend refused the internal API key; calls are retried until it is fixed',
        status: response.status,
        code,
      });
      return unavailable(response.status, code, message);
    }
    if (response.status >= 500 || RETRYABLE_STATUSES.has(response.status)) {
      return unavailable(response.status, code, message);
    }
    return {
      kind: 'REFUSED',
      status: response.status,
      code,
      message,
      details: envelope.success ? (envelope.data.error.details ?? null) : null,
    };
  }

  getFareQuote(
    quoteId: string,
    requestId: string,
  ): Promise<TypedOutcome<InternalFareQuote>> {
    return this.typed(internalFareQuoteSchema, {
      method: 'GET',
      path: `/v1/internal/fare-quotes/${encodeURIComponent(quoteId)}`,
      requestId,
    });
  }

  registerBooking(
    input: {
      readonly externalRef: string;
      readonly customerSubject: string;
      readonly quoteId: string;
      readonly paymentMethod: 'PAY_AT_PICKUP' | 'PAY_AT_DELIVERY';
    },
    requestId: string,
  ): Promise<TypedOutcome<InternalBooking>> {
    return this.typed(internalBookingSchema, {
      method: 'POST',
      path: '/v1/internal/bookings',
      body: { ...input },
      requestId,
    });
  }

  getBooking(
    paymentBookingId: string,
    requestId: string,
  ): Promise<TypedOutcome<InternalBooking>> {
    return this.typed(internalBookingSchema, {
      method: 'GET',
      path: `/v1/internal/bookings/${encodeURIComponent(paymentBookingId)}`,
      requestId,
    });
  }

  /** Validates an OK answer; an unexpected shape is treated as no answer (nothing applied). */
  parse<T>(
    schema: z.ZodType<T>,
    outcome: BackendOutcome,
    path: string,
  ): TypedOutcome<T> {
    if (outcome.kind !== 'OK') {
      return outcome;
    }
    const parsed = schema.safeParse(outcome.body);
    if (!parsed.success) {
      this.logger.error({
        alert: 'PAYMENT_BACKEND_CONTRACT_MISMATCH',
        msg: 'The payment backend answered with an unexpected shape; nothing was applied from it',
        path,
        issues: parsed.error.issues
          .slice(0, 5)
          .map((issue) => issue.path.join('.')),
      });
      return unavailable(
        outcome.status,
        'UNEXPECTED_RESPONSE',
        'unexpected response shape',
      );
    }
    return { kind: 'OK', status: outcome.status, value: parsed.data };
  }

  private async typed<T>(
    schema: z.ZodType<T>,
    request: BackendRequest,
  ): Promise<TypedOutcome<T>> {
    return this.parse(schema, await this.call(request), request.path);
  }
}

function unavailable(
  status: number | null,
  code: string,
  message: string,
): Extract<BackendOutcome, { kind: 'UNAVAILABLE' }> {
  return { kind: 'UNAVAILABLE', status, code, message };
}

function errorName(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const { name } = error;
    return typeof name === 'string' ? name : undefined;
  }
  return undefined;
}

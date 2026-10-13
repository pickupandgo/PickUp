import { PaymentsApiError } from './paymentsErrors';

/*
 * Checks for payments-backend responses. Anything unexpected becomes INVALID_RESPONSE, so a
 * malformed or tampered response never reaches a screen, Razorpay Checkout or a QR code.
 */

export type Json = Record<string, unknown>;

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

export function invalid(what: string): never {
  throw new PaymentsApiError(
    'INVALID_RESPONSE',
    `Unexpected ${what} in server response`,
    0,
  );
}

export function record(value: unknown, what: string): Json {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Json;
  }
  return invalid(what);
}

export function list(value: unknown, what: string): readonly unknown[] {
  return Array.isArray(value) ? value : invalid(what);
}

export function text(value: unknown, what: string, pattern?: RegExp): string {
  if (
    typeof value === 'string' &&
    value.length > 0 &&
    (!pattern || pattern.test(value))
  ) {
    return value;
  }
  return invalid(what);
}

export function nullableText(
  value: unknown,
  what: string,
  pattern?: RegExp,
): string | null {
  return value === null ? null : text(value, what, pattern);
}

export function wholeNumber(value: unknown, what: string): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  return invalid(what);
}

export function nullableWholeNumber(
  value: unknown,
  what: string,
): number | null {
  return value === null ? null : wholeNumber(value, what);
}

export function bool(value: unknown, what: string): boolean {
  return typeof value === 'boolean' ? value : invalid(what);
}

export function oneOf<T extends string>(
  value: unknown,
  options: readonly T[],
  what: string,
): T {
  if (
    typeof value === 'string' &&
    (options as readonly string[]).includes(value)
  ) {
    return value as T;
  }
  return invalid(what);
}

export function nullableOneOf<T extends string>(
  value: unknown,
  options: readonly T[],
  what: string,
): T | null {
  return value === null ? null : oneOf(value, options, what);
}

/** An ISO-8601 timestamp the app can show; anything unparsable is refused. */
export function timestamp(value: unknown, what: string): string {
  const raw = text(value, what);
  return Number.isNaN(Date.parse(raw)) ? invalid(what) : raw;
}

export function nullableTimestamp(value: unknown, what: string): string | null {
  return value === null ? null : timestamp(value, what);
}

import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Engine error responses keep Nest's shape ({ statusCode, error, message }), which the apps
 * already read, and add a stable `code` and optional `details`.
 */
export function engineError(
  status: HttpStatus,
  code: string,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): HttpException {
  return new HttpException(
    {
      statusCode: status,
      error: reasonPhrase(status),
      code,
      message,
      ...(details ? { details } : {}),
    },
    status,
  );
}

export const badRequest = (
  message: string,
  details?: Record<string, unknown>,
) => engineError(HttpStatus.BAD_REQUEST, 'INVALID_REQUEST', message, details);

export const notFound = (code: string, message: string) =>
  engineError(HttpStatus.NOT_FOUND, code, message);

export const forbidden = (
  message = 'You do not have access to this resource',
) => engineError(HttpStatus.FORBIDDEN, 'FORBIDDEN', message);

/** The payment backend could not be asked, or did not answer: nothing was committed. */
export const paymentBackendUnavailable = (
  message: string,
  details?: Record<string, unknown>,
) =>
  engineError(
    HttpStatus.SERVICE_UNAVAILABLE,
    'PAYMENT_BACKEND_UNAVAILABLE',
    message,
    details,
  );

function reasonPhrase(status: HttpStatus): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'Bad Request';
    case HttpStatus.UNAUTHORIZED:
      return 'Unauthorized';
    case HttpStatus.FORBIDDEN:
      return 'Forbidden';
    case HttpStatus.NOT_FOUND:
      return 'Not Found';
    case HttpStatus.CONFLICT:
      return 'Conflict';
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return 'Unprocessable Entity';
    case HttpStatus.SERVICE_UNAVAILABLE:
      return 'Service Unavailable';
    case HttpStatus.BAD_GATEWAY:
      return 'Bad Gateway';
    default:
      return Number(status) >= 500 ? 'Internal Server Error' : 'Error';
  }
}

/** A short, value-free description of an error for logs. */
export function describeError(error: unknown): string {
  // Duck-typed: fetch and AbortSignal reject with DOMExceptions, which are not always
  // `instanceof Error` (another realm).
  if (typeof error === 'object' && error !== null) {
    const { name, message } = error as { name?: unknown; message?: unknown };
    if (typeof name === 'string' && typeof message === 'string') {
      return `${name}: ${message}`.slice(0, 300);
    }
  }
  return 'unknown error';
}

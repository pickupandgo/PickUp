import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** Accept a caller-supplied correlation id only if it is short and harmless. */
const INCOMING_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * Returns the request's correlation id, assigning one on first call. A well-formed
 * X-Request-Id from the caller is reused; anything else is replaced with a new UUID.
 * The id is echoed back in the X-Request-Id response header.
 */
export function ensureRequestId(request: IncomingMessage, response: ServerResponse): string {
  if (typeof request.id === 'string') {
    return request.id;
  }
  const header = request.headers['x-request-id'];
  const id = typeof header === 'string' && INCOMING_REQUEST_ID.test(header) ? header : randomUUID();
  request.id = id;
  response.setHeader('X-Request-Id', id);
  return id;
}

/**
 * Registered before every other middleware (including body parsing), so even requests rejected
 * for a malformed or oversized body get a request id in their error response.
 */
export function requestIdMiddleware(
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
): void {
  ensureRequestId(request, response);
  next();
}

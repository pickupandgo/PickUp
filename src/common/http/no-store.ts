import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Every response from this API is private and changes when money moves (balances, payment
 * states, ledger pages). `no-store` stops phones (React Native's OkHttp disk cache), browsers,
 * proxies and CDNs from keeping a copy or serving a stale one.
 */
export function noStoreMiddleware(
  _request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
): void {
  response.setHeader('Cache-Control', 'no-store');
  next();
}

import { type EngineConfig, loadConfig } from '../../src/config/engine-config';
import { TEST_DATABASE_URL } from '../setup/test-database';

export const TEST_FIREBASE_PROJECT = 'multipleride-test';
export const TEST_ISSUER = `https://securetoken.google.com/${TEST_FIREBASE_PROJECT}`;
/** Fake, test-only value (same format the payment backend accepts). Not a real credential. */
export const TEST_INTERNAL_API_KEY =
  'engine_integration_internal_key_0123456789abcdef';

/**
 * The engine's configuration for integration tests. The outbox has no background sender
 * (OUTBOX_POLL_INTERVAL_MS=0): tests drive it with OutboxService.tick(), so every retry is
 * deterministic. A short payment backend timeout keeps fault-injection tests fast.
 */
export function buildTestConfig(
  paymentBackendUrl: string,
  overrides: Record<string, string> = {},
): EngineConfig {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    DATABASE_POOL_MAX: '20',
    AUTH_ISSUER: TEST_ISSUER,
    AUTH_AUDIENCE: TEST_FIREBASE_PROJECT,
    PAYMENT_BACKEND_URL: paymentBackendUrl,
    PAYMENT_BACKEND_INTERNAL_API_KEY: TEST_INTERNAL_API_KEY,
    PAYMENT_BACKEND_TIMEOUT_MS: '1000',
    OUTBOX_POLL_INTERVAL_MS: '0',
    DISPATCH_POLL_INTERVAL_MS: '0',
    OUTBOX_LEASE_SECONDS: '5',
    // Long enough that a retried record is never due again by accident during a test; tests
    // make records due explicitly (flows.makeDue) when they want the next attempt.
    OUTBOX_BASE_BACKOFF_MS: '2000',
    OUTBOX_MAX_BACKOFF_MS: '10000',
    OUTBOX_ALERT_AFTER_ATTEMPTS: '3',
    OFFER_TTL_SECONDS: '60',
    ...overrides,
  });
}

import { type AppConfig, loadConfig } from '../../src/config/app-config';
import { TEST_DATABASE_URL } from '../setup/test-database';

export const TEST_FIREBASE_PROJECT = 'multipleride-test';
export const TEST_ISSUER = `https://securetoken.google.com/${TEST_FIREBASE_PROJECT}`;
export const TEST_RAZORPAY_KEY_ID = 'rzp_test_IntegrationKey01';
export const TEST_RAZORPAY_KEY_SECRET = 'integration_key_secret_value_x';
export const TEST_WEBHOOK_SECRET = 'integration_webhook_secret_value_0123456789abcd';
export const TEST_PREVIOUS_WEBHOOK_SECRET = 'integration_previous_webhook_secret_0123456789';
export const TEST_RAZORPAYX_WEBHOOK_SECRET = 'integration_razorpayx_webhook_secret_0123456789';
export const TEST_RAZORPAYX_ACCOUNT_NUMBER = '7878780080316316';
export const TEST_INTERNAL_API_KEY = 'integration_internal_api_key_0123456789abcdef';
export const TEST_TOPUP_MIN_PAISE = 100;
export const TEST_TOPUP_MAX_PAISE = 1_000_000;
export const TEST_ADJUSTMENT_MAX_PAISE = 5_000_000;

/** Fake, test-only values. None of these are real credentials. */
export function buildTestConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: TEST_DATABASE_URL,
    DATABASE_POOL_MAX: '25',
    AUTH_ISSUER: TEST_ISSUER,
    AUTH_AUDIENCE: TEST_FIREBASE_PROJECT,
    RAZORPAY_KEY_ID: TEST_RAZORPAY_KEY_ID,
    RAZORPAY_KEY_SECRET: TEST_RAZORPAY_KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
    RAZORPAY_WEBHOOK_SECRET_PREVIOUS: TEST_PREVIOUS_WEBHOOK_SECRET,
    WALLET_TOPUP_MIN_PAISE: String(TEST_TOPUP_MIN_PAISE),
    WALLET_TOPUP_MAX_PAISE: String(TEST_TOPUP_MAX_PAISE),
    ADMIN_ADJUSTMENT_MAX_PAISE: String(TEST_ADJUSTMENT_MAX_PAISE),
    INTERNAL_API_KEYS: TEST_INTERNAL_API_KEY,
    COLLECTION_LINK_PROVIDER: 'razorpay_payment_link',
    PAYOUT_PROVIDER: 'razorpayx',
    RAZORPAYX_ACCOUNT_NUMBER: TEST_RAZORPAYX_ACCOUNT_NUMBER,
    RAZORPAYX_WEBHOOK_SECRET: TEST_RAZORPAYX_WEBHOOK_SECRET,
    // Settlements come from the in-memory gateway and are synced explicitly by each test.
    SETTLEMENT_PROVIDER: 'razorpay',
    SETTLEMENT_SYNC_INTERVAL_MINUTES: '0',
    // Razorpay refunds in test mode; the gateway is the in-memory fake (test-app.ts).
    REFUND_PROVIDER: 'razorpay',
    // Reconciliation jobs run only when a test asks (payment flow Phase 7), on rows of any age.
    COLLECTION_RECOVERY_INTERVAL_MINUTES: '0',
    COLLECTION_RECOVERY_MIN_AGE_MINUTES: '0',
    RECONCILIATION_INTERVAL_MINUTES: '0',
    RECONCILIATION_MIN_AGE_MINUTES: '0',
    ...overrides,
  });
}

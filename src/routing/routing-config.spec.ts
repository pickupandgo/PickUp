import { loadConfig } from '../config/app-config';
const base = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  AUTH_ISSUER: 'https://securetoken.google.com/demo-project',
  AUTH_AUDIENCE: 'demo-project',
  RAZORPAY_KEY_ID: 'rzp_test_AbCdEf123456',
  RAZORPAY_KEY_SECRET: 'unit_secret_value_1234',
  RAZORPAY_WEBHOOK_SECRET: 'unit_webhook_secret_value_0123456789abcd',
  WALLET_TOPUP_MAX_PAISE: '500000',
  ADMIN_ADJUSTMENT_MAX_PAISE: '1000000',
};
it('loads the dedicated server route key into immutable config', () => {
  const config = loadConfig({ ...base, GOOGLE_ROUTES_API_KEY: 'server-only-test-key' });
  expect(config.googleRoutes?.apiKey).toBe('server-only-test-key');
  expect(Object.isFrozen(config.googleRoutes)).toBe(true);
});
it('does not reuse unrelated keys or prevent startup without routing', () => {
  const config = loadConfig({
    ...base,
    GOOGLE_MAPS_API_KEY: 'android-key',
    GOOGLE_ROUTES_API_KEY: '',
  });
  expect(config.googleRoutes).toBeUndefined();
});

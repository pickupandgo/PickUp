'use strict';
const assert = require('node:assert/strict');
const { loadConfig } = require('/app/dist/config/engine-config.js');
function validate(env) {
  assert.equal(env.MR_SYNTHETIC_ONLY, 'true');
  const c = loadConfig(env);
  assert.equal(c.nodeEnv, 'production');
  assert.equal(c.outbox.pollIntervalMs, 0);
  assert.equal(c.dispatch.pollIntervalMs, 0);
  assert.equal(c.auth.jwksUrl, 'https://127.0.0.1:3443/jwks');
  assert.equal(c.paymentBackend.url, 'https://127.0.0.1:3443');
  return c;
}
validate(process.env);
const cases = {
  'missing synthetic gate': { MR_SYNTHETIC_ONLY: undefined },
  'background outbox enabled': { OUTBOX_POLL_INTERVAL_MS: '1000' },
  'dispatch timer enabled': { DISPATCH_POLL_INTERVAL_MS: '1000' },
  'external backend': { PAYMENT_BACKEND_URL: 'https://external.invalid' },
  'external JWKS': { AUTH_JWKS_URL: 'https://external.invalid/jwks' },
  'external database': {
    DATABASE_URL: 'postgresql://dummy:dummy@external.invalid:5432/forbidden',
  },
  'wrong database': {
    DATABASE_URL:
      'postgresql://engine_ci_runtime:dummy_engine_ci_test@172.29.63.2:5432/forbidden',
  },
  'live-like internal key': {
    PAYMENT_BACKEND_INTERNAL_API_KEY: 'external_internal_key_0123456789abcdef',
  },
  'TLS bypass': { NODE_TLS_REJECT_UNAUTHORIZED: '0' },
  'cloud credential': { AWS_ACCESS_KEY_ID: 'dummy-forbidden' },
  'payment credential': { RAZORPAY_KEY_ID: 'dummy-forbidden' },
  'proxy override': { HTTPS_PROXY: 'http://127.0.0.1:9999' },
};
for (const overrides of Object.values(cases))
  assert.throws(() => validate({ ...process.env, ...overrides }));
console.log(
  JSON.stringify({
    result: 'PASS',
    production_mode: true,
    negative_safety_cases: Object.keys(cases),
    background_outbox: false,
    background_dispatch: false,
    cloud_or_production_credentials: false,
  }),
);

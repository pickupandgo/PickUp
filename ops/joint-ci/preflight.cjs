'use strict';
const a = require('node:assert/strict');
const { existsSync } = require('node:fs');
const mode = process.argv[2];
a.equal(existsSync('/app/.env'), false);
for (const k of Object.keys(process.env))
  a.ok(
    !/^(AWS_|AZURE_|GITHUB_|ACTIONS_|GOOGLE_APPLICATION_CREDENTIALS$|FCM_PROJECT_ID$|RAZORPAYX_|HTTP_PROXY$|HTTPS_PROXY$|ALL_PROXY$)/.test(
      k,
    ),
  );
a.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, '0');
const u = new URL(process.env.DATABASE_URL);
a.equal(u.hostname, '172.29.63.2');
a.equal(u.port, '5432');
a.ok(u.password.startsWith('dummy_engine_ci_'));
if (mode === 'engine') {
  a.equal(process.env.MR_SYNTHETIC_ONLY, 'true');
  const c = require('/app/dist/config/engine-config.js').loadConfig();
  a.equal(c.nodeEnv, 'production');
  a.equal(c.outbox.pollIntervalMs, 0);
  a.equal(c.dispatch.pollIntervalMs, 0);
  a.equal(u.pathname, '/mr_engine_synthetic_test');
  a.equal(u.username, 'engine_ci_runtime');
  a.equal(c.paymentBackend.url, 'https://127.0.0.1:3443');
  a.equal(c.auth.jwksUrl, 'https://127.0.0.1:3443/jwks');
  a.ok(c.paymentBackend.internalApiKey.startsWith('dummy_engine_ci_'));
} else {
  a.equal(mode, 'backend');
  const c = require('/app/dist/config/app-config.js').loadConfig();
  const flags = {
    NODE_ENV: 'test',
    MR_DISABLE_CHAT_CLEANUP: 'true',
    FCM_ENABLED: 'false',
    SETTLEMENT_PROVIDER: 'disabled',
    SETTLEMENT_SYNC_INTERVAL_MINUTES: '0',
    PAYOUT_PROVIDER: 'disabled',
    PAYOUT_SCHEDULE_ENABLED: 'false',
    PAYOUT_AUTO_EXECUTE: 'false',
    REFUND_PROVIDER: 'disabled',
    REFUND_AUTO_ON_CANCEL: 'false',
    COLLECTION_LINK_PROVIDER: 'disabled',
    DOCUMENT_STORAGE_PROVIDER: 'disabled',
    DOCUMENT_SCANNER_PROVIDER: 'disabled',
    MANUAL_KYC_ENABLED: 'false',
    SWAGGER_ENABLED: 'false',
  };
  for (const [k, v] of Object.entries(flags)) a.equal(process.env[k], v);
  a.equal(u.pathname, '/mr_joint_backend_e2e');
  a.equal(u.username, 'mr_app');
  a.equal(c.auth.provider, 'firebase');
  a.equal(c.auth.jwksUrl, 'https://172.29.63.3:3443/jwks');
  a.equal(c.auth.issuer, 'https://engine-ci.invalid');
  a.equal(c.auth.audience, 'mr-engine-ci');
  a.equal(c.internalApi.keys.length, 1);
  a.ok(c.internalApi.keys[0].startsWith('dummy_engine_ci_'));
  a.equal(c.settlements.provider, null);
  a.equal(c.settlements.syncIntervalMinutes, 0);
  a.equal(c.payouts.provider, null);
  a.equal(c.payouts.schedule.enabled, false);
  a.equal(c.payouts.schedule.autoExecute, false);
  a.equal(c.refunds.provider, null);
  a.equal(c.collections.product, null);
  a.equal(c.collections.simulated, false);
  a.equal(c.simulation.enabled, false);
  a.equal(c.documents.storage, null);
  a.equal(c.documents.scanner, null);
  a.equal(c.googleRoutes, undefined);
  a.equal(c.razorpay.mode, 'test');
  a.equal(c.razorpay.apiBaseUrl, 'http://127.0.0.1:9');
}
console.log(
  JSON.stringify({
    result: 'PASS',
    service: mode,
    safety_flags_verified: true,
    providers_disabled: true,
    background_workers_disabled: true,
    production_credentials: false,
    API_started: false,
  }),
);

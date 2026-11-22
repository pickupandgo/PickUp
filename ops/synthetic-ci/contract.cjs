'use strict';
const assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const imageRequire=createRequire('/app/package.json');
const {loadConfig}=imageRequire('/app/dist/config/app-config.js');
const required={NODE_ENV:'test',MR_DISABLE_CHAT_CLEANUP:'true',FCM_ENABLED:'false',
  SETTLEMENT_PROVIDER:'disabled',SETTLEMENT_SYNC_INTERVAL_MINUTES:'0',
  PAYOUT_PROVIDER:'disabled',PAYOUT_SCHEDULE_ENABLED:'false',PAYOUT_AUTO_EXECUTE:'false',
  REFUND_PROVIDER:'disabled',REFUND_AUTO_ON_CANCEL:'false',COLLECTION_LINK_PROVIDER:'disabled',
  DOCUMENT_STORAGE_PROVIDER:'disabled',DOCUMENT_SCANNER_PROVIDER:'disabled',
  MANUAL_KYC_ENABLED:'false',SWAGGER_ENABLED:'false',DATABASE_POOL_MAX:'2'};
for(const [key,value] of Object.entries(required))assert.equal(process.env[key],value,key);
for(const key of ['AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN',
  'GOOGLE_APPLICATION_CREDENTIALS','GOOGLE_ROUTES_API_KEY','FCM_PROJECT_ID',
  'INTERNAL_API_KEYS','RAZORPAYX_KEY_ID','RAZORPAYX_KEY_SECRET','NODE_TLS_REJECT_UNAUTHORIZED'])
  assert.ok(!process.env[key],key);
assert.equal(require('node:fs').existsSync('/app/.env'),false);
const url=new URL(process.env.DATABASE_URL);
assert.equal(url.hostname,'172.29.62.2');assert.equal(url.port,'5432');
assert.equal(url.pathname,'/mr_synthetic_backend_ci');assert.equal(url.username,'ci_runtime');
assert.ok(url.password.length>=32);assert.equal(url.search,'');
assert.ok(process.env.RAZORPAY_KEY_ID.startsWith('rzp_test_'));
assert.equal(process.env.RAZORPAY_API_BASE_URL,'http://127.0.0.1:9');
assert.equal(process.env.AUTH_JWKS_URL,'http://127.0.0.1:9/jwks');
const config=loadConfig();
assert.equal(config.nodeEnv,'test');assert.equal(config.database.poolMax,2);
assert.equal(config.settlements.provider,null);assert.equal(config.settlements.syncIntervalMinutes,0);
assert.equal(config.payouts.provider,null);assert.equal(config.payouts.schedule.enabled,false);
assert.equal(config.payouts.schedule.autoExecute,false);assert.equal(config.refunds.provider,null);
assert.equal(config.collections.product,null);assert.equal(config.collections.simulated,false);assert.equal(config.simulation.enabled,false);
assert.equal(config.documents.storage,null);assert.equal(config.documents.scanner,null);
assert.equal(config.googleRoutes,undefined);assert.equal(config.internalApi.keys.length,0);
console.log(JSON.stringify({result:'PASS',required_flags_verified:Object.keys(required).length,safe_configuration:true,
  core_payment_gateway:'closed-loopback dummy origin plus enforced network deny',
  production_credentials_loaded:false,Backend_started:false}));

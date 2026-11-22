'use strict';
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const cases=[
 ['cleanup flag missing',{MR_DISABLE_CHAT_CLEANUP:undefined}],
 ['settlement provider enabled',{SETTLEMENT_PROVIDER:'razorpay'}],
 ['payout scheduler enabled',{PAYOUT_SCHEDULE_ENABLED:'true'}],
 ['FCM enabled',{FCM_ENABLED:'true'}],
 ['live-looking dummy key',{RAZORPAY_KEY_ID:'rzp_live_SYNTHETICONLY'}],
 ['non-synthetic database address',{DATABASE_URL:'postgresql://ci_runtime:dummy-only-never-used@192.0.2.123:5432/not_allowed'}],
 ['cloud credential accidentally supplied',{AWS_SESSION_TOKEN:'synthetic-rejection-test-only'}],
 ['TLS verification bypass supplied',{NODE_TLS_REJECT_UNAUTHORIZED:'0'}],
];
const tests=[];
for(const [name,override] of cases){
 const env={...process.env,...override};for(const key of Object.keys(env))if(env[key]===undefined)delete env[key];
 const child=spawnSync(process.execPath,['/ci/contract.cjs'],{env,encoding:'utf8',timeout:8000});
 assert.equal(child.error,undefined,'Safety check did not complete');
 const pass=child.status!==0;tests.push({name,pass});assert.ok(pass,name);
}
console.log(JSON.stringify({result:'PASS',passed:tests.length,total:tests.length,tests,Backend_started:false,database_connected:false}));

'use strict';
const assert=require('node:assert/strict');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 const tests=[];const base='http://127.0.0.1:3000';let ready=false;
 for(let n=0;n<50;n++){
  try{const r=await fetch(base+'/health/ready',{signal:AbortSignal.timeout(1500)});if(r.status===200){ready=true;break;}}catch{}
  await sleep(1000);
 }
 assert.ok(ready,'Backend readiness did not become healthy within bounded startup window');
 const cases=[['/health/live',200],['/health/ready',200],['/v1/customers/me',401],
  ['/v1/drivers/me',401],['/v1/wallet',401],['/v1/admin/session',401],
  ['/v1/notifications/inbox',401],['/v1/admin/session',401,'Bearer malformed'],
  ['/v1/internal/bookings/by-ref/synthetic-nonexistent',503],['/docs',404],
  ['/v1/dev/simulate',404]];
 for(const [path,expected,auth] of cases){
  const started=performance.now();const response=await fetch(base+path,{redirect:'error',
    headers:auth?{authorization:auth}:{},signal:AbortSignal.timeout(4000)});
  const body=await response.text();assert.ok(body.length<16384,'Response unexpectedly large');
  if(path.startsWith('/health/'))assert.deepEqual(JSON.parse(body),{status:'ok'});
  tests.push({path,expected,status:response.status,pass:response.status===expected,milliseconds:Math.round(performance.now()-started)});
 }
 const passed=tests.filter(x=>x.pass).length;
 console.log(JSON.stringify({result:passed===tests.length?'PASS':'FAIL',passed,total:tests.length,tests,
  production_database_contacted:false,external_integrations_used:false}));
 process.exitCode=passed===tests.length?0:1;
})().catch(error=>{console.log(JSON.stringify({result:'FAIL',startup_or_test_failure:error.message}));process.exitCode=1;});

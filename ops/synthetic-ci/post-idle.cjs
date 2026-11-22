'use strict';
// Verify the real readiness path reconnects after pg's 30-second idle timeout.
(async()=>{
 const response=await fetch('http://127.0.0.1:3000/health/ready',{redirect:'error',signal:AbortSignal.timeout(4000)});
 const body=await response.json();const pass=response.status===200 && body.status==='ok';
 console.log(JSON.stringify({result:pass?'PASS':'FAIL',passed:pass?1:0,total:1,
  path:'/health/ready',status:response.status,after_idle_pool_retirement:true}));
 process.exitCode=pass?0:1;
})().catch(()=>{console.log(JSON.stringify({result:'FAIL',passed:0,total:1,after_idle_pool_retirement:true}));process.exitCode=1;});

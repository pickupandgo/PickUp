'use strict';
const net=require('node:net'),dgram=require('node:dgram');
function tcp(host,port,expected){return new Promise(resolve=>{
 const socket=net.connect({host,port});let done=false;
 const finish=connected=>{if(done)return;done=true;socket.destroy();resolve({host,port,expected,connected,pass:connected===expected});};
 socket.on('connect',()=>finish(true));socket.on('error',()=>finish(false));socket.setTimeout(900,()=>finish(false));
});}
function dns(){return new Promise(resolve=>{
 const socket=dgram.createSocket('udp4');let done=false;
 const finish=responded=>{if(done)return;done=true;socket.close();resolve({name:'Docker embedded DNS denied',pass:!responded});};
 socket.on('message',()=>finish(true));socket.on('error',()=>finish(false));
 socket.send(Buffer.from('123401000001000000000000076d722d7465737407696e76616c69640000010001','hex'),53,'127.0.0.11');
 setTimeout(()=>finish(false),900);
});}
(async()=>{
 const tests=await Promise.all([tcp('172.29.62.2',5432,true),tcp('1.1.1.1',443,false),
   tcp('169.254.169.254',80,false),tcp('172.29.62.1',22,false),tcp('172.17.0.1',80,false),dns()]);
 const passed=tests.filter(x=>x.pass).length;
 console.log(JSON.stringify({result:passed===tests.length?'PASS':'FAIL',passed,total:tests.length,tests}));
 process.exitCode=passed===tests.length?0:1;
})();

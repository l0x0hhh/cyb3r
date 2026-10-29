const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createOperations,normalize}=require('../backend/operations');
test('operations validates settings, persists restart state and suppresses duplicate alerts',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ops-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 let time=100000000,free=15,sent=[];
 const options={directory,now:()=>time,statfs:()=>({blocks:100,bsize:1024,bavail:free}),send:async(...args)=>sent.push(args)};
 let ops=createOperations(options);await ops.check();assert.equal(sent.length,0);
 assert.throws(()=>ops.save({enabled:true,warningPercent:90,criticalPercent:80,cooldownHours:6,recipients:[]}),/阈值/);
 ops.save({enabled:true,warningPercent:80,criticalPercent:90,cooldownHours:6,recipients:['monitor@example.com']});
 await ops.check();assert.equal(sent.length,1);assert.equal(ops.status().level,'warning');
 ops=createOperations(options);await ops.check();assert.equal(sent.length,1,'cooldown survives restart');
 free=5;await ops.check();assert.equal(sent.length,2,'escalation sends without waiting');
 free=50;await ops.check();free=5;await ops.check();assert.equal(sent.length,3,'new incident after recovery alerts');
 time+=7*3600000;await ops.check();assert.equal(sent.length,4);
 assert.throws(()=>normalize({...ops.settings(),recipients:['x\r\n@example.com']}),/邮箱/);
 assert.throws(()=>normalize({...ops.settings(),warningPercent:NaN}),/阈值/);
});
test('operations report send failures without leaking error details to browser and release busy flag',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ops-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const ops=createOperations({directory,statfs:()=>({blocks:100,bsize:1,bavail:1}),send:async()=>{throw new Error('test failure');}});
 ops.save({enabled:true,warningPercent:80,criticalPercent:90,cooldownHours:6,recipients:['monitor@example.com']});
 await ops.check();assert.match(ops.status().lastCheck.error,/SMTP/);assert.equal(JSON.stringify(ops.status()).includes('test failure'),false);
});

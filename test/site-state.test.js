const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomBytes } = require('node:crypto');
const { createSiteState } = require('../backend/site-state');

test('persistent sessions store only digests, expire, revoke, and follow password changes', t => {
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'site-state-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const file=path.join(folder,'site-state.sqlite');let time=Date.now();
  let store=createSiteState(file,()=>time);
  const token=randomBytes(32).toString('hex'), user={id:'synthetic-admin',passwordHash:'synthetic-hash'};
  const find=id=>id===user.id?user:null;
  store.createSession(token,user,10000);
  assert.equal(store.getSession(token,find).adminUserId,user.id);
  store.close();
  assert.ok(!fs.readFileSync(file).includes(Buffer.from(token)));
  store=createSiteState(file,()=>time);
  assert.ok(store.getSession(token,find));
  assert.equal(store.getSession(randomBytes(32).toString('hex'),find),null);
  user.passwordHash='changed-hash';assert.equal(store.getSession(token,find),null);
  store.createSession(token,user,10000);time+=10001;assert.equal(store.getSession(token,find),null);
  store.createSession(token,user,10000);store.revoke(token);assert.equal(store.getSession(token,find),null);
  store.createSession(token,user,10000);store.revokeUser(user.id);assert.equal(store.getSession(token,find),null);
  store.attach('visitor-a',['record-a','record-a']);store.attach('visitor-b',['record-b']);
  assert.deepEqual(store.records('visitor-a'),['record-a']);assert.deepEqual(store.records('visitor-c'),[]);
  store.close();
});

test('failed login locks persist, resist IP/account rotation, expire and reset after success',t=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'auth-lock-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const file=path.join(folder,'state.sqlite');let clock=Date.now(),store=createSiteState(file,()=>clock);
  for(let i=0;i<5;i++)store.loginFailure('synthetic-user','192.0.2.1');
  assert.equal(store.loginStatus('synthetic-user','192.0.2.1'),900);
  store.close();store=createSiteState(file,()=>clock);assert.equal(store.loginStatus('synthetic-user','192.0.2.1'),900);
  clock+=1000;store.loginFailure('synthetic-user','192.0.2.1');assert.equal(store.loginStatus('synthetic-user','192.0.2.1'),899);
  for(let i=0;i<5;i++)store.loginFailure('synthetic-user','192.0.2.2');
  assert.ok(store.loginStatus('synthetic-user','192.0.2.3')>0);
  for(let i=0;i<20;i++)store.loginFailure('user-'+i,'192.0.2.10');
  assert.ok(store.loginStatus('different','192.0.2.10')>0);
  clock+=901000;assert.equal(store.loginStatus('synthetic-user','192.0.2.1'),0);
  for(let i=0;i<4;i++)store.loginFailure('reset','192.0.2.11');
  store.loginSuccess('reset','192.0.2.11');
  store.loginFailure('reset','192.0.2.11');assert.equal(store.loginStatus('reset','192.0.2.11'),0);
  assert.equal(store.loginStatus('reset','192.0.2.11','password-change'),0);
  store.close();
});

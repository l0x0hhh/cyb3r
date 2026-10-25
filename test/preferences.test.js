const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

test('preference cookie restores only approved UI fields and never stores personal information', async t=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'document');
  let cookie='';
  Object.defineProperty(globalThis,'document',{configurable:true,value:{get cookie(){return cookie;},set cookie(value){cookie=value;}}});
  t.after(()=>{if(previous)Object.defineProperty(globalThis,'document',previous);else delete globalThis.document;});
  const {preference,savePreference}=await import(pathToFileURL(path.resolve(__dirname,'../frontend/src/services/preferences.js')).href);
  savePreference('adminTab','materials-inventory');savePreference('deviceMode','return');savePreference('materialOnlyAvailable',true);
  assert.equal(preference('adminTab','devices'),'materials-inventory');assert.equal(preference('deviceMode','borrow'),'return');assert.equal(preference('materialOnlyAvailable',false),true);
  assert.ok(cookie.includes('Path=/')&&cookie.includes('Max-Age=31536000')&&cookie.includes('SameSite=Lax'));
  const saved=cookie;
  for(const key of ['password','phone','name','sessionId','receipt'])savePreference(key,'synthetic-value');
  savePreference('adminTab','arbitrary-path');assert.equal(cookie,saved);
  cookie='ccs_preferences=%malformed';assert.equal(preference('adminTab','devices'),'devices');
  cookie='ccs_preferences='+encodeURIComponent(JSON.stringify({adminTab:'devices',phone:'synthetic',materialOnlyAvailable:'yes'}));
  assert.equal(preference('phone',null),null);assert.equal(preference('materialOnlyAvailable',false),false);
});

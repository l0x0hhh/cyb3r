const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {hashAdminPasswordAsync,verifyAdminPassword,passwordFormat}=require('../backend/passwords');

test('versioned salted scrypt hashes support stronger parameters and legacy verification',async()=>{
  const password=crypto.randomBytes(16).toString('hex');
  const [a,b]=await Promise.all([hashAdminPasswordAsync(password),hashAdminPasswordAsync(password)]);
  assert.notEqual(a,b);assert.equal(passwordFormat(a).legacy,false);
  assert.equal(passwordFormat(a).options.N,32768);assert.equal(passwordFormat(a).options.p,3);
  assert.equal(await verifyAdminPassword(password,a),true);assert.equal(await verifyAdminPassword(password+'x',a),false);
  const salt=crypto.randomBytes(16).toString('hex');
  const legacy='scrypt$'+salt+'$'+crypto.scryptSync(password,salt,64).toString('hex');
  assert.equal(passwordFormat(legacy).legacy,true);assert.equal(await verifyAdminPassword(password,legacy),true);
  assert.equal(await verifyAdminPassword(password,'scrypt$v2$999999999$8$3$x$y'),false);
  assert.equal(await verifyAdminPassword('x'.repeat(1025),a),false);
});

const crypto = require('node:crypto');
const { promisify } = require('node:util');
const derive = promisify(crypto.scrypt);
const OPTIONS = { N:32768, r:8, p:3, maxmem:64 * 1024 * 1024 };
const PREFIX = 'scrypt$v2$32768$8$3$';
function passwordFormat(value) {
  const text = String(value || '');
  if (/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(text)) {
    const [,salt,hash]=text.split('$');return {salt,hash,options:{N:16384,r:8,p:1,maxmem:64*1024*1024},legacy:true};
  }
  if (/^scrypt\$v2\$32768\$8\$3\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(text)) {
    const fields=text.split('$');return {salt:fields[5],hash:fields[6],options:OPTIONS,legacy:false};
  }
  return null;
}
function hashAdminPassword(password) {
  const salt=crypto.randomBytes(16).toString('hex');
  return PREFIX+salt+'$'+crypto.scryptSync(String(password),salt,64,OPTIONS).toString('hex');
}
async function hashAdminPasswordAsync(password) {
  const salt=crypto.randomBytes(16).toString('hex');
  return PREFIX+salt+'$'+(await derive(String(password),salt,64,OPTIONS)).toString('hex');
}
async function verifyAdminPassword(password, encoded) {
  const parsed=passwordFormat(encoded);
  if (!parsed || typeof password!=='string' || Buffer.byteLength(password)>1024) return false;
  const actual=await derive(password,parsed.salt,64,parsed.options);
  return crypto.timingSafeEqual(Buffer.from(parsed.hash,'hex'),actual);
}
module.exports={hashAdminPassword,hashAdminPasswordAsync,verifyAdminPassword,passwordFormat};

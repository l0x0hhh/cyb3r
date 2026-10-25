const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomBytes,randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');

test('site cookies preserve login and visitor ownership through restarts, reject CSRF and revoke sessions', async t=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'site-cookie-http-'));
  const reservation=net.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
  const base=`http://127.0.0.1:${port}`, password=randomBytes(16).toString('hex');let child,output='';
  async function stop(){if(child&&child.exitCode===null){const ended=new Promise(r=>child.once('exit',r));child.kill();await ended;}}
  async function start(){
    child=spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,NODE_ENV:'test',PORT:String(port),HOST:'127.0.0.1',TRUST_PROXY:'true',ADMIN_PASSWORD:password,DATA_DIR:folder,UPLOAD_DIR:path.join(folder,'uploads'),QR_DIR:path.join(folder,'qrcodes'),MATERIALS_DEMO:'true'},stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
    for(let i=0;i<100;i++){if(child.exitCode!==null)throw new Error(output);try{if((await fetch(base+'/api/admin/check')).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw new Error(output);
  }
  t.after(async()=>{await stop();fs.rmSync(folder,{recursive:true,force:true});});
  await start();
  const malformed=await fetch(base+'/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"password":"SYNTHETIC-NO-LOG-FIXTURE"'});
  assert.equal(malformed.status,400);assert.equal((await malformed.json()).message,'请求内容格式错误');
  assert.ok(!output.includes('SYNTHETIC-NO-LOG-FIXTURE'));
  function browser(initial={}){
    const jar={...initial};return {jar,async request(route,method='GET',body,headers={}){
      const response=await fetch(base+route,{method,headers:{Cookie:Object.entries(jar).map(([k,v])=>`${k}=${v}`).join('; '),...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});
      for(const set of response.headers.getSetCookie()){const pair=set.split(';')[0],idx=pair.indexOf('=');if(/Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(set))delete jar[pair.slice(0,idx)];else jar[pair.slice(0,idx)]=pair.slice(idx+1);}
      return {response,data:await response.json()};
    }};
  }
  const admin=browser();
  const login=await admin.request('/api/admin/login','POST',{username:'admin',password},{'X-Forwarded-Proto':'https'});
  assert.equal(login.data.success,true);
  const cookie=login.response.headers.getSetCookie().find(v=>v.startsWith('ccs_admin='));
  for(const flag of ['HttpOnly','Secure','SameSite=Lax','Path=/','Max-Age=2592000'])assert.ok(cookie.includes(flag));
  const oldToken=admin.jar.ccs_admin;
  assert.equal((await browser(admin.jar).request('/api/admin/check')).data.isAdmin,true);
  const csrf=await admin.request('/api/v2/admin/materials/demo/status','POST',{status:'inactive'},{Origin:'https://untrusted.example'});assert.equal(csrf.response.status,403);
  const fetchCSRF=await admin.request('/api/admin/logout','POST',{}, {'Sec-Fetch-Site':'cross-site'});assert.equal(fetchCSRF.response.status,403);
  const guest=browser();await guest.request('/api/v2/catalog');
  const other=await guest.request('/api/records/borrow-other','POST',{otherDeviceName:'演示设备',borrowerName:'演示访客',borrowerPhone:'10000000000',major:'演示专业',purpose:'Cookie验收'});
  assert.equal(other.data.success,true);
  const remembered=await guest.request('/api/visitor/records');assert.equal(remembered.data.data[0].recordId,other.data.data.id);assert.notEqual(remembered.data.data[0].borrowerPhone,'10000000000');
  assert.deepEqual((await browser().request('/api/visitor/records')).data.data,[]);
  const materials=(await guest.request('/api/v2/catalog')).data.data.materials;
  const borrowed=await guest.request('/api/v2/borrow','POST',{requestId:randomUUID(),name:'演示访客',phone:'000000',organization:'演示组织',purpose:'迁移校验',dueAt:new Date(Date.now()+86400000).toISOString(),items:[{materialId:materials[0].id,quantity:1}]});assert.equal(borrowed.data.success,true);
  const migrated=browser({materials_guest:guest.jar.ccs_visitor});
  assert.equal((await migrated.request('/api/v2/records')).data.data[0].id,borrowed.data.data.id);
  assert.equal(migrated.jar.ccs_visitor,guest.jar.ccs_visitor);assert.equal(migrated.jar.materials_guest,undefined);
  await stop();await start();
  assert.equal((await admin.request('/api/admin/check')).data.isAdmin,true);
  assert.equal((await guest.request('/api/visitor/records')).data.data[0].recordId,other.data.data.id);
  assert.equal((await guest.request('/api/v2/records')).data.data[0].id,borrowed.data.data.id);
  await admin.request('/api/admin/logout','POST',{});
  assert.equal(admin.jar.ccs_admin,undefined);
  assert.equal((await browser({ccs_admin:oldToken}).request('/api/admin/check')).data.isAdmin,false);
  await admin.request('/api/admin/login','POST',{username:'admin',password});
  const first=admin.jar.ccs_admin;await admin.request('/api/admin/login','POST',{username:'admin',password});
  assert.notEqual(admin.jar.ccs_admin,first);assert.equal((await browser({ccs_admin:first}).request('/api/admin/check')).data.isAdmin,false);
  const second=browser(admin.jar);
  const changed=await admin.request('/api/admin/password','PUT',{currentPassword:password,newPassword:password+'x',confirmPassword:password+'x'});assert.equal(changed.data.success,true);
  assert.equal((await second.request('/api/admin/check')).data.isAdmin,false);
  // 实际HTTP失败状态与持久化限制；伪造更左侧转发IP不能绕过pair锁。
  for(let i=0;i<5;i++){
    const failed=await browser().request('/api/admin/login','POST',{username:'missing-security-test',password:'incorrect'},{'X-Forwarded-For':`203.0.113.${i+1}, 192.0.2.77`});
    assert.equal(failed.response.status,401);assert.equal(failed.data.message,'账号或密码错误');
  }
  await stop();await start();
  const locked=await browser().request('/api/admin/login','POST',{username:'missing-security-test',password:'incorrect'},{'X-Forwarded-For':'198.51.100.2, 192.0.2.77'});
  assert.equal(locked.response.status,429);assert.ok(Number(locked.response.headers.get('retry-after'))>0);
  // 模拟首次升级前的旧账户，验证登录后强度升级且API不返回哈希。
  await stop();
  const {DatabaseSync}=require('node:sqlite'),crypto=require('node:crypto');
  const legacySalt=randomBytes(16).toString('hex');
  const db=new DatabaseSync(path.join(folder,'device-management.sqlite'));
  db.prepare('UPDATE admin_users SET password_hash=? WHERE username=?').run('scrypt$'+legacySalt+'$'+crypto.scryptSync(password,legacySalt,64).toString('hex'),'admin');db.close();
  await start();
  const upgraded=await browser().request('/api/admin/login','POST',{username:'admin',password});
  assert.equal(upgraded.data.success,true);assert.equal(upgraded.data.user.passwordHash,undefined);
  const readDb=new DatabaseSync(path.join(folder,'device-management.sqlite'));
  assert.ok(readDb.prepare('SELECT password_hash FROM admin_users WHERE username=?').get('admin').password_hash.startsWith('scrypt$v2$32768$8$3$'));readDb.close();
});

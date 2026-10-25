const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomBytes, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const sharp = require('sharp');

test('materials HTTP flow: anonymous borrowing, owned photo upload, entry review and return approval', async t => {
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'materials-http-'));
  const reservation=net.createServer();
  await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
  const port=reservation.address().port;
  await new Promise(resolve=>reservation.close(resolve));
  const password=randomBytes(16).toString('hex'), base=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,PORT:String(port),HOST:'127.0.0.1',NODE_ENV:'test',ADMIN_PASSWORD:password,DATA_DIR:folder,UPLOAD_DIR:path.join(folder,'uploads'),QR_DIR:path.join(folder,'qrcodes'),MATERIALS_DEMO:'true',MATERIALS_PORTAL:'true'},stdio:['ignore','pipe','pipe']});
  let output=''; child.stdout.on('data',data=>output+=data.toString()); child.stderr.on('data',data=>output+=data.toString());
  t.after(async()=>{
    if(child.exitCode===null){const exit=new Promise(resolve=>child.once('exit',resolve));child.kill();await exit;}
    fs.rmSync(folder,{recursive:true,force:true});
  });
  let ready=false;
  for(let attempt=0;attempt<80;attempt++){
    if(child.exitCode!==null)throw new Error(output);
    try{if((await fetch(`${base}/api/v2/catalog`)).ok){ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(ready,output);
  let cookie='',sid='';
  async function request(url,method='GET',body,extra={}){
    const response=await fetch(base+url,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(sid?{'x-session-id':sid}:{}),...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{}),...extra},body:body?(body instanceof FormData?body:JSON.stringify(body)):undefined,redirect:'manual'});
    const set=response.headers.getSetCookie().find(value=>value.startsWith('ccs_visitor='));if(set)cookie=set.split(';')[0];
    const result=(response.headers.get('content-type')||'').includes('json')?await response.json():await response.text();
    return {response,result};
  }
  const root=await request('/');assert.equal(root.response.headers.get('location'),'/materials');
  const catalog=await request('/api/v2/catalog');assert.equal(catalog.result.data.materials.length,6);
  const material=catalog.result.data.materials.find(m=>m.consumable&&m.quantity>=100);
  const input={requestId:randomUUID(),name:'演示用户',phone:'000-000',organization:'演示组织',purpose:'活动验收',dueAt:new Date(Date.now()+86400000).toISOString(),items:[{materialId:material.id,quantity:100}]};
  const borrowed=await request('/api/v2/borrow','POST',input);assert.equal(borrowed.response.status,200);assert.ok(borrowed.result.data.receipt);
  assert.equal((await request('/api/v2/borrow','POST',input)).result.data.id,borrowed.result.data.id);
  let mine=(await request('/api/v2/records')).result.data;assert.equal(mine[0].remaining,100);assert.notEqual(mine[0].phone,input.phone);
  const refused=await request('/api/v2/admin/overview');assert.equal(refused.response.status,401);
  const csrf=await request('/api/v2/borrow','POST',{...input,requestId:randomUUID()},{Origin:'https://untrusted.example'});assert.equal(csrf.response.status,403);
  // A new browser can query by exact name and phone, then submit a return without saving a receipt.
  cookie='';
  assert.deepEqual((await request('/api/v2/records')).result.data,[]);
  const noMatch=await request('/api/v2/records/lookup','POST',{name:'错误姓名',phone:input.phone});assert.deepEqual(noMatch.result.data,[]);
  const lookup=await request('/api/v2/records/lookup','POST',{name:input.name,phone:'000000'});
  assert.equal(lookup.response.status,200);assert.equal(lookup.result.data[0].id,mine[0].id);assert.notEqual(lookup.result.data[0].phone,input.phone);
  const returns=await request('/api/v2/returns','POST',{requestId:randomUUID(),loanId:mine[0].id,notes:'活动使用70个，剩余30个交还',lines:[{lineId:mine[0].lines[0].id,good:30,consumed:70,damaged:0,lost:0}]});assert.equal(returns.response.status,200);
  assert.equal((await request('/api/v2/records')).result.data[0].remaining,100);
  const image=await sharp({create:{width:40,height:60,channels:3,background:'#aabbcc'}}).png().toBuffer();
  const photo=new FormData();photo.append('image',new Blob([image],{type:'image/png'}),'photo.png');
  const uploaded=await request('/api/v2/images','POST',photo);assert.equal(uploaded.response.status,200);assert.ok(uploaded.result.data.image.endsWith('-detail.webp'));
  assert.ok(fs.existsSync(path.join(folder,'uploads',path.basename(uploaded.result.data.image))));
  const entry=await request('/api/v2/entries','POST',{requestId:randomUUID(),submitter:'演示录入者',name:'拍照上传验收物资',category:'办公用品',model:'标准',unit:'个',location:'演示柜',quantity:3,consumable:false,images:[uploaded.result.data.image],notes:''});assert.equal(entry.response.status,200);
  assert.equal((await request('/api/v2/catalog')).result.data.materials.length,6);
  const login=await request('/api/admin/login','POST',{username:'admin',password});assert.equal(login.result.success,true);sid=login.result.sessionId;
  const confirm=await request(`/api/v2/admin/returns/${returns.result.data.id}/review`,'POST',{decision:'approved',note:''});assert.equal(confirm.response.status,200);
  const approval=await request(`/api/v2/admin/entries/${entry.result.data.id}/review`,'POST',{decision:'approved',note:''});assert.equal(approval.response.status,200);
  const after=(await request('/api/v2/catalog')).result.data.materials;
  assert.equal(after.length,7);assert.equal(after.find(m=>m.id===material.id).quantity,material.quantity-70);
  mine=(await request('/api/v2/records')).result.data;assert.equal(mine[0].remaining,0);
  const overview=await request('/api/v2/admin/overview');assert.equal(overview.result.data.loans[0].phone,input.phone);assert.ok(overview.result.data.ledger.some(l=>l.type==='归还结算'));
  const exported=await fetch(base+'/api/v2/admin/export',{headers:{'x-session-id':sid}});
  assert.equal(exported.status,200);
  const ExcelJS=require('exceljs'), workbook=new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await exported.arrayBuffer()));
  assert.equal(workbook.worksheets[0].getCell('A1').value,'名称');
  assert.equal(workbook.worksheets[0].rowCount,after.length+1);
  const settled=await request('/api/v2/records/lookup','POST',{name:input.name,phone:input.phone});assert.deepEqual(settled.result.data,[]);
  // Isolated guest cannot enumerate another browser's records or use its ordinary loan number as a receipt.
  const other=await fetch(base+'/api/v2/records');assert.deepEqual((await other.json()).data,[]);
  const forged=await fetch(base+'/api/v2/restore',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({receipt:mine[0].id})});assert.equal(forged.status,404);
  const reusable=after.find(m=>!m.consumable&&m.quantity>=2);
  const normalBorrow=await request('/api/v2/borrow','POST',{...input,requestId:randomUUID(),items:[{materialId:reusable.id,quantity:2}]});
  const normalLoan=(await request('/api/v2/records')).result.data.find(l=>l.id===normalBorrow.result.data.id);
  const normal=await request('/api/v2/returns','POST',{requestId:randomUUID(),loanId:normalLoan.id,notes:'',lines:[{lineId:normalLoan.lines[0].id,good:1,consumed:0,damaged:0,lost:0}]});
  assert.equal(normal.result.data.status,'approved');
  assert.equal((await request('/api/v2/catalog')).result.data.materials.find(m=>m.id===reusable.id).quantity,reusable.quantity-1);
  const policy=await request('/api/v2/admin/materials/'+material.id+'/consumption-policy','POST',{percent:50});
  assert.equal(policy.response.status,200);assert.equal(policy.result.data.consumptionLimitPercent,50);
  // 共用登录，设备与物资权限独立，旧设备权限不会获得物资数据。
  const rootSid=sid;
  for(const [username,permissions,allowInventory,allowRecords] of [
    ['inventory-test',['materials-inventory'],true,false],
    ['records-test',['materials-records'],false,true],
    ['devices-only-test',['devices','records'],false,false],
    ['unrelated-test',['categories'],false,false]
  ]){
    sid=rootSid;
    const accountPassword=randomBytes(16).toString('hex');
    const created=await request('/api/admin/users','POST',{username,password:accountPassword,permissions});
    assert.equal(created.response.status,201);
    sid=''; // 模拟另一个管理员浏览器，登录不撤销超级管理员的当前会话。
    const session=await request('/api/admin/login','POST',{username,password:accountPassword});
    assert.equal(session.result.success,true);sid=session.result.sessionId;
    const inventory=await request('/api/v2/admin/inventory');
    const records=await request('/api/v2/admin/records');
    assert.equal(inventory.response.status,allowInventory?200:403);
    assert.equal(records.response.status,allowRecords?200:403);
    if(allowInventory||allowRecords){
      assert.equal((await request('/api/devices','POST',{})).response.status,403);
      assert.equal((await request('/api/records?includeDeleted=true')).response.status,403);
    }
    if(username==='devices-only-test'){
      assert.equal((await request('/api/v2/admin/materials','POST',{})).response.status,403);
      assert.equal((await request('/api/v2/admin/returns/demo/review','POST',{})).response.status,403);
    }
    if(allowInventory){assert.ok(Array.isArray(inventory.result.data.materials));assert.equal(inventory.result.data.loans,undefined);assert.equal(inventory.result.data.returns,undefined);}
    if(allowRecords){assert.ok(Array.isArray(records.result.data.loans));assert.equal(records.result.data.entries,undefined);assert.equal(records.result.data.ledger,undefined);}
    // 权限在每次请求实时读取，撤回后当前会话立即失去对应功能。
    const accountId=created.result.data.id, userSid=sid;
    sid=rootSid;
    assert.equal((await request('/api/admin/users/'+accountId+'/permissions','PUT',{permissions:[]})).result.success,true);
    sid=userSid;
    assert.equal((await request('/api/v2/admin/inventory')).response.status,403);
    assert.equal((await request('/api/v2/admin/records')).response.status,403);
  }
  sid=rootSid;
  assert.equal((await request('/api/v2/admin/inventory')).response.status,200);
  assert.equal((await request('/api/v2/admin/records')).response.status,200);
  await request('/api/admin/logout','POST');
  assert.equal((await request('/api/v2/admin/inventory')).response.status,401);
  assert.equal((await request('/api/v2/admin/records')).response.status,401);
});

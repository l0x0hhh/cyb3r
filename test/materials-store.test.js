const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createMaterialsStore } = require('../backend/materials/store');

function fixture(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'materials-'));
  const store = createMaterialsStore({ databasePath:path.join(folder,'test.sqlite'),demo:true });
  t.after(() => { store.close(); fs.rmSync(folder,{recursive:true,force:true}); });
  return store;
}
function borrowInput(material, qty) { return { requestId:randomUUID(),name:'演示用户',phone:'000-000',organization:'测试组织',purpose:'流程验证',dueAt:new Date(Date.now()+86400000).toISOString(),items:[{materialId:material.id,quantity:qty}] }; }
function returnInput(loan, line, parts) { return { requestId:randomUUID(),loanId:loan.id,notes:'活动使用情况说明',lines:[{lineId:line.id,good:0,damaged:0,consumed:0,lost:0,...parts}] }; }

test('normal partial returns settle immediately and repeated confirmation does not double stock', t => {
  const store=fixture(t), material=store.listMaterials().find(m=>!m.consumable&&m.quantity>=10), before=material.quantity;
  store.borrow('owner',borrowInput(material,10));
  let loan=store.loanRecords('owner')[0];
  assert.equal(store.listMaterials().find(m=>m.id===material.id).quantity,before-10);
  const request=store.submitReturn('owner',returnInput(loan,loan.lines[0],{good:4}));
  assert.equal(request.status,'approved');
  assert.equal(store.loanRecords('owner')[0].remaining,6);
  store.reviewReturn(request.id,'approved','已点收','admin-test');
  loan=store.loanRecords('owner')[0];
  assert.equal(loan.remaining,6);
  assert.equal(store.listMaterials().find(m=>m.id===material.id).quantity,before-6);
  store.reviewReturn(request.id,'approved','重试','admin-test');
  assert.equal(store.loanRecords('owner')[0].remaining,6);
  const next=store.submitReturn('owner',returnInput(loan,loan.lines[0],{good:6}));
  store.reviewReturn(next.id,'approved','','admin-test');
  assert.equal(store.loanRecords('owner')[0].remaining,0);
  assert.equal(store.listMaterials().find(m=>m.id===material.id).quantity,before);
});
test('consumption settles responsibility without inventing stock, including zero physical return', t => {
  const store=fixture(t), material=store.listMaterials().find(m=>m.consumable&&m.quantity>=100), before=material.quantity;
  store.borrow('owner',borrowInput(material,100));
  const loan=store.loanRecords('owner')[0], request=store.submitReturn('owner',returnInput(loan,loan.lines[0],{good:30,consumed:70}));
  store.reviewReturn(request.id,'approved','','admin-test');
  assert.equal(store.loanRecords('owner')[0].remaining,0);
  assert.equal(store.listMaterials().find(m=>m.id===material.id).quantity,before-70);
  store.borrow('other',borrowInput(material,100));
  const another=store.loanRecords('other')[0], full=store.submitReturn('other',returnInput(another,another.lines[0],{consumed:100}));
  store.reviewReturn(full.id,'approved','','admin-test');
  assert.equal(store.loanRecords('other')[0].remaining,0);
  assert.equal(store.listMaterials().find(m=>m.id===material.id).quantity,before-170);
});
test('borrow and return retries are idempotent and changed payloads cannot reuse a request', t => {
  const store=fixture(t), material=store.listMaterials()[0], input=borrowInput(material,2);
  const first=store.borrow('owner',input), repeat=store.borrow('owner',input);
  assert.equal(first.id,repeat.id); assert.equal(store.loanRecords('owner').length,1);
  assert.throws(()=>store.borrow('owner',{...input,purpose:'changed'}),/请求标识/);
  const loan=store.loanRecords('owner')[0], req=returnInput(loan,loan.lines[0],{good:1});
  const a=store.submitReturn('owner',req), b=store.submitReturn('owner',req); assert.equal(a.id,b.id);
  assert.equal(a.status,'approved'); assert.equal(b.status,'approved');
  assert.equal(store.loanRecords('owner')[0].remaining,1);
  store.submitReturn('owner',returnInput(loan,loan.lines[0],{good:1}));
  assert.equal(store.loanRecords('owner')[0].remaining,0);
});
test('overselling, whole-order failures, and unauthorized record operations leave stock unchanged', t => {
  const store=fixture(t), [a,b]=store.listMaterials(), before=store.listMaterials();
  const input=borrowInput(a,1); input.items.push({materialId:b.id,quantity:b.quantity+1});
  assert.throws(()=>store.borrow('owner',input),/库存不足/);
  assert.deepEqual(store.listMaterials(),before); assert.equal(store.loanRecords('owner').length,0);
  const result=store.borrow('owner',borrowInput(a,a.quantity));
  assert.throws(()=>store.borrow('other',borrowInput(a,1)),/库存不足/);
  const loan=store.loanRecords('owner')[0];
  assert.throws(()=>store.submitReturn('other',returnInput(loan,loan.lines[0],{good:1})),/权限/);
  assert.equal(store.loanRecords('other').length,0);
  assert.throws(()=>store.restore('other',result.id),/凭证无效/);
  store.restore('other',result.receipt); assert.equal(store.loanRecords('other')[0].id,result.id);
  assert.ok(!JSON.stringify(store.loanRecords('owner')).includes('receipt_hash'));
});
test('damage enters quarantine, normal goods cannot be consumed, and rejection retains responsibility', t => {
  const store=fixture(t), material=store.listMaterials().find(m=>!m.consumable&&m.quantity>=10), before=material.quantity;
  store.borrow('owner',borrowInput(material,10)); const loan=store.loanRecords('owner')[0];
  assert.throws(()=>store.submitReturn('owner',returnInput(loan,loan.lines[0],{consumed:10})),/不是消耗品/);
  assert.throws(()=>store.submitReturn('owner',returnInput(loan,loan.lines[0],{good:11})),/申报合计/);
  const rejected=store.submitReturn('owner',returnInput(loan,loan.lines[0],{good:8,damaged:2}));
  store.reviewReturn(rejected.id,'rejected','数量不符，请核对','admin-test');
  assert.equal(store.loanRecords('owner')[0].remaining,10);
  const request=store.submitReturn('owner',returnInput(loan,loan.lines[0],{good:8,damaged:2}));
  store.reviewReturn(request.id,'approved','','admin-test');
  const after=store.listMaterials().find(m=>m.id===material.id);
  assert.equal(after.quantity,before-2); assert.equal(after.quarantine,2); assert.equal(after.outstanding,0);
});
test('entry approval, import batches and adjustments preserve auditable nonnegative stock', t => {
  const store=fixture(t), initial=store.listMaterials().length;
  const input={requestId:randomUUID(),submitter:'演示录入者',name:'演示物资',category:'办公用品',model:'标准',unit:'个',location:'演示柜',quantity:5,consumable:false,images:[],notes:''};
  const entry=store.submitEntry('owner',input); assert.equal(store.listMaterials().length,initial);
  const approved=store.reviewEntry(entry.id,'approved','','admin-test'); store.reviewEntry(entry.id,'approved','','admin-test');
  assert.equal(store.listMaterials().length,initial+1);
  store.adjust(approved.materialId,-2,'盘点差异','admin-test');
  assert.throws(()=>store.adjust(approved.materialId,-4,'无效调整','admin-test'),/小于零/);
  assert.equal(store.listMaterials().find(m=>m.id===approved.materialId).quantity,3);
  const batch=randomUUID(); store.importMaterials('owner',[input],'admin-test',batch); store.importMaterials('owner',[input],'admin-test',batch);
  assert.equal(store.listMaterials().length,initial+2);
  assert.throws(()=>store.importMaterials('owner',[{...input,quantity:6}],'admin-test',batch),/不同内容/);
  assert.ok(store.ledger().some(row=>row.type==='盘点调整'&&row.delta===-2));
});
test('uploaded image references are owned by the submitter', t => {
  const store=fixture(t), image='/uploads/test-detail.webp'; store.registerImage('owner',image);
  const input={requestId:randomUUID(),submitter:'演示录入者',name:'演示物资',unit:'个',location:'测试柜',quantity:1,images:[image]};
  assert.throws(()=>store.submitEntry('other',input),/不属于/);
  assert.ok(store.submitEntry('owner',input).id);
});

test('exact name and normalized phone group multiple outstanding loans across browsers', t => {
  const store=fixture(t), material=store.listMaterials().find(m=>m.quantity>=10);
  const first=store.borrow('browser-a',borrowInput(material,1));
  const second=store.borrow('browser-b',{...borrowInput(material,2),phone:'(000) 000'});
  store.borrow('browser-c',{...borrowInput(material,1),name:'另一位演示用户'});
  store.borrow('browser-d',{...borrowInput(material,1),phone:'000-001'});
  assert.deepEqual(store.loanRecords('query-browser'),[]);
  assert.deepEqual(store.lookupRecords('query-browser',{name:'错误姓名',phone:'000000'}),[]);
  assert.deepEqual(store.lookupRecords('query-browser',{name:'演示用户',phone:'000001'}).map(l=>l.lines[0].borrowed),[1]);
  assert.deepEqual(store.lookupRecords('query-browser',{name:'演示',phone:'000000'}),[]);
  const matches=store.lookupRecords('query-browser',{name:' 演示用户 ',phone:' 000 000 '});
  assert.deepEqual(new Set(matches.map(l=>l.id)),new Set([first.id,second.id]));
  assert.ok(matches.every(l=>l.phone.includes('****')&&l.name!=='演示用户'));
  assert.ok(!JSON.stringify(matches).includes('phone_key'));
  assert.throws(()=>store.lookupRecords('query-browser',{name:'演示用户',phone:'000'}),/有效/);
});

test('phone lookup authorizes only matched records temporarily and does not change stock', t => {
  const store=fixture(t), material=store.listMaterials().find(m=>m.quantity>=10);
  store.borrow('first-owner',borrowInput(material,2));
  store.borrow('other-owner',{...borrowInput(material,1),name:'其他演示用户'});
  const other=store.loanRecords('other-owner')[0], before=store.listMaterials();
  const matched=store.lookupRecords('query-browser',{name:'演示用户',phone:'000000'})[0];
  assert.deepEqual(store.listMaterials(),before);
  assert.throws(()=>store.submitReturn('query-browser',returnInput(other,other.lines[0],{good:1})),/权限/);
  const db=new DatabaseSync(store.databasePath);
  db.prepare('UPDATE mat_lookup_access SET expires_at=0 WHERE owner_hash=?').run('query-browser'); db.close();
  assert.throws(()=>store.submitReturn('query-browser',returnInput(matched,matched.lines[0],{good:1})),/权限/);
  store.lookupRecords('query-browser',{name:'演示用户',phone:'000000'});
  store.lookupRecords('query-browser',{name:'错误姓名',phone:'000000'});
  assert.throws(()=>store.submitReturn('query-browser',returnInput(matched,matched.lines[0],{good:1})),/权限/);
  store.lookupRecords('query-browser',{name:'演示用户',phone:'000000'});
  const request=store.submitReturn('query-browser',returnInput(matched,matched.lines[0],{good:2}));
  assert.equal(request.status,'approved');
  assert.equal(store.listMaterials().find(m=>m.id===material.id).quantity,before.find(m=>m.id===material.id).quantity+2);
  store.reviewReturn(request.id,'approved','','admin-test');
  assert.deepEqual(store.lookupRecords('query-browser',{name:'演示用户',phone:'000000'}),[]);
  assert.equal(store.loanRecords('first-owner')[0].remaining,0);
});

test('v1 records gain a phone index without changing loan IDs, quantities or saved receipts', t => {
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'materials-phone-migration-')), databasePath=path.join(folder,'old.sqlite');
  let store=createMaterialsStore({databasePath,demo:true});
  t.after(()=>{store?.close();fs.rmSync(folder,{recursive:true,force:true});});
  const material=store.listMaterials()[0], loan=store.borrow('original',borrowInput(material,1));
  const before=store.listMaterials();store.close();store=null;
  const old=new DatabaseSync(databasePath);
  old.exec('DROP INDEX mat_loans_phone_name; ALTER TABLE mat_loans DROP COLUMN phone_key; DROP TABLE mat_lookup_access; PRAGMA user_version=1;');old.close();
  store=createMaterialsStore({databasePath,demo:true});
  assert.equal(store.lookupRecords('new-browser',{name:'演示用户',phone:'000000'})[0].id,loan.id);
  assert.deepEqual(store.listMaterials(),before);
  assert.equal(store.restore('legacy-browser',loan.receipt).id,loan.id);
  const migrated=new DatabaseSync(databasePath);
  assert.equal(migrated.prepare('PRAGMA user_version').get().user_version,3);
  const indexes=migrated.prepare('PRAGMA index_list(mat_loans)').all();
  assert.ok(indexes.some(index=>index.name==='mat_loans_phone_name'&&index.unique===0));migrated.close();
});

test('each declaration uses its own consumption against original borrowed quantity, independent of earlier consumption', t => {
  const store=fixture(t), material=store.listMaterials().find(m=>m.consumable&&m.quantity>=100), before=material.quantity;
  store.borrow('owner',borrowInput(material,100));
  let loan=store.loanRecords('owner')[0];
  const first=store.submitReturn('owner',returnInput(loan,loan.lines[0],{consumed:15}));
  assert.equal(first.status,'approved');
  loan=store.loanRecords('owner')[0];assert.equal(loan.remaining,85);assert.equal(loan.lines[0].consumed,15);
  const atLimit=store.submitReturn('owner',returnInput(loan,loan.lines[0],{consumed:30}));
  assert.equal(atLimit.status,'approved');
  loan=store.loanRecords('owner')[0];assert.equal(loan.lines[0].consumed,45);
  const tooMuch=store.submitReturn('owner',returnInput(loan,loan.lines[0],{consumed:31}));
  assert.equal(tooMuch.status,'pending');assert.equal(store.loanRecords('owner')[0].remaining,55);
  assert.throws(()=>store.submitReturn('owner',returnInput(loan,loan.lines[0],{consumed:1})),/已有待确认/);
  store.reviewReturn(tooMuch.id,'rejected','超出活动预计消耗，请核对','admin-test');
  loan=store.loanRecords('owner')[0];
  const final=store.submitReturn('owner',returnInput(loan,loan.lines[0],{good:55}));
  assert.equal(final.status,'approved');assert.equal(store.loanRecords('owner')[0].remaining,0);
  assert.equal(store.listMaterials().find(m=>m.id===material.id).quantity,before-45);
});

test('per-material thresholds cover zero, full consumption, and fractional boundaries without changing stock', t => {
  const store=fixture(t), material=store.listMaterials().find(m=>m.consumable&&m.quantity>=10);
  store.borrow('owner',borrowInput(material,10));let loan=store.loanRecords('owner')[0];
  const before=store.listMaterials().find(m=>m.id===material.id).quantity;
  store.setConsumptionPolicy(material.id,0,'admin-test');
  const pending=store.submitReturn('owner',returnInput(loan,loan.lines[0],{consumed:1}));assert.equal(pending.status,'pending');
  store.setConsumptionPolicy(material.id,100,'admin-test');
  assert.equal(store.adminReturns().find(r=>r.id===pending.id).status,'pending');
  store.reviewReturn(pending.id,'approved','','admin-test');loan=store.loanRecords('owner')[0];
  assert.equal(store.submitReturn('owner',returnInput(loan,loan.lines[0],{consumed:9})).status,'approved');
  assert.equal(store.loanRecords('owner')[0].remaining,0);
  assert.equal(store.listMaterials().find(m=>m.id===material.id).quantity,before);
  assert.throws(()=>store.setConsumptionPolicy(material.id,101,'admin-test'),/阈值/);
  assert.throws(()=>store.setConsumptionPolicy(material.id,29.5,'admin-test'),/阈值/);
  store.setConsumptionPolicy(material.id,30,'admin-test');store.borrow('fractional',borrowInput(material,5));
  const fractional=store.loanRecords('fractional')[0];
  assert.equal(store.submitReturn('fractional',returnInput(fractional,fractional.lines[0],{consumed:1})).status,'approved');
  assert.equal(store.submitReturn('fractional',returnInput(fractional,fractional.lines[0],{consumed:1})).status,'approved');
  assert.equal(store.submitReturn('fractional',returnInput(fractional,fractional.lines[0],{consumed:2})).status,'pending');
});

test('an older pending normal return can be self-confirmed without migrating historical quantities', t => {
  const store=fixture(t), material=store.listMaterials().find(m=>!m.consumable), before=material.quantity;
  store.borrow('owner',borrowInput(material,2));const loan=store.loanRecords('owner')[0], id=randomUUID();
  const oldLines=[{lineId:loan.lines[0].id,name:material.name,unit:material.unit,good:1,damaged:0,consumed:0,lost:0}];
  const db=new DatabaseSync(store.databasePath);
  db.prepare('INSERT INTO mat_returns(id,loan_id,owner_hash,request_id,request_hash,lines,notes,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id,loan.id,'owner',randomUUID(),'legacy',JSON.stringify(oldLines),'历史正常归还',new Date().toISOString());db.close();
  assert.equal(store.loanRecords('owner')[0].remaining,2);
  assert.throws(()=>store.confirmNormalReturn('other',id),/权限/);
  assert.equal(store.confirmNormalReturn('owner',id).status,'approved');
  assert.equal(store.confirmNormalReturn('owner',id).repeated,true);
  assert.equal(store.loanRecords('owner')[0].remaining,1);
  assert.equal(store.listMaterials().find(m=>m.id===material.id).quantity,before-1);
});

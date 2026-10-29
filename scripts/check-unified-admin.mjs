// 用Vue服务端渲染验证统一后台与真实处理函数；不启动浏览器。
import { createServer } from 'vite';
import { createSSRApp, createRenderer, nextTick, reactive } from 'vue';
import { renderToString } from 'vue/server-renderer';
import assert from 'node:assert/strict';

const makeStorage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
};
globalThis.localStorage = makeStorage();
globalThis.sessionStorage = makeStorage();
globalThis.window = {
  location: { pathname:'/admin', search:'', href:'http://127.0.0.1:3100/admin' },
  history: { replaceState(_state, _title, url) { Object.assign(window.location, { pathname:new URL(url,window.location.href).pathname, search:new URL(url,window.location.href).search, href:new URL(url,window.location.href).href }); } }
};
const server = await createServer({ server:{ middlewareMode:true }, appType:'custom' });
try {
  const { default: Admin } = await server.ssrLoadModule('/src/pages/AdminPage.js');
  const { default: Materials } = await server.ssrLoadModule('/src/pages/MaterialsPage.js');
  const superUser = { username:'demo-admin', role:'super_admin', permissions:[] };
  async function renderAdmin(user, tab, pathname='/admin') {
    window.location = { pathname, search:'', href:'http://127.0.0.1:3100'+pathname };
    let state;
    const html = await renderToString(createSSRApp({ ...Admin, setup() {
      state = Admin.setup();
      if (user) { state.adminUser.value=user; state.isLoggedIn.value=true; }
      if (tab) state.activeTab.value=tab;
      return state;
    }}));
    return { html, state };
  }
  const loggedOut = await renderAdmin(null);
  assert.equal((loggedOut.html.match(/autocomplete="current-password"/g)||[]).length,1);
  assert.ok(!loggedOut.html.includes('导出库存'));
  for (const [tab, expected] of [
    ['devices','设备列表'], ['records','当前借出'], ['categories','分类管理'],
    ['materials-inventory','导出库存'], ['materials-entry','拍照上传'],
    ['materials-loans','借用人'], ['materials-returns','暂无归还或核销申请'],
    ['materials-entries','暂无物资录入申请'], ['materials-ledger','可借结余']
  ]) {
    const {html,state}=await renderAdmin(superUser,tab);
    assert.ok(html.includes(expected),`${tab} missing ${expected}`);
    assert.ok(html.includes('学院管理后台'));
    assert.equal((html.match(/class="admin-nav"/g)||[]).length,1);
    assert.ok(!html.includes('class="mm-sidebar"') && !html.includes('登录管理后台'));
    const menus=state.visibleNavigationGroups.value.flatMap(group=>group.items);
    const expectedArea=tab.startsWith('materials-')?'materials':'devices';
    assert.equal(state.activeArea.value,expectedArea);
    assert.ok(menus.every(item=>item.key.startsWith('materials-')===(expectedArea==='materials')));
    if(expectedArea==='materials'){
      const requested=[];globalThis.fetch=async url=>{requested.push(url);throw new Error('Unexpected device request');};
      await state.loadData();assert.deepEqual(requested,[]);
    }
    state.selectAdminArea('devices');
    assert.equal(state.activeArea.value,'devices');
    assert.ok(state.visibleNavigationGroups.value.every(group=>group.key!=='materials'));
    state.selectAdminArea('materials');
    assert.equal(state.activeArea.value,'materials');
    assert.ok(state.visibleNavigationGroups.value.every(group=>group.key==='materials'));
    state.selectMaterialSection('returns');
    assert.equal(state.activeTab.value,'materials-returns');
    assert.equal(new URL(window.location.href).searchParams.get('tab'),'materials-returns');
  }
  const alias=await renderAdmin(superUser,null,'/materials/admin/');
  assert.equal(alias.state.activeTab.value,'materials-inventory');
  for (const [permissions, allowed, denied, endpoint] of [
    [['materials-inventory'],'materials-inventory','materials-returns','/api/v2/admin/inventory'],
    [['materials-records'],'materials-returns','materials-inventory','/api/v2/admin/records'],
    [['devices','records'],'devices','materials-inventory',null],
    [['categories'],'categories','materials-inventory',null]
  ]) {
    const user={username:'demo-user',role:'admin',permissions};
    const {state}=await renderAdmin(user,allowed);
    assert.ok(state.visibleTabs.value.some(tab=>tab.key===allowed));
    assert.ok(!state.visibleTabs.value.some(tab=>tab.key===denied));
    state.selectAdminTab(denied);assert.equal(state.activeTab.value,allowed);
    if (!endpoint) continue;
    const requested=[];
    localStorage.setItem('sessionId','demo-shared-session');
    globalThis.fetch=async(url,options)=>{
      requested.push(url);assert.equal(options.headers['x-session-id'],'demo-shared-session');
      return {ok:true,status:200,json:async()=>({success:true,data:{materials:[],entries:[],ledger:[],loans:[],returns:[]}})};
    };
    let materialState;
    const props=reactive({embedded:true,section:allowed.slice(10),adminUser:user});
    const events=[];
    const renderer=createRenderer({createComment:text=>({text}),insert(){},remove(){},parentNode:()=>null,nextSibling:()=>null});
    const panel=renderer.createApp({ ...Materials, render:()=>null, setup() {
      materialState=Materials.setup(props,{emit:(...args)=>events.push(args)});return materialState;
    }},props);
    panel.mount({});
    await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(requested,[endpoint]);
    materialState.switchPage('entry');assert.deepEqual(events.at(-1),['navigate','entry']);
    props.section=permissions.includes('materials-inventory')?'entries':'loans';
    await nextTick();assert.equal(materialState.page.value,props.section);
    await new Promise(resolve=>setImmediate(resolve));
    globalThis.fetch=async()=>({ok:false,status:401,json:async()=>({success:false,message:'登录已失效'})});
    await materialState.load();assert.ok(events.some(event=>event[0]==='session-expired'));
    panel.unmount();
    localStorage.setItem('sessionId','demo-shared-session');sessionStorage.setItem('materials_admin_session','old-session');
    state.expireAdminSession();assert.equal(state.isLoggedIn.value,false);
    assert.equal(localStorage.getItem('sessionId'),null);assert.equal(sessionStorage.getItem('materials_admin_session'),null);
  }
  const ops = await renderAdmin(superUser,'admin-management');
  assert.ok(ops.html.includes('ops-panel') && ops.html.includes('ops-button--primary'));
  assert.ok(!loggedOut.html.includes('id="ops-title"'));
  const config={enabled:false,warningPercent:80,criticalPercent:90,cooldownHours:6,recipients:[]};
  const status={usedPercent:49,free:20*1024**3,level:'ok',lastCheck:null};
  const calls=[];
  globalThis.fetch=async(url,options)=>{calls.push({url,method:options.method});return {json:async()=>({success:true,data:options.method==='GET'?{settings:config,status}:options.method==='PUT'?JSON.parse(options.body):{...status,lastCheck:{error:'邮件发送失败'}}})};};
  await ops.state.loadOperations();assert.equal(ops.state.operationsReady.value,true);
  assert.equal(ops.state.operationsDirty.value,false);
  ops.state.operationsConfig.warningPercent=81;
  await ops.state.checkOperations();assert.equal(calls.length,1,'unsaved config cannot trigger checks');
  assert.equal(ops.state.operationsError.value,true);
  await ops.state.saveOperations();assert.equal(ops.state.operationsDirty.value,false);
  assert.equal(ops.state.operationsError.value,false);
  await ops.state.checkOperations();assert.equal(ops.state.operationsMessage.value,'邮件发送失败');
  assert.equal(ops.state.operationsError.value,true,'server failures cannot appear as successful checks');
  globalThis.fetch=async()=>{throw new Error('连接失败');};
  ops.state.operationsConfig.cooldownHours=8;
  await ops.state.saveOperations();assert.equal(ops.state.operationsConfig.cooldownHours,8,'failure retains edits');
  assert.equal(ops.state.operationsBusy.value,false);
  const unloaded=await renderAdmin(superUser,'admin-management');
  await unloaded.state.loadOperations();assert.equal(unloaded.state.operationsReady.value,false);
  await unloaded.state.saveOperations();assert.equal(unloaded.state.operationsReady.value,false);
  console.log('Operations panel: loading safety, dirty config, save, failed check and edit preservation passed.');
  console.log('Separate admin areas: single login, 9 panels, isolated navigation and data loads, independent permissions, old alias and session expiry passed.');
} finally { await server.close(); }

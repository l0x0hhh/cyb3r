// 在Node中验证Vue模板，不启动浏览器或下载浏览器依赖。
import { createServer } from 'vite';
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import assert from 'node:assert/strict';

const storage = { getItem: () => null };
globalThis.sessionStorage = storage;
globalThis.localStorage = storage;
globalThis.window = { location: { pathname: '/materials' } };
const server = await createServer({ server: { middlewareMode: true }, appType:'custom' });
try {
  const { default: Component } = await server.ssrLoadModule('/src/pages/MaterialsPage.js');
  const variants = [
    { page:'catalog', admin:false, expected:'找到你需要的物资' },
    { page:'mine', admin:false, expected:'查询借用记录' },
    { page:'entry', admin:false, expected:'拍照上传' },
    { page:'inventory', admin:true, expected:'导出库存' },
    { page:'entry', admin:true, expected:'确认入库' },
    { page:'loans', admin:true, expected:'借用人' },
    { page:'returns', admin:true, expected:'暂无归还或核销申请' },
    { page:'entries', admin:true, expected:'暂无物资录入申请' },
    { page:'ledger', admin:true, expected:'可借结余' },
    { page:'inventory', admin:true, modal:'policy', expected:'保存审核阈值' },
    { page:'mine', admin:false, modal:'return', consumed:10, expected:'确认归还并结算' },
    { page:'mine', admin:false, modal:'return', consumed:30, expected:'确认归还并结算' },
    { page:'mine', admin:false, modal:'return', consumed:31, expected:'提交管理员确认' }
  ];
  for (const variant of variants) {
    globalThis.window.location.pathname = variant.admin ? '/materials/admin' : '/materials';
    const app = createSSRApp({ ...Component, setup(props, context) {
      const state=Component.setup(props,context);state.page.value=variant.page;state.loading.value=false;
      if(variant.modal==='policy')state.modal.value={kind:'policy',item:{name:'演示消耗品'}};
      if(variant.modal==='return') {
        state.modal.value={kind:'return',loan:{id:'demo'}};
        state.returnLines.value=[{id:'demo-line',name:'演示纸杯',unit:'个',borrowed:100,remaining:100,consumable:true,consumption_review_percent:30,alreadyConsumed:0,good:0,damaged:0,lost:0,consumed:variant.consumed}];
      }
      return state;
    }}, { embedded:variant.admin, section:variant.page, adminUser:variant.admin?{username:'admin',role:'super_admin'}:null });
    const html=await renderToString(app);
    assert.ok(html.includes(variant.expected),`${variant.page} missing ${variant.expected}`);
    if (variant.admin) {
      assert.ok(!html.includes('class="mm-sidebar"') && !html.includes('class="mm-topbar"'));
      assert.ok(!html.includes('登录密码') && !html.includes('退出后台'));
    }
    if (variant.page === 'mine') {
      assert.ok(html.includes('借用人姓名') && html.includes('手机号码'));
      assert.ok(!html.includes('粘贴借用凭证') && !html.includes('恢复记录'));
    }
    console.log(`Rendered ${variant.admin?'admin':'public'}/${variant.page}${variant.login?'/login':''}`);
  }
} finally { await server.close(); }

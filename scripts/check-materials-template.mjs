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
  // Exercise selection, quantity limits and removal through the page's actual handlers.
  const selected = { id:'fixture', name:'示例物资', unit:'个', location:'示例地点', images:[], quantity:3, category:'其他物资', model:'', consumable:false };
  let interactionState;
  const app = createSSRApp({ ...Component, setup(props, context) {
    const state = Component.setup(props, context);
    interactionState = state;
    state.page.value = 'catalog'; state.loading.value = false; state.materials.value = [selected];
    state.toggleCart(selected);
    assert.equal(state.cart.value.length, 1);
    state.changeCartQuantity(selected,1);
    state.changeCartQuantity(selected,1);
    state.changeCartQuantity(selected,1);
    assert.equal(state.cart.value[0].quantity, 3, 'quantity cannot exceed available stock');
    assert.equal(state.cartQuantity.value, 3);
    state.changeCartQuantity(selected,-1);
    state.changeCartQuantity(selected,-1);
    state.changeCartQuantity(selected,-1);
    assert.equal(state.cart.value.length, 0, 'decrement to zero removes the item');
    state.addToCart(selected);
    assert.equal(state.cart.value[0].quantity, 1, 'reselect starts at one');
    state.addToCart(selected);
    assert.equal(state.cart.value[0].quantity, 1, 'duplicate add does not silently increment');
    state.cart.value[0].quantity = 2;
    assert.equal(state.cartItem(selected.id).quantity, 2, 'quantity edited in the cart is shared with the card');
    assert.equal(state.cartQuantity.value, 2);
    return state;
  }});
  const selectedHtml = await renderToString(app);
  assert.ok(selectedHtml.includes('减少示例物资借用数量') && selectedHtml.includes('增加示例物资借用数量'));
  assert.ok(selectedHtml.includes('数量合计 2') && selectedHtml.includes('示例物资借用数量，输入零取消'));
  console.log('Selection, quantity limits, cart synchronization and selected state passed.');
  const pointer = { button:0, isPrimary:true, pointerId:1 };
  const click = { detail:1 };
  const waitForHold = () => new Promise(resolve => setTimeout(resolve, 650));
  interactionState.startQuantityHold(pointer, selected, 1);
  await waitForHold();
  interactionState.endQuantityHold(pointer);
  interactionState.quantityClick(click, selected, 1);
  assert.equal(interactionState.cartItem(selected.id).quantity, 3, 'hold fills to the current stock');
  interactionState.startQuantityHold(pointer, selected, -1);
  await waitForHold();
  interactionState.endQuantityHold(pointer);
  interactionState.quantityClick(click, selected, -1);
  assert.equal(interactionState.cart.value.length, 0, 'hold minus removes the item');
  interactionState.startQuantityHold(pointer, selected, 1);
  await waitForHold();
  interactionState.endQuantityHold(pointer);
  interactionState.quantityClick(click, selected, 1);
  assert.equal(interactionState.cartItem(selected.id).quantity, 3, 'hold on the initial add button selects all');
  interactionState.removeCart(selected.id);
  interactionState.startQuantityHold(pointer, selected, 1);
  interactionState.endQuantityHold(pointer);
  interactionState.quantityClick(click, selected, 1);
  await waitForHold();
  assert.equal(interactionState.cartItem(selected.id).quantity, 1, 'short click adds one and cancels the timer');
  interactionState.quantityClick({detail:0}, selected, 1);
  assert.equal(interactionState.cartItem(selected.id).quantity, 2, 'keyboard click increments one');
  interactionState.setCartQuantity(selected,3);
  assert.equal(interactionState.cartItem(selected.id).quantity,3);
  interactionState.setCartQuantity(selected,4);
  assert.equal(interactionState.cartItem(selected.id).quantity,3,'direct input cannot exceed inventory');
  interactionState.setCartQuantity(selected,1.5);
  assert.equal(interactionState.cartItem(selected.id).quantity,3,'fractions are rejected');
  interactionState.setCartQuantity(selected,0);
  assert.equal(interactionState.cart.value.length,0,'direct zero removes selection');
  console.log('Long press, direct entry, release suppression, cancellation and keyboard activation passed.');
} finally { await server.close(); }

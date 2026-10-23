// 借用清单行为回归：上限、实例隔离、快照及部分成功结算不依赖浏览器或真实借用数据。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const cartModule = import(pathToFileURL(path.resolve(__dirname, '../frontend/src/composables/use-borrow-cart.js')).href);

function item(id) {
  return { id, name: '测试设备 ' + id, model: '测试型号' };
}

test('cart enforces the ten-device limit while still allowing removal when full', async () => {
  const { useBorrowCart, MAX_BATCH_BORROW } = await cartModule;
  const cart = useBorrowCart();
  assert.equal(MAX_BATCH_BORROW, 10);
  for (let index = 0; index < MAX_BATCH_BORROW; index += 1) {
    assert.equal(cart.toggleCartDevice(item('fixture-' + index)), 'added');
  }
  assert.equal(cart.toggleCartDevice(item('extra-fixture')), 'limit');
  assert.equal(cart.borrowCart.length, 10);
  assert.equal(cart.toggleCartDevice(item('fixture-0')), 'removed');
  assert.equal(cart.isInCart('fixture-0'), false);
  assert.equal(cart.toggleCartDevice(item('extra-fixture')), 'added');
});

test('cart stores device summaries only and returns detached submission snapshots', async () => {
  const { useBorrowCart } = await cartModule;
  const cart = useBorrowCart();
  assert.equal(cart.toggleCartDevice(item('')), 'invalid');
  const source = { ...item('first'), model: null, extraField: 'not-for-cart' };
  cart.toggleCartDevice(source);
  source.name = 'changed outside cart';
  const snapshot = cart.snapshotBorrowCart();
  assert.deepEqual(snapshot, [{ id: 'first', name: '测试设备 first', model: '' }]);
  snapshot[0].name = 'changed in snapshot';
  snapshot.push(item('snapshot-only'));
  assert.equal(cart.borrowCart[0].name, '测试设备 first');
  assert.equal(cart.borrowCart.length, 1);
});

test('removing the final item closes both cart surfaces and later selection stays collapsed', async () => {
  const { useBorrowCart } = await cartModule;
  const cart = useBorrowCart();
  assert.equal(cart.openBatchBorrowForm(), false);
  cart.toggleCartDevice(item('first'));
  cart.showBorrowCart.value = true;
  assert.equal(cart.openBatchBorrowForm(), true);
  assert.equal(cart.showBorrowCart.value, false);
  assert.equal(cart.showBatchBorrowForm.value, true);
  cart.toggleCartDevice(item('first'));
  assert.equal(cart.showBorrowCart.value, false);
  assert.equal(cart.showBatchBorrowForm.value, false);
  cart.toggleCartDevice(item('second'));
  assert.equal(cart.showBatchBorrowForm.value, false);
});

test('partial settlement retains conflicts and selections added while a request is pending', async () => {
  const { useBorrowCart } = await cartModule;
  const cart = useBorrowCart();
  cart.toggleCartDevice(item('borrowed'));
  cart.toggleCartDevice(item('conflicted'));
  cart.openBatchBorrowForm();
  const submittedIds = cart.snapshotBorrowCart().map(entry => entry.id);
  cart.toggleCartDevice(item('added-later'));
  // 即使响应误带未提交设备 ID，也不能删除这次请求之外的选择。
  cart.settleBatchBorrow(submittedIds, ['borrowed', 'added-later']);
  assert.deepEqual(cart.borrowCart.map(entry => entry.id), ['conflicted', 'added-later']);
  assert.equal(cart.showBatchBorrowForm.value, true);
});

test('empty confirmed results preserve the cart and all confirmed results close it', async () => {
  const { useBorrowCart } = await cartModule;
  const cart = useBorrowCart();
  cart.toggleCartDevice(item('first'));
  cart.openBatchBorrowForm();
  cart.settleBatchBorrow(['first'], []);
  assert.equal(cart.isInCart('first'), true);
  assert.equal(cart.showBatchBorrowForm.value, true);
  cart.settleBatchBorrow(['first'], ['first']);
  assert.equal(cart.borrowCart.length, 0);
  assert.equal(cart.showBatchBorrowForm.value, false);
});

test('single-device completion only removes that device and clearing preserves the reactive list identity', async () => {
  const { useBorrowCart } = await cartModule;
  const cart = useBorrowCart();
  cart.toggleCartDevice(item('first'));
  cart.toggleCartDevice(item('second'));
  const list = cart.borrowCart;
  cart.removeCartDevices(['first']);
  assert.deepEqual(cart.borrowCart.map(entry => entry.id), ['second']);
  cart.showBorrowCart.value = true;
  cart.clearBorrowCart();
  assert.strictEqual(cart.borrowCart, list);
  assert.equal(cart.borrowCart.length, 0);
  assert.equal(cart.showBorrowCart.value, false);
});

test('cart selections and dialog flags are isolated between page instances', async () => {
  const { useBorrowCart } = await cartModule;
  const first = useBorrowCart();
  const second = useBorrowCart();
  first.toggleCartDevice(item('first'));
  first.openBatchBorrowForm();
  assert.equal(second.borrowCart.length, 0);
  assert.equal(second.showBatchBorrowForm.value, false);
});

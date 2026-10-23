// 借还分层契约：用内存快照仓储验证事务、凭证、权限与邮件调用，不读取生产数据。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRecordService } = require('../backend/records/service');
const { createRecordRouter } = require('../backend/records/routes');
const { createReturnAuthorizationStore } = require('../backend/records/return-authorization');
const { createAdminPermissions } = require('../backend/middleware/admin-permissions');

// 姓名、编号与电话均为测试专用合成值，电话通过拼接生成以避免文档示例误用。
const borrower = {
  borrowerName: '合成借用人', borrowerId: 'SYNTHETIC',
  borrowerPhone: '1' + '0'.repeat(10), major: '测试专业', purpose: '契约检查'
};
const device = (id, extra = {}) => ({ id, name: `测试设备 ${id}`, model: 'SYNTHETIC', status: 'available', ...extra });
const record = (id, deviceId, extra = {}) => ({
  id, deviceId, deviceName: `测试设备 ${deviceId}`, type: 'borrow',
  ...borrower, createdAt: '2026-01-01T00:00:00.000Z', ...extra
});

function fixture({ devices = [], records = [], failWrite, failLog = false, returnAuthorization } = {}) {
  let state = structuredClone({ devices, records, logs: [] });
  const events = [];
  let transactionDepth = 0;
  const store = {
    databasePath: 'memory-only',
    readCollection(name) { return structuredClone(state[name]); },
    writeCollection(name, values) {
      events.push(`write:${name}`);
      if (failWrite === name) throw new Error('synthetic write failure');
      state[name] = structuredClone(values);
    },
    transaction(fn) {
      const before = structuredClone(state);
      events.push('begin');
      transactionDepth++;
      try {
        const result = fn();
        events.push('commit');
        return result;
      } catch (error) {
        state = before;
        events.push('rollback');
        throw error;
      } finally {
        transactionDepth--;
      }
    },
    close() { throw new Error('business service must not close the shared store'); }
  };
  const mail = [];
  const enqueue = kind => (event, payload) => {
    assert.equal(transactionDepth, 0, 'mail must be queued after the transaction');
    events.push(`mail:${kind}:${event}`);
    mail.push({ kind, event, payload: structuredClone(payload) });
  };
  const service = createRecordService({
    store, collections: { devices: 'devices', records: 'records' }, returnAuthorization,
    email: { queueEmailNotification: enqueue('single'), queueBatchEmailNotification: enqueue('batch') },
    appendOperationLog(action, target, summary) {
      assert.equal(transactionDepth, 1, 'return logs belong to the same transaction');
      if (failLog) throw new Error('synthetic log failure');
      store.writeCollection('logs', [...store.readCollection('logs'), { action, target, summary }]);
    },
    getDeviceImageFields: item => ({ image: item.image || null }),
    getOperationalStatus: item => item?.operationalStatus === 'offline' ? 'offline' : 'online'
  });
  return { service, store, mail, events };
}

test('borrowing validates online/available state, commits both snapshots, then queues one notification', () => {
  const f = fixture({ devices: [device('A'), device('B', { operationalStatus: 'offline' }), device('C', { status: 'borrowed' })] });
  assert.equal(f.service.borrow({ ...borrower, deviceId: 'B' }).status, 409);
  assert.equal(f.service.borrow({ ...borrower, deviceId: 'C' }).status, 409);
  assert.equal(f.service.borrow({ ...borrower, deviceId: 'missing' }).status, 404);
  assert.equal(f.service.borrow({ deviceId: 'A' }).status, 400);
  assert.deepEqual(f.events, []);
  const result = f.service.borrow({ ...borrower, deviceId: 'A' });
  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(typeof result.then, 'undefined', 'the store/service contract stays synchronous');
  assert.deepEqual(f.events, ['begin', 'write:devices', 'write:records', 'commit', 'mail:single:borrow']);
  assert.equal(f.store.readCollection('records')[0].department, borrower.major);
  assert.equal(f.store.readCollection('records')[0].notes, borrower.purpose);
});

test('record-write failure rolls back the device and never queues mail, preserving legacy HTTP 200 errors', () => {
  const f = fixture({ devices: [device('A')], failWrite: 'records' });
  assert.deepEqual(f.service.borrow({ ...borrower, deviceId: 'A' }), {
    status: 200, body: { success: false, message: 'synthetic write failure' }
  });
  assert.equal(f.store.readCollection('devices')[0].status, 'available');
  assert.deepEqual(f.store.readCollection('records'), []);
  assert.deepEqual(f.mail, []);
  assert.equal(f.events.at(-1), 'rollback');
  assert.equal(f.service.borrowOther({ ...borrower, otherDeviceName: '合成其他设备' }).status, 500);
});

test('batch borrow deduplicates IDs, preserves conflicts and queues a single batch after committing', () => {
  const f = fixture({ devices: [device('A'), device('B', { operationalStatus: 'offline' })] });
  const result = f.service.borrowBatch({ ...borrower, deviceIds: ['A', 'B', 'A', 'missing'] });
  assert.equal(result.body.success, true);
  assert.deepEqual(result.body.data.borrowed.map(item => item.deviceId), ['A']);
  assert.deepEqual(result.body.data.conflicts.map(item => item.deviceId), ['B', 'missing']);
  assert.equal(f.mail.length, 1);
  assert.equal(f.mail[0].kind, 'batch');
  assert.equal(f.mail[0].payload.length, 1);
  assert.equal(f.events.at(-2), 'commit');
  assert.equal(f.service.borrowBatch({ ...borrower, deviceIds: Array.from({ length: 11 }, (_, i) => `D${i}`) }).status, 400);
});

test('lookup protects personal fields; tokens are scoped and consumed only for successfully returned records', () => {
  const f = fixture({
    devices: [device('A', { status: 'borrowed' }), device('B', { status: 'borrowed' })],
    records: [record('RA', 'A'), record('RB', 'B'), record('RX', null, { isOtherDevice: true, borrowerName: '另一个合成人' })]
  });
  const lookup = f.service.lookupReturns(borrower).body.data;
  assert.deepEqual(lookup.records.map(item => item.recordId), ['RA', 'RB']);
  for (const item of lookup.records) {
    for (const field of ['borrowerName', 'borrowerPhone', 'borrowerId', 'purpose', 'notes']) {
      assert.equal(field in item, false);
    }
  }
  const result = f.service.returnBatch({ recordIds: ['RA', 'RX'], returnToken: lookup.returnToken, notes: '测试备注' });
  assert.deepEqual(result.body.data.returned.map(item => item.recordId), ['RA']);
  assert.deepEqual(result.body.data.conflicts.map(item => item.recordId), ['RX']);
  assert.equal(f.mail.length, 1);
  assert.equal(f.mail[0].kind, 'batch');
  assert.equal(f.mail[0].event, 'return');
  assert.equal(f.service.returnOne({ recordId: 'RA', returnToken: lookup.returnToken }).status, 403);
  assert.equal(f.service.returnOne({ recordId: 'RB', returnToken: lookup.returnToken }).body.success, true);
  assert.equal(f.service.returnOne({ recordId: 'RB', returnToken: lookup.returnToken }).status, 403);
});

test('other-device borrowing and return never create inventory and retain single notification semantics', () => {
  const f = fixture();
  const borrowed = f.service.borrowOther({ ...borrower, otherDeviceName: '测试其他设备' });
  assert.equal(borrowed.body.data.isOtherDevice, true);
  assert.equal(borrowed.body.data.deviceId, null);
  const lookup = f.service.lookupReturns(borrower).body.data;
  assert.equal(f.service.returnOne({ recordId: borrowed.body.data.id, returnToken: lookup.returnToken }).body.success, true);
  assert.deepEqual(f.store.readCollection('devices'), []);
  assert.deepEqual(f.mail.map(item => [item.kind, item.event]), [['single', 'borrow'], ['single', 'return']]);
  assert.equal(f.events.includes('write:devices'), false);
});

test('failed single and batch returns retain their original token-consumption timing', () => {
  for (const batch of [false, true]) {
    const tokens = createReturnAuthorizationStore();
    const f = fixture({
      devices: [device('A', { status: 'borrowed' })], records: [record('RA', 'A')],
      failWrite: 'records', returnAuthorization: tokens
    });
    const token = f.service.lookupReturns(borrower).body.data.returnToken;
    const result = batch
      ? f.service.returnBatch({ recordIds: ['RA'], returnToken: token })
      : f.service.returnOne({ recordId: 'RA', returnToken: token });
    assert.deepEqual(result, { status: 200, body: { success: false, message: 'synthetic write failure' } });
    assert.equal(f.store.readCollection('devices')[0].status, 'borrowed');
    assert.equal(f.store.readCollection('records')[0].returnedAt, undefined);
    assert.deepEqual(f.mail, []);
    // 基线批量操作在循环内消费凭证，单台在提交后消费；分层不得顺手改变该行为。
    assert.deepEqual(tokens.getReturnAuthorization(token).recordIds, batch ? [] : ['RA']);
  }
});

test('administrator batch return commits one privacy-safe log and one summary email; log failure rolls back all snapshots', () => {
  const options = {
    devices: [device('A', { status: 'borrowed' })],
    records: [record('RA', 'A'), record('RO', null, { isOtherDevice: true })]
  };
  const f = fixture(options);
  const result = f.service.forceReturnBatch({ recordIds: ['RA', 'RO', 'missing'] });
  assert.equal(result.body.data.returned.length, 2);
  assert.equal(result.body.data.conflicts.length, 1);
  const logs = f.store.readCollection('logs');
  assert.equal(logs.length, 1);
  assert.equal(JSON.stringify(logs).includes(borrower.borrowerName), false);
  assert.equal(JSON.stringify(logs).includes(borrower.borrowerPhone), false);
  assert.equal(f.mail.length, 1);
  assert.equal(f.mail[0].event, 'adminReturn');
  assert.equal(f.mail[0].payload.length, 2);
  const failing = fixture({ ...options, failLog: true });
  assert.deepEqual(failing.service.forceReturnBatch({ recordIds: ['RA', 'RO'] }), {
    status: 500, body: { success: false, message: '批量归还失败: synthetic log failure' }
  });
  assert.equal(failing.store.readCollection('devices')[0].status, 'borrowed');
  assert.equal(failing.store.readCollection('records').some(item => item.returnedAt), false);
  assert.deepEqual(failing.store.readCollection('logs'), []);
  assert.deepEqual(failing.mail, []);
});

test('archive, restore, delete and compatibility reads preserve existing record lifecycle', () => {
  const f = fixture({ records: [record('active', 'A'), record('returned', 'B', {
    returnedAt: '2026-01-02T00:00:00.000Z', major: undefined, purpose: undefined,
    department: '旧专业', notes: '旧用途'
  })] });
  assert.equal(f.service.archive({ id: 'active' }).status, 409);
  assert.equal(f.service.removePermanently({ id: 'returned' }).status, 409);
  assert.equal(f.service.list({}).body.data[0].major, '旧专业');
  assert.equal(f.service.list({}).body.data[0].purpose, '旧用途');
  assert.equal(f.service.archive({ id: 'returned' }).body.success, true);
  assert.equal(f.service.list({}).body.data.length, 1);
  assert.equal(f.service.list({ includeDeleted: 'true' }).body.data.length, 2);
  assert.equal(f.service.restore({ id: 'returned' }).body.success, true);
  assert.equal(f.service.list({}).body.data.length, 2);
  f.service.archive({ id: 'returned' });
  assert.equal(f.service.removePermanently({ id: 'returned' }).body.success, true);
  assert.deepEqual(f.store.readCollection('records').map(item => item.id), ['active']);
  assert.deepEqual(f.mail, []);
});

test('return token lifetime and instances stay isolated without global timers', () => {
  let now = 0;
  const first = createReturnAuthorizationStore({ now: () => now });
  const second = createReturnAuthorizationStore({ now: () => now });
  const ids = ['RA'];
  const token = first.createReturnAuthorization(ids);
  ids.push('RB');
  assert.match(token, /^[a-f0-9]{48}$/);
  assert.deepEqual(first.getReturnAuthorization(token).recordIds, ['RA']);
  assert.equal(second.getReturnAuthorization(token), null);
  now = 10 * 60 * 1000 - 1;
  assert.ok(first.getReturnAuthorization(token));
  now++;
  assert.equal(first.getReturnAuthorization(token), null);
});

function response() {
  return {
    statusCode: 200, body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('permission middleware preserves unauthenticated, removed-account, forbidden and super-admin behavior', () => {
  const users = new Map([
    ['reader', { role: 'admin', permissions: ['records'] }],
    ['limited', { role: 'admin', permissions: [] }],
    ['root', { role: 'super_admin', permissions: [] }]
  ]);
  const permissions = createAdminPermissions({ getAdminUserById: id => users.get(id), normalizeAdminPermissions: value => value });
  for (const [id, status, message] of [
    [null, 401, '未登录管理后台'], ['removed', 401, '管理员账号不存在或已失效'],
    ['limited', 403, '当前管理员没有此功能权限']
  ]) {
    const res = response();
    permissions.requireAdminPermission('records')({ session: id ? { isAdmin: true, adminUserId: id } : {} }, res, () => assert.fail('must reject'));
    assert.equal(res.statusCode, status);
    assert.deepEqual(res.body, { success: false, message });
  }
  for (const id of ['reader', 'root']) {
    let passed = false;
    permissions.requireAdminPermission('records')({ session: { isAdmin: true, adminUserId: id } }, response(), () => { passed = true; });
    assert.equal(passed, true);
  }
  const res = response();
  permissions.requireSuperAdmin({ session: { isAdmin: true, adminUserId: 'reader' } }, res, () => assert.fail('must reject'));
  assert.equal(res.statusCode, 403);
  let passed = false;
  permissions.requireSuperAdmin({ session: { isAdmin: true, adminUserId: 'root' } }, response(), () => { passed = true; });
  assert.equal(passed, true);
  const unauthenticated = response();
  permissions.checkAdmin({ session: {} }, unauthenticated, () => assert.fail('must reject'));
  assert.equal(unauthenticated.statusCode, 401);
  let checked = false;
  permissions.checkAdmin({ session: { isAdmin: true, adminUserId: 'root' } }, response(), () => { checked = true; });
  assert.equal(checked, true);
  users.delete('reader');
  const removed = response();
  permissions.requireAdminPermission('records')({ session: { isAdmin: true, adminUserId: 'reader' } }, removed, () => assert.fail('must reject'));
  assert.equal(removed.statusCode, 401);
});

test('all fourteen route registrations retain exact method, path, guard and request argument mappings', () => {
  const expected = [
    ['post', '/borrow', 'borrow', ['body']], ['post', '/borrow-other', 'borrowOther', ['body']],
    ['post', '/borrow-batch', 'borrowBatch', ['body']], ['post', '/return-lookup', 'lookupReturns', ['body']],
    ['post', '/return', 'returnOne', ['body']], ['post', '/return-batch', 'returnBatch', ['body']],
    ['get', '', 'list', ['query']], ['get', '/active', 'listActive', []],
    ['put', '/:id', 'update', ['body', 'params']], ['post', '/:id/force-return', 'forceReturn', ['body', 'params']],
    ['post', '/force-return-batch', 'forceReturnBatch', ['body']], ['delete', '/:id', 'archive', ['params']],
    ['post', '/:id/restore', 'restore', ['params']], ['delete', '/:id/permanent', 'removePermanently', ['params']]
  ];
  const limiter = () => {};
  const guard = () => {};
  const body = { synthetic: 'body' }, params = { id: 'synthetic-id' }, query = { includeDeleted: 'true' };
  const req = { body, params, query };
  const result = { status: 409, body: { success: false, message: 'synthetic-response' } };
  const calls = [];
  const service = Object.fromEntries(expected.map(([, , name]) => [name, (...args) => { calls.push({ name, args }); return result; }]));
  const router = createRecordRouter({ service, borrowReturnLimiter: limiter, requireAdminPermission: permission => {
    assert.equal(permission, 'records');
    return guard;
  } });
  assert.equal(router.stack.length, expected.length);
  router.stack.forEach((layer, index) => {
    const [method, routePath, name, fields] = expected[index];
    assert.equal(layer.route.path, routePath);
    assert.deepEqual(layer.route.methods, { [method]: true });
    assert.equal(layer.route.stack.length, 2);
    assert.equal(layer.route.stack[0].handle, index < 6 ? limiter : guard);
    const res = response();
    layer.route.stack[1].handle(req, res);
    assert.deepEqual(calls.at(-1), { name, args: fields.map(field => req[field]) });
    assert.equal(res.statusCode, 409);
    assert.equal(res.body, result.body);
  });
});

test('backend modules never import startup, open a database, send SMTP directly or create listeners', () => {
  for (const file of ['records/service.js', 'records/routes.js', 'records/validation.js', 'records/return-authorization.js', 'middleware/admin-permissions.js']) {
    const source = fs.readFileSync(path.resolve(__dirname, '../backend', file), 'utf8');
    assert.doesNotMatch(source, /require\([^\n]*(?:server|db\/repository|email-service)/);
    assert.doesNotMatch(source, /\.listen\s*\(|createSqliteStore\s*\(|sendSmtpMail\s*\(/);
  }
});

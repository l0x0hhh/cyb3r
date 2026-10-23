// 传输边界回归：会话逐次读取、JSON/上传分流、部分成功响应和错误原样交回页面。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const apiModule = import(pathToFileURL(path.resolve(__dirname, '../frontend/src/services/api.js')).href);

function stubSession(t, readSession) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: key => { assert.equal(key, 'sessionId'); return readSession(); } }
  });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  });
}

test('API keeps the URL, JSON body and current session on each request', async t => {
  const { apiCall } = await apiModule;
  let session = 'test-session-first';
  stubSession(t, () => session);
  const calls = [];
  const partialResult = { success: true, data: { borrowed: [{ deviceId: 'test-device' }], conflicts: [{ deviceId: 'test-conflict' }] } };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return { json: async () => partialResult };
  });
  const body = { deviceIds: ['test-device', 'test-conflict'], purpose: 'contract fixture' };
  assert.strictEqual(await apiCall('POST', '/api/records/borrow-batch', body), partialResult);
  assert.deepEqual(calls[0], {
    url: '/api/records/borrow-batch',
    options: { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-id': session }, body: JSON.stringify(body) }
  });
  session = 'test-session-next';
  await apiCall('GET', '/api/admin/check');
  assert.equal(calls[1].options.headers['x-session-id'], session);
  assert.equal(Object.hasOwn(calls[1].options, 'body'), false);
  session = null;
  await apiCall('GET', '/api/devices/available');
  assert.deepEqual(calls[2].options.headers, { 'Content-Type': 'application/json' });
});

test('API passes FormData unchanged and lets the browser set its multipart boundary', async t => {
  const { apiCall } = await apiModule;
  stubSession(t, () => 'test-upload-session');
  const form = new FormData();
  form.append('name', 'test-device');
  let captured;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    captured = { url, options };
    return { json: async () => ({ success: true }) };
  });
  await apiCall('PUT', '/api/devices/test-device', form);
  assert.equal(captured.url, '/api/devices/test-device');
  assert.equal(captured.options.method, 'PUT');
  assert.strictEqual(captured.options.body, form);
  assert.deepEqual(captured.options.headers, { 'x-session-id': 'test-upload-session' });
});

test('API preserves server failures and propagates transport or JSON errors', async t => {
  const { apiCall } = await apiModule;
  stubSession(t, () => null);
  const failure = { success: false, message: 'test conflict' };
  const transportError = new Error('test transport failure');
  const jsonError = new SyntaxError('test invalid response');
  let request = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    request += 1;
    if (request === 2) throw transportError;
    return { ok: false, json: async () => {
      if (request === 3) throw jsonError;
      return failure;
    } };
  });
  assert.strictEqual(await apiCall('POST', '/api/records/return'), failure);
  await assert.rejects(apiCall('POST', '/api/records/return'), error => error === transportError);
  await assert.rejects(apiCall('POST', '/api/records/return'), error => error === jsonError);
});

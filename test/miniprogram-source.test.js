const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../miniprogram');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('wechat mini program is configured with the supplied AppID and no secret', () => {
  const project = JSON.parse(read('project.config.json'));
  const config = read('config.js');
  assert.equal(project.appid, 'wx46f682f7e11b893d');
  assert.match(config, /apiBase:\s*'https:\/\/cyb3r\.art'/);
  assert.doesNotMatch(config, /appsecret|appSecret|secret/i);
});

test('mini program exposes the ordinary-user borrow and return pages', () => {
  const app = JSON.parse(read('app.json'));
  assert.deepEqual(app.pages, [
    'pages/borrow/index',
    'pages/detail/index',
    'pages/borrow-form/index',
    'pages/return/index'
  ]);
  assert.match(read('pages/borrow/index.js'), /\/api\/devices\/available/);
  assert.match(read('pages/detail/index.js'), /\/api\/devices\/\$\{encodeURIComponent\(this\.deviceId\)\}\/status/);
  assert.match(read('pages/borrow-form/index.js'), /\/api\/records\/borrow/);
  assert.match(read('pages/return/index.js'), /\/api\/records\/return-lookup/);
  assert.match(read('pages/return/index.js'), /\/api\/records\/return/);
});

test('mini program images use the fixed-color blurred fade-in treatment', () => {
  const styles = read('app.wxss');
  assert.match(styles, /background:\s*#f0ece4/);
  assert.match(styles, /opacity:\s*0;\s*filter:\s*blur\(15px\);\s*transform:\s*scale\(1\.03\)/);
  assert.match(styles, /transition:\s*opacity \.3s ease, filter \.6s ease, transform \.6s ease/);
  assert.doesNotMatch(styles, /shimmer|spinner|skeleton/i);
});

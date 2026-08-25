const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const serverSource = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));

test('production startup requires an administrator password from the environment', () => {
  assert.match(serverSource, /NODE_ENV\s*===\s*['"]production['"]/);
  assert.match(serverSource, /ADMIN_PASSWORD/);
});

test('startup logs never print the administrator password', () => {
  assert.doesNotMatch(serverSource, /管理密码[^\n]*PASSWORD/);
});

test('uploads can be isolated and use a patched Multer release', () => {
  assert.match(serverSource, /process\.env\.UPLOAD_DIR/);
  assert.match(serverSource, /process\.env\.QR_DIR/);
  const [major, minor] = packageJson.dependencies.multer.split('.').map(Number);
  assert.ok(major > 2 || (major === 2 && minor >= 2));
});

test('public QR links can be pinned to the deployed HTTPS origin', () => {
  assert.match(serverSource, /process\.env\.APP_BASE_URL/);
  assert.match(serverSource, /getPublicBaseUrl/);
});

test('public deployment enables security headers, login throttling, and expiring sessions', () => {
  assert.match(serverSource, /helmet\(/);
  assert.match(serverSource, /rateLimit\(/);
  assert.match(serverSource, /SESSION_TTL_MS/);
  assert.doesNotMatch(serverSource, /Access-Control-Allow-Origin', '\*'/);
  assert.match(packageJson.dependencies.helmet || '', /^\d+\.\d+\.\d+$/);
  assert.match(packageJson.dependencies['express-rate-limit'] || '', /^\d+\.\d+\.\d+$/);
});

test('Content-Security-Policy permits the Google Fonts stylesheet and font files', () => {
  assert.match(serverSource, /styleSrc:\s*\[[^\]]*https:\/\/fonts\.googleapis\.com/);
  assert.match(serverSource, /styleSrcElem:\s*\[[^\]]*https:\/\/fonts\.googleapis\.com/);
  assert.match(serverSource, /fontSrc:\s*\[[^\]]*https:\/\/fonts\.gstatic\.com/);
});

// 一言仅允许从官方语句接口发起浏览器连接，不扩大其他 CSP 来源。
test('Content-Security-Policy permits the official Hitokoto sentence endpoint', () => {
  assert.match(serverSource, /connectSrc:\s*\["'self'",\s*'https:\/\/v1\.hitokoto\.cn'\]/);
});

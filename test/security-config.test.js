// 安全源码检查按装配入口和权限模块分别定位，保留原有安全要求。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const serverSource = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');
const permissionSource = fs.readFileSync(path.resolve(__dirname, '../backend/middleware/admin-permissions.js'), 'utf8');
const recordRouteSource = fs.readFileSync(path.resolve(__dirname, '../backend/records/routes.js'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));

test('production startup requires an administrator password from the environment', () => {
  assert.match(serverSource, /NODE_ENV\s*===\s*['"]production['"]/);
  assert.match(serverSource, /ADMIN_PASSWORD/);
});

test('startup logs never print the administrator password', () => {
  assert.doesNotMatch(serverSource, /管理密码[^\n]*PASSWORD/);
});

// 开发环境回退密钥契约：未配置 EMAIL_CONFIG_KEY 时仅非生产环境使用内置开发密钥，
// 生产环境仍强制要求显式配置，密钥不得进入仓库。
test('non-production startup falls back to a development email config key', () => {
  assert.match(serverSource, /DEV_EMAIL_CONFIG_KEY/);
  assert.match(serverSource, /process\.env\.NODE_ENV\s*===\s*['"]production['"]/);
  assert.match(serverSource, /使用开发默认密钥/);
  assert.match(serverSource, /生产部署前请设置 EMAIL_CONFIG_KEY/);
  assert.match(serverSource, /emailConfigKeyWarned/);
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

test('Content-Security-Policy keeps self-hosted styles and fonts local', () => {
  assert.match(serverSource, /styleSrc:\s*\["'self'",\s*"'unsafe-inline'"\]/);
  assert.match(serverSource, /styleSrcElem:\s*\["'self'",\s*"'unsafe-inline'"\]/);
  assert.match(serverSource, /fontSrc:\s*\["'self'"\]/);
  assert.doesNotMatch(serverSource, /fonts\.googleapis\.com/);
  assert.doesNotMatch(serverSource, /fonts\.gstatic\.com/);
});

// 一言仅允许从官方语句接口发起浏览器连接，不扩大其他 CSP 来源。
test('Content-Security-Policy permits the official Hitokoto sentence endpoint', () => {
  assert.match(serverSource, /connectSrc:\s*\["'self'",\s*'https:\/\/v1\.hitokoto\.cn'\]/);
});

test('record routes mount after session setup and preserve permission and limiter boundaries', () => {
  assert.ok(serverSource.indexOf('req.session = session') < serverSource.indexOf("app.use('/api/records'"));
  assert.match(serverSource, /createAdminPermissions\(\{\s*getAdminUserById, normalizeAdminPermissions/);
  assert.match(serverSource, /service: recordService, borrowReturnLimiter, requireAdminPermission/);
  assert.equal((recordRouteSource.match(/requireAdminPermission\('records'\)/g) || []).length, 8);
  assert.equal((recordRouteSource.match(/, borrowReturnLimiter,/g) || []).length, 6);
  assert.match(permissionSource, /getAdminUserById\(req\.session\.adminUserId\)/);
  assert.match(permissionSource, /normalizeAdminPermissions\(user\.permissions\)\.includes\(permission\)/);
  assert.match(permissionSource, /status\(401\)/);
  assert.match(permissionSource, /status\(403\)/);
  assert.doesNotMatch(serverSource, /app\.(get|post|put|delete)\('\/api\/records/);
});

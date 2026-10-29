// 后端分层第一批：装配借还记录域与权限工厂，其余接口仍保留在启动入口。
const express = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const multer = require('multer');
const QRCode = require('qrcode');
const sharp = require('sharp');
const { sendSmtpMail } = require('./email-service');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { createSqliteStore } = require('./db/repository');
const { createRecordService } = require('./backend/records/service');
const { createRecordRouter } = require('./backend/records/routes');
const { createAdminPermissions } = require('./backend/middleware/admin-permissions');
const { getRecordMajor, getRecordPurpose } = require('./backend/records/validation');
const { createMaterialsStore } = require('./backend/materials/store');
const { createMaterialsRouter } = require('./backend/materials/routes');
const { createSiteState, siteCookies } = require('./backend/site-state');
const {hashAdminPassword,hashAdminPasswordAsync,verifyAdminPassword,passwordFormat} = require('./backend/passwords');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const APP_BASE_URL = String(process.env.APP_BASE_URL || '').trim().replace(/\/+$/, '');
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 'loopback');
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');
const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, 'uploads');
const QR_DIR = process.env.QR_DIR
  ? path.resolve(process.env.QR_DIR)
  : path.join(__dirname, 'public/qrcodes');
const FRONTEND_DIST_DIR = path.join(__dirname, 'frontend', 'dist');
const FRONTEND_SOURCE_DIR = path.join(__dirname, 'frontend');
const STATIC_DIR = fs.existsSync(path.join(FRONTEND_DIST_DIR, 'index.html'))
  ? FRONTEND_DIST_DIR
  : FRONTEND_SOURCE_DIR;

if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_PASSWORD && !passwordFormat(process.env.ADMIN_PASSWORD_HASH)) {
  throw new Error('生产环境必须设置有效的 ADMIN_PASSWORD_HASH（兼容 ADMIN_PASSWORD）');
}

const PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// 确保目录存在
[DATA_DIR, UPLOAD_DIR, QR_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// 初始化数据文件
const DEVICES_FILE = path.join(DATA_DIR, 'devices.json');
const RECORDS_FILE = path.join(DATA_DIR, 'records.json');
const CATEGORIES_FILE = path.join(DATA_DIR, 'categories.json');
const OPERATION_LOGS_FILE = path.join(DATA_DIR, 'operation-logs.json');
const EMAIL_SETTINGS_FILE = path.join(DATA_DIR, 'email-settings.json');
const ADMIN_USERS_FILE = path.join(DATA_DIR, 'admin-users.json');
// 内置邮件正文采用统一完整结构；识别到历史简略版本时在读取阶段自动升级。
const DEFAULT_EMAIL_TEMPLATE_BODIES = {
  borrow: [
    '设备借出通知', '',
    '事件：设备借出', '{{deviceNotice}}', '',
    '借用明细：', '{{recordList}}', '',
    '操作时间：{{eventAt}}'
  ].join('\n'),
  return: [
    '用户归还通知', '',
    '事件：用户归还', '{{deviceNotice}}', '',
    '归还明细：', '{{recordList}}', '',
    '归还时间：{{eventAt}}', '归还备注：{{returnNotes}}'
  ].join('\n'),
  adminReturn: [
    '管理员归还通知', '',
    '事件：管理员归还', '{{deviceNotice}}', '',
    '归还明细：', '{{recordList}}', '',
    '归还时间：{{eventAt}}', '归还备注：{{returnNotes}}'
  ].join('\n')
};
const BUILT_IN_SHORT_EMAIL_TEMPLATE_BODIES = {
  borrow: '设备借出通知\n\n{{recordList}}',
  return: '用户归还通知\n\n{{recordList}}',
  adminReturn: '管理员归还通知\n\n{{recordList}}'
};
const DEFAULT_EMAIL_SETTINGS = {
  enabled: false,
  // 邮件默认只展示脱敏个人信息，管理员确认风险后才可切换为完整信息。
  maskSensitiveData: true,
  notifyBorrow: true,
  notifyReturn: false,
  notifyAdminReturn: false,
  recipients: [],
  smtp: { host: '', port: 465, security: 'ssl', username: '', secretEncrypted: '' },
  // 兼容旧字段：升级前的部署只有 subjectTemplate/bodyTemplate，始终与借出模板保持一致。
  subjectTemplate: '【设备管理】设备借出：{{deviceName}}',
  bodyTemplate: DEFAULT_EMAIL_TEMPLATE_BODIES.borrow,
  // 三套事件各自独立的主题和正文；事件名写死，其余字段继续使用变量。
  templates: {
    borrow: {
      subject: '【设备管理】设备借出：{{deviceName}}',
      body: DEFAULT_EMAIL_TEMPLATE_BODIES.borrow
    },
    return: {
      subject: '【设备管理】用户归还：{{deviceName}}',
      body: DEFAULT_EMAIL_TEMPLATE_BODIES.return
    },
    adminReturn: {
      subject: '【设备管理】管理员归还：{{deviceName}}',
      body: DEFAULT_EMAIL_TEMPLATE_BODIES.adminReturn
    }
  }
};
function initDataFile(filePath, initial) {
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, JSON.stringify(initial, null, 2));
}
initDataFile(DEVICES_FILE, []);
initDataFile(RECORDS_FILE, []);
initDataFile(OPERATION_LOGS_FILE, []);
initDataFile(EMAIL_SETTINGS_FILE, DEFAULT_EMAIL_SETTINGS);
initDataFile(ADMIN_USERS_FILE, []);
initDataFile(CATEGORIES_FILE, [
  { id: 'cat-camera', name: '相机', icon: 'camera', sortOrder: 1 },
  { id: 'cat-lens', name: '镜头', icon: 'lens', sortOrder: 2 },
  { id: 'cat-stabilizer', name: '稳定器', icon: 'stabilizer', sortOrder: 3 },
  { id: 'cat-microphone', name: '麦克风', icon: 'microphone', sortOrder: 4 },
  { id: 'cat-other', name: '其他', icon: 'other', sortOrder: 5 }
]);

const SQLITE_FILE = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(DATA_DIR, 'device-management.sqlite');
// 首次启动仅从现有 JSON 创建 SQLite；SQLite 已存在时不会重新导入，避免数据回退或分叉。
const DATA_STORE = createSqliteStore({ dataDir: DATA_DIR, databasePath: SQLITE_FILE });
try { fs.chmodSync(DATA_STORE.databasePath, 0o600); } catch { /* Windows 和受限挂载目录可能不支持 chmod。 */ }
// 服务退出前释放 SQLite 句柄，避免 WAL 文件和数据库被进程锁住。
const closeDataStore = () => DATA_STORE.close();
process.once('exit', closeDataStore);
process.once('SIGTERM', () => { closeDataStore(); process.exit(0); });
process.once('SIGINT', () => { closeDataStore(); process.exit(0); });

function isKnownCategoryId(categoryId) {
  return readJSON(CATEGORIES_FILE).some(category => category.id === categoryId);
}

const IMAGE_DISPLAY_HEIGHT_MIN = 120;
const IMAGE_DISPLAY_HEIGHT_MAX = 720;
const IMAGE_DISPLAY_POSITION_MIN = 0;
const IMAGE_DISPLAY_POSITION_MAX = 100;
const IMAGE_DISPLAY_ASPECT_RATIO_MIN = 0.2;
const IMAGE_DISPLAY_ASPECT_RATIO_MAX = 20;
function normalizeImageDisplayHeight(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const height = Number(value);
  if (!Number.isInteger(height) || height < IMAGE_DISPLAY_HEIGHT_MIN || height > IMAGE_DISPLAY_HEIGHT_MAX) {
    return undefined;
  }
  return height;
}

function normalizeImageDisplayPositionY(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const position = Number(value);
  if (!Number.isInteger(position) || position < IMAGE_DISPLAY_POSITION_MIN || position > IMAGE_DISPLAY_POSITION_MAX) {
    return undefined;
  }
  return position;
}

function normalizeImageDisplayAspectRatio(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const ratio = Number(value);
  if (!Number.isFinite(ratio) || ratio < IMAGE_DISPLAY_ASPECT_RATIO_MIN || ratio > IMAGE_DISPLAY_ASPECT_RATIO_MAX) {
    return undefined;
  }
  return Number(ratio.toFixed(4));
}

// 中间件。HTTP 部署时不能启用 upgrade-insecure-requests/HSTS，否则浏览器
// 会把前端脚本升级到 HTTPS，导致没有证书的服务器出现空白页。
const usingHttps = APP_BASE_URL.startsWith('https://');
const cspDirectives = {
  defaultSrc: ["'self'"],
  // 当前前端仍使用运行时模板；迁移到 .vue 单文件组件后可移除 unsafe-eval。
  scriptSrc: ["'self'", "'unsafe-eval'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  styleSrcElem: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", 'data:', 'blob:'],
  // 网页底栏每次装载仅连接一言官方语句接口一次。
  connectSrc: ["'self'", 'https://v1.hitokoto.cn'],
  fontSrc: ["'self'"],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"]
};
if (!usingHttps) cspDirectives.upgradeInsecureRequests = null;

app.use(helmet({
  contentSecurityPolicy: { directives: cspDirectives },
  strictTransportSecurity: usingHttps ? undefined : false
}));
// 批量导入使用独立且有上限的JSON大小，其他接口保持原32KB限制。
app.use('/api/v2/admin/import', express.json({ limit: '512kb' }));
app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: true, limit: '32kb' }));
app.use('/uploads', express.static(UPLOAD_DIR, {
  maxAge: '1y',
  immutable: true,
  etag: true
}));
app.use('/qrcodes', express.static(QR_DIR));
app.use(express.static(STATIC_DIR, { index: false }));

// 文件上传配置
// 图片允许保留相机原图上传，处理完成后只持久化压缩后的 WebP 变体。
const MAX_IMAGE_UPLOAD_BYTES = 20 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp']
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = IMAGE_EXTENSIONS.get(file.mimetype);
    cb(null, crypto.randomBytes(8).toString('hex') + ext);
  }
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (!IMAGE_EXTENSIONS.has(file.mimetype)) {
      const error = new Error('仅支持 JPEG、PNG 和 WebP 图片');
      error.code = 'INVALID_IMAGE_TYPE';
      return cb(error);
    }
    cb(null, true);
  },
  limits: {
    fileSize: MAX_IMAGE_UPLOAD_BYTES,
    files: 1,
    fields: 10,
    parts: 11
  }
});

function hasValidImageSignature(filePath, mimetype) {
  const buffer = Buffer.alloc(12);
  const fd = fs.openSync(filePath, 'r');
  const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
  fs.closeSync(fd);

  if (mimetype === 'image/jpeg') {
    return bytesRead >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimetype === 'image/png') {
    return bytesRead >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mimetype === 'image/webp') {
    return bytesRead >= 12
      && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
      && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  return false;
}

function validateUploadedImage(req, res, next) {
  if (!req.file) return next();
  if (hasValidImageSignature(req.file.path, req.file.mimetype)) return next();

  fs.unlinkSync(req.file.path);
  res.status(400).json({ success: false, message: '图片内容与文件类型不匹配' });
}

function removeFileIfPresent(filePath) {
  if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

async function optimizeUploadedImage(req, res, next) {
  if (!req.file) return next();

  const imageId = path.parse(req.file.filename).name;
  const detailFilename = `${imageId}-detail.webp`;
  const thumbFilename = `${imageId}-thumb.webp`;
  const detailPath = path.join(UPLOAD_DIR, detailFilename);
  const thumbPath = path.join(UPLOAD_DIR, thumbFilename);

  try {
    await Promise.all([
      sharp(req.file.path)
        .rotate()
        .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80, effort: 4 })
        .toFile(detailPath),
      sharp(req.file.path)
        .rotate()
        .resize({ width: 480, height: 640, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 72, effort: 4 })
        .toFile(thumbPath)
    ]);

    const metadata = await sharp(detailPath).metadata();
    removeFileIfPresent(req.file.path);
    req.optimizedImage = {
      image: `/uploads/${detailFilename}`,
      imageThumb: `/uploads/${thumbFilename}`,
      imageWidth: metadata.width || null,
      imageHeight: metadata.height || null
    };
    next();
  } catch (cause) {
    removeFileIfPresent(req.file.path);
    removeFileIfPresent(detailPath);
    removeFileIfPresent(thumbPath);
    const error = new Error('图片处理失败，请更换图片后重试');
    error.code = 'IMAGE_PROCESSING_FAILED';
    error.cause = cause;
    next(error);
  }
}

// ==================== 工具函数 ====================
function readJSON(filePath) {
  return DATA_STORE.readCollection(filePath);
}
function writeJSON(filePath, data) {
  DATA_STORE.writeCollection(filePath, data);
}

// 管理员账户模型：超级管理员拥有全部功能，普通管理员使用明确的权限白名单。
const ADMIN_USERNAME = String(process.env.ADMIN_USERNAME || 'admin').trim() || 'admin';
const ADMIN_PERMISSION_KEYS = ['devices', 'records', 'categories', 'statistics', 'operation-logs', 'email-settings', 'admin-management', 'materials-inventory', 'materials-records'];
const ADMIN_PASSWORD_MIN_LENGTH = 12;

function normalizeAdminUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeAdminPermissions(value) {
  const list = Array.isArray(value) ? value : [];
  return [...new Set(list.map(item => String(item || '').trim()).filter(item => ADMIN_PERMISSION_KEYS.includes(item)))];
}

const dummyPasswordHash=hashAdminPassword(crypto.randomBytes(32).toString('hex'));

function toPublicAdminUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    permissions: user.role === 'super_admin' ? [...ADMIN_PERMISSION_KEYS] : normalizeAdminPermissions(user.permissions),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

function writeAdminUsers(users) {
  writeJSON(ADMIN_USERS_FILE, users);
  try { fs.chmodSync(DATA_STORE.databasePath, 0o600); } catch { /* Windows and restricted filesystems may reject chmod. */ }
}

function ensureAdminUsers() {
  let users = readJSON(ADMIN_USERS_FILE);
  if (!Array.isArray(users)) users = [];
  const now = new Date().toISOString();
  const normalized = users
    .filter(user => user && typeof user === 'object')
    .map(user => ({
      id: String(user.id || `admin-${crypto.randomBytes(8).toString('hex')}`),
      username: normalizeAdminUsername(user.username),
      passwordHash: String(user.passwordHash || ''),
      role: user.role === 'super_admin' ? 'super_admin' : 'admin',
      permissions: normalizeAdminPermissions(user.permissions),
      createdAt: user.createdAt || now,
      updatedAt: user.updatedAt || now
    }))
    .filter(user => user.username && user.passwordHash);

  if (!normalized.length) {
    normalized.push({
      id: 'admin-root',
      username: normalizeAdminUsername(ADMIN_USERNAME),
      passwordHash: passwordFormat(process.env.ADMIN_PASSWORD_HASH) ? process.env.ADMIN_PASSWORD_HASH : hashAdminPassword(PASSWORD),
      role: 'super_admin',
      permissions: [...ADMIN_PERMISSION_KEYS],
      createdAt: now,
      updatedAt: now
    });
    writeAdminUsers(normalized);
    return normalized;
  }

  if (!normalized.some(user => user.role === 'super_admin')) normalized[0].role = 'super_admin';
  const current = normalized.find(user => user.username === normalizeAdminUsername(ADMIN_USERNAME));
  if (current && current.role !== 'super_admin') current.role = 'super_admin';
  writeAdminUsers(normalized);
  return normalized;
}

const ADMIN_USERS = ensureAdminUsers();

function getAdminUserByUsername(username) {
  const normalizedUsername = normalizeAdminUsername(username);
  return ADMIN_USERS.find(user => user.username === normalizedUsername) || null;
}

function getAdminUserById(id) {
  return ADMIN_USERS.find(user => user.id === String(id || '')) || null;
}

function persistAdminUsers() {
  writeAdminUsers(ADMIN_USERS);
}

// 邮件配置只保存加密后的 SMTP 凭据，接口永远不返回原始密码或授权码。
const EMAIL_EVENTS = {
  borrow: { label: '设备借出', setting: 'notifyBorrow' },
  return: { label: '用户归还', setting: 'notifyReturn' },
  adminReturn: { label: '管理员归还', setting: 'notifyAdminReturn' }
};
const EMAIL_TEMPLATE_VARIABLES = new Set([
  'eventLabel', 'deviceName', 'deviceModel', 'deviceId', 'borrowerName', 'borrowerId',
  'borrowerNameMasked', 'borrowerIdMasked', 'borrowerPhone', 'borrowerPhoneMasked',
  'major', 'purpose', 'borrowedAt', 'eventAt', 'returnNotes', 'deviceNotice', 'recordList'
]);
const EMAIL_ADDRESS_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cloneEmailSettings(settings = DEFAULT_EMAIL_SETTINGS) {
  return JSON.parse(JSON.stringify(settings));
}

function isBuiltInShortEmailTemplateBody(eventType, body) {
  const expected = BUILT_IN_SHORT_EMAIL_TEMPLATE_BODIES[eventType];
  return Boolean(expected) && String(body || '').replace(/\r\n/g, '\n').trim() === expected;
}

function readEmailSettings() {
  const stored = readJSON(EMAIL_SETTINGS_FILE);
  const source = stored && !Array.isArray(stored) ? stored : {};
  const defaults = cloneEmailSettings();
  const storedTemplates = source.templates && !Array.isArray(source.templates) ? source.templates : {};
  const templates = {};
  for (const eventType of Object.keys(defaults.templates)) {
    const storedTemplate = storedTemplates[eventType] && !Array.isArray(storedTemplates[eventType]) ? storedTemplates[eventType] : {};
    templates[eventType] = {
      ...defaults.templates[eventType],
      ...storedTemplate,
      ...(isBuiltInShortEmailTemplateBody(eventType, storedTemplate.body)
        ? { body: DEFAULT_EMAIL_TEMPLATE_BODIES[eventType] }
        : {})
    };
  }
  return {
    ...defaults,
    ...source,
    smtp: { ...defaults.smtp, ...(source.smtp || {}) },
    recipients: Array.isArray(source.recipients) ? source.recipients : defaults.recipients,
    bodyTemplate: isBuiltInShortEmailTemplateBody('borrow', source.bodyTemplate)
      ? templates.borrow.body
      : (source.bodyTemplate || defaults.bodyTemplate),
    // 事件级合并默认模板，旧部署缺少 templates 或只存部分事件时不会丢默认值。
    templates
  };
}

function writeEmailSettings(settings) {
  writeJSON(EMAIL_SETTINGS_FILE, settings);
  try { fs.chmodSync(DATA_STORE.databasePath, 0o600); } catch { /* Windows 和部分挂载目录不支持 chmod。 */ }
}

// 开发环境内置密钥：未配置 EMAIL_CONFIG_KEY 时，仅非生产环境回退到固定开发密钥以便本地测试邮件；
// 生产环境必须显式配置环境变量，密钥不进入仓库，加密语义不被削弱。
const DEV_EMAIL_CONFIG_KEY = '1b741a8d1d7ade75546f052a846e3160a5741341e42e65d49e2f3eaa228c2c61';
let emailConfigKeyWarned = false;
function getEmailConfigKey() {
  const raw = String(process.env.EMAIL_CONFIG_KEY || '').trim();
  if (raw) {
    if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
    try {
      const key = Buffer.from(raw, 'base64');
      return key.length === 32 ? key : null;
    } catch {
      return null;
    }
  }
  if (process.env.NODE_ENV === 'production') return null;
  if (!emailConfigKeyWarned) {
    emailConfigKeyWarned = true;
    console.warn('\n⚠️  未配置 EMAIL_CONFIG_KEY，当前使用开发默认密钥；生产部署前请设置 EMAIL_CONFIG_KEY 环境变量。\n');
  }
  return Buffer.from(DEV_EMAIL_CONFIG_KEY, 'hex');
}

function encryptEmailSecret(secret) {
  const key = getEmailConfigKey();
  if (!key) throw new Error('服务器未配置 EMAIL_CONFIG_KEY，暂时不能保存 SMTP 凭据');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(secret), 'utf8'), cipher.final()]);
  return JSON.stringify({
    version: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: encrypted.toString('base64')
  });
}

function decryptEmailSecret(encrypted) {
  const key = getEmailConfigKey();
  if (!key || !encrypted) return '';
  try {
    const payload = JSON.parse(encrypted);
    if (payload.version !== 1) return '';
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(payload.data, 'base64')),
      decipher.final()
    ]).toString('utf8');
  } catch {
    return '';
  }
}

function normalizeEmailRecipients(value) {
  const entries = Array.isArray(value) ? value : String(value || '').split(/[\n,;]+/);
  const recipients = [...new Set(entries.map(item => String(item || '').trim()).filter(Boolean))];
  if (recipients.length > 20) throw new Error('接收邮箱最多填写 20 个');
  if (recipients.some(email => !EMAIL_ADDRESS_PATTERN.test(email))) throw new Error('接收邮箱格式不正确');
  return recipients;
}

function validateEmailTemplate(template, fieldName, maxLength) {
  const value = String(template ?? '').trim();
  if (!value) throw new Error(`${fieldName}不能为空`);
  if (value.length > maxLength) throw new Error(`${fieldName}过长`);
  const placeholders = value.match(/\{\{([^{}]+)\}\}/g) || [];
  for (const placeholder of placeholders) {
    const variable = placeholder.slice(2, -2).trim();
    if (!EMAIL_TEMPLATE_VARIABLES.has(variable)) throw new Error(`${fieldName}包含不支持的变量：${variable}`);
  }
  if (value.includes('{{') && placeholders.length !== (value.match(/\{\{/g) || []).length) {
    throw new Error(`${fieldName}的变量格式不正确`);
  }
  return value;
}

function normalizeEmailSettings(body, current) {
  const next = cloneEmailSettings(current);
  next.enabled = Boolean(body.enabled);
  next.maskSensitiveData = body.maskSensitiveData === undefined ? Boolean(current.maskSensitiveData !== false) : Boolean(body.maskSensitiveData);
  next.notifyBorrow = body.notifyBorrow === undefined ? Boolean(current.notifyBorrow) : body.notifyBorrow !== false;
  next.notifyReturn = body.notifyReturn === undefined ? Boolean(current.notifyReturn) : Boolean(body.notifyReturn);
  next.notifyAdminReturn = body.notifyAdminReturn === undefined ? Boolean(current.notifyAdminReturn) : Boolean(body.notifyAdminReturn);
  next.recipients = body.recipients === undefined ? [...current.recipients] : normalizeEmailRecipients(body.recipients);

  const smtp = body.smtp || {};
  const host = String(smtp.host === undefined ? current.smtp.host : smtp.host || '').trim();
  const username = String(smtp.username === undefined ? current.smtp.username : smtp.username || '').trim();
  const port = Number(smtp.port === undefined ? current.smtp.port : smtp.port || 465);
  const security = String(smtp.security === undefined ? current.smtp.security : smtp.security || 'ssl').trim();
  if (host.length > 255 || /[\r\n]/.test(host)) throw new Error('SMTP 服务器地址不正确');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SMTP 端口不正确');
  if (!['ssl', 'starttls', 'none'].includes(security)) throw new Error('SMTP 加密方式不正确');
  if (username && !EMAIL_ADDRESS_PATTERN.test(username)) throw new Error('发件邮箱格式不正确');
  next.smtp = { ...current.smtp, host, port, security, username };

  const secret = String(smtp.secret || '');
  if (secret.trim()) next.smtp.secretEncrypted = encryptEmailSecret(secret);
  if (Boolean(smtp.clearSecret)) next.smtp.secretEncrypted = '';
  // 部分更新时，未提交的模板字段沿用当前配置，避免意外清空模板。
  const subjectTemplate = body.subjectTemplate === undefined ? next.subjectTemplate : body.subjectTemplate;
  const bodyTemplate = body.bodyTemplate === undefined ? next.bodyTemplate : body.bodyTemplate;
  next.subjectTemplate = validateEmailTemplate(subjectTemplate, '邮件主题', 160);
  if (/[\r\n]/.test(next.subjectTemplate)) throw new Error('邮件主题不能包含换行');
  next.bodyTemplate = validateEmailTemplate(bodyTemplate, '邮件正文', 8000);

  // 三套独立模板：请求未携带 templates 时整组回退到兼容旧字段（旧前端行为）；
  // 携带 templates 时按 请求值 > 当前值 > 旧字段 逐事件解析，未提交的事件沿用当前配置。
  const requestedTemplates = body.templates && typeof body.templates === 'object' && !Array.isArray(body.templates) ? body.templates : {};
  const currentTemplates = current.templates && typeof current.templates === 'object' && !Array.isArray(current.templates) ? current.templates : {};
  next.templates = {};
  for (const eventType of Object.keys(EMAIL_EVENTS)) {
    const label = EMAIL_EVENTS[eventType].label;
    const requestedEvent = requestedTemplates[eventType] && typeof requestedTemplates[eventType] === 'object' ? requestedTemplates[eventType] : {};
    const currentEvent = currentTemplates[eventType] && typeof currentTemplates[eventType] === 'object' ? currentTemplates[eventType] : {};
    // 请求未携带 templates 字段时，整个事件组回退到旧字段，保持旧版共用一套模板的行为。
    const eventSubject = body.templates === undefined
      ? next.subjectTemplate
      : (requestedEvent.subject === undefined
        ? (currentEvent.subject === undefined ? next.subjectTemplate : currentEvent.subject)
        : requestedEvent.subject);
    const eventBody = body.templates === undefined
      ? next.bodyTemplate
      : (requestedEvent.body === undefined
        ? (currentEvent.body === undefined ? next.bodyTemplate : currentEvent.body)
        : requestedEvent.body);
    const normalizedSubject = validateEmailTemplate(eventSubject, `${label}邮件主题`, 160);
    if (/[\r\n]/.test(normalizedSubject)) throw new Error(`${label}邮件主题不能包含换行`);
    next.templates[eventType] = {
      subject: normalizedSubject,
      body: validateEmailTemplate(eventBody, `${label}邮件正文`, 8000)
    };
  }
  // 旧字段始终同步为借出模板，旧前端和旧数据读取不受影响。
  next.subjectTemplate = next.templates.borrow.subject;
  next.bodyTemplate = next.templates.borrow.body;

  if (next.enabled) {
    if (!next.recipients.length) throw new Error('启用通知前请填写至少一个接收邮箱');
    if (!next.smtp.host || !next.smtp.username || !next.smtp.secretEncrypted) throw new Error('启用通知前请完整填写 SMTP 配置');
    if (!getEmailConfigKey()) throw new Error('服务器未配置 EMAIL_CONFIG_KEY，暂时不能启用邮件通知');
  }
  return next;
}

function toPublicEmailSettings(settings) {
  return {
    enabled: Boolean(settings.enabled),
    maskSensitiveData: settings.maskSensitiveData !== false,
    notifyBorrow: Boolean(settings.notifyBorrow),
    notifyReturn: Boolean(settings.notifyReturn),
    notifyAdminReturn: Boolean(settings.notifyAdminReturn),
    recipients: [...settings.recipients],
    smtp: {
      host: settings.smtp.host || '',
      port: Number(settings.smtp.port) || 465,
      security: settings.smtp.security || 'ssl',
      username: settings.smtp.username || '',
      secretConfigured: Boolean(settings.smtp.secretEncrypted)
    },
    subjectTemplate: settings.subjectTemplate,
    bodyTemplate: settings.bodyTemplate,
    templates: {
      borrow: resolveEventTemplate(settings, 'borrow'),
      return: resolveEventTemplate(settings, 'return'),
      adminReturn: resolveEventTemplate(settings, 'adminReturn')
    }
  };
}

// 三套模板解析：优先事件级模板，缺失字段回退到兼容旧字段，保证升级前配置继续生效。
function resolveEventTemplate(settings, eventType) {
  const pair = settings.templates?.[eventType] || {};
  const legacy = { subject: settings.subjectTemplate, body: settings.bodyTemplate };
  return {
    subject: String(pair.subject || legacy.subject || ''),
    body: String(pair.body || legacy.body || '')
  };
}

function formatEmailTemplate(template, values) {
  return String(template).replace(/\{\{([^{}]+)\}\}/g, (_, variable) => String(values[variable.trim()] ?? ''));
}

// 模板变量检查集中处理，确保新旧模板的兼容补充逻辑使用同一判断规则。
function hasEmailVariable(template, variable) {
  return new RegExp(`\\{\\{\\s*${variable}\\s*\\}\\}`).test(String(template || ''));
}

function maskIdentifier(identifier) {
  const value = String(identifier || '').trim();
  if (!value) return '';
  if (value.length <= 4) return '*'.repeat(value.length);
  return `${value.slice(0, 2)}${'*'.repeat(Math.max(1, value.length - 4))}${value.slice(-2)}`;
}

// 邮件里的时间统一转成北京时间可读格式，避免把 ISO 字符串直接展示给收件人。
function formatEmailTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return String(value || '');
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const pad = n => String(n).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}

// 模板字段统一在服务端按配置脱敏，避免前端或管理员误选变量造成隐私泄露。
function buildEmailValues(eventType, record, settings = DEFAULT_EMAIL_SETTINGS) {
  const event = EMAIL_EVENTS[eventType] || EMAIL_EVENTS.borrow;
  const maskSensitiveData = settings.maskSensitiveData !== false;
  const borrowerName = String(record.borrowerName || '');
  const borrowerId = String(record.borrowerId || '');
  const borrowerPhone = String(record.borrowerPhone || '');
  return {
    eventLabel: event.label,
    deviceName: getEmailDeviceName(record),
    deviceModel: getEmailDeviceModel(record),
    deviceId: String(record.deviceId || ''),
    deviceNotice: getEmailDeviceNotice(record),
    borrowerName: maskSensitiveData ? maskName(borrowerName) : borrowerName,
    borrowerId: maskSensitiveData ? maskIdentifier(borrowerId) : borrowerId,
    borrowerNameMasked: maskName(borrowerName),
    borrowerIdMasked: maskIdentifier(borrowerId),
    borrowerPhone: maskSensitiveData ? maskPhone(borrowerPhone) : borrowerPhone,
    borrowerPhoneMasked: maskPhone(borrowerPhone),
    major: getRecordMajor(record),
    purpose: getRecordPurpose(record),
    borrowedAt: formatEmailTime(record.createdAt),
    eventAt: formatEmailTime(record.returnedAt || new Date().toISOString()),
    returnNotes: String(record.returnNotes || ''),
    recordList: ''
  };
}

function queueEmailNotification(eventType, record) {
  const event = EMAIL_EVENTS[eventType];
  if (!event) return;
  const settings = readEmailSettings();
  if (!settings.enabled || !settings[event.setting] || !settings.recipients.length) return;
  const secret = decryptEmailSecret(settings.smtp.secretEncrypted);
  if (!secret) {
    console.error('[email] SMTP 凭据无法解密，已跳过邮件通知');
    return;
  }
  const values = buildEmailValues(eventType, record, settings);
  // 单台邮件也提供明细变量，让新模板在单台和批量场景下都能复用。
  values.recordList = formatEmailRecordGroup(eventType, [record], settings);
  const template = resolveEventTemplate(settings, eventType);
  const subject = formatEmailTemplate(template.subject, values);
  let text = formatEmailTemplate(template.body, values);
  // 旧模板没有待上线提醒变量时，自动补一行提醒且只补一次。
  if (values.deviceNotice && !hasEmailVariable(template.body, 'deviceNotice')) {
    text += `\n\n${values.deviceNotice}`;
  }
  void sendSmtpMail({
    smtp: settings.smtp,
    secret,
    recipients: settings.recipients,
    subject,
    text
  }).catch(error => {
    console.error(`[email] ${event.label}通知发送失败：${error.message}`);
  });
}

// 批量事件只发一封汇总邮件；新模板使用逐组明细，旧模板继续通过既有字段兼容清单。
function queueBatchEmailNotification(eventType, records) {
  const list = (records || []).filter(Boolean);
  if (!list.length) return;
  const settings = readEmailSettings();
  const event = EMAIL_EVENTS[eventType];
  if (!event || !settings.enabled || !settings[event.setting] || !settings.recipients.length) return;
  const secret = decryptEmailSecret(settings.smtp.secretEncrypted);
  if (!secret) {
    console.error('[email] SMTP 凭据无法解密，已跳过邮件通知');
    return;
  }

  const template = resolveEventTemplate(settings, eventType);
  const groupMap = new Map();
  for (const record of list) {
    const key = [record.borrowerName, record.borrowerId, record.borrowerPhone].map(value => String(value || '')).join('\u0000');
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key).push(record);
  }
  const groups = [...groupMap.values()];
  const first = list[0];
  const summary = {
    ...first,
    isOtherDevice: false,
    deviceName: list.map(record => String(record.deviceName || '未知设备')).join('、'),
    deviceModel: list.map(getEmailDeviceModel).join('、'),
    deviceId: list.map(record => String(record.deviceId || '未分配编号')).join('、'),
    deviceNotice: list.filter(record => record.isOtherDevice === true).length
      ? '记得有时间上线这个设备喔'
      : '',
    recordList: groups.map(group => formatEmailRecordGroup(eventType, group, settings)).join('\n\n')
  };
  const values = buildEmailValues(eventType, summary, settings);
  values.deviceNotice = summary.deviceNotice;
  values.recordList = summary.recordList;
  // 多个借用人使用中性占位语，避免旧模板把第一人展示成整批记录的唯一借用人。
  if (groups.length > 1) {
    const detailHint = '见下方分组明细';
    values.borrowerName = '多人（详见下方明细）';
    values.borrowerNameMasked = values.borrowerName;
    values.borrowerId = detailHint;
    values.borrowerIdMasked = detailHint;
    values.borrowerPhone = detailHint;
    values.borrowerPhoneMasked = detailHint;
    values.major = detailHint;
    values.purpose = detailHint;
  }
  const hasRecordList = /\{\{\s*recordList\s*\}\}/.test(template.body);
  const subject = formatEmailTemplate(template.subject, values);
  let text = formatEmailTemplate(template.body, values);
  const extraSections = [];
  if (summary.deviceNotice && !hasEmailVariable(template.body, 'deviceNotice')) {
    extraSections.push(summary.deviceNotice);
  }
  if (!hasRecordList) {
    const detailLabel = eventType === 'borrow' ? '借用' : '归还';
    extraSections.push(`${detailLabel}明细：\n${summary.recordList}`);
  }
  if (extraSections.length) {
    text += `\n\n${extraSections.join('\n\n')}`;
  }
  void sendSmtpMail({ smtp: settings.smtp, secret, recipients: settings.recipients, subject, text }).catch(error => {
    console.error(`[email] ${event.label}通知发送失败：${error.message}`);
  });
}

// 操作日志只保存设备动作元数据，禁止传入借用人姓名、电话等隐私字段。
function appendOperationLog(action, device, summary) {
  const logs = readJSON(OPERATION_LOGS_FILE);
  logs.push({
    id: 'LOG' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase(),
    action,
    targetType: 'device',
    targetId: device.id,
    targetName: String(device.name || '未知设备'),
    summary: String(summary || '').trim(),
    createdAt: new Date().toISOString()
  });
  writeJSON(OPERATION_LOGS_FILE, logs);
}
function generateDeviceId() {
  return 'DEV' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
}

function getPublicBaseUrl(req) {
  return APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
}

function findActiveRecord(records, deviceId) {
  return [...records]
    .reverse()
    .find(record => record.deviceId === deviceId && !record.returnedAt && !record.deletedAt);
}

function getOperationalStatus(device) {
  return device?.operationalStatus === 'offline' ? 'offline' : 'online';
}

function getDeviceImageFields(device) {
  const image = device?.image || null;
  const width = Number(device?.imageWidth);
  const height = Number(device?.imageHeight);
  const displayHeight = normalizeImageDisplayHeight(device?.imageDisplayHeight);
  const displayPositionY = normalizeImageDisplayPositionY(device?.imageDisplayPositionY);
  const displayAspectRatio = normalizeImageDisplayAspectRatio(device?.imageDisplayAspectRatio);
  return {
    image,
    imageThumb: device?.imageThumb || image,
    imageWidth: Number.isFinite(width) && width > 0 ? width : null,
    imageHeight: Number.isFinite(height) && height > 0 ? height : null,
    imageDisplayHeight: displayHeight === undefined ? null : displayHeight,
    imageDisplayPositionY: displayPositionY === undefined ? null : displayPositionY,
    imageDisplayAspectRatio: displayAspectRatio === undefined ? null : displayAspectRatio
  };
}

// 邮件中不再把提醒文字拼进设备名称；型号为空时给出可执行的补充提示。
const EMAIL_MISSING_MODEL = '暂未录入（待管理员上线后补充）';
const EMAIL_MISSING_DEVICE_ID = '待管理员上线后生成';
const EMAIL_OTHER_DEVICE_NOTICE = '记得有时间上线这个设备喔';

function getEmailDeviceName(record) {
  const deviceName = String(record?.deviceName || '未知设备');
  return deviceName.trim() || '未知设备';
}

function getEmailDeviceModel(record) {
  const deviceModel = String(record?.deviceModel || '').trim();
  return deviceModel || EMAIL_MISSING_MODEL;
}

function getEmailDeviceNotice(record) {
  return record?.isOtherDevice === true ? EMAIL_OTHER_DEVICE_NOTICE : '';
}

function formatEmailRecordGroup(eventType, records, settings) {
  const list = (records || []).filter(Boolean);
  if (!list.length) return '';
  const firstValues = buildEmailValues(eventType, list[0], settings);
  const lines = [
    `借用人：${firstValues.borrowerName || '-'}`,
    `联系电话：${firstValues.borrowerPhone || '-'}`
  ];
  if (firstValues.major) lines.push(`专业/部门：${firstValues.major}`);
  if (firstValues.purpose) lines.push(`借用用途：${firstValues.purpose}`);
  lines.push('设备明细：');
  list.forEach((record, index) => {
    const values = buildEmailValues(eventType, record, settings);
    const deviceId = values.deviceId || EMAIL_MISSING_DEVICE_ID;
    lines.push(`${index + 1}. ${values.deviceName}（型号：${values.deviceModel}，编号：${deviceId}）`);
  });
  return lines.join('\n');
}

function withDeviceCompatibility(device) {
  return {
    ...device,
    category: device.category || 'cat-other',
    ...getDeviceImageFields(device),
    operationalStatus: getOperationalStatus(device),
    offlineReason: getOperationalStatus(device) === 'offline'
      ? String(device.offlineReason || '').trim()
      : ''
  };
}

// 借用统计按记录实时聚合，归档记录继续保留在历史口径中。
function buildBorrowingStatistics(records, devices, requestedRange) {
  const range = ['7d', '30d', 'all'].includes(requestedRange) ? requestedRange : '30d';
  const now = new Date();
  const dayCount = range === '7d' ? 7 : range === '30d' ? 30 : null;
  const cutoff = dayCount ? new Date(now.getTime() - dayCount * 24 * 60 * 60 * 1000) : null;
  const borrowRecords = records.filter(record => {
    if (record.type !== 'borrow') return false;
    const createdAt = new Date(record.createdAt);
    return !Number.isNaN(createdAt.getTime()) && (!cutoff || createdAt >= cutoff);
  });

  const deviceUsage = new Map();
  const trendCounts = new Map();
  for (const record of borrowRecords) {
    const usageKey = record.isOtherDevice === true
      ? `other:${String(record.deviceName || '未知设备')}`
      : `device:${String(record.deviceId || '')}`;
    const current = deviceUsage.get(usageKey) || {
      deviceId: record.deviceId,
      deviceName: record.deviceName || '未知设备',
      deviceModel: record.deviceModel || '',
      isOtherDevice: record.isOtherDevice === true,
      borrowCount: 0
    };
    current.borrowCount += 1;
    deviceUsage.set(usageKey, current);

    const date = new Date(record.createdAt).toISOString().slice(0, 10);
    trendCounts.set(date, (trendCounts.get(date) || 0) + 1);
  }

  let trend;
  if (dayCount) {
    trend = Array.from({ length: dayCount }, (_, index) => {
      const date = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() - (dayCount - 1 - index)
      )).toISOString().slice(0, 10);
      return { date, borrowCount: trendCounts.get(date) || 0 };
    });
  } else {
    trend = [...trendCounts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, borrowCount]) => ({ date, borrowCount }));
  }

  const usedDeviceCount = [...deviceUsage.values()].filter(item => !item.isOtherDevice).length;
  const deviceCount = devices.length;
  return {
    range,
    summary: {
      borrowCount: borrowRecords.length,
      returnedCount: borrowRecords.filter(record => record.returnedAt).length,
      activeCount: records.filter(record => record.type === 'borrow' && !record.returnedAt && !record.deletedAt).length,
      usedDeviceCount,
      deviceCount,
      utilizationRate: deviceCount ? Math.round(usedDeviceCount / deviceCount * 100) : 0
    },
    popularDevices: [...deviceUsage.values()]
      .sort((left, right) => right.borrowCount - left.borrowCount || left.deviceName.localeCompare(right.deviceName, 'zh-CN'))
      .slice(0, 5),
    trend
  };
}

function maskName(name) {
  const value = String(name || '').trim();
  const chars = Array.from(value);
  if (!chars.length) return '-';
  if (chars.length === 1) return '*';
  if (chars.length === 2) return `${chars[0]}*`;
  return `${chars[0]}${'*'.repeat(chars.length - 2)}${chars.at(-1)}`;
}

function maskPhone(phone) {
  const value = String(phone || '').trim();
  if (!value) return '';
  return value.slice(0, 3) + '****';
}

function toPublicBorrower(record) {
  if (!record) return null;
  return {
    name: maskName(record.borrowerName),
    major: getRecordMajor(record),
    phone: maskPhone(record.borrowerPhone),
    borrowedAt: record.createdAt
  };
}

// 权限中间件由启动入口注入当前管理员查询，保持会话与权限白名单行为。
const { checkAdmin, requireAdminPermission, requireSuperAdmin } = createAdminPermissions({
  getAdminUserById, normalizeAdminPermissions
});

function getSessionAdminUser(req) {
  return req.session?.adminUserId ? getAdminUserById(req.session.adminUserId) : null;
}

// ==================== session 简易实现 ====================
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const siteState = createSiteState(path.join(DATA_DIR, 'site-state.sqlite'));
process.once('exit', () => siteState.close());
app.use(siteCookies);
app.use((req, res, next) => {
  const session = siteState.getSession(req.adminToken, getAdminUserById);
  if (session) {
    req.session = session;
    if (req.headers['x-session-id']) res.cookie('ccs_admin', req.adminToken, {httpOnly:true,sameSite:'lax',secure:req.secure,path:'/',maxAge:session.expiresAt-Date.now()});
  } else {
    req.session = {};
    if (req.adminToken) res.clearCookie('ccs_admin', { httpOnly:true, sameSite:'lax', secure:req.secure, path:'/' });
  }
  next();
});

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message: '登录尝试过于频繁，请稍后再试' }
});

const borrowReturnLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message: '操作过于频繁，请稍后再试' }
});

// ==================== 分类 API ====================
app.get('/api/categories', (req, res) => {
  try {
    const categories = readJSON(CATEGORIES_FILE)
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    res.json({ success: true, data: categories });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 创建分类（管理员）
app.post('/api/categories', requireAdminPermission('categories'), (req, res) => {
  try {
    const { name, icon, sortOrder } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: '分类名称不能为空' });
    }
    const validIcons = ['camera', 'lens', 'stabilizer', 'microphone', 'other'];
    if (icon && !validIcons.includes(icon)) {
      return res.status(400).json({ success: false, message: '无效的图标类型' });
    }
    const categories = readJSON(CATEGORIES_FILE);
    const id = 'cat-' + crypto.randomBytes(4).toString('hex');
    const newCategory = {
      id,
      name: String(name).trim(),
      icon: icon && validIcons.includes(icon) ? icon : 'other',
      sortOrder: typeof sortOrder === 'number' ? sortOrder : categories.length + 1
    };
    categories.push(newCategory);
    writeJSON(CATEGORIES_FILE, categories);
    res.status(201).json({ success: true, data: newCategory });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 批量更新分类顺序（管理员）
app.put('/api/categories/reorder', requireAdminPermission('categories'), (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : null;
    const categories = readJSON(CATEGORIES_FILE);
    const knownIds = categories.map(category => category.id);
    const hasSameIds = ids
      && ids.length === knownIds.length
      && new Set(ids).size === knownIds.length
      && knownIds.every(id => ids.includes(id));

    if (!hasSameIds) {
      return res.status(400).json({ success: false, message: '分类顺序数据无效，请刷新后重试' });
    }

    const orderById = new Map(ids.map((id, index) => [id, index + 1]));
    categories.forEach(category => {
      category.sortOrder = orderById.get(category.id);
    });
    writeJSON(CATEGORIES_FILE, categories);

    res.json({
      success: true,
      data: [...categories].sort((a, b) => a.sortOrder - b.sortOrder)
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 更新分类（管理员）
app.put('/api/categories/:id', requireAdminPermission('categories'), (req, res) => {
  try {
    const { name, icon, sortOrder } = req.body;
    const categories = readJSON(CATEGORIES_FILE);
    const idx = categories.findIndex(c => c.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, message: '分类不存在' });

    const validIcons = ['camera', 'lens', 'stabilizer', 'microphone', 'other'];
    if (name !== undefined) {
      if (!String(name).trim()) return res.status(400).json({ success: false, message: '分类名称不能为空' });
      categories[idx].name = String(name).trim();
    }
    if (icon !== undefined) {
      if (!validIcons.includes(icon)) return res.status(400).json({ success: false, message: '无效的图标类型' });
      categories[idx].icon = icon;
    }
    if (sortOrder !== undefined) categories[idx].sortOrder = sortOrder;

    writeJSON(CATEGORIES_FILE, categories);
    res.json({ success: true, data: categories[idx] });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 删除分类（管理员）；cat-other 不可删除，已有设备归入 cat-other
app.delete('/api/categories/:id', requireAdminPermission('categories'), (req, res) => {
  try {
    if (req.params.id === 'cat-other') {
      return res.status(400).json({ success: false, message: '「其他」分类不可删除' });
    }
    let categories = readJSON(CATEGORIES_FILE);
    const idx = categories.findIndex(c => c.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, message: '分类不存在' });

    categories.splice(idx, 1);
    categories.forEach((category, index) => {
      category.sortOrder = index + 1;
    });
    const devices = readJSON(DEVICES_FILE);
    let changed = false;
    devices.forEach(d => {
      if (d.category === req.params.id) {
        d.category = 'cat-other';
        changed = true;
      }
    });
    DATA_STORE.transaction(() => {
      writeJSON(CATEGORIES_FILE, categories);
      // 将该分类下的设备迁移到 cat-other
      if (changed) writeJSON(DEVICES_FILE, devices);
    });

    res.json({ success: true, message: '删除成功' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ==================== 设备 CRUD API ====================

// 批量导入先完整校验所有行，再一次性写入，避免产生半成功数据。
app.post('/api/devices/batch-import', requireAdminPermission('devices'), (req, res) => {
  try {
    const rows = req.body?.devices;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, message: '请至少导入一条设备数据', errors: [] });
    }
    if (rows.length > 500) {
      return res.status(400).json({ success: false, message: '单次最多导入 500 台设备', errors: [] });
    }

    const categories = readJSON(CATEGORIES_FILE);
    const errors = [];
    const normalizedRows = rows.map((row, index) => {
      const rowNumber = index + 2;
      const name = String(row?.name ?? '').trim();
      const model = String(row?.model ?? '').trim();
      const categoryName = String(row?.categoryName ?? '').trim();
      const location = String(row?.location ?? '').trim();
      const notes = String(row?.notes ?? '').trim();
      const rowErrors = [];
      if (!name) rowErrors.push('设备名称不能为空');
      if (!model) rowErrors.push('设备型号不能为空');
      if (!categoryName) rowErrors.push('设备分类不能为空');
      const matchedCategories = categoryName
        ? categories.filter(category => String(category.name || '').trim() === categoryName)
        : [];
      if (categoryName && matchedCategories.length === 0) rowErrors.push(`设备分类“${categoryName}”不存在`);
      if (matchedCategories.length > 1) rowErrors.push(`设备分类“${categoryName}”无法唯一匹配`);
      if (rowErrors.length) errors.push({ rowNumber, errors: rowErrors });
      return { name, model, category: matchedCategories[0]?.id, location, notes };
    });

    if (errors.length) {
      return res.status(400).json({ success: false, message: '导入数据存在错误，请修正后重试', errors });
    }

    const devices = readJSON(DEVICES_FILE);
    const createdAt = new Date().toISOString();
    const importedDevices = normalizedRows.map(row => ({
      id: generateDeviceId(),
      name: row.name,
      model: row.model,
      location: row.location,
      notes: row.notes,
      category: row.category,
      image: null,
      imageThumb: null,
      imageWidth: null,
      imageHeight: null,
      imageDisplayHeight: null,
      imageDisplayPositionY: null,
      imageDisplayAspectRatio: null,
      status: 'available',
      operationalStatus: 'online',
      offlineReason: '',
      createdAt
    }));
    DATA_STORE.transaction(() => {
      writeJSON(DEVICES_FILE, devices.concat(importedDevices));
      appendOperationLog(
        'devices_batch_imported',
        { id: 'batch', name: '批量导入设备' },
        `批量导入 ${importedDevices.length} 台设备`
      );
    });
    res.json({ success: true, data: { count: importedDevices.length, devices: importedDevices } });
  } catch (e) {
    res.status(500).json({ success: false, message: '批量导入失败: ' + e.message });
  }
});

// 批量状态先检查全部设备；借出设备只阻止下线，上线会清空离线原因。
app.put('/api/devices/batch-operational-status', requireAdminPermission('devices'), (req, res) => {
  try {
    const deviceIds = req.body?.deviceIds;
    const operationalStatus = String(req.body?.operationalStatus || '').trim();
    const offlineReason = String(req.body?.offlineReason || '').trim();
    if (!Array.isArray(deviceIds) || deviceIds.length < 1 || deviceIds.length > 500) {
      return res.status(400).json({ success: false, message: '单次批量状态操作设备数量需为 1-500 台', errors: [] });
    }
    if (!['online', 'offline'].includes(operationalStatus)) {
      return res.status(400).json({ success: false, message: '批量状态操作无效', errors: [] });
    }
    const normalizedIds = deviceIds.map(id => String(id || '').trim());
    if (normalizedIds.some(id => !id) || new Set(normalizedIds).size !== normalizedIds.length) {
      return res.status(400).json({ success: false, message: '设备选择无效或存在重复设备', errors: [] });
    }

    const devices = readJSON(DEVICES_FILE);
    const errors = [];
    const selectedDevices = normalizedIds.map(deviceId => {
      const device = devices.find(item => item.id === deviceId);
      if (!device) {
        errors.push({ deviceId, message: '设备不存在' });
        return null;
      }
      if (operationalStatus === 'offline' && device.status === 'borrowed') {
        errors.push({ deviceId, deviceName: device.name, message: '设备正在借用中，请归还后再下线' });
      }
      return device;
    }).filter(Boolean);
    if (errors.length) {
      return res.status(409).json({ success: false, message: '批量状态操作未执行，请先处理校验失败的设备', errors });
    }

    selectedDevices.forEach(device => {
      device.operationalStatus = operationalStatus;
      device.offlineReason = operationalStatus === 'offline' ? offlineReason : '';
    });
    const isOffline = operationalStatus === 'offline';
    DATA_STORE.transaction(() => {
      writeJSON(DEVICES_FILE, devices);
      appendOperationLog(
        isOffline ? 'devices_batch_offlined' : 'devices_batch_onlined',
        { id: 'batch', name: isOffline ? '批量下线设备' : '批量上线设备' },
        `批量${isOffline ? '下线' : '上线'} ${selectedDevices.length} 台设备${isOffline && offlineReason ? `；原因：${offlineReason}` : ''}`
      );
    });
    res.json({ success: true, data: { count: selectedDevices.length, devices: selectedDevices.map(withDeviceCompatibility) } });
  } catch (e) {
    res.status(500).json({ success: false, message: '批量状态操作失败: ' + e.message });
  }
});

// 批量分类先校验目标分类和全部设备，再一次写入并记录单条汇总日志。
app.put('/api/devices/batch-category', requireAdminPermission('devices'), (req, res) => {
  try {
    const deviceIds = req.body?.deviceIds;
    const categoryId = String(req.body?.category || '').trim();
    if (!Array.isArray(deviceIds) || deviceIds.length < 1 || deviceIds.length > 500) {
      return res.status(400).json({ success: false, message: '单次批量分类设备数量需为 1-500 台', errors: [] });
    }
    const normalizedIds = deviceIds.map(id => String(id || '').trim());
    if (normalizedIds.some(id => !id) || new Set(normalizedIds).size !== normalizedIds.length) {
      return res.status(400).json({ success: false, message: '设备选择无效或存在重复设备', errors: [] });
    }

    const categories = readJSON(CATEGORIES_FILE);
    const targetCategory = categories.find(category => category.id === categoryId);
    if (!targetCategory) {
      return res.status(400).json({ success: false, message: '目标分类不存在', errors: [] });
    }

    const devices = readJSON(DEVICES_FILE);
    const errors = [];
    const selectedDevices = normalizedIds.map(deviceId => {
      const device = devices.find(item => item.id === deviceId);
      if (!device) {
        errors.push({ deviceId, message: '设备不存在' });
        return null;
      }
      return device;
    }).filter(Boolean);
    if (errors.length) {
      return res.status(409).json({ success: false, message: '批量分类未执行，请先处理校验失败的设备', errors });
    }

    selectedDevices.forEach(device => {
      device.category = targetCategory.id;
    });
    DATA_STORE.transaction(() => {
      writeJSON(DEVICES_FILE, devices);
      appendOperationLog(
        'devices_batch_categorized',
        { id: 'batch', name: '批量分类设备' },
        `批量分类 ${selectedDevices.length} 台设备至“${targetCategory.name}”`
      );
    });
    res.json({
      success: true,
      data: {
        count: selectedDevices.length,
        category: targetCategory,
        devices: selectedDevices.map(withDeviceCompatibility)
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: '批量分类失败: ' + e.message });
  }
});

// 添加设备
app.post('/api/devices', requireAdminPermission('devices'), upload.single('image'), validateUploadedImage, optimizeUploadedImage, (req, res) => {
  try {
    const { name, model, location, notes, category, imageDisplayHeight: rawDisplayHeight, imageDisplayPositionY: rawDisplayPositionY, imageDisplayAspectRatio: rawDisplayAspectRatio } = req.body;
    if (!name || !model) return res.json({ success: false, message: '设备名称和型号不能为空' });
    const categoryId = String(category || '').trim();
    if (!categoryId) return res.status(400).json({ success: false, message: '设备分类不能为空' });
    if (!isKnownCategoryId(categoryId)) return res.status(400).json({ success: false, message: '设备分类无效，请刷新后重试' });
    const imageDisplayHeight = normalizeImageDisplayHeight(rawDisplayHeight);
    if (imageDisplayHeight === undefined) {
      return res.status(400).json({ success: false, message: `图片展示高度需为 ${IMAGE_DISPLAY_HEIGHT_MIN}-${IMAGE_DISPLAY_HEIGHT_MAX}px 的整数` });
    }
    const imageDisplayPositionY = normalizeImageDisplayPositionY(rawDisplayPositionY);
    if (imageDisplayPositionY === undefined) {
      return res.status(400).json({ success: false, message: `图片展示位置需为 ${IMAGE_DISPLAY_POSITION_MIN}-${IMAGE_DISPLAY_POSITION_MAX}% 的整数` });
    }
    const imageDisplayAspectRatio = normalizeImageDisplayAspectRatio(rawDisplayAspectRatio);
    if (imageDisplayAspectRatio === undefined) {
      return res.status(400).json({ success: false, message: `图片展示比例需为 ${IMAGE_DISPLAY_ASPECT_RATIO_MIN}-${IMAGE_DISPLAY_ASPECT_RATIO_MAX} 之间的数字` });
    }

    const devices = readJSON(DEVICES_FILE);
    const id = generateDeviceId();

    const device = {
      id,
      name,
      model,
      location: location || '',
      notes: notes || '',
      category: categoryId,
      ...(req.optimizedImage || {
        image: null,
        imageThumb: null,
        imageWidth: null,
        imageHeight: null
      }),
      imageDisplayHeight,
      imageDisplayPositionY,
      imageDisplayAspectRatio,
      status: 'available', // available | borrowed
      operationalStatus: 'online', // online | offline
      offlineReason: '',
      createdAt: new Date().toISOString()
    };

    devices.push(device);
    DATA_STORE.transaction(() => {
      writeJSON(DEVICES_FILE, devices);
      appendOperationLog('device_created', device, `新增设备：${device.name}（${device.model}）`);
    });

    res.json({ success: true, data: device });
  } catch (e) {
    res.json({ success: false, message: '添加失败: ' + e.message });
  }
});

// 获取所有设备
app.get('/api/devices', requireAdminPermission('devices'), (req, res) => {
  try {
    const devices = readJSON(DEVICES_FILE);
    res.json({ success: true, data: devices.map(withDeviceCompatibility) });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// 统一门户只公开在线且当前空闲的设备
app.get('/api/devices/available', (req, res) => {
  try {
    const devices = readJSON(DEVICES_FILE)
      .filter(device => device.status === 'available' && getOperationalStatus(device) === 'online')
      .map(device => ({
        id: device.id,
        name: device.name,
        model: device.model,
        location: device.location || '',
        category: device.category || 'cat-other',
        notes: device.notes || '',
        ...getDeviceImageFields(device),
        status: 'available',
        operationalStatus: 'online'
      }));
    res.json({ success: true, data: devices });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 获取单个设备
app.get('/api/devices/:id', (req, res) => {
  try {
    const devices = readJSON(DEVICES_FILE);
    const device = devices.find(d => d.id === req.params.id);
    if (!device) return res.json({ success: false, message: '设备不存在' });
    res.json({ success: true, data: withDeviceCompatibility(device) });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// 获取单个设备的公开状态；借用人信息只返回脱敏字段
app.get('/api/devices/:id/status', (req, res) => {
  try {
    const devices = readJSON(DEVICES_FILE);
    const device = devices.find(d => d.id === req.params.id);
    if (!device) {
      return res.status(404).json({ success: false, message: '设备不存在' });
    }

    const records = readJSON(RECORDS_FILE);
    const activeRecord = device.status === 'borrowed'
      ? findActiveRecord(records, device.id)
      : null;

    const data = {
      id: device.id,
      name: device.name,
      model: device.model,
      location: device.location || '',
      notes: device.notes || '',
      category: device.category || 'cat-other',
      ...getDeviceImageFields(device),
      status: device.status,
      operationalStatus: getOperationalStatus(device),
      currentBorrower: toPublicBorrower(activeRecord)
    };
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 更新设备
app.put('/api/devices/:id', requireAdminPermission('devices'), upload.single('image'), validateUploadedImage, optimizeUploadedImage, (req, res) => {
  try {
    const { name, model, location, notes, category, imageDisplayHeight: rawDisplayHeight, imageDisplayPositionY: rawDisplayPositionY, imageDisplayAspectRatio: rawDisplayAspectRatio } = req.body;
    const categoryId = String(category || '').trim();
    if (!categoryId) return res.status(400).json({ success: false, message: '设备分类不能为空' });
    if (!isKnownCategoryId(categoryId)) return res.status(400).json({ success: false, message: '设备分类无效，请刷新后重试' });
    const imageDisplayHeight = normalizeImageDisplayHeight(rawDisplayHeight);
    if (rawDisplayHeight !== undefined && imageDisplayHeight === undefined) {
      return res.status(400).json({ success: false, message: `图片展示高度需为 ${IMAGE_DISPLAY_HEIGHT_MIN}-${IMAGE_DISPLAY_HEIGHT_MAX}px 的整数` });
    }
    const imageDisplayPositionY = normalizeImageDisplayPositionY(rawDisplayPositionY);
    if (rawDisplayPositionY !== undefined && imageDisplayPositionY === undefined) {
      return res.status(400).json({ success: false, message: `图片展示位置需为 ${IMAGE_DISPLAY_POSITION_MIN}-${IMAGE_DISPLAY_POSITION_MAX}% 的整数` });
    }
    const imageDisplayAspectRatio = normalizeImageDisplayAspectRatio(rawDisplayAspectRatio);
    if (rawDisplayAspectRatio !== undefined && imageDisplayAspectRatio === undefined) {
      return res.status(400).json({ success: false, message: `图片展示比例需为 ${IMAGE_DISPLAY_ASPECT_RATIO_MIN}-${IMAGE_DISPLAY_ASPECT_RATIO_MAX} 之间的数字` });
    }
    const devices = readJSON(DEVICES_FILE);
    const idx = devices.findIndex(d => d.id === req.params.id);
    if (idx === -1) return res.json({ success: false, message: '设备不存在' });

    if (name) devices[idx].name = name;
    if (model) devices[idx].model = model;
    if (location !== undefined) devices[idx].location = location;
    if (notes !== undefined) devices[idx].notes = notes;
    devices[idx].category = categoryId;
    if (rawDisplayHeight !== undefined) devices[idx].imageDisplayHeight = imageDisplayHeight;
    if (rawDisplayPositionY !== undefined) devices[idx].imageDisplayPositionY = imageDisplayPositionY;
    if (rawDisplayAspectRatio !== undefined) devices[idx].imageDisplayAspectRatio = imageDisplayAspectRatio;

    if (req.optimizedImage) Object.assign(devices[idx], req.optimizedImage);

    DATA_STORE.transaction(() => {
      writeJSON(DEVICES_FILE, devices);
      appendOperationLog('device_updated', devices[idx], `编辑设备：${devices[idx].name}（${devices[idx].model}）`);
    });
    res.json({ success: true, data: withDeviceCompatibility(devices[idx]) });
  } catch (e) {
    res.json({ success: false, message: '更新失败: ' + e.message });
  }
});

// 管理员控制设备上线/下线；借出中的设备必须先归还
app.put('/api/devices/:id/operational-status', requireAdminPermission('devices'), (req, res) => {
  try {
    const operationalStatus = String(req.body?.operationalStatus || '').trim();
    if (!['online', 'offline'].includes(operationalStatus)) {
      return res.status(400).json({ success: false, message: '设备运营状态无效' });
    }

    const devices = readJSON(DEVICES_FILE);
    const device = devices.find(item => item.id === req.params.id);
    if (!device) return res.status(404).json({ success: false, message: '设备不存在' });
    if (operationalStatus === 'offline' && device.status === 'borrowed') {
      return res.status(409).json({ success: false, message: '设备正在借用中，请归还后再下线' });
    }

    device.operationalStatus = operationalStatus;
    device.offlineReason = operationalStatus === 'offline'
      ? String(req.body?.offlineReason || '').trim()
      : '';
    DATA_STORE.transaction(() => {
      writeJSON(DEVICES_FILE, devices);
      if (operationalStatus === 'offline') {
        const reason = device.offlineReason ? `；原因：${device.offlineReason}` : '';
        appendOperationLog('device_offlined', device, `下线设备：${device.name}${reason}`);
      }
    });
    res.json({ success: true, data: withDeviceCompatibility(device) });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 删除设备
app.delete('/api/devices/:id', requireAdminPermission('devices'), (req, res) => {
  try {
    let devices = readJSON(DEVICES_FILE);
    const device = devices.find(d => d.id === req.params.id);
    // 借出中的设备连下线都不允许，删除同样必须在归还后进行。
    if (device?.status === 'borrowed') {
      return res.status(409).json({ success: false, message: '设备正在借用中，请归还后再删除' });
    }
    const records = readJSON(RECORDS_FILE);
    const relatedRecords = records.filter(record => record.deviceId === req.params.id);
    const deleteRecords = req.query.deleteRecords === 'true';
    if (relatedRecords.length > 0 && !deleteRecords) {
      return res.status(409).json({
        success: false,
        requiresRecordDeletion: true,
        recordCount: relatedRecords.length,
        message: `该设备有 ${relatedRecords.length} 条借用记录，确认后将一并删除`
      });
    }
    if (!device) return res.json({ success: false, message: '设备不存在' });

    devices = devices.filter(d => d.id !== req.params.id);
    DATA_STORE.transaction(() => {
      writeJSON(DEVICES_FILE, devices);
      if (deleteRecords) {
        writeJSON(RECORDS_FILE, records.filter(record => record.deviceId !== req.params.id));
      }
    });

    // 删除 QR 码
    const qrPath = path.join(QR_DIR, `qr_${req.params.id}.png`);
    if (fs.existsSync(qrPath)) fs.unlinkSync(qrPath);

    res.json({ success: true, message: '删除成功' });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// 生成统一门户二维码
app.post('/api/qrcode/portal', requireAdminPermission('devices'), async (req, res) => {
  try {
    const qrUrl = `${getPublicBaseUrl(req)}/borrow`;
    const qrFilename = 'qr_portal.png';
    const qrPath = path.join(QR_DIR, qrFilename);

    await QRCode.toFile(qrPath, qrUrl, {
      width: 500,
      margin: 2,
      color: { dark: '#1a1a2e', light: '#ffffff' }
    });

    res.json({ success: true, qrcode: `/qrcodes/${qrFilename}`, url: qrUrl });
  } catch (e) {
    res.status(500).json({ success: false, message: '生成失败: ' + e.message });
  }
});

// 旧单设备二维码仍可重新生成，链接会打开统一门户的同一设备详情
app.post('/api/devices/:id/qrcode', requireAdminPermission('devices'), async (req, res) => {
  try {
    const devices = readJSON(DEVICES_FILE);
    const device = devices.find(d => d.id === req.params.id);
    if (!device) return res.json({ success: false, message: '设备不存在' });

    const qrUrl = `${getPublicBaseUrl(req)}/borrow?id=${req.params.id}`;
    const qrFilename = `qr_${req.params.id}.png`;
    const qrPath = path.join(QR_DIR, qrFilename);

    await QRCode.toFile(qrPath, qrUrl, {
      width: 400,
      margin: 2,
      color: { dark: '#1e293b', light: '#ffffff' }
    });

    res.json({ success: true, qrcode: `/qrcodes/${qrFilename}` });
  } catch (e) {
    res.json({ success: false, message: '生成失败: ' + e.message });
  }
});

// ==================== 日志、统计与邮件 API（暂留入口） ====================

// 管理员操作日志按时间倒序返回，限制单次读取规模以保持管理页面稳定。
app.get('/api/operation-logs', requireAdminPermission('operation-logs'), (req, res) => {
  try {
    const logs = readJSON(OPERATION_LOGS_FILE);
    res.json({ success: true, data: logs.slice(-500).reverse() });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 管理员借用统计：概览、热门设备和按日趋势共用同一时间范围。
app.get('/api/statistics/borrowing', requireAdminPermission('statistics'), (req, res) => {
  try {
    const records = readJSON(RECORDS_FILE);
    const devices = readJSON(DEVICES_FILE);
    const data = buildBorrowingStatistics(records, devices, String(req.query.range || '30d'));
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 管理员邮件通知设置：SMTP 密码只在服务端加密保存，不回传到浏览器。
const { createOperations } = require('./backend/operations');
const operations = createOperations({ directory:DATA_DIR, send:async (recipients,subject,text) => {
  const settings=readEmailSettings(),secret=decryptEmailSecret(settings.smtp.secretEncrypted);
  if(!settings.smtp.host || !settings.smtp.username || !secret) throw new Error('请先保存SMTP发件配置');
  await sendSmtpMail({smtp:settings.smtp,secret,recipients,subject,text});
}});
const operationsTimer=setInterval(()=>void operations.check(),60000);
operationsTimer.unref();
app.get('/api/admin/operations',requireSuperAdmin,(req,res)=>{
  try {res.json({success:true,data:{settings:operations.settings(),status:operations.status()}});}
  catch {res.status(500).json({success:false,message:'无法读取运行配置'});}
});
app.put('/api/admin/operations',requireSuperAdmin,(req,res)=>{
  try { if(req.body.enabled) { const mail=readEmailSettings(); if(!mail.smtp.host || !mail.smtp.username || !decryptEmailSecret(mail.smtp.secretEncrypted)) return res.status(400).json({success:false,message:'请先在邮件通知页面保存SMTP发件配置'}); } const data=operations.save(req.body);res.json({success:true,data}); }
  catch(e){res.status(400).json({success:false,message:e.message});}
});
app.post('/api/admin/operations/check',requireSuperAdmin,async(req,res)=>{
  await operations.check();res.json({success:true,data:operations.status()});
});

app.get('/api/admin/email-settings', requireAdminPermission('email-settings'), (req, res) => {
  res.json({ success: true, data: toPublicEmailSettings(readEmailSettings()) });
});

app.put('/api/admin/email-settings', requireAdminPermission('email-settings'), (req, res) => {
  try {
    const current = readEmailSettings();
    const next = normalizeEmailSettings(req.body || {}, current);
    writeEmailSettings(next);
    res.json({ success: true, data: toPublicEmailSettings(next), message: '邮件通知设置已保存' });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

app.post('/api/admin/email-settings/test', requireAdminPermission('email-settings'), async (req, res) => {
  try {
    // 测试邮件使用当前草稿和模拟借用记录，不读取真实借用人数据或持久化草稿。
    const current = readEmailSettings();
    const draft = req.body && typeof req.body === 'object' ? req.body : {};
    const settings = normalizeEmailSettings({ ...draft, enabled: false }, current);
    const secret = decryptEmailSecret(settings.smtp.secretEncrypted);
    if (!settings.recipients.length || !settings.smtp.host || !settings.smtp.username || !secret) {
      return res.status(400).json({ success: false, message: '请先完整保存 SMTP 配置和接收邮箱' });
    }
    const eventType = EMAIL_EVENTS[draft.previewEvent] ? draft.previewEvent : 'borrow';
    const sampleRecord = {
      deviceName: '示例设备',
      deviceModel: 'DEMO-001',
      deviceId: 'DEMO-DEVICE',
      borrowerName: '示例用户',
      borrowerId: '2026000001',
      borrowerPhone: '13800138000',
      major: '示例部门',
      purpose: '模板预览',
      createdAt: new Date().toISOString(),
      returnedAt: new Date().toISOString(),
      returnNotes: '示例备注'
    };
    const values = buildEmailValues(eventType, sampleRecord, settings);
    // 测试邮件与正式单台通知共用分组明细格式，避免模板预览和真实邮件出现差异。
    values.recordList = formatEmailRecordGroup(eventType, [sampleRecord], settings);
    const template = resolveEventTemplate(settings, eventType);
    await sendSmtpMail({
      smtp: settings.smtp,
      secret,
      recipients: settings.recipients,
      subject: `【测试】${formatEmailTemplate(template.subject, values)}`,
      text: formatEmailTemplate(template.body, values)
    });
    res.json({ success: true, message: '测试邮件已发送' });
  } catch (e) {
    res.status(502).json({ success: false, message: `测试邮件发送失败：${e.message}` });
  }
});

// 借还记录域只在这里装配；业务模块不导入启动入口或创建第二个仓储/服务。
const recordService = createRecordService({
  store: DATA_STORE,
  collections: { devices: DEVICES_FILE, records: RECORDS_FILE },
  email: { queueEmailNotification, queueBatchEmailNotification },
  appendOperationLog, getDeviceImageFields, getOperationalStatus
});
app.use('/api/records', createRecordRouter({
  service: recordService, borrowReturnLimiter, requireAdminPermission,
  onBorrow: (req, ids) => { try { siteState.attach(req.siteVisitorHash, ids); } catch { console.error('访客记录关联暂时不可用，借用已完成'); } }
}));
app.get('/api/visitor/records', (req, res) => {
  const ids = new Set(siteState.records(req.siteVisitorHash));
  const records = readJSON(RECORDS_FILE).filter(record=>ids.has(record.id) && !record.deletedAt);
  res.json({success:true, data:records.map(record=>({recordId:record.id, deviceName:record.deviceName, deviceModel:record.deviceModel,
    borrowerName:maskName(record.borrowerName), borrowerPhone:maskPhone(record.borrowerPhone), createdAt:record.createdAt, returnedAt:record.returnedAt || null}))});
});

// 数量物资模块独立持久化；不改动或迁移原设备与历史借还表。
const materialsStore = createMaterialsStore({
  databasePath: path.join(DATA_DIR, 'materials.sqlite'),
  demo: process.env.MATERIALS_DEMO === 'true'
});
process.once('exit', () => materialsStore.close());
app.use('/api/v2', createMaterialsRouter({
  store: materialsStore, requireAdminPermission, upload, validateUploadedImage, optimizeUploadedImage,
  demo: process.env.MATERIALS_DEMO === 'true'
}));

// ==================== 管理后台认证 ====================
app.post('/api/admin/login', loginLimiter, async (req, res, next) => { try {
  const password = typeof req.body?.password==='string' ? req.body.password : '';
  const username = normalizeAdminUsername(req.body?.username || ADMIN_USERNAME);
  const retryAfter=siteState.loginStatus(username,req.ip);
  if(retryAfter) return res.set('Retry-After',String(retryAfter)).status(429).json({success:false,message:'登录尝试过多，请稍后重试',retryAfter});
  if(username.length>32 || Buffer.byteLength(password)>1024) return res.status(400).json({success:false,message:'账号或密码格式不正确'});
  const user = getAdminUserByUsername(username);
  const hashBeforeVerification=user?.passwordHash;
  const verified=await verifyAdminPassword(password,hashBeforeVerification || dummyPasswordHash);
  // 异步哈希期间别的请求可能刚刚触发锁定，发放会话前再次确认。
  const blocked=siteState.loginStatus(username,req.ip);
  if(blocked) return res.set('Retry-After',String(blocked)).status(429).json({success:false,message:'登录尝试过多，请稍后重试',retryAfter:blocked});
  if (user && verified && getAdminUserById(user.id)===user && user.passwordHash===hashBeforeVerification) {
    if(passwordFormat(user.passwordHash)?.legacy) {
      const upgradedHash=await hashAdminPasswordAsync(password);
      if(user.passwordHash!==hashBeforeVerification || getAdminUserById(user.id)!==user) return res.status(401).json({success:false,message:'账号或密码错误'});
      user.passwordHash=upgradedHash;
      persistAdminUsers();siteState.revokeUser(user.id);
    }
    const finalBlocked=siteState.loginStatus(username,req.ip);
    if(finalBlocked) return res.set('Retry-After',String(finalBlocked)).status(429).json({success:false,message:'登录尝试过多，请稍后重试',retryAfter:finalBlocked});
    siteState.loginSuccess(username,req.ip);
    siteState.revoke(req.adminToken);
    const sid = crypto.randomBytes(32).toString('hex');
    siteState.createSession(sid, user, SESSION_TTL_MS);
    res.cookie('ccs_admin', sid, { httpOnly:true, sameSite:'lax', secure:req.secure, path:'/', maxAge:SESSION_TTL_MS });
    res.json({ success: true, sessionId: sid, user: toPublicAdminUser(user) });
  } else {
    siteState.loginFailure(username,req.ip);
    res.status(401).json({ success: false, message: '账号或密码错误' });
  }
} catch(error) {next(error);} });

app.post('/api/admin/logout', (req, res) => {
  siteState.revoke(req.adminToken);
  res.clearCookie('ccs_admin', { httpOnly:true, sameSite:'lax', secure:req.secure, path:'/' });
  res.json({ success: true });
});

// 校验当前 session 是否仍有效（前端挂载时调用）
app.get('/api/admin/check', (req, res) => {
  const user = getSessionAdminUser(req);
  res.json({ success: true, isAdmin: Boolean(user), user: user ? toPublicAdminUser(user) : null });
});

// 管理员账号接口仅由超级管理员调用，返回数据永远不包含密码哈希。
app.get('/api/admin/users', requireSuperAdmin, (req, res) => {
  res.json({ success: true, data: ADMIN_USERS.map(toPublicAdminUser) });
});

app.post('/api/admin/users', requireSuperAdmin, async (req, res, next) => {try {
  const username = normalizeAdminUsername(req.body?.username);
  const password = typeof req.body?.password==='string' ? req.body.password : '';
  const permissions = normalizeAdminPermissions(req.body?.permissions);
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) {
    return res.status(400).json({ success: false, message: '用户名需为 3-32 位字母、数字、点、下划线或短横线' });
  }
  if (password.length < ADMIN_PASSWORD_MIN_LENGTH || Buffer.byteLength(password)>1024) {
    return res.status(400).json({ success: false, message: `密码至少需要 ${ADMIN_PASSWORD_MIN_LENGTH} 位，且不超过1024字节` });
  }
  if (getAdminUserByUsername(username)) return res.status(409).json({ success: false, message: '用户名已存在' });

  const now = new Date().toISOString();
  const user = {
    id: `admin-${crypto.randomBytes(8).toString('hex')}`,
    username,
    passwordHash: await hashAdminPasswordAsync(password),
    role: 'admin',
    permissions,
    createdAt: now,
    updatedAt: now
  };
  ADMIN_USERS.push(user);
  persistAdminUsers();
  res.status(201).json({ success: true, data: toPublicAdminUser(user), message: '管理员已创建' });
} catch(error) {next(error);} });

app.put('/api/admin/users/:id/permissions', requireSuperAdmin, (req, res) => {
  const user = getAdminUserById(req.params.id);
  if (!user) return res.status(404).json({ success: false, message: '管理员不存在' });
  if (user.role === 'super_admin') return res.status(400).json({ success: false, message: '超级管理员始终拥有全部权限' });
  user.permissions = normalizeAdminPermissions(req.body?.permissions);
  user.updatedAt = new Date().toISOString();
  persistAdminUsers();
  res.json({ success: true, data: toPublicAdminUser(user), message: '管理员权限已更新' });
});

app.delete('/api/admin/users/:id', requireSuperAdmin, (req, res) => {
  const user = getAdminUserById(req.params.id);
  if (!user) return res.status(404).json({ success: false, message: '管理员不存在' });
  if (user.role === 'super_admin') return res.status(400).json({ success: false, message: '不能删除超级管理员' });
  const index = ADMIN_USERS.findIndex(item => item.id === user.id);
  ADMIN_USERS.splice(index, 1);
  persistAdminUsers();
  siteState.revokeUser(user.id);
  res.json({ success: true, message: '管理员已删除' });
});

app.put('/api/admin/password', checkAdmin, async (req, res, next) => {try {
  const user = getSessionAdminUser(req);
  const hashBeforeVerification=user?.passwordHash;
  const retryAfter=siteState.loginStatus(user?.id || '',req.ip,'password-change');
  if(retryAfter) return res.set('Retry-After',String(retryAfter)).status(429).json({success:false,message:'原密码验证失败过多，请稍后重试',retryAfter});
  const currentPassword = typeof req.body?.currentPassword==='string' ? req.body.currentPassword : '';
  const newPassword = typeof req.body?.newPassword==='string' ? req.body.newPassword : '';
  const confirmPassword = typeof req.body?.confirmPassword==='string' ? req.body.confirmPassword : '';
  if (!user || !await verifyAdminPassword(currentPassword, hashBeforeVerification)) {
    siteState.loginFailure(user?.id || '',req.ip,'password-change');
    return res.status(400).json({ success: false, message: '原密码错误' });
  }
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ success: false, message: '两次输入的新密码不一致' });
  }
  if (newPassword.length < ADMIN_PASSWORD_MIN_LENGTH || Buffer.byteLength(newPassword)>1024) {
    return res.status(400).json({ success: false, message: `新密码至少需要 ${ADMIN_PASSWORD_MIN_LENGTH} 位` });
  }
  if (await verifyAdminPassword(newPassword, user.passwordHash)) {
    return res.status(400).json({ success: false, message: '新密码不能与原密码相同' });
  }
  const newHash=await hashAdminPasswordAsync(newPassword);
  if(user.passwordHash!==hashBeforeVerification || getAdminUserById(user.id)!==user) return res.status(409).json({success:false,message:'账号状态已变化，请重新登录'});
  user.passwordHash = newHash;
  user.updatedAt = new Date().toISOString();
  persistAdminUsers();
  siteState.loginSuccess(user.id,req.ip,'password-change');
  siteState.revokeUser(user.id);
  res.clearCookie('ccs_admin', { httpOnly:true, sameSite:'lax', secure:req.secure, path:'/' });
  res.json({ success: true, message: '密码已修改' });
} catch(error) {next(error);} });

// ==================== 前端页面 ====================
app.get(['/materials', '/materials/admin'], (req, res) => {
  res.sendFile(path.join(STATIC_DIR, 'index.html'));
});
// 借还页面（用户扫码进入）
app.get('/borrow', (req, res) => {
  res.sendFile(path.join(STATIC_DIR, 'index.html'));
});

// 归还后的答案之书彩蛋复用同一前端入口，不创建新的服务端数据接口。
app.get('/answers', (req, res) => {
  res.sendFile(path.join(STATIC_DIR, 'index.html'));
});

// 管理后台
app.get('/admin', (req, res) => {
  res.sendFile(path.join(STATIC_DIR, 'index.html'));
});

// 根路径
app.get('/', (req, res) => {
  res.redirect(process.env.MATERIALS_PORTAL === 'true' ? '/materials' : '/borrow');
});

app.use((err, req, res, next) => {
  res.set('Cache-Control','no-store');
  if (err instanceof multer.MulterError || ['INVALID_IMAGE_TYPE', 'IMAGE_PROCESSING_FAILED'].includes(err.code)) {
    // 统一上传错误提示，避免 Multer 的英文默认信息暴露给管理员。
    const message = err.code === 'LIMIT_FILE_SIZE' ? '图片不能超过 20 MB' : err.message;
    return res.status(400).json({ success: false, message });
  }
  if(err.type==='entity.parse.failed') return res.status(400).json({success:false,message:'请求内容格式错误'});
  if(err.type==='entity.too.large') return res.status(413).json({success:false,message:'请求内容过大'});
  console.error('请求处理失败',String(err.code || err.name || 'Error').slice(0,80));
  res.status(500).json({success:false,message:'服务暂时不可用，请稍后重试'});
});

// 启动服务
app.listen(PORT, process.env.HOST || (process.env.NODE_ENV === 'production' ? '127.0.0.1' : undefined), () => {
  console.log(`\n🚀 设备管理系统已启动！`);
  console.log(`\n  用户借还页面: http://localhost:${PORT}/borrow`);
  console.log(`  管理后台:     http://localhost:${PORT}/admin`);
  console.log(`  团委物资门户: http://localhost:${PORT}/materials`);
  if (!process.env.ADMIN_PASSWORD && !process.env.ADMIN_PASSWORD_HASH) {
    console.warn('\n⚠️  当前使用开发默认密码；部署前请设置 ADMIN_PASSWORD 环境变量。\n');
  }
});

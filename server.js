// 管理员分级与图片选区展示：账户持久化使用 scrypt 哈希，并兼容旧的像素高度字段。
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

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const APP_BASE_URL = String(process.env.APP_BASE_URL || '').trim().replace(/\/+$/, '');
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);
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

if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_PASSWORD) {
  throw new Error('生产环境必须设置 ADMIN_PASSWORD');
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
  bodyTemplate: [
    '设备借出通知', '',
    '事件：设备借出', '设备名称：{{deviceName}}', '设备型号：{{deviceModel}}', '设备编号：{{deviceId}}',
    '借用人：{{borrowerName}}', '联系电话：{{borrowerPhoneMasked}}', '专业/部门：{{major}}',
    '借用用途：{{purpose}}', '借用时间：{{borrowedAt}}', '操作时间：{{eventAt}}'
  ].join('\n'),
  // 三套事件各自独立的主题和正文；事件名写死，其余字段继续使用变量。
  templates: {
    borrow: {
      subject: '【设备管理】设备借出：{{deviceName}}',
      body: [
        '设备借出通知', '',
        '事件：设备借出', '设备名称：{{deviceName}}', '设备型号：{{deviceModel}}', '设备编号：{{deviceId}}',
        '借用人：{{borrowerName}}', '联系电话：{{borrowerPhoneMasked}}', '专业/部门：{{major}}',
        '借用用途：{{purpose}}', '借用时间：{{borrowedAt}}', '操作时间：{{eventAt}}'
      ].join('\n')
    },
    return: {
      subject: '【设备管理】用户归还：{{deviceName}}',
      body: [
        '用户归还通知', '',
        '事件：用户归还', '设备名称：{{deviceName}}', '设备型号：{{deviceModel}}', '设备编号：{{deviceId}}',
        '借用人：{{borrowerName}}', '联系电话：{{borrowerPhoneMasked}}', '专业/部门：{{major}}',
        '借用用途：{{purpose}}', '借用时间：{{borrowedAt}}', '归还时间：{{eventAt}}', '归还备注：{{returnNotes}}'
      ].join('\n')
    },
    adminReturn: {
      subject: '【设备管理】管理员归还：{{deviceName}}',
      body: [
        '管理员归还通知', '',
        '事件：管理员归还', '设备名称：{{deviceName}}', '设备型号：{{deviceModel}}', '设备编号：{{deviceId}}',
        '借用人：{{borrowerName}}', '联系电话：{{borrowerPhoneMasked}}', '专业/部门：{{major}}',
        '借用用途：{{purpose}}', '借用时间：{{borrowedAt}}', '归还时间：{{eventAt}}', '归还备注：{{returnNotes}}'
      ].join('\n')
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
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return []; }
}
function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// 管理员账户模型：超级管理员拥有全部功能，普通管理员使用明确的权限白名单。
const ADMIN_USERNAME = String(process.env.ADMIN_USERNAME || 'admin').trim() || 'admin';
const ADMIN_PERMISSION_KEYS = ['devices', 'records', 'categories', 'statistics', 'operation-logs', 'email-settings', 'admin-management'];
const ADMIN_PASSWORD_MIN_LENGTH = 8;

function normalizeAdminUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeAdminPermissions(value) {
  const list = Array.isArray(value) ? value : [];
  return [...new Set(list.map(item => String(item || '').trim()).filter(item => ADMIN_PERMISSION_KEYS.includes(item)))];
}

function hashAdminPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

function verifyAdminPassword(password, encodedHash) {
  const [algorithm, salt, encoded] = String(encodedHash || '').split('$');
  if (algorithm !== 'scrypt' || !salt || !encoded || !/^[a-f0-9]{128}$/i.test(encoded)) return false;
  const expected = Buffer.from(encoded, 'hex');
  const actual = crypto.scryptSync(String(password), salt, expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

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
  try { fs.chmodSync(ADMIN_USERS_FILE, 0o600); } catch { /* Windows and restricted filesystems may reject chmod. */ }
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
      passwordHash: hashAdminPassword(PASSWORD),
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
  'major', 'purpose', 'borrowedAt', 'eventAt', 'returnNotes'
]);
const EMAIL_ADDRESS_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cloneEmailSettings(settings = DEFAULT_EMAIL_SETTINGS) {
  return JSON.parse(JSON.stringify(settings));
}

function readEmailSettings() {
  const stored = readJSON(EMAIL_SETTINGS_FILE);
  const source = stored && !Array.isArray(stored) ? stored : {};
  const defaults = cloneEmailSettings();
  const storedTemplates = source.templates && !Array.isArray(source.templates) ? source.templates : {};
  return {
    ...defaults,
    ...source,
    smtp: { ...defaults.smtp, ...(source.smtp || {}) },
    recipients: Array.isArray(source.recipients) ? source.recipients : defaults.recipients,
    // 事件级合并默认模板，旧部署缺少 templates 或只存部分事件时不会丢默认值。
    templates: {
      borrow: { ...defaults.templates?.borrow, ...(storedTemplates.borrow || {}) },
      return: { ...defaults.templates?.return, ...(storedTemplates.return || {}) },
      adminReturn: { ...defaults.templates?.adminReturn, ...(storedTemplates.adminReturn || {}) }
    }
  };
}

function writeEmailSettings(settings) {
  writeJSON(EMAIL_SETTINGS_FILE, settings);
  try { fs.chmodSync(EMAIL_SETTINGS_FILE, 0o600); } catch { /* Windows 和部分挂载目录不支持 chmod。 */ }
}

function getEmailConfigKey() {
  const raw = String(process.env.EMAIL_CONFIG_KEY || '').trim();
  if (!raw) return null;
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  try {
    const key = Buffer.from(raw, 'base64');
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
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
    deviceName: String(record.deviceName || '未知设备'),
    deviceModel: String(record.deviceModel || ''),
    deviceId: String(record.deviceId || ''),
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
    returnNotes: String(record.returnNotes || '')
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
  const template = resolveEventTemplate(settings, eventType);
  const subject = formatEmailTemplate(template.subject, values);
  const text = formatEmailTemplate(template.body, values);
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

function getRecordMajor(record) {
  return String(record?.major ?? record?.department ?? '').trim();
}

function getRecordPurpose(record) {
  return String(record?.purpose ?? record?.notes ?? '').trim();
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

function withRecordCompatibility(record) {
  return {
    ...record,
    major: getRecordMajor(record),
    purpose: getRecordPurpose(record)
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
    const current = deviceUsage.get(record.deviceId) || {
      deviceId: record.deviceId,
      deviceName: record.deviceName || '未知设备',
      deviceModel: record.deviceModel || '',
      borrowCount: 0
    };
    current.borrowCount += 1;
    deviceUsage.set(record.deviceId, current);

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

  const usedDeviceCount = deviceUsage.size;
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

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function isFullPhone(phone) {
  return /^1\d{10}$/.test(normalizePhone(phone));
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

const RETURN_TOKEN_TTL_MS = 10 * 60 * 1000;
const returnAuthorizations = new Map();

function createReturnAuthorization(recordIds) {
  const token = crypto.randomBytes(24).toString('hex');
  returnAuthorizations.set(token, {
    recordIds: [...recordIds],
    expiresAt: Date.now() + RETURN_TOKEN_TTL_MS
  });
  return token;
}

function getReturnAuthorization(token) {
  const authorization = returnAuthorizations.get(String(token || ''));
  if (!authorization) return null;
  if (authorization.expiresAt <= Date.now()) {
    returnAuthorizations.delete(String(token || ''));
    return null;
  }
  return authorization;
}

// ==================== 管理后台权限验证中间件 ====================
function checkAdmin(req, res, next) {
  if (req.session?.isAdmin && req.session.adminUserId) return next();
  res.status(401).json({ success: false, message: '未登录管理后台' });
}

function requireAdminPermission(permission) {
  return (req, res, next) => {
    if (!req.session?.isAdmin || !req.session.adminUserId) {
      return res.status(401).json({ success: false, message: '未登录管理后台' });
    }
    const user = getAdminUserById(req.session.adminUserId);
    if (!user) return res.status(401).json({ success: false, message: '管理员账号不存在或已失效' });
    if (user.role === 'super_admin' || normalizeAdminPermissions(user.permissions).includes(permission)) return next();
    return res.status(403).json({ success: false, message: '当前管理员没有此功能权限' });
  };
}

function requireSuperAdmin(req, res, next) {
  if (!req.session?.isAdmin || !req.session.adminUserId) {
    return res.status(401).json({ success: false, message: '未登录管理后台' });
  }
  const user = getAdminUserById(req.session.adminUserId);
  if (user?.role === 'super_admin') return next();
  return res.status(403).json({ success: false, message: '仅超级管理员可以管理管理员账号' });
}

function getSessionAdminUser(req) {
  return req.session?.adminUserId ? getAdminUserById(req.session.adminUserId) : null;
}

// ==================== session 简易实现 ====================
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const sessions = new Map();
app.use((req, res, next) => {
  const sid = req.headers['x-session-id'];
  const session = sid ? sessions.get(sid) : null;
  if (session && session.expiresAt > Date.now()) {
    req.session = session;
  } else {
    if (sid) sessions.delete(sid);
    req.session = {};
  }
  next();
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
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
    writeJSON(CATEGORIES_FILE, categories);

    // 将该分类下的设备迁移到 cat-other
    const devices = readJSON(DEVICES_FILE);
    let changed = false;
    devices.forEach(d => {
      if (d.category === req.params.id) {
        d.category = 'cat-other';
        changed = true;
      }
    });
    if (changed) writeJSON(DEVICES_FILE, devices);

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
    writeJSON(DEVICES_FILE, devices.concat(importedDevices));
    appendOperationLog(
      'devices_batch_imported',
      { id: 'batch', name: '批量导入设备' },
      `批量导入 ${importedDevices.length} 台设备`
    );
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
    writeJSON(DEVICES_FILE, devices);
    const isOffline = operationalStatus === 'offline';
    appendOperationLog(
      isOffline ? 'devices_batch_offlined' : 'devices_batch_onlined',
      { id: 'batch', name: isOffline ? '批量下线设备' : '批量上线设备' },
      `批量${isOffline ? '下线' : '上线'} ${selectedDevices.length} 台设备${isOffline && offlineReason ? `；原因：${offlineReason}` : ''}`
    );
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
    writeJSON(DEVICES_FILE, devices);
    appendOperationLog(
      'devices_batch_categorized',
      { id: 'batch', name: '批量分类设备' },
      `批量分类 ${selectedDevices.length} 台设备至“${targetCategory.name}”`
    );
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
    writeJSON(DEVICES_FILE, devices);
    appendOperationLog('device_created', device, `新增设备：${device.name}（${device.model}）`);

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

    writeJSON(DEVICES_FILE, devices);
    appendOperationLog('device_updated', devices[idx], `编辑设备：${devices[idx].name}（${devices[idx].model}）`);
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
    writeJSON(DEVICES_FILE, devices);
    if (operationalStatus === 'offline') {
      const reason = device.offlineReason ? `；原因：${device.offlineReason}` : '';
      appendOperationLog('device_offlined', device, `下线设备：${device.name}${reason}`);
    }
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
    writeJSON(DEVICES_FILE, devices);
    if (deleteRecords) {
      writeJSON(RECORDS_FILE, records.filter(record => record.deviceId !== req.params.id));
    }

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

// ==================== 借还记录 API ====================

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

// 借用设备
app.post('/api/records/borrow', borrowReturnLimiter, (req, res) => {
  try {
    const deviceId = String(req.body?.deviceId || '').trim();
    const borrowerName = String(req.body?.borrowerName || '').trim();
    const borrowerId = String(req.body?.borrowerId || '').trim();
    const borrowerPhone = normalizePhone(req.body?.borrowerPhone);
    const major = String(req.body?.major ?? req.body?.department ?? '').trim();
    const purpose = String(req.body?.purpose ?? req.body?.notes ?? '').trim();
    if (!deviceId || !borrowerName || !borrowerPhone || !major || !purpose) {
      return res.status(400).json({ success: false, message: '姓名、完整手机号、专业和用途均为必填项' });
    }
    if (!isFullPhone(borrowerPhone)) {
      return res.status(400).json({ success: false, message: '请输入 11 位完整手机号' });
    }

    const devices = readJSON(DEVICES_FILE);
    const device = devices.find(d => d.id === deviceId);
    if (!device) return res.status(404).json({ success: false, message: '设备不存在' });
    if (getOperationalStatus(device) === 'offline') {
      return res.status(409).json({ success: false, message: '该设备当前已下线，无法借用' });
    }
    if (device.status === 'borrowed') {
      return res.status(409).json({ success: false, message: '该设备已被借用，请先归还' });
    }

    device.status = 'borrowed';
    writeJSON(DEVICES_FILE, devices);

    const records = readJSON(RECORDS_FILE);
    const record = {
      id: 'REC' + Date.now().toString(36).toUpperCase(),
      deviceId,
      deviceName: device.name,
      deviceModel: device.model,
      type: 'borrow',
      borrowerName,
      borrowerId,
      borrowerPhone,
      major,
      purpose,
      // 保留旧字段，便于旧部署脚本和历史前端平滑读取。
      department: major,
      notes: purpose,
      createdAt: new Date().toISOString()
    };
    records.push(record);
    writeJSON(RECORDS_FILE, records);

    queueEmailNotification('borrow', record);
    res.json({ success: true, message: '借用成功', data: record });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// 使用姓名和完整手机号查询本人当前待归还设备，并签发短期归还凭证
app.post('/api/records/return-lookup', borrowReturnLimiter, (req, res) => {
  try {
    const borrowerName = String(req.body?.borrowerName || '').trim();
    const borrowerPhone = normalizePhone(req.body?.borrowerPhone);
    if (!borrowerName || !isFullPhone(borrowerPhone)) {
      return res.status(400).json({ success: false, message: '请输入姓名和 11 位完整手机号' });
    }

    const devices = readJSON(DEVICES_FILE);
    const records = readJSON(RECORDS_FILE);
    const matchedRecords = records.filter(record =>
      record.type === 'borrow'
      && !record.returnedAt
      && !record.deletedAt
      && String(record.borrowerName || '').trim() === borrowerName
      && normalizePhone(record.borrowerPhone) === borrowerPhone
    );

    const publicRecords = matchedRecords
      .map(record => {
        const device = devices.find(item => item.id === record.deviceId);
        if (!device || device.status !== 'borrowed') return null;
        return {
          recordId: record.id,
          deviceId: device.id,
          deviceName: device.name,
          deviceModel: device.model,
          ...getDeviceImageFields(device),
          location: device.location || '',
          borrowedAt: record.createdAt
        };
      })
      .filter(Boolean);

    const returnToken = publicRecords.length
      ? createReturnAuthorization(publicRecords.map(record => record.recordId))
      : null;
    res.json({ success: true, data: { records: publicRecords, returnToken } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 使用查询阶段签发的短期凭证归还设备
app.post('/api/records/return', borrowReturnLimiter, (req, res) => {
  try {
    const recordId = String(req.body?.recordId || '').trim();
    const returnToken = String(req.body?.returnToken || '').trim();
    const authorization = getReturnAuthorization(returnToken);
    if (!recordId || !authorization || !authorization.recordIds.includes(recordId)) {
      return res.status(403).json({ success: false, message: '归还验证已失效，请重新查询' });
    }

    const records = readJSON(RECORDS_FILE);
    const activeRecord = records.find(record =>
      record.id === recordId && record.type === 'borrow' && !record.returnedAt && !record.deletedAt
    );
    if (!activeRecord) {
      return res.status(409).json({ success: false, message: '未找到当前借用记录' });
    }

    const devices = readJSON(DEVICES_FILE);
    const device = devices.find(item => item.id === activeRecord.deviceId);
    if (!device) return res.status(404).json({ success: false, message: '设备不存在' });
    if (device.status === 'available') {
      return res.status(409).json({ success: false, message: '该设备当前未借出' });
    }

    device.status = 'available';
    writeJSON(DEVICES_FILE, devices);

    activeRecord.returnedAt = new Date().toISOString();
    activeRecord.returnNotes = String(req.body?.notes || '').trim();
    writeJSON(RECORDS_FILE, records);

    authorization.recordIds = authorization.recordIds.filter(id => id !== recordId);
    if (!authorization.recordIds.length) returnAuthorizations.delete(returnToken);

    queueEmailNotification('return', activeRecord);
    res.json({ success: true, message: '归还成功' });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// 获取所有记录（含联系人隐私信息，仅管理员）
app.get('/api/records', requireAdminPermission('records'), (req, res) => {
  try {
    const records = readJSON(RECORDS_FILE);
    const includeDeleted = req.query.includeDeleted === 'true';
    const visibleRecords = includeDeleted
      ? records
      : records.filter(record => !record.deletedAt);
    res.json({ success: true, data: [...visibleRecords].reverse().map(withRecordCompatibility) });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// 获取当前借出中的记录
app.get('/api/records/active', requireAdminPermission('records'), (req, res) => {
  try {
    const records = readJSON(RECORDS_FILE);
    const active = records
      .filter(r => r.type === 'borrow' && !r.returnedAt && !r.deletedAt)
      .reverse()
      .map(withRecordCompatibility);
    res.json({ success: true, data: active });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// 归档已归还记录（软删除）
// 管理员修改当前借用信息
app.put('/api/records/:id', requireAdminPermission('records'), (req, res) => {
  try {
    const records = readJSON(RECORDS_FILE);
    const record = records.find(item => item.id === req.params.id);
    if (!record) return res.status(404).json({ success: false, message: '记录不存在' });
    if (record.deletedAt) return res.status(409).json({ success: false, message: '已归档记录不能直接修改' });

    const borrowerName = String(req.body?.borrowerName || '').trim();
    const borrowerId = String(req.body?.borrowerId || '').trim();
    const borrowerPhone = normalizePhone(req.body?.borrowerPhone);
    const major = String(req.body?.major ?? req.body?.department ?? '').trim();
    const purpose = String(req.body?.purpose ?? req.body?.notes ?? '').trim();
    if (!String(borrowerName || '').trim() || !String(borrowerPhone || '').trim()) {
      return res.status(400).json({ success: false, message: '姓名和联系电话不能为空' });
    }
    if (!isFullPhone(borrowerPhone)) {
      return res.status(400).json({ success: false, message: '请输入 11 位完整手机号' });
    }
    if (!major || !purpose) {
      return res.status(400).json({ success: false, message: '专业和用途不能为空' });
    }

    record.borrowerName = borrowerName;
    record.borrowerId = borrowerId;
    record.borrowerPhone = borrowerPhone;
    record.major = major;
    record.purpose = purpose;
    record.department = major;
    record.notes = purpose;
    writeJSON(RECORDS_FILE, records);
    res.json({ success: true, data: withRecordCompatibility(record), message: '借用信息已更新' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 管理员强制归还当前借用记录
app.post('/api/records/:id/force-return', requireAdminPermission('records'), (req, res) => {
  try {
    const records = readJSON(RECORDS_FILE);
    const record = records.find(item => item.id === req.params.id);
    if (!record) return res.status(404).json({ success: false, message: '记录不存在' });
    if (record.returnedAt) return res.status(409).json({ success: false, message: '该记录已经归还' });

    const devices = readJSON(DEVICES_FILE);
    const device = devices.find(item => item.id === record.deviceId);
    if (!device) return res.status(404).json({ success: false, message: '设备不存在' });

    record.returnedAt = new Date().toISOString();
    record.returnNotes = String(req.body?.notes || '管理员确认归还').trim();
    device.status = 'available';
    writeJSON(DEVICES_FILE, devices);
    writeJSON(RECORDS_FILE, records);
    appendOperationLog('admin_returned', device, `管理员归还设备：${device.name}（${device.model}）`);
    queueEmailNotification('adminReturn', record);
    res.json({ success: true, data: record, message: '设备已由管理员归还' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.delete('/api/records/:id', requireAdminPermission('records'), (req, res) => {
  try {
    const records = readJSON(RECORDS_FILE);
    const record = records.find(item => item.id === req.params.id);
    if (!record) {
      return res.status(404).json({ success: false, message: '记录不存在' });
    }
    if (!record.returnedAt) {
      return res.status(409).json({ success: false, message: '当前借用记录不能删除' });
    }

    if (!record.deletedAt) {
      record.deletedAt = new Date().toISOString();
      record.deletedBy = 'admin';
      writeJSON(RECORDS_FILE, records);
    }

    res.json({ success: true, message: '记录已归档' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 恢复已归档记录
app.post('/api/records/:id/restore', requireAdminPermission('records'), (req, res) => {
  try {
    const records = readJSON(RECORDS_FILE);
    const record = records.find(item => item.id === req.params.id);
    if (!record) {
      return res.status(404).json({ success: false, message: '记录不存在' });
    }

    delete record.deletedAt;
    delete record.deletedBy;
    writeJSON(RECORDS_FILE, records);
    res.json({ success: true, message: '记录已恢复' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 永久删除必须先归档，降低误删风险
app.delete('/api/records/:id/permanent', requireAdminPermission('records'), (req, res) => {
  try {
    const records = readJSON(RECORDS_FILE);
    const record = records.find(item => item.id === req.params.id);
    if (!record) {
      return res.status(404).json({ success: false, message: '记录不存在' });
    }
    if (!record.deletedAt) {
      return res.status(409).json({ success: false, message: '请先归档该记录' });
    }

    writeJSON(RECORDS_FILE, records.filter(item => item.id !== req.params.id));
    res.json({ success: true, message: '记录已永久删除' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ==================== 管理后台认证 ====================
app.post('/api/admin/login', loginLimiter, (req, res) => {
  const password = String(req.body?.password || '');
  const username = normalizeAdminUsername(req.body?.username || ADMIN_USERNAME);
  const user = getAdminUserByUsername(username);
  if (user && verifyAdminPassword(password, user.passwordHash)) {
    const sid = crypto.randomBytes(16).toString('hex');
    sessions.set(sid, {
      isAdmin: true,
      adminUserId: user.id,
      loginAt: new Date().toISOString(),
      expiresAt: Date.now() + SESSION_TTL_MS
    });
    res.json({ success: true, sessionId: sid, user: toPublicAdminUser(user) });
  } else {
    res.json({ success: false, message: '密码错误' });
  }
});

app.post('/api/admin/logout', (req, res) => {
  const sid = req.headers['x-session-id'];
  if (sid) sessions.delete(sid);
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

app.post('/api/admin/users', requireSuperAdmin, (req, res) => {
  const username = normalizeAdminUsername(req.body?.username);
  const password = String(req.body?.password || '');
  const permissions = normalizeAdminPermissions(req.body?.permissions);
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) {
    return res.status(400).json({ success: false, message: '用户名需为 3-32 位字母、数字、点、下划线或短横线' });
  }
  if (password.length < ADMIN_PASSWORD_MIN_LENGTH) {
    return res.status(400).json({ success: false, message: `密码至少需要 ${ADMIN_PASSWORD_MIN_LENGTH} 位` });
  }
  if (getAdminUserByUsername(username)) return res.status(409).json({ success: false, message: '用户名已存在' });

  const now = new Date().toISOString();
  const user = {
    id: `admin-${crypto.randomBytes(8).toString('hex')}`,
    username,
    passwordHash: hashAdminPassword(password),
    role: 'admin',
    permissions,
    createdAt: now,
    updatedAt: now
  };
  ADMIN_USERS.push(user);
  persistAdminUsers();
  res.status(201).json({ success: true, data: toPublicAdminUser(user), message: '管理员已创建' });
});

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
  for (const [sid, session] of sessions.entries()) {
    if (session.adminUserId === user.id) sessions.delete(sid);
  }
  res.json({ success: true, message: '管理员已删除' });
});

app.put('/api/admin/password', checkAdmin, (req, res) => {
  const user = getSessionAdminUser(req);
  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  const confirmPassword = String(req.body?.confirmPassword || '');
  if (!user || !verifyAdminPassword(currentPassword, user.passwordHash)) {
    return res.status(400).json({ success: false, message: '原密码错误' });
  }
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ success: false, message: '两次输入的新密码不一致' });
  }
  if (newPassword.length < ADMIN_PASSWORD_MIN_LENGTH) {
    return res.status(400).json({ success: false, message: `新密码至少需要 ${ADMIN_PASSWORD_MIN_LENGTH} 位` });
  }
  if (verifyAdminPassword(newPassword, user.passwordHash)) {
    return res.status(400).json({ success: false, message: '新密码不能与原密码相同' });
  }
  user.passwordHash = hashAdminPassword(newPassword);
  user.updatedAt = new Date().toISOString();
  persistAdminUsers();
  res.json({ success: true, message: '密码已修改' });
});

// ==================== 前端页面 ====================
// 借还页面（用户扫码进入）
app.get('/borrow', (req, res) => {
  res.sendFile(path.join(STATIC_DIR, 'index.html'));
});

// 管理后台
app.get('/admin', (req, res) => {
  res.sendFile(path.join(STATIC_DIR, 'index.html'));
});

// 根路径
app.get('/', (req, res) => {
  res.redirect('/borrow');
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || ['INVALID_IMAGE_TYPE', 'IMAGE_PROCESSING_FAILED'].includes(err.code)) {
    // 统一上传错误提示，避免 Multer 的英文默认信息暴露给管理员。
    const message = err.code === 'LIMIT_FILE_SIZE' ? '图片不能超过 20 MB' : err.message;
    return res.status(400).json({ success: false, message });
  }
  next(err);
});

// 启动服务
app.listen(PORT, () => {
  console.log(`\n🚀 设备管理系统已启动！`);
  console.log(`\n  用户借还页面: http://localhost:${PORT}/borrow`);
  console.log(`  管理后台:     http://localhost:${PORT}/admin`);
  if (!process.env.ADMIN_PASSWORD) {
    console.warn('\n⚠️  当前使用开发默认密码；部署前请设置 ADMIN_PASSWORD 环境变量。\n');
  }
});

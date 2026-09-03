// 将现有 JSON 持久化数据一次性导入 SQLite，默认不覆盖已有数据库文件。
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SCHEMA_FILE = path.join(PROJECT_ROOT, 'db', 'schema.sql');
const DEFAULT_DATA_DIR = path.join(PROJECT_ROOT, 'data');
const DEFAULT_OUTPUT = path.join(DEFAULT_DATA_DIR, 'device-management.sqlite');
const JSON_FILES = ['devices.json', 'records.json', 'categories.json', 'operation-logs.json', 'admin-users.json', 'email-settings.json'];

function parseArgs(argv) {
  const options = { dataDir: DEFAULT_DATA_DIR, output: DEFAULT_OUTPUT };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--data-dir') options.dataDir = path.resolve(argv[++index] || '');
    else if (argv[index] === '--output') options.output = path.resolve(argv[++index] || '');
    else if (argv[index] === '--help') options.help = true;
    else throw new Error(`Unknown option: ${argv[index]}`);
  }
  return options;
}

function readJson(dataDir, name, fallback) {
  const filePath = path.join(dataDir, name);
  if (!fs.existsSync(filePath)) return fallback;
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return value;
}

function asText(value, fallback = '') {
  return value === undefined || value === null ? fallback : String(value);
}

function asNullableText(value) {
  return value === undefined || value === null || value === '' ? null : String(value);
}

function asNullableInteger(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function asNullableReal(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function asJson(value, fallback) {
  return JSON.stringify(value === undefined || value === null ? fallback : value);
}

function bool(value) {
  return value ? 1 : 0;
}

function migrate({ dataDir, output }) {
  if (fs.existsSync(output)) throw new Error(`Target SQLite database already exists: ${output}`);
  if (!fs.existsSync(dataDir)) throw new Error(`Data directory does not exist: ${dataDir}`);
  fs.mkdirSync(path.dirname(output), { recursive: true });

  const categories = readJson(dataDir, 'categories.json', []);
  const devices = readJson(dataDir, 'devices.json', []);
  const records = readJson(dataDir, 'records.json', []);
  const operationLogs = readJson(dataDir, 'operation-logs.json', []);
  const adminUsers = readJson(dataDir, 'admin-users.json', []);
  const emailSettings = readJson(dataDir, 'email-settings.json', {});
  if (![categories, devices, records, operationLogs, adminUsers].every(Array.isArray)) {
    throw new Error('Expected category, device, record, log, and admin-user JSON files to contain arrays');
  }
  if (!emailSettings || Array.isArray(emailSettings) || typeof emailSettings !== 'object') {
    throw new Error('Expected email-settings.json to contain an object');
  }

  let db;
  let closed = false;
  try {
    db = new DatabaseSync(output);
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec(fs.readFileSync(SCHEMA_FILE, 'utf8'));
    const insertCategory = db.prepare('INSERT INTO categories (id, name, icon, sort_order) VALUES (?, ?, ?, ?)');
    const insertDevice = db.prepare(`INSERT INTO devices (
      id, name, model, location, notes, category_id, image, image_thumb, image_width, image_height,
      image_display_height, image_display_position_y, image_display_aspect_ratio, status,
      operational_status, offline_reason, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertRecord = db.prepare(`INSERT INTO records (
      id, device_id, device_name, device_model, is_other_device, other_device_name, type,
      borrower_name, borrower_id, borrower_phone, major, purpose, department, notes,
      created_at, returned_at, return_notes, deleted_at, deleted_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertLog = db.prepare(`INSERT INTO operation_logs
      (id, action, target_type, target_id, target_name, summary, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const insertAdmin = db.prepare(`INSERT INTO admin_users
      (id, username, password_hash, role, permissions_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const insertEmail = db.prepare(`INSERT INTO email_settings
      (id, enabled, mask_sensitive_data, notify_borrow, notify_return, notify_admin_return,
       recipients_json, smtp_json, secret_encrypted, subject_template, body_template, templates_json)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

    db.exec('BEGIN IMMEDIATE');
    try {
      for (const category of categories) {
        insertCategory.run(asText(category.id), asText(category.name), asText(category.icon, 'other'), Number(category.sortOrder) || 0);
      }
      for (const device of devices) {
        insertDevice.run(
          asText(device.id), asText(device.name), asText(device.model), asText(device.location), asText(device.notes),
          asText(device.category, 'cat-other'), asNullableText(device.image), asNullableText(device.imageThumb),
          asNullableInteger(device.imageWidth), asNullableInteger(device.imageHeight), asNullableInteger(device.imageDisplayHeight),
          asNullableInteger(device.imageDisplayPositionY), asNullableReal(device.imageDisplayAspectRatio), asText(device.status, 'available'),
          asText(device.operationalStatus, 'online'), asText(device.offlineReason), asText(device.createdAt)
        );
      }
      for (const record of records) {
        insertRecord.run(
          asText(record.id), asNullableText(record.deviceId), asText(record.deviceName), asText(record.deviceModel), bool(record.isOtherDevice),
          asText(record.otherDeviceName), asText(record.type, 'borrow'), asText(record.borrowerName), asText(record.borrowerId),
          asText(record.borrowerPhone), asText(record.major || record.department), asText(record.purpose || record.notes),
          asText(record.department || record.major), asText(record.notes || record.purpose), asText(record.createdAt),
          asNullableText(record.returnedAt), asText(record.returnNotes), asNullableText(record.deletedAt), asNullableText(record.deletedBy)
        );
      }
      for (const log of operationLogs) {
        insertLog.run(asText(log.id), asText(log.action), asText(log.targetType, 'device'), asText(log.targetId), asText(log.targetName), asText(log.summary), asText(log.createdAt));
      }
      for (const user of adminUsers) {
        insertAdmin.run(asText(user.id), asText(user.username), asText(user.passwordHash), asText(user.role, 'admin'), asJson(user.permissions, []), asText(user.createdAt), asText(user.updatedAt));
      }
      const smtp = { ...(emailSettings.smtp || {}) };
      const secretEncrypted = asText(smtp.secretEncrypted);
      delete smtp.secretEncrypted;
      insertEmail.run(
        bool(emailSettings.enabled), emailSettings.maskSensitiveData === undefined ? 1 : bool(emailSettings.maskSensitiveData),
        emailSettings.notifyBorrow === undefined ? 1 : bool(emailSettings.notifyBorrow),
        bool(emailSettings.notifyReturn), bool(emailSettings.notifyAdminReturn), asJson(emailSettings.recipients, []),
        asJson(smtp, {}), secretEncrypted, asText(emailSettings.subjectTemplate), asText(emailSettings.bodyTemplate), asJson(emailSettings.templates, {})
      );
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } catch (error) {
    // 目标库由本次迁移创建；失败后移除它，避免下次迁移被半成品文件阻塞。
    if (db) {
      db.close();
      closed = true;
    }
    fs.rmSync(output, { force: true });
    for (const suffix of ['-wal', '-shm']) fs.rmSync(`${output}${suffix}`, { force: true });
    throw error;
  } finally {
    if (db && !closed) db.close();
  }

  return { output, counts: { categories: categories.length, devices: devices.length, records: records.length, operationLogs: operationLogs.length, adminUsers: adminUsers.length, emailSettings: 1 } };
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log('Usage: node scripts/migrate-json-to-sqlite.js [--data-dir DIR] [--output FILE]');
      process.exit(0);
    }
    const result = migrate(options);
    console.log(`Migration completed: ${result.output}`);
    console.log(result.counts);
  } catch (error) {
    console.error(`Migration failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { migrate, parseArgs };

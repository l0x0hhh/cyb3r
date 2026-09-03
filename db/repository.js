// SQLite 运行时适配层：保持现有对象字段名，统一将业务数据读写到关系数据库。
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { migrate } = require('../scripts/migrate-json-to-sqlite');

function parseJson(value, fallback) {
  try {
    return value === null || value === undefined ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function nullableText(value) {
  return value === null || value === undefined || value === '' ? null : String(value);
}

function text(value, fallback = '') {
  return value === null || value === undefined ? fallback : String(value);
}

function numberOrNull(value) {
  return value === null || value === undefined ? null : Number(value);
}

function categoryFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    sortOrder: row.sort_order
  };
}

function deviceFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    model: row.model,
    location: row.location,
    notes: row.notes,
    category: row.category_id,
    image: row.image,
    imageThumb: row.image_thumb,
    imageWidth: row.image_width,
    imageHeight: row.image_height,
    imageDisplayHeight: row.image_display_height,
    imageDisplayPositionY: row.image_display_position_y,
    imageDisplayAspectRatio: row.image_display_aspect_ratio,
    status: row.status,
    operationalStatus: row.operational_status,
    offlineReason: row.offline_reason,
    createdAt: row.created_at
  };
}

function recordFromRow(row) {
  return {
    id: row.id,
    deviceId: row.device_id,
    deviceName: row.device_name,
    deviceModel: row.device_model,
    isOtherDevice: Boolean(row.is_other_device),
    otherDeviceName: row.other_device_name,
    type: row.type,
    borrowerName: row.borrower_name,
    borrowerId: row.borrower_id,
    borrowerPhone: row.borrower_phone,
    major: row.major,
    purpose: row.purpose,
    department: row.department,
    notes: row.notes,
    createdAt: row.created_at,
    returnedAt: row.returned_at,
    returnNotes: row.return_notes,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by
  };
}

function logFromRow(row) {
  return {
    id: row.id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    targetName: row.target_name,
    summary: row.summary,
    createdAt: row.created_at
  };
}

function adminFromRow(row) {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    role: row.role,
    permissions: parseJson(row.permissions_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function emailFromRow(row) {
  const smtp = parseJson(row.smtp_json, {});
  smtp.secretEncrypted = text(row.secret_encrypted);
  return {
    enabled: Boolean(row.enabled),
    maskSensitiveData: Boolean(row.mask_sensitive_data),
    notifyBorrow: Boolean(row.notify_borrow),
    notifyReturn: Boolean(row.notify_return),
    notifyAdminReturn: Boolean(row.notify_admin_return),
    recipients: parseJson(row.recipients_json, []),
    smtp,
    subjectTemplate: row.subject_template,
    bodyTemplate: row.body_template,
    templates: parseJson(row.templates_json, {})
  };
}

function createSqliteStore({ dataDir, databasePath = path.join(dataDir, 'device-management.sqlite') }) {
  if (!fs.existsSync(databasePath)) {
    migrate({ dataDir, output: databasePath });
  }

  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');

  const tableByFile = new Map([
    ['categories.json', 'categories'],
    ['devices.json', 'devices'],
    ['records.json', 'records'],
    ['operation-logs.json', 'operation_logs'],
    ['admin-users.json', 'admin_users'],
    ['email-settings.json', 'email_settings']
  ]);

  function tableFor(filePath) {
    const table = tableByFile.get(path.basename(filePath));
    if (!table) throw new Error(`Unsupported SQLite data file: ${filePath}`);
    return table;
  }

  function readCollection(filePath) {
    const table = tableFor(filePath);
    if (table === 'email_settings') {
      const row = db.prepare('SELECT * FROM email_settings WHERE id = 1').get();
      return row ? emailFromRow(row) : {};
    }
    const rows = db.prepare(`SELECT * FROM ${table}`).all();
    if (table === 'categories') return rows.map(categoryFromRow);
    if (table === 'devices') return rows.map(deviceFromRow);
    if (table === 'records') return rows.map(recordFromRow);
    if (table === 'operation_logs') return rows.map(logFromRow);
    return rows.map(adminFromRow);
  }

  function replaceCategories(categories) {
    const existing = db.prepare('SELECT id FROM categories').all();
    const nextIds = new Set(categories.map(item => text(item.id)));
    for (const row of existing) {
      if (!nextIds.has(row.id)) {
        if (!nextIds.has('cat-other')) {
          throw new Error('删除分类前必须保留「其他」分类');
        }
        db.prepare("UPDATE devices SET category_id = 'cat-other' WHERE category_id = ?").run(row.id);
      }
    }
    const upsert = db.prepare(`INSERT INTO categories (id, name, icon, sort_order)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, icon = excluded.icon, sort_order = excluded.sort_order`);
    for (const category of categories) {
      upsert.run(text(category.id), text(category.name), text(category.icon, 'other'), Number(category.sortOrder) || 0);
    }
    const remove = db.prepare('DELETE FROM categories WHERE id = ?');
    for (const row of existing) if (!nextIds.has(row.id)) remove.run(row.id);
  }

  function replaceDevices(devices) {
    db.exec('DELETE FROM devices');
    const insert = db.prepare(`INSERT INTO devices (
      id, name, model, location, notes, category_id, image, image_thumb, image_width, image_height,
      image_display_height, image_display_position_y, image_display_aspect_ratio, status,
      operational_status, offline_reason, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const device of devices) {
      insert.run(
        text(device.id), text(device.name), text(device.model), text(device.location), text(device.notes),
        text(device.category, 'cat-other'), nullableText(device.image), nullableText(device.imageThumb),
        numberOrNull(device.imageWidth), numberOrNull(device.imageHeight), numberOrNull(device.imageDisplayHeight),
        numberOrNull(device.imageDisplayPositionY), numberOrNull(device.imageDisplayAspectRatio), text(device.status, 'available'),
        text(device.operationalStatus, 'online'), text(device.offlineReason), text(device.createdAt)
      );
    }
  }

  function replaceRecords(records) {
    db.exec('DELETE FROM records');
    const insert = db.prepare(`INSERT INTO records (
      id, device_id, device_name, device_model, is_other_device, other_device_name, type,
      borrower_name, borrower_id, borrower_phone, major, purpose, department, notes,
      created_at, returned_at, return_notes, deleted_at, deleted_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const record of records) {
      insert.run(
        text(record.id), nullableText(record.deviceId), text(record.deviceName), text(record.deviceModel), record.isOtherDevice ? 1 : 0,
        text(record.otherDeviceName), text(record.type, 'borrow'), text(record.borrowerName), text(record.borrowerId),
        text(record.borrowerPhone), text(record.major), text(record.purpose), text(record.department), text(record.notes),
        text(record.createdAt), nullableText(record.returnedAt), text(record.returnNotes), nullableText(record.deletedAt), nullableText(record.deletedBy)
      );
    }
  }

  function replaceLogs(logs) {
    db.exec('DELETE FROM operation_logs');
    const insert = db.prepare(`INSERT INTO operation_logs
      (id, action, target_type, target_id, target_name, summary, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const log of logs) {
      insert.run(text(log.id), text(log.action), text(log.targetType, 'device'), text(log.targetId), text(log.targetName), text(log.summary), text(log.createdAt));
    }
  }

  function replaceAdmins(users) {
    db.exec('DELETE FROM admin_users');
    const insert = db.prepare(`INSERT INTO admin_users
      (id, username, password_hash, role, permissions_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const user of users) {
      insert.run(text(user.id), text(user.username), text(user.passwordHash), text(user.role, 'admin'), JSON.stringify(user.permissions || []), text(user.createdAt), text(user.updatedAt));
    }
  }

  function replaceEmail(settings) {
    const smtp = { ...(settings.smtp || {}) };
    const secretEncrypted = text(smtp.secretEncrypted);
    delete smtp.secretEncrypted;
    db.prepare(`INSERT OR REPLACE INTO email_settings (
      id, enabled, mask_sensitive_data, notify_borrow, notify_return, notify_admin_return,
      recipients_json, smtp_json, secret_encrypted, subject_template, body_template, templates_json
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      settings.enabled ? 1 : 0, settings.maskSensitiveData !== false ? 1 : 0, settings.notifyBorrow ? 1 : 0,
      settings.notifyReturn ? 1 : 0, settings.notifyAdminReturn ? 1 : 0, JSON.stringify(settings.recipients || []),
      JSON.stringify(smtp), secretEncrypted, text(settings.subjectTemplate), text(settings.bodyTemplate), JSON.stringify(settings.templates || {})
    );
  }

  function writeCollection(filePath, value) {
    const table = tableFor(filePath);
    const write = () => {
      if (table === 'categories') replaceCategories(value);
      else if (table === 'devices') replaceDevices(value);
      else if (table === 'records') replaceRecords(value);
      else if (table === 'operation_logs') replaceLogs(value);
      else if (table === 'admin_users') replaceAdmins(value);
      else replaceEmail(value);
    };
    if (transactionDepth > 0) {
      write();
      return;
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      write();
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  let transactionDepth = 0;
  function transaction(callback) {
    if (transactionDepth > 0) return callback();
    db.exec('BEGIN IMMEDIATE');
    transactionDepth += 1;
    try {
      const result = callback();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    } finally {
      transactionDepth -= 1;
    }
  }

  let closed = false;
  return {
    databasePath,
    readCollection,
    writeCollection,
    transaction,
    close: () => {
      if (closed) return;
      closed = true;
      db.close();
    }
  };
}

module.exports = { createSqliteStore };

// SQLite 迁移契约：旧 JSON 数据必须完整导入新库，且默认拒绝覆盖已有数据库。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { createSqliteStore } = require('../db/repository');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'migrate-json-to-sqlite.js');
const TEMP_ROOT = process.env.TEST_TEMP_ROOT || os.tmpdir();

function writeJson(directory, name, value) {
  fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2));
}

async function waitForRuntimeServer(child, baseUrl) {
  const deadline = Date.now() + 8000;
  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited before startup:\n${output}`);
    try {
      const response = await fetch(`${baseUrl}/api/devices/available`);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`server did not start in time:\n${output}`);
}

async function stopRuntimeServer(child) {
  if (child.exitCode !== null) return;
  child.kill();
  await new Promise(resolve => child.once('exit', resolve));
}

test('JSON migration creates a relational SQLite snapshot without overwriting an existing database', () => {
  const dataDir = fs.mkdtempSync(path.join(TEMP_ROOT, 'device-management-db-test-'));
  const output = path.join(dataDir, 'device-management.sqlite');
  try {
    writeJson(dataDir, 'devices.json', [{
      id: 'DEV_DB_1', name: '示例相机', model: 'DB-1', location: '器材室', notes: '',
      image: '/uploads/example.webp', imageThumb: '/uploads/example-thumb.webp', imageWidth: 1280,
      imageHeight: 720, status: 'available', operationalStatus: 'online', offlineReason: '',
      createdAt: '2026-09-03T10:00:00.000Z', category: 'cat-camera', imageDisplayHeight: 320,
      imageDisplayPositionY: 50, imageDisplayAspectRatio: 1.7778
    }]);
    writeJson(dataDir, 'records.json', [{
      id: 'REC_DB_1', deviceId: null, deviceName: '临时录音设备', deviceModel: '', isOtherDevice: true,
      otherDeviceName: '临时录音设备', type: 'borrow', borrowerName: '示例用户', borrowerId: '',
      borrowerPhone: '13800000000', major: '网络安全', purpose: '模板测试', department: '网络安全',
      notes: '模板测试', createdAt: '2026-09-03T10:01:00.000Z', returnedAt: null,
      returnNotes: '', deletedAt: null, deletedBy: null
    }, {
      id: 'REC_DB_OLD', deviceId: 'DEV_DELETED', deviceName: '已删除设备', deviceModel: 'OLD-1', type: 'borrow',
      borrowerName: '历史用户', borrowerId: '', borrowerPhone: '13900000000', major: '网络安全', purpose: '历史记录',
      department: '网络安全', notes: '历史记录', createdAt: '2026-08-01T10:01:00.000Z', returnedAt: '2026-08-01T11:01:00.000Z',
      returnNotes: '已归还', deletedAt: null, deletedBy: null
    }]);
    writeJson(dataDir, 'categories.json', [{ id: 'cat-camera', name: '相机', icon: 'camera', sortOrder: 1 }]);
    writeJson(dataDir, 'operation-logs.json', [{
      id: 'LOG_DB_1', action: 'device_created', targetType: 'device', targetId: 'DEV_DB_1',
      targetName: '示例相机', summary: '新增设备', createdAt: '2026-09-03T10:00:01.000Z'
    }]);
    writeJson(dataDir, 'admin-users.json', [{
      id: 'admin-db', username: 'operator', passwordHash: 'scrypt$test', role: 'admin',
      permissions: ['devices', 'records'], createdAt: '2026-09-03T10:00:02.000Z', updatedAt: '2026-09-03T10:00:02.000Z'
    }]);
    writeJson(dataDir, 'email-settings.json', {
      enabled: true, maskSensitiveData: true, notifyBorrow: true, notifyReturn: false,
      notifyAdminReturn: false, recipients: ['admin@example.com'],
      smtp: { host: 'smtp.example.com', port: 465, security: 'ssl', username: 'sender@example.com', secretEncrypted: 'encrypted' },
      subjectTemplate: '主题', bodyTemplate: '正文', templates: { borrow: { subject: '主题', body: '正文' } }
    });

    const result = spawnSync(process.execPath, [SCRIPT, '--data-dir', dataDir, '--output', output], {
      cwd: PROJECT_ROOT,
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Migration completed/);
    assert.ok(fs.existsSync(output));

    const db = new DatabaseSync(output);
    try {
      for (const table of ['categories', 'devices', 'operation_logs', 'admin_users', 'email_settings']) {
        assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 1, table);
      }
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM records').get().count, 2, 'records');
      assert.deepEqual({ ...db.prepare('SELECT device_id, is_other_device, other_device_name FROM records').get() }, {
        device_id: null,
        is_other_device: 1,
        other_device_name: '临时录音设备'
      });
      assert.deepEqual(JSON.parse(db.prepare('SELECT permissions_json FROM admin_users').get().permissions_json), ['devices', 'records']);
    assert.equal(db.prepare('SELECT secret_encrypted FROM email_settings WHERE id = 1').get().secret_encrypted, 'encrypted');
      assert.equal(db.prepare('SELECT mask_sensitive_data FROM email_settings WHERE id = 1').get().mask_sensitive_data, 1);
      assert.equal(db.prepare('SELECT device_id FROM records WHERE id = ?').get('REC_DB_OLD').device_id, 'DEV_DELETED');
      assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
    } finally {
      db.close();
    }

    const second = spawnSync(process.execPath, [SCRIPT, '--data-dir', dataDir, '--output', output], {
      cwd: PROJECT_ROOT,
      encoding: 'utf8'
    });
    assert.notEqual(second.status, 0);
    assert.match(second.stderr, /already exists|已存在/i);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('server runtime imports JSON once and then uses SQLite as the source of truth', async t => {
  // 运行时切换契约：首次启动迁移 JSON，之后重启只认 SQLite，不再从 JSON 回读。
  const dataDir = fs.mkdtempSync(path.join(TEMP_ROOT, 'device-management-runtime-test-'));
  const uploadDir = path.join(dataDir, 'uploads');
  const qrDir = path.join(dataDir, 'qrcodes');
  const dbPath = path.join(dataDir, 'device-management.sqlite');
  const port = 3101;
  const baseUrl = `http://127.0.0.1:${port}`;
  fs.mkdirSync(uploadDir, { recursive: true });
  fs.mkdirSync(qrDir, { recursive: true });
  writeJson(dataDir, 'devices.json', [{
    id: 'DEV_RUNTIME_1', name: '运行时相机', model: 'RUNTIME-1', location: '器材室', notes: '',
    image: null, status: 'available', operationalStatus: 'online', createdAt: '2026-09-03T10:00:00.000Z', category: 'cat-camera'
  }]);
  writeJson(dataDir, 'records.json', []);
  writeJson(dataDir, 'categories.json', [{ id: 'cat-camera', name: '相机', icon: 'camera', sortOrder: 1 }]);
  writeJson(dataDir, 'operation-logs.json', []);
  writeJson(dataDir, 'admin-users.json', []);
  writeJson(dataDir, 'email-settings.json', {});

  const start = () => spawn(process.execPath, ['server.js'], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      UPLOAD_DIR: uploadDir,
      QR_DIR: qrDir,
      ADMIN_PASSWORD: 'runtime-secret',
      EMAIL_CONFIG_KEY: 'b'.repeat(64)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const request = async (url, options = {}) => {
    const response = await fetch(`${baseUrl}${url}`, options);
    const body = await response.json();
    return { response, body };
  };

  let child = start();
  t.after(async () => {
    await stopRuntimeServer(child);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  await waitForRuntimeServer(child, baseUrl);
  assert.ok(fs.existsSync(dbPath));

  let result = await request('/api/records/borrow-other', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      otherDeviceName: '运行时未录入设备', borrowerName: '运行时用户', borrowerPhone: '13500001234',
      major: '网络安全', purpose: '运行时验证'
    })
  });
  assert.equal(result.response.status, 200);

  let db = new DatabaseSync(dbPath);
  try {
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM records').get().count, 1);
  } finally {
    db.close();
  }

  await stopRuntimeServer(child);
  writeJson(dataDir, 'devices.json', [{
    id: 'DEV_JSON_ONLY', name: '不应重新导入', model: 'JSON-ONLY', location: '', notes: '',
    image: null, status: 'available', operationalStatus: 'online', createdAt: '2026-09-03T10:02:00.000Z', category: 'cat-camera'
  }]);
  child = start();
  await waitForRuntimeServer(child, baseUrl);
  result = await request('/api/devices/available');
  assert.equal(result.response.status, 200);
  assert.ok(result.body.data.some(device => device.id === 'DEV_RUNTIME_1'));
  assert.equal(result.body.data.some(device => device.id === 'DEV_JSON_ONLY'), false);
});

test('SQLite store rolls back a multi-table transaction as one unit', () => {
  // 事务契约：设备和借还记录必须一起提交，任一写入失败时全部恢复。
  const dataDir = fs.mkdtempSync(path.join(TEMP_ROOT, 'device-management-transaction-test-'));
  try {
    writeJson(dataDir, 'devices.json', [{
      id: 'DEV_TX_1', name: '事务设备', model: 'TX-1', category: 'cat-camera', status: 'available',
      operationalStatus: 'online', createdAt: '2026-09-03T10:00:00.000Z'
    }]);
    writeJson(dataDir, 'records.json', []);
    writeJson(dataDir, 'categories.json', [{ id: 'cat-camera', name: '相机', icon: 'camera', sortOrder: 1 }]);
    writeJson(dataDir, 'operation-logs.json', []);
    writeJson(dataDir, 'admin-users.json', []);
    writeJson(dataDir, 'email-settings.json', {});

    const store = createSqliteStore({ dataDir });
    try {
      const originalDevices = store.readCollection(path.join(dataDir, 'devices.json'));
      assert.throws(() => store.transaction(() => {
        store.writeCollection(path.join(dataDir, 'devices.json'), [{ ...originalDevices[0], status: 'borrowed' }]);
        store.writeCollection(path.join(dataDir, 'records.json'), [{ id: 'REC_TX_1' }, { id: 'REC_TX_1' }]);
      }), /NOT NULL|constraint/i);
      assert.deepEqual(store.readCollection(path.join(dataDir, 'devices.json')), originalDevices);
      assert.deepEqual(store.readCollection(path.join(dataDir, 'records.json')), []);
    } finally {
      store.close();
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

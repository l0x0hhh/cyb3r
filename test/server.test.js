// 服务端契约测试覆盖图片展示、管理员配置和邮件隐私边界。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const sharp = require('sharp');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.TEST_PORT) || 3000;
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function waitForServer(child) {
  const deadline = Date.now() + 8000;
  let output = '';

  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server exited before startup:\n${output}`);
    }

    try {
      const response = await fetch(`${BASE_URL}/api/devices/available`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  throw new Error(`server did not start in time:\n${output}`);
}

async function request(url, options = {}) {
  const response = await fetch(`${BASE_URL}${url}`, options);
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  return { response, body };
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  await new Promise(resolve => {
    child.once('exit', resolve);
    child.kill();
  });
}

function readSqliteRows(dataDir, table) {
  const db = new DatabaseSync(path.join(dataDir, 'device-management.sqlite'));
  try {
    return db.prepare(`SELECT * FROM ${table}`).all();
  } finally {
    db.close();
  }
}

test('privacy and administrator record-management contract', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'device-management-test-'));
  const uploadDir = path.join(dataDir, 'uploads');
  const qrDir = path.join(dataDir, 'qrcodes');
  fs.mkdirSync(uploadDir, { recursive: true });
  fs.mkdirSync(qrDir, { recursive: true });
  const devices = [
    {
      id: 'DEV_BORROWED',
      name: '单反相机',
      model: 'Canon EOS 5D Mark IV',
      location: '实验楼 301',
      notes: '含敏感设备备注',
      image: null,
      status: 'borrowed',
      createdAt: '2026-07-20T10:00:00.000Z'
    },
    {
      id: 'DEV_AVAILABLE',
      name: '三脚架',
      model: 'T-100',
      location: '器材室',
      notes: '',
      image: null,
      status: 'available',
      createdAt: '2026-07-20T10:00:00.000Z'
    },
    {
      id: 'DEV_OFFLINE',
      name: '维修中的补光灯',
      model: 'LED-200',
      location: '器材室',
      notes: '',
      image: null,
      status: 'available',
      operationalStatus: 'offline',
      offlineReason: '电源故障维修中',
      createdAt: '2026-07-20T10:00:00.000Z'
    },
    {
      id: 'DEV_STATUS',
      name: '状态测试设备',
      model: 'STATUS-1',
      location: '器材室',
      notes: '',
      image: null,
      status: 'available',
      operationalStatus: 'online',
      createdAt: '2026-07-20T10:00:00.000Z'
    }
  ];
  const records = [
    {
      id: 'REC_ACTIVE',
      deviceId: 'DEV_BORROWED',
      deviceName: '单反相机',
      deviceModel: 'Canon EOS 5D Mark IV',
      type: 'borrow',
      borrowerName: '张三丰',
      borrowerId: '2024010001',
      borrowerPhone: '13800138000',
      department: '计算机学院',
      notes: '课程拍摄',
      createdAt: '2026-07-21T01:30:00.000Z'
    },
    {
      id: 'REC_RETURNED',
      deviceId: 'DEV_AVAILABLE',
      deviceName: '三脚架',
      deviceModel: 'T-100',
      type: 'borrow',
      borrowerName: '李四',
      borrowerId: '2024010002',
      borrowerPhone: '13900139000',
      department: '计算机学院',
      notes: '活动使用',
      createdAt: '2026-07-19T01:30:00.000Z',
      returnedAt: '2026-07-19T04:30:00.000Z'
    }
  ];

  fs.writeFileSync(path.join(dataDir, 'devices.json'), JSON.stringify(devices, null, 2));
  fs.writeFileSync(path.join(dataDir, 'records.json'), JSON.stringify(records, null, 2));
  // 用现网曾保存的简略模板启动，验证服务升级时会自动补全邮件正文。
  fs.writeFileSync(path.join(dataDir, 'email-settings.json'), JSON.stringify({
    enabled: false,
    recipients: [],
    smtp: { host: '', port: 465, security: 'ssl', username: '', secretEncrypted: '' },
    subjectTemplate: '【设备管理】设备借出：{{deviceName}}',
    bodyTemplate: '设备借出通知\n\n{{recordList}}',
    templates: {
      borrow: { subject: '【设备管理】设备借出：{{deviceName}}', body: '设备借出通知\n\n{{recordList}}' },
      return: { subject: '【设备管理】用户归还：{{deviceName}}', body: '用户归还通知\n\n{{recordList}}' },
      adminReturn: { subject: '【设备管理】管理员归还：{{deviceName}}', body: '管理员归还通知\n\n{{recordList}}' }
    }
  }, null, 2));

  const child = spawn(process.execPath, ['server.js'], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR: dataDir,
      UPLOAD_DIR: uploadDir,
      QR_DIR: qrDir,
      ADMIN_PASSWORD: 'test-secret',
      EMAIL_CONFIG_KEY: 'a'.repeat(64)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  t.after(async () => {
    await stopServer(child);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  await waitForServer(child);

  await t.test('public device status exposes only masked current-borrower details', async () => {
    const { response, body } = await request('/api/devices/DEV_BORROWED/status');

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.deepEqual(body.data.currentBorrower, {
      name: '张*丰',
      major: '计算机学院',
      phone: '138****',
      borrowedAt: '2026-07-21T01:30:00.000Z'
    });
    assert.equal('borrowerId' in body.data.currentBorrower, false);
    assert.equal('notes' in body.data.currentBorrower, false);
  });

  await t.test('public users cannot enumerate complete active records', async () => {
    const { response, body } = await request('/api/records/active');

    assert.equal(response.status, 401);
    assert.equal(body.success, false);
  });

  // 借用统计包含完整历史记录，但只能由管理员读取。
  await t.test('public users cannot read borrowing statistics', async () => {
    const { response, body } = await request('/api/statistics/borrowing?range=all');

    assert.equal(response.status, 401);
    assert.equal(body.success, false);
  });

  // 操作日志包含管理动作元数据，只允许已登录管理员读取。
  await t.test('public users cannot read administrator operation logs', async () => {
    const { response, body } = await request('/api/operation-logs');

    assert.equal(response.status, 401);
    assert.equal(body.success, false);
  });

  // 批量导入属于管理员写操作，未登录请求不得读取或修改设备数据。
  await t.test('public users cannot batch import devices', async () => {
    const { response, body } = await request('/api/devices/batch-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ devices: [] })
    });
    assert.equal(response.status, 401);
    assert.equal(body.success, false);
  });

  await t.test('root URL redirects users to the unified borrowing portal', async () => {
    const { response } = await request('/', { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/borrow');
  });

  // 答案之书页面由同一前端入口提供，支持通知栏点击后的直接访问。
  await t.test('answers book route serves the frontend entry', async () => {
    const { response, body } = await request('/answers');
    assert.equal(response.status, 200);
    assert.match(body, /<div id="app"><\/div>/);
  });

  await t.test('public available-device list contains only online and returned equipment', async () => {
    const { response, body } = await request('/api/devices/available');
    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.deepEqual(body.data.map(device => device.id).sort(), ['DEV_AVAILABLE', 'DEV_STATUS']);
    assert.equal(body.data.some(device => device.id === 'DEV_BORROWED'), false);
    assert.equal(body.data.some(device => device.id === 'DEV_OFFLINE'), false);
  });

  let sessionId;
  await t.test('administrator password comes from the environment', async () => {
    const { response, body } = await request('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'test-secret' })
    });

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.ok(body.sessionId);
    sessionId = body.sessionId;
  });

  // 管理员分级契约：旧环境账号首次登录后必须迁移为超级管理员，并返回可用于前端授权的身份信息。
  await t.test('current environment account migrates to the super administrator', async () => {
    const { response, body } = await request('/api/admin/check', {
      headers: { 'x-session-id': sessionId }
    });

    assert.equal(response.status, 200);
    assert.equal(body.isAdmin, true);
    assert.equal(body.user.username, 'admin');
    assert.equal(body.user.role, 'super_admin');
    assert.ok(Array.isArray(body.user.permissions));
  });

  await t.test('super administrator can create and authorize an administrator', async () => {
    const created = await request('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
      body: JSON.stringify({
        username: 'operator-one',
        password: 'operator-secret',
        permissions: ['statistics']
      })
    });

    assert.equal(created.response.status, 201);
    assert.equal(created.body.success, true);
    assert.equal(created.body.data.username, 'operator-one');
    assert.equal(created.body.data.role, 'admin');
    assert.deepEqual(created.body.data.permissions, ['statistics']);
    assert.equal('passwordHash' in created.body.data, false);
  });

  await t.test('ordinary administrator is limited to granted features', async () => {
    const login = await request('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'operator-one', password: 'operator-secret' })
    });
    assert.equal(login.response.status, 200);
    const operatorSessionId = login.body.sessionId;

    const allowed = await request('/api/statistics/borrowing?range=7d', {
      headers: { 'x-session-id': operatorSessionId }
    });
    assert.equal(allowed.response.status, 200);

    const denied = await request('/api/devices', {
      headers: { 'x-session-id': operatorSessionId }
    });
    assert.equal(denied.response.status, 403);
    assert.equal(denied.body.success, false);
  });

  await t.test('ordinary administrator cannot manage administrators', async () => {
    const login = await request('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'operator-one', password: 'operator-secret' })
    });
    const users = await request('/api/admin/users', {
      headers: { 'x-session-id': login.body.sessionId }
    });
    assert.equal(users.response.status, 403);
  });

  await t.test('administrator can change password only with the current password and matching confirmation', async () => {
    const result = await request('/api/admin/password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
      body: JSON.stringify({
        currentPassword: 'test-secret',
        newPassword: 'new-test-secret',
        confirmPassword: 'new-test-secret'
      })
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.success, true);

    const mismatch = await request('/api/admin/password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
      body: JSON.stringify({
        currentPassword: 'new-test-secret',
        newPassword: 'another-secret',
        confirmPassword: 'different-secret'
      })
    });
    assert.equal(mismatch.response.status, 400);
  });

  await t.test('administrator can read complete active records', async () => {
    const { response, body } = await request('/api/records/active', {
      headers: { 'x-session-id': sessionId }
    });

    assert.equal(response.status, 200);
    assert.equal(body.data[0].borrowerName, '张三丰');
    assert.equal(body.data[0].borrowerPhone, '13800138000');
    assert.equal(body.data[0].borrowerId, '2024010001');
    assert.equal(body.data[0].major, '计算机学院');
  });

  // 旧版内置简略模板读取后应直接显示完整的事件、明细、时间和备注结构。
  await t.test('saved built-in short email templates are upgraded on read', async () => {
    const { response, body } = await request('/api/admin/email-settings', {
      headers: { 'x-session-id': sessionId }
    });

    assert.equal(response.status, 200);
    assert.equal(body.data.templates.borrow.body, [
      '设备借出通知', '', '事件：设备借出', '{{deviceNotice}}', '', '借用明细：', '{{recordList}}', '', '操作时间：{{eventAt}}'
    ].join('\n'));
    assert.equal(body.data.templates.return.body, [
      '用户归还通知', '', '事件：用户归还', '{{deviceNotice}}', '', '归还明细：', '{{recordList}}', '', '归还时间：{{eventAt}}', '归还备注：{{returnNotes}}'
    ].join('\n'));
    assert.equal(body.data.templates.adminReturn.body, [
      '管理员归还通知', '', '事件：管理员归还', '{{deviceNotice}}', '', '归还明细：', '{{recordList}}', '', '归还时间：{{eventAt}}', '归还备注：{{returnNotes}}'
    ].join('\n'));
    assert.equal(body.data.bodyTemplate, body.data.templates.borrow.body);
  });

  await t.test('email settings require administrator access and never expose the SMTP secret', async () => {
    let result = await request('/api/admin/email-settings');
    assert.equal(result.response.status, 401);

    result = await request('/api/admin/email-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
      body: JSON.stringify({
        enabled: false,
        notifyBorrow: true,
        notifyReturn: false,
        notifyAdminReturn: false,
        recipients: ['admin@example.com'],
        smtp: {
          host: 'smtp.example.com',
          port: 465,
          security: 'ssl',
          username: 'sender@example.com',
          secret: 'unit-test-secret'
        },
        subjectTemplate: '【设备管理】{{eventLabel}}：{{deviceName}}',
        bodyTemplate: '设备：{{deviceName}}\n联系电话：{{borrowerPhoneMasked}}'
      })
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.success, true);
    assert.equal(result.body.data.smtp.secretConfigured, true);
    assert.equal('secret' in result.body.data.smtp, false);
    assert.equal('secretEncrypted' in result.body.data.smtp, false);

    const storedSettings = readSqliteRows(dataDir, 'email_settings')[0];
    assert.ok(storedSettings);
    assert.doesNotMatch(JSON.stringify(storedSettings), /unit-test-secret/);
    assert.ok(storedSettings.secret_encrypted);

    result = await request('/api/admin/email-settings', { headers: { 'x-session-id': sessionId } });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.data.smtp.username, 'sender@example.com');
    assert.equal(result.body.data.smtp.secretConfigured, true);
    assert.equal(result.body.data.maskSensitiveData, true);
  });

  // 管理员可以关闭邮件脱敏，但显式脱敏变量始终保持脱敏结果。
  await t.test('email settings support configurable personal-data masking', async () => {
    const result = await request('/api/admin/email-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
      body: JSON.stringify({
        maskSensitiveData: false
      })
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.data.maskSensitiveData, false);
  });

  await t.test('email settings reject unsupported template variables', async () => {
    const result = await request('/api/admin/email-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
      body: JSON.stringify({
        enabled: false,
        recipients: [],
        smtp: { host: '', port: 465, security: 'ssl', username: '', secret: '' },
        subjectTemplate: '{{notAllowed}}',
        bodyTemplate: '通知'
      })
    });
    assert.equal(result.response.status, 400);
    assert.match(result.body.message, /不支持的变量/);
  });

  // 部分更新邮件配置时，未提交的模板字段应继续沿用已保存模板。
  await t.test('email settings preserve templates when omitted from a partial update', async () => {
    const result = await request('/api/admin/email-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
      body: JSON.stringify({
        enabled: false,
        notifyBorrow: false,
        recipients: ['admin@example.com'],
        smtp: { host: 'smtp.example.com', port: 465, security: 'ssl', username: 'sender@example.com', secret: '' }
      })
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.data.notifyBorrow, false);
    assert.equal(result.body.data.subjectTemplate, '【设备管理】{{eventLabel}}：{{deviceName}}');
    assert.equal(result.body.data.bodyTemplate, '设备：{{deviceName}}\n联系电话：{{borrowerPhoneMasked}}');
  });

  // 服务端重新校验全部行；任一行错误时整批不写入。
  await t.test('batch import rejects invalid rows atomically', async () => {
    const before = readSqliteRows(dataDir, 'devices');
    const { response, body } = await request('/api/devices/batch-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
      body: JSON.stringify({
        devices: [
          { name: '有效设备', model: 'VALID-1', categoryName: '其他', location: '', notes: '' },
          { name: '', model: 'INVALID-1', categoryName: '不存在分类', location: '', notes: '' }
        ]
      })
    });
    const after = readSqliteRows(dataDir, 'devices');
    assert.equal(response.status, 400);
    assert.equal(body.success, false);
    assert.ok(Array.isArray(body.errors));
    assert.deepEqual(after, before);
  });

  // 有效行按分类名称映射，允许重名并只追加一条批次日志。
  await t.test('administrator batch imports devices with defaults and one summary log', async () => {
    const { response, body } = await request('/api/devices/batch-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
      body: JSON.stringify({
        devices: [
          { name: '批量相机', model: 'BATCH-1', categoryName: '其他', location: '器材室', notes: '第一台' },
          { name: '批量相机', model: 'BATCH-1', categoryName: '其他', location: '', notes: '' }
        ]
      })
    });
    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.count, 2);
    assert.equal(body.data.devices.every(device => device.category === 'cat-other'), true);
    assert.equal(body.data.devices.every(device => device.status === 'available'), true);
    assert.equal(body.data.devices.every(device => device.operationalStatus === 'online'), true);
    assert.equal(body.data.devices.every(device => device.image === null), true);

    const logs = readSqliteRows(dataDir, 'operation_logs');
    assert.equal(logs.length, 1);
    assert.equal(logs[0].action, 'devices_batch_imported');
    assert.match(logs[0].summary, /批量导入 2 台设备/);
  });

  // 统计接口按借用记录聚合概览、热门设备和每日趋势，归档不影响历史计数。
  await t.test('administrator can read aggregated borrowing statistics', async () => {
    const { response, body } = await request('/api/statistics/borrowing?range=all', {
      headers: { 'x-session-id': sessionId }
    });

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.range, 'all');
    assert.deepEqual(body.data.summary, {
      borrowCount: 2,
      returnedCount: 1,
      activeCount: 1,
      usedDeviceCount: 2,
      deviceCount: 6,
      utilizationRate: 33
    });
    assert.deepEqual(body.data.trend, [
      { date: '2026-07-19', borrowCount: 1 },
      { date: '2026-07-21', borrowCount: 1 }
    ]);
    assert.equal(body.data.popularDevices.length, 2);
    assert.deepEqual(
      body.data.popularDevices.map(item => item.deviceId).sort(),
      ['DEV_AVAILABLE', 'DEV_BORROWED']
    );
    assert.equal(body.data.popularDevices.every(item => item.borrowCount === 1), true);
  });

  // 四类成功管理动作写入脱敏日志，失败动作不会追加日志。
  await t.test('administrator actions persist sanitized operation logs', async () => {
    const createForm = new FormData();
    createForm.append('name', '日志测试设备');
    createForm.append('model', 'LOG-1');
    createForm.append('category', 'cat-other');
    let result = await request('/api/devices', {
      method: 'POST',
      headers: { 'x-session-id': sessionId },
      body: createForm
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.success, true);
    const deviceId = result.body.data.id;

    const editForm = new FormData();
    editForm.append('name', '日志测试设备（已编辑）');
    editForm.append('model', 'LOG-2');
    editForm.append('category', 'cat-other');
    result = await request('/api/devices/' + deviceId, {
      method: 'PUT',
      headers: { 'x-session-id': sessionId },
      body: editForm
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.success, true);

    result = await request('/api/devices/' + deviceId + '/operational-status', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
      body: JSON.stringify({ operationalStatus: 'offline', offlineReason: '例行检修' })
    });
    assert.equal(result.response.status, 200);

    result = await request('/api/devices/' + deviceId + '/operational-status', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
      body: JSON.stringify({ operationalStatus: 'online' })
    });
    assert.equal(result.response.status, 200);

    result = await request('/api/records/borrow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId,
        borrowerName: '日志隐私用户',
        borrowerPhone: '13500003333',
        major: '日志测试专业',
        purpose: '日志测试用途'
      })
    });
    assert.equal(result.response.status, 200);
    const recordId = result.body.data.id;

    result = await request('/api/records/' + recordId + '/force-return', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
      body: JSON.stringify({ notes: '管理员确认归还' })
    });
    assert.equal(result.response.status, 200);

    result = await request('/api/operation-logs', {
      headers: { 'x-session-id': sessionId }
    });
    assert.equal(result.response.status, 200);
    const deviceActionLogs = result.body.data.filter(log => log.action !== 'devices_batch_imported');
    assert.deepEqual(deviceActionLogs.map(log => log.action), [
      'admin_returned',
      'device_offlined',
      'device_updated',
      'device_created'
    ]);
    assert.equal(deviceActionLogs.every(log => log.targetId === deviceId), true);
    assert.equal(JSON.stringify(result.body.data).includes('13500003333'), false);
    assert.equal(JSON.stringify(result.body.data).includes('日志隐私用户'), false);

    result = await request('/api/records/' + recordId + '/force-return', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
      body: JSON.stringify({ notes: '重复归还' })
    });
    assert.equal(result.response.status, 409);

    result = await request('/api/operation-logs', {
      headers: { 'x-session-id': sessionId }
    });
    assert.equal(result.body.data.length, 5);
  });

  await t.test('administrator can generate the one unified portal QR code', async () => {
    const { response, body } = await request('/api/qrcode/portal', {
      method: 'POST',
      headers: { 'x-session-id': sessionId }
    });
    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.qrcode, '/qrcodes/qr_portal.png');
    assert.equal(fs.existsSync(path.join(qrDir, 'qr_portal.png')), true);
  });

  await t.test('administrator can generate a printable QR code for an individual device', async () => {
    const { response, body } = await request('/api/devices/DEV_STATUS/qrcode', {
      method: 'POST',
      headers: { 'x-session-id': sessionId }
    });
    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.qrcode, '/qrcodes/qr_DEV_STATUS.png');
    assert.equal(fs.existsSync(path.join(qrDir, 'qr_DEV_STATUS.png')), true);
  });

  await t.test('borrowed equipment cannot be taken offline and offline equipment cannot be borrowed', async () => {
    let result = await request('/api/devices/DEV_BORROWED/operational-status', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
      body: JSON.stringify({ operationalStatus: 'offline', offlineReason: '送修' })
    });
    assert.equal(result.response.status, 409);

    result = await request('/api/devices/DEV_STATUS/operational-status', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
      body: JSON.stringify({ operationalStatus: 'offline', offlineReason: '线路检修' })
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.data.operationalStatus, 'offline');

    result = await request('/api/records/borrow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: 'DEV_STATUS',
        borrowerName: '测试用户',
        borrowerPhone: '13700001111',
        major: '摄影专业',
        purpose: '课程拍摄'
      })
    });
    assert.equal(result.response.status, 409);

    result = await request('/api/devices/DEV_STATUS/operational-status', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
      body: JSON.stringify({ operationalStatus: 'online' })
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.data.operationalStatus, 'online');
  });

  await t.test('borrowing requires a full phone number, major, and purpose', async () => {
    const { response, body } = await request('/api/records/borrow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: 'DEV_STATUS',
        borrowerName: '测试用户',
        borrowerPhone: '13700001111',
        major: '',
        purpose: ''
      })
    });
    assert.equal(response.status, 400);
    assert.equal(body.success, false);
  });

  await t.test('administrator can edit and force-return an active borrowing record', async () => {
    let result = await request('/api/records/borrow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: 'DEV_AVAILABLE',
        borrowerName: 'Admin User',
        borrowerId: '2024010098',
        borrowerPhone: '13600002222',
        major: 'Admin Major',
        purpose: 'Admin purpose'
      })
    });
    assert.equal(result.response.status, 200);
    const adminRecordId = result.body.data.id;

    result = await request('/api/records/' + adminRecordId, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-session-id': sessionId
      },
      body: JSON.stringify({
        borrowerName: 'Updated User',
        borrowerId: '2024010099',
        borrowerPhone: '13600002222',
        major: 'Updated Major',
        purpose: 'Updated purpose'
      })
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.data.borrowerName, 'Updated User');

    result = await request('/api/records/' + adminRecordId + '/force-return', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-id': sessionId
      },
      body: JSON.stringify({ notes: '管理员确认归还' })
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.success, true);
  });

  // 批量借出契约：同一借用信息一次借多台设备，单台冲突不影响其他设备借出。
  await t.test('batch borrowing borrows several devices and reports conflicts', async () => {
    let result = await request('/api/records/borrow-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceIds: ['DEV_AVAILABLE', 'DEV_STATUS'],
        borrowerName: '批量借用用户',
        borrowerId: '2024010101',
        borrowerPhone: '13500004444',
        major: '批量测试专业',
        purpose: '批量测试用途'
      })
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.success, true);
    assert.equal(result.body.data.borrowed.length, 2);
    assert.equal(result.body.data.conflicts.length, 0);
    assert.match(result.body.message, /成功借出 2 台设备/);
    const borrowedItems = result.body.data.borrowed;

    // 借出后设备状态必须同步为已借出，并展示脱敏借用人信息。
    result = await request('/api/devices/DEV_AVAILABLE/status');
    assert.equal(result.body.data.currentBorrower.name, '批****户');
    assert.equal(result.body.data.currentBorrower.phone, '135****');
    result = await request('/api/devices/DEV_STATUS/status');
    assert.equal(result.body.data.currentBorrower.name, '批****户');

    // 归还两台设备，避免影响后续测试的共享状态。
    for (const item of borrowedItems) {
      const returned = await request('/api/records/' + item.recordId + '/force-return', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
        body: JSON.stringify({ notes: '批量测试归还' })
      });
      assert.equal(returned.response.status, 200);
    }
  });

  await t.test('batch borrowing reports conflicts while borrowing the rest', async () => {
    // DEV_STATUS 可借，DEV_BORROWED 处于借出状态，只能借出前者。
    let result = await request('/api/records/borrow-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceIds: ['DEV_STATUS', 'DEV_BORROWED'],
        borrowerName: '批量冲突用户',
        borrowerPhone: '13500005555',
        major: '批量测试专业',
        purpose: '批量测试用途'
      })
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.success, true);
    assert.equal(result.body.data.borrowed.length, 1);
    assert.equal(result.body.data.borrowed[0].deviceId, 'DEV_STATUS');
    assert.equal(result.body.data.conflicts.length, 1);
    assert.equal(result.body.data.conflicts[0].deviceId, 'DEV_BORROWED');
    assert.equal(result.body.data.conflicts[0].reason, '该设备已被借用，请先归还');
    assert.match(result.body.message, /成功借出 1 台设备，1 台设备暂时无法借用/);

    // 归还借出的 DEV_STATUS，恢复共享状态。
    result = await request('/api/records/' + result.body.data.borrowed[0].recordId + '/force-return', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
      body: JSON.stringify({ notes: '批量测试归还' })
    });
    assert.equal(result.response.status, 200);
  });

  await t.test('batch borrowing validates device list and borrower fields', async () => {
    let result = await request('/api/records/borrow-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceIds: [], borrowerName: '测试用户', borrowerPhone: '13500006666', major: '测试专业', purpose: '测试用途'
      })
    });
    assert.equal(result.response.status, 400);
    assert.equal(result.body.message, '请选择要借用的设备');

    const manyIds = Array.from({ length: 11 }, (_, i) => 'DEV_' + i);
    result = await request('/api/records/borrow-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceIds: manyIds, borrowerName: '测试用户', borrowerPhone: '13500006666', major: '测试专业', purpose: '测试用途'
      })
    });
    assert.equal(result.response.status, 400);
    assert.equal(result.body.message, '单次最多可批量借用 10 台设备');

    result = await request('/api/records/borrow-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceIds: ['DEV_AVAILABLE'], borrowerName: '测试用户', borrowerPhone: '', major: '测试专业', purpose: '测试用途'
      })
    });
    assert.equal(result.response.status, 400);
    assert.equal(result.body.message, '姓名、完整手机号、专业和用途均为必填项');
  });

  // 其他设备回归契约：写入普通借用记录，但不能修改设备库存文件。
  await t.test('other device borrowing creates a normal record and can be returned without inventory changes', async () => {
    const beforeDevices = readSqliteRows(dataDir, 'devices');
    let result = await request('/api/records/borrow-other', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        otherDeviceName: '无线领夹麦克风',
        borrowerName: '其他设备用户',
        borrowerId: '2024010111',
        borrowerPhone: '13500001111',
        major: '网络安全',
        purpose: '课堂录音'
      })
    });

    assert.equal(result.response.status, 200);
    assert.equal(result.body.success, true);
    assert.equal(result.body.data.deviceId, null);
    assert.equal(result.body.data.deviceName, '无线领夹麦克风');
    assert.equal(result.body.data.isOtherDevice, true);

    const active = await request('/api/records/active', {
      headers: { 'x-session-id': sessionId }
    });
    assert.equal(active.response.status, 200);
    assert.ok(active.body.data.some(record => record.id === result.body.data.id && record.isOtherDevice === true));

    result = await request('/api/records/return-lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ borrowerName: '其他设备用户', borrowerPhone: '13500001111' })
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.data.records.length, 1);
    assert.equal(result.body.data.records[0].deviceName, '无线领夹麦克风');
    assert.equal(result.body.data.records[0].isOtherDevice, true);

    const returned = await request('/api/records/return', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recordId: result.body.data.records[0].recordId,
        returnToken: result.body.data.returnToken,
        notes: '设备已归还'
      })
    });
    assert.equal(returned.response.status, 200);
    assert.equal(returned.body.success, true);
    assert.deepEqual(readSqliteRows(dataDir, 'devices'), beforeDevices);
  });

  // 其他设备回归契约：管理员强制归还只结束借用记录，不要求库存中存在对应设备。
  await t.test('administrator can force-return an other device without inventory changes', async () => {
    const beforeDevices = readSqliteRows(dataDir, 'devices');
    const borrowed = await request('/api/records/borrow-other', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        otherDeviceName: '便携式投影仪',
        borrowerName: '管理员归还用户',
        borrowerPhone: '13600001111',
        major: '网络安全',
        purpose: '社团活动'
      })
    });
    assert.equal(borrowed.response.status, 200);

    const forced = await request('/api/records/' + borrowed.body.data.id + '/force-return', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
      body: JSON.stringify({ notes: '管理员已确认归还' })
    });
    assert.equal(forced.response.status, 200);
    assert.equal(forced.body.success, true);
    assert.equal(forced.body.data.isOtherDevice, true);
    assert.deepEqual(readSqliteRows(dataDir, 'devices'), beforeDevices);
  });

  // 用户批量归还契约：查询凭证覆盖多台记录，统一备注一次归还；单台异常不影响其他设备。
  await t.test('batch return returns several devices with one authorization', async () => {
    let result = await request('/api/records/borrow-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceIds: ['DEV_AVAILABLE', 'DEV_STATUS'],
        borrowerName: '批量归还用户',
        borrowerPhone: '13500007777',
        major: '批量测试专业',
        purpose: '批量测试用途'
      })
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.data.borrowed.length, 2);

    result = await request('/api/records/return-lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ borrowerName: '批量归还用户', borrowerPhone: '13500007777' })
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.data.records.length, 2);
    const recordIds = result.body.data.records.map(record => record.recordId);
    const returnToken = result.body.data.returnToken;

    result = await request('/api/records/return-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recordIds, returnToken, notes: '统一归还备注' })
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.success, true);
    assert.equal(result.body.data.returned.length, 2);
    assert.equal(result.body.data.conflicts.length, 0);
    assert.match(result.body.message, /成功归还 2 台设备/);

    // 归还后两台设备恢复为可借状态。
    result = await request('/api/devices/available');
    assert.equal(result.body.data.some(device => device.id === 'DEV_AVAILABLE'), true);
    assert.equal(result.body.data.some(device => device.id === 'DEV_STATUS'), true);
  });

  await t.test('batch return reports conflicts for invalid records', async () => {
    let result = await request('/api/records/borrow-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceIds: ['DEV_STATUS'],
        borrowerName: '批量冲突归还用户',
        borrowerPhone: '13500008888',
        major: '批量测试专业',
        purpose: '批量测试用途'
      })
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.data.borrowed.length, 1);

    result = await request('/api/records/return-lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ borrowerName: '批量冲突归还用户', borrowerPhone: '13500008888' })
    });
    const validRecordId = result.body.data.records[0].recordId;
    const returnToken = result.body.data.returnToken;

    // 提交一个有效记录 + 一个不在授权内的记录，只有有效记录被归还。
    result = await request('/api/records/return-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recordIds: [validRecordId, 'REC_NOT_AUTHORIZED'], returnToken, notes: '部分归还' })
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.success, true);
    assert.equal(result.body.data.returned.length, 1);
    assert.equal(result.body.data.conflicts.length, 1);
    assert.equal(result.body.data.conflicts[0].recordId, 'REC_NOT_AUTHORIZED');
    assert.match(result.body.message, /成功归还 1 台设备，1 台设备无法归还/);
  });

  await t.test('batch return validates record list and token', async () => {
    let result = await request('/api/records/return-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recordIds: [], returnToken: 'x', notes: '' })
    });
    assert.equal(result.response.status, 400);
    assert.equal(result.body.message, '请选择要归还的设备');

    const manyIds = Array.from({ length: 11 }, (_, i) => 'REC_' + i);
    result = await request('/api/records/return-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recordIds: manyIds, returnToken: 'x', notes: '' })
    });
    assert.equal(result.response.status, 400);
    assert.equal(result.body.message, '单次最多可批量归还 10 台设备');

    result = await request('/api/records/return-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recordIds: ['REC_1'], returnToken: 'invalid-token', notes: '' })
    });
    assert.equal(result.response.status, 403);
    assert.equal(result.body.message, '归还验证已失效，请重新查询');
  });

  // 管理员批量强制归还契约：一次归还多台借出设备，只写一条汇总日志。
  await t.test('administrator batch force-return returns several devices with one log', async () => {
    let result = await request('/api/records/borrow-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceIds: ['DEV_AVAILABLE', 'DEV_STATUS'],
        borrowerName: '批量管理员归还用户',
        borrowerPhone: '13500009999',
        major: '批量测试专业',
        purpose: '批量测试用途'
      })
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.data.borrowed.length, 2);
    // 只归还本次借出的两台，避免误归还 fixture 中的其他借出记录。
    const myRecordIds = result.body.data.borrowed.map(item => item.recordId);

    const beforeLogs = await request('/api/operation-logs', { headers: { 'x-session-id': sessionId } });
    const beforeAdminReturned = beforeLogs.body.data.filter(log => log.action === 'admin_returned').length;

    result = await request('/api/records/force-return-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
      body: JSON.stringify({ recordIds: myRecordIds, notes: '管理员统一归还' })
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.success, true);
    assert.equal(result.body.data.returned.length, 2);
    assert.match(result.body.message, /成功归还 2 台设备/);

    // 批量归还只追加一条 admin_returned 汇总日志，且日志不含借用人隐私。
    const afterLogs = await request('/api/operation-logs', { headers: { 'x-session-id': sessionId } });
    const afterAdminReturned = afterLogs.body.data.filter(log => log.action === 'admin_returned').length;
    assert.equal(afterAdminReturned, beforeAdminReturned + 1);
    assert.equal(JSON.stringify(afterLogs.body.data).includes('批量管理员归还用户'), false);
    assert.equal(JSON.stringify(afterLogs.body.data).includes('13500009999'), false);

    // 设备恢复可借。
    result = await request('/api/devices/available');
    assert.equal(result.body.data.some(device => device.id === 'DEV_AVAILABLE'), true);
    assert.equal(result.body.data.some(device => device.id === 'DEV_STATUS'), true);
  });

  await t.test('only an exact name and full-phone lookup can return matching equipment', async () => {
    let result = await request('/api/records/return-lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ borrowerName: '张三丰', borrowerPhone: '13800139999' })
    });
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.body.data.records, []);

    result = await request('/api/records/return-lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ borrowerName: '张三丰', borrowerPhone: '13800138000' })
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.success, true);
    assert.equal(result.body.data.records.length, 1);
    assert.equal(result.body.data.records[0].deviceId, 'DEV_BORROWED');
    assert.ok(result.body.data.returnToken);
    assert.equal('borrowerPhone' in result.body.data.records[0], false);

    const returnToken = result.body.data.returnToken;
    result = await request('/api/records/return', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recordId: 'REC_ACTIVE', returnToken: 'invalid', notes: 'returned' })
    });
    assert.equal(result.response.status, 403);

    result = await request('/api/records/return', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recordId: 'REC_ACTIVE', returnToken, notes: 'returned' })
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.success, true);

    result = await request('/api/devices/DEV_BORROWED/status');
    assert.equal(result.body.data.status, 'available');
  });

  await t.test('administrator cannot upload SVG or other executable image formats', async () => {
    const form = new FormData();
    form.append('name', '不安全图片测试');
    form.append('model', 'TEST');
    form.append('image', new Blob(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'], {
      type: 'image/svg+xml'
    }), 'unsafe.svg');

    const { response, body } = await request('/api/devices', {
      method: 'POST',
      headers: { 'x-session-id': sessionId },
      body: form
    });

    assert.equal(response.status, 400);
    assert.equal(body.success, false);
    assert.deepEqual(fs.readdirSync(uploadDir), []);
  });

  await t.test('uploaded device images are converted into cached detail and thumbnail variants', async () => {
    const png = await sharp({
      create: {
        width: 2,
        height: 3,
        channels: 3,
        background: { r: 224, g: 163, b: 61 }
      }
    }).png().toBuffer();
    const form = new FormData();
    form.append('name', '图片优化测试设备');
    form.append('model', 'IMG-1');
    form.append('category', 'cat-camera');
    form.append('imageDisplayHeight', '360');
    form.append('imageDisplayPositionY', '72');
    form.append('imageDisplayAspectRatio', '1.75');
    form.append('image', new Blob([png], { type: 'image/png' }), 'camera.png');

    const { response, body } = await request('/api/devices', {
      method: 'POST',
      headers: { 'x-session-id': sessionId },
      body: form
    });

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.match(body.data.image, /^\/uploads\/[a-f0-9]+-detail\.webp$/);
    assert.match(body.data.imageThumb, /^\/uploads\/[a-f0-9]+-thumb\.webp$/);
    assert.equal(body.data.imageWidth, 2);
    assert.equal(body.data.imageHeight, 3);
    assert.equal(body.data.imageDisplayHeight, 360);
    assert.equal(body.data.imageDisplayPositionY, 72);
    assert.equal(body.data.imageDisplayAspectRatio, 1.75);

    const files = fs.readdirSync(uploadDir).sort();
    assert.equal(files.length, 2);
    assert.equal(files.every(file => file.endsWith('.webp')), true);

    const imageResponse = await fetch(`${BASE_URL}${body.data.imageThumb}`);
    assert.equal(imageResponse.status, 200);
    assert.match(imageResponse.headers.get('cache-control') || '', /max-age=31536000/);
    assert.match(imageResponse.headers.get('cache-control') || '', /immutable/);
  });

  // 上传边界契约：超过 20 MB 的文件必须在服务端被拒绝。
  await t.test('image uploads over 20 MB are rejected by the server', async () => {
    const oversizedImage = new Uint8Array(20 * 1024 * 1024 + 1);
    const form = new FormData();
    form.append('name', '超大图片测试设备');
    form.append('model', 'IMG-LIMIT');
    form.append('category', 'cat-camera');
    form.append('image', new Blob([oversizedImage], { type: 'image/png' }), 'oversized.png');

    const { response, body } = await request('/api/devices', {
      method: 'POST',
      headers: { 'x-session-id': sessionId },
      body: form
    });

    assert.equal(response.status, 400);
    assert.equal(body.success, false);
    assert.match(body.message, /大于|超过|20/);
  });

  await t.test('active borrowing records cannot be archived', async () => {
    const borrowed = await request('/api/records/borrow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: 'DEV_BORROWED',
        borrowerName: 'Active User',
        borrowerPhone: '13500003333',
        major: '测试专业',
        purpose: '测试归档限制'
      })
    });
    const { response, body } = await request('/api/records/' + borrowed.body.data.id, {
      method: 'DELETE',
      headers: { 'x-session-id': sessionId }
    });

    assert.equal(response.status, 409);
    assert.equal(body.success, false);
  });

  await t.test('administrator can archive, restore, and permanently delete returned records', async () => {
    let result = await request('/api/records/REC_RETURNED', {
      method: 'DELETE',
      headers: { 'x-session-id': sessionId }
    });
    assert.equal(result.response.status, 200);

    result = await request('/api/records', {
      headers: { 'x-session-id': sessionId }
    });
    assert.equal(result.body.data.some(record => record.id === 'REC_RETURNED'), false);

    result = await request('/api/records?includeDeleted=true', {
      headers: { 'x-session-id': sessionId }
    });
    const archived = result.body.data.find(record => record.id === 'REC_RETURNED');
    assert.ok(archived.deletedAt);

    result = await request('/api/records/REC_RETURNED/restore', {
      method: 'POST',
      headers: { 'x-session-id': sessionId }
    });
    assert.equal(result.response.status, 200);

    result = await request('/api/records/REC_RETURNED', {
      method: 'DELETE',
      headers: { 'x-session-id': sessionId }
    });
    assert.equal(result.response.status, 200);

    result = await request('/api/records/REC_RETURNED/permanent', {
      method: 'DELETE',
      headers: { 'x-session-id': sessionId }
    });
    assert.equal(result.response.status, 200);

    result = await request('/api/records?includeDeleted=true', {
      headers: { 'x-session-id': sessionId }
    });
    assert.equal(result.body.data.some(record => record.id === 'REC_RETURNED'), false);
  });

  await t.test('deleting a device requires explicit confirmation before cascading its records', async () => {
    let result = await request('/api/devices/DEV_AVAILABLE', {
      method: 'DELETE',
      headers: { 'x-session-id': sessionId }
    });
    assert.equal(result.response.status, 409);
    assert.equal(result.body.requiresRecordDeletion, true);
    assert.ok(result.body.recordCount >= 1);

    result = await request('/api/devices/DEV_AVAILABLE?deleteRecords=true', {
      method: 'DELETE',
      headers: { 'x-session-id': sessionId }
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.success, true);

    result = await request('/api/records?includeDeleted=true', {
      headers: { 'x-session-id': sessionId }
    });
    assert.equal(result.body.data.some(record => record.deviceId === 'DEV_AVAILABLE'), false);
  });

  await t.test('borrowed devices cannot be deleted even with record deletion confirmed', async () => {
    let result = await request('/api/devices/DEV_BORROWED', {
      method: 'DELETE',
      headers: { 'x-session-id': sessionId }
    });
    assert.equal(result.response.status, 409);
    assert.match(result.body.message, /借用中/);

    result = await request('/api/devices/DEV_BORROWED?deleteRecords=true', {
      method: 'DELETE',
      headers: { 'x-session-id': sessionId }
    });
    assert.equal(result.response.status, 409);
    assert.match(result.body.message, /借用中/);

    const list = await request('/api/devices', { headers: { 'x-session-id': sessionId } });
    assert.equal(list.body.data.some(device => device.id === 'DEV_BORROWED'), true);
  });

  await t.test('GET /api/categories returns the 5 initial categories', async () => {
    const { response, body } = await request('/api/categories');
    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.length, 5);
    const ids = body.data.map(c => c.id).sort();
    assert.deepEqual(ids, ['cat-camera', 'cat-lens', 'cat-microphone', 'cat-other', 'cat-stabilizer']);
  });

  await t.test('POST /api/categories requires admin session and persists a new category', async () => {
    let result = await request('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'cat-test', name: '测试分类', icon: 'camera' })
    });
    assert.equal(result.response.status, 401);

    result = await request('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
      body: JSON.stringify({ id: 'cat-test', name: '测试分类', icon: 'camera' })
    });
    assert.equal(result.response.status, 201);
    assert.equal(result.body.success, true);
  });

  let catTestId;
  await t.test('GET /api/categories includes the newly created cat-test', async () => {
    const { body } = await request('/api/categories');
    const cat = body.data.find(c => c.name === '测试分类');
    assert.ok(cat);
    catTestId = cat.id;
  });

  await t.test('PUT /api/categories/:id requires admin and updates name/icon', async () => {
    assert.ok(catTestId, 'catTestId must be set from previous test');

    let result = await request('/api/categories/' + catTestId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '改名分类', icon: 'lens' })
    });
    assert.equal(result.response.status, 401);

    result = await request('/api/categories/' + catTestId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
      body: JSON.stringify({ name: '改名分类', icon: 'lens' })
    });
    assert.equal(result.response.status, 200);
    const { body } = await request('/api/categories');
    const updated = body.data.find(c => c.id === catTestId);
    assert.equal(updated?.name, '改名分类');
  });

  await t.test('PUT /api/categories/reorder requires admin and persists a complete category order', async () => {
    const { body: current } = await request('/api/categories');
    const reversedIds = current.data.map(category => category.id).reverse();

    let result = await request('/api/categories/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: reversedIds })
    });
    assert.equal(result.response.status, 401);

    result = await request('/api/categories/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
      body: JSON.stringify({ ids: reversedIds })
    });
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.body.data.map(category => category.id), reversedIds);
    assert.deepEqual(result.body.data.map(category => category.sortOrder), [1, 2, 3, 4, 5, 6]);
    assert.equal(result.body.data.at(0).id, reversedIds[0]);

    result = await request('/api/categories/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
      body: JSON.stringify({ ids: reversedIds.slice(1) })
    });
    assert.equal(result.response.status, 400);
  });

  let delCatDevId;
  await t.test('DELETE /api/categories/:id removes the category and migrates devices to cat-other', async () => {
    assert.ok(catTestId, 'catTestId must be set from previous test');

    let result = await request('/api/devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
      body: JSON.stringify({
        name: '待迁移设备',
        model: 'MIG-1',
        category: catTestId
      })
    });
    assert.equal(result.response.status, 200);
    delCatDevId = result.body.data.id;
    assert.ok(delCatDevId, 'device ID must be returned');

    let unauthorized = await request('/api/categories/' + catTestId, {
      method: 'DELETE',
      headers: { 'x-session-id': 'invalid' }
    });
    assert.equal(unauthorized.response.status, 401);

    result = await request('/api/categories/' + catTestId, {
      method: 'DELETE',
      headers: { 'x-session-id': sessionId }
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.success, true);

    const { body: devBody } = await request('/api/devices/' + delCatDevId + '/status');
    assert.equal(devBody.data.category, 'cat-other');
  });

  await t.test('DELETE cat-other returns 400 (cannot remove the fallback category)', async () => {
    const { response, body } = await request('/api/categories/cat-other', {
      method: 'DELETE',
      headers: { 'x-session-id': sessionId }
    });
    assert.equal(response.status, 400);
    assert.equal(body.success, false);
  });

  let catDevKnownId;
  await t.test('creating a device with category stores the category', async () => {
    const { response, body } = await request('/api/devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
      body: JSON.stringify({
        name: '分类设备',
        model: 'CAT-1',
        category: 'cat-lens'
      })
    });
    assert.equal(response.status, 200);
    assert.equal(body.data.category, 'cat-lens');
    catDevKnownId = body.data.id;
  });

  await t.test('creating a device without category is rejected', async () => {
    const { response, body } = await request('/api/devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
      body: JSON.stringify({
        name: '无分类设备',
        model: 'NOCAT-1'
      })
    });
    assert.equal(response.status, 400);
    assert.equal(body.success, false);
    assert.match(body.message, /分类/);
  });

  await t.test('updating a device without category is rejected', async () => {
    const { response, body } = await request('/api/devices/' + catDevKnownId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
      body: JSON.stringify({ name: '缺少分类的更新' })
    });
    assert.equal(response.status, 400);
    assert.equal(body.success, false);
    assert.match(body.message, /分类/);
  });

  await t.test('available endpoint returns category and old devices fallback to cat-other', async () => {
    assert.ok(catDevKnownId, 'catDevKnownId must be set from previous test');
    const { body } = await request('/api/devices/available');
    assert.ok(body.data.length > 0);
    assert.ok(body.data.every(d => typeof d.category === 'string'));
    const catDevice = body.data.find(d => d.id === catDevKnownId);
    assert.ok(catDevice, 'device should be in the available list');
    assert.equal(catDevice.category, 'cat-lens');
  });

  // 批量状态必须整批校验；借出设备会阻止批量下线，上线会清空离线原因。
  await t.test('batch status changes are atomic and log one summary per action', async () => {
    const beforeDevices = readSqliteRows(dataDir, 'devices');
    const beforeLogs = readSqliteRows(dataDir, 'operation_logs');
    let result = await request('/api/devices/batch-operational-status', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
      body: JSON.stringify({ deviceIds: ['DEV_STATUS', 'DEV_BORROWED'], operationalStatus: 'offline', offlineReason: '批量检修' })
    });
    assert.equal(result.response.status, 409);
    assert.equal(result.body.success, false);
    assert.ok(result.body.errors.some(error => error.deviceId === 'DEV_BORROWED'));
    assert.deepEqual(readSqliteRows(dataDir, 'devices'), beforeDevices);

    result = await request('/api/devices/batch-operational-status', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
      body: JSON.stringify({ deviceIds: ['DEV_STATUS'], operationalStatus: 'offline', offlineReason: '批量检修' })
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.success, true);
    assert.equal(result.body.data.count, 1);
    assert.equal(result.body.data.devices[0].offlineReason, '批量检修');
    const afterLogs = readSqliteRows(dataDir, 'operation_logs');
    assert.equal(afterLogs.length, beforeLogs.length + 1);
    assert.equal(afterLogs.at(-1).action, 'devices_batch_offlined');
    assert.match(afterLogs.at(-1).summary, /批量下线 1 台设备/);

    result = await request('/api/devices/batch-operational-status', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
      body: JSON.stringify({ deviceIds: ['DEV_STATUS'], operationalStatus: 'online' })
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.data.devices[0].operationalStatus, 'online');
    assert.equal(result.body.data.devices[0].offlineReason, '');
    const onlineLogs = readSqliteRows(dataDir, 'operation_logs');
    assert.equal(onlineLogs.length, beforeLogs.length + 2);
    assert.equal(onlineLogs.at(-1).action, 'devices_batch_onlined');
    assert.match(onlineLogs.at(-1).summary, /批量上线 1 台设备/);
  });

  // 批量分类必须验证目标分类和全部设备，成功时只写一条汇总日志。
  await t.test('batch categorization is atomic and logs one summary', async () => {
    const beforeDevices = readSqliteRows(dataDir, 'devices');
    const beforeLogs = readSqliteRows(dataDir, 'operation_logs');
    let result = await request('/api/devices/batch-category', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
      body: JSON.stringify({ deviceIds: ['DEV_STATUS'], category: 'cat-missing' })
    });
    assert.equal(result.response.status, 400);
    assert.equal(result.body.success, false);
    assert.deepEqual(readSqliteRows(dataDir, 'devices'), beforeDevices);

    result = await request('/api/devices/batch-category', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
      body: JSON.stringify({ deviceIds: ['DEV_STATUS', 'DEV_MISSING'], category: 'cat-lens' })
    });
    assert.equal(result.response.status, 409);
    assert.equal(result.body.success, false);
    assert.deepEqual(readSqliteRows(dataDir, 'devices'), beforeDevices);

    result = await request('/api/devices/batch-category', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
      body: JSON.stringify({ deviceIds: ['DEV_STATUS', 'DEV_BORROWED'], category: 'cat-lens' })
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.success, true);
    assert.equal(result.body.data.count, 2);
    assert.ok(result.body.data.devices.every(device => device.category === 'cat-lens'));
    const afterLogs = readSqliteRows(dataDir, 'operation_logs');
    assert.equal(afterLogs.length, beforeLogs.length + 1);
    assert.equal(afterLogs.at(-1).action, 'devices_batch_categorized');
    assert.match(afterLogs.at(-1).summary, /批量分类 2 台设备/);
    assert.match(afterLogs.at(-1).summary, /镜头/);
  });
});

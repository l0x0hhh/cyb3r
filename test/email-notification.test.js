// 邮件通知集成契约：当前模板、预览事件和脱敏规则都必须经过同一套邮件渲染流程。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PORT = 3111;

function startFakeSmtpServer() {
  let receivedMessages = [];
  const server = net.createServer(socket => {
    socket.setEncoding('utf8');
    socket.write('220 fake.smtp.test ready\r\n');
    let buffer = '';
    let dataMode = false;
    let authStep = '';

    const handleCommand = line => {
      if (line.startsWith('EHLO ')) socket.write('250-fake.smtp.test\r\n250 AUTH LOGIN\r\n');
      else if (line === 'AUTH LOGIN') {
        authStep = 'username';
        socket.write('334 VXNlcm5hbWU6\r\n');
      } else if (authStep && /^[A-Za-z0-9+/=]+$/.test(line)) {
        if (authStep === 'username') {
          authStep = 'password';
          socket.write('334 UGFzc3dvcmQ6\r\n');
        } else {
          authStep = '';
          socket.write('235 2.7.0 authenticated\r\n');
        }
      } else if (line.startsWith('MAIL FROM:') || line.startsWith('RCPT TO:')) socket.write('250 ok\r\n');
      else if (line === 'DATA') {
        dataMode = true;
        socket.write('354 ready for message\r\n');
      } else if (line === 'QUIT') {
        socket.write('221 bye\r\n');
        socket.end();
      }
    };

    socket.on('data', chunk => {
      buffer += chunk;
      if (dataMode) {
        const end = buffer.indexOf('\r\n.\r\n');
        if (end === -1) return;
        receivedMessages.push(buffer.slice(0, end));
        buffer = buffer.slice(end + 5);
        dataMode = false;
        socket.write('250 queued\r\n');
      }
      const lines = buffer.split('\r\n');
      buffer = lines.pop() || '';
      lines.filter(Boolean).forEach(handleCommand);
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, () => resolve({
      port: server.address().port,
      getMessage: () => receivedMessages.at(-1) || '',
      getMessages: () => [...receivedMessages],
      close: () => new Promise(done => server.close(done))
    }));
  });
}

// 测试服务启动诊断：串行 CI 下等待服务就绪，并保留子进程退出信息。
async function waitForServer(child, getOutput = () => '') {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`测试服务提前退出（${child.exitCode}）：\n${getOutput()}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/api/devices/available`);
      if (response.ok) return;
    } catch {
      // 服务仍在启动。
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`测试服务启动超时（20 秒）：\n${getOutput()}`);
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  await new Promise(resolve => {
    child.once('exit', resolve);
    child.kill();
  });
}

async function request(url, options = {}) {
  const response = await fetch(`http://127.0.0.1:${PORT}${url}`, options);
  return { response, body: await response.json() };
}

test('successful borrowing queues a masked administrator email notification', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'device-management-email-test-'));
  const uploadDir = path.join(dataDir, 'uploads');
  const qrDir = path.join(dataDir, 'qrcodes');
  fs.mkdirSync(uploadDir, { recursive: true });
  fs.mkdirSync(qrDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'devices.json'), JSON.stringify([{
    id: 'DEV_EMAIL', name: '测试相机', model: 'EMAIL-1', category: 'cat-camera', status: 'available', createdAt: new Date().toISOString()
  }]));
  fs.writeFileSync(path.join(dataDir, 'records.json'), '[]');

  const smtp = await startFakeSmtpServer();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR: dataDir,
      UPLOAD_DIR: uploadDir,
      QR_DIR: qrDir,
      ADMIN_PASSWORD: 'test-secret',
      EMAIL_CONFIG_KEY: 'b'.repeat(64)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });

  t.after(async () => {
    await stopServer(child);
    await smtp.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  await waitForServer(child, () => output);
  const login = await request('/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test-secret' })
  });
  assert.equal(login.body.success, true, output);
  const sessionId = login.body.sessionId;

  const save = await request('/api/admin/email-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
    body: JSON.stringify({
      enabled: true,
      notifyBorrow: true,
      notifyReturn: false,
      notifyAdminReturn: false,
      recipients: ['admin@example.com'],
      smtp: { host: '127.0.0.1', port: smtp.port, security: 'none', username: 'sender@example.com', secret: 'secret' },
      subjectTemplate: '借用：{{deviceName}}',
      bodyTemplate: '设备：{{deviceName}}\n姓名：{{borrowerName}}\n工号：{{borrowerId}}\n电话：{{borrowerPhone}}'
    })
  });
  assert.equal(save.response.status, 200);

  const testMail = await request('/api/admin/email-settings/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
    body: JSON.stringify({
      previewEvent: 'return',
      subjectTemplate: '回收：{{eventLabel}}/{{deviceName}}',
      bodyTemplate: '预览设备：{{deviceName}}\n预览姓名：{{borrowerName}}\n预览电话：{{borrowerPhone}}'
    })
  });
  assert.equal(testMail.response.status, 200, output);
  const testDeadline = Date.now() + 3000;
  while (!smtp.getMessage() && Date.now() < testDeadline) await new Promise(resolve => setTimeout(resolve, 50));
  const testMessage = smtp.getMessage();
  assert.match(testMessage, /Subject: =\?UTF-8\?B\?/);
  const testBody = Buffer.from(testMessage.split('\r\n\r\n').at(-1).replace(/\r\n/g, ''), 'base64').toString('utf8');
  assert.match(testBody, /预览设备：示例设备/);
  assert.match(testBody, /预览姓名：示\*\*户/);
  assert.match(testBody, /预览电话：138\*\*\*\*/);
  assert.doesNotMatch(testBody, /13800138000/);

  const borrowed = await request('/api/records/borrow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: 'DEV_EMAIL', borrowerName: '张三', borrowerId: '2026000001', borrowerPhone: '13800138000', major: '网络安全', purpose: '课程拍摄' })
  });
  assert.equal(borrowed.response.status, 200);

  const deadline = Date.now() + 3000;
  while (smtp.getMessage() === testMessage && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
  const message = smtp.getMessage();
  assert.match(message, /Subject: =\?UTF-8\?B\?/);
  const body = Buffer.from(message.split('\r\n\r\n').at(-1).replace(/\r\n/g, ''), 'base64').toString('utf8');
  assert.match(body, /设备：测试相机/);
  assert.match(body, /姓名：张\*/);
  assert.match(body, /工号：20\*+01/);
  assert.match(body, /电话：138\*\*\*\*/);
  assert.doesNotMatch(body, /13800138000/);
});

function decodeMessageSubject(message) {
  const match = String(message).match(/Subject: =\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/);
  return match ? Buffer.from(match[1], 'base64').toString('utf8') : '';
}

function decodeMessageBody(message) {
  return Buffer.from(String(message).split('\r\n\r\n').at(-1).replace(/\r\n/g, ''), 'base64').toString('utf8');
}

async function waitForMessageCount(smtp, count, deadline = 5000) {
  const started = Date.now();
  while (smtp.getMessages().length < count && Date.now() - started < deadline) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return smtp.getMessages();
}

// 邮件批量回归夹具：允许调用方注入设备集合，覆盖重复名称和型号场景。
async function startEmailTestServer(devices = [
  { id: 'DEV_EMAIL', name: '测试相机', model: 'EMAIL-1', category: 'cat-camera', status: 'available' },
  { id: 'DEV_EMAIL_2', name: '测试镜头', model: 'LENS-1', category: 'cat-lens', status: 'available' }
]) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'device-management-email-test-'));
  const uploadDir = path.join(dataDir, 'uploads');
  const qrDir = path.join(dataDir, 'qrcodes');
  fs.mkdirSync(uploadDir, { recursive: true });
  fs.mkdirSync(qrDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'devices.json'), JSON.stringify(devices.map(device => ({
    ...device,
    createdAt: device.createdAt || new Date().toISOString()
  }))));
  fs.writeFileSync(path.join(dataDir, 'records.json'), '[]');

  const smtp = await startFakeSmtpServer();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR: dataDir,
      UPLOAD_DIR: uploadDir,
      QR_DIR: qrDir,
      ADMIN_PASSWORD: 'test-secret',
      EMAIL_CONFIG_KEY: 'b'.repeat(64)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });

  await waitForServer(child, () => output);
  const login = await request('/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test-secret' })
  });
  if (!login.body.success) throw new Error(`管理员登录失败: ${output}`);
  return {
    smtp,
    child,
    sessionId: login.body.sessionId,
    dataDir,
    output,
    cleanup: async () => {
      await stopServer(child);
      await smtp.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  };
}

// 其他设备邮件契约：名称保持干净，待上线提醒和缺失型号单独展示。
test('other device borrowing renders a clean name, reminder, and model fallback', async t => {
  const env = await startEmailTestServer();
  t.after(env.cleanup);

  const save = await request('/api/admin/email-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-session-id': env.sessionId },
    body: JSON.stringify({
      enabled: true,
      notifyBorrow: true,
      notifyReturn: false,
      notifyAdminReturn: false,
      recipients: ['admin@example.com'],
      smtp: { host: '127.0.0.1', port: env.smtp.port, security: 'none', username: 'sender@example.com', secret: 'secret' },
      templates: {
        borrow: { subject: '借用：{{deviceName}}', body: '设备名称：{{deviceName}}\n设备型号：{{deviceModel}}\n设备提醒：{{deviceNotice}}\n借用明细：{{recordList}}' },
        return: { subject: '归还：{{deviceName}}', body: '设备：{{deviceName}}' },
        adminReturn: { subject: '管理员归还：{{deviceName}}', body: '设备：{{deviceName}}' }
      }
    })
  });
  assert.equal(save.response.status, 200, env.output);

  const borrowed = await request('/api/records/borrow-other', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      otherDeviceName: '无线领夹麦克风',
      borrowerName: '邮件测试用户',
      borrowerPhone: '13700001111',
      major: '网络安全',
      purpose: '课堂录音'
    })
  });
  assert.equal(borrowed.response.status, 200, JSON.stringify(borrowed.body));

  const messages = await waitForMessageCount(env.smtp, 1);
  assert.equal(messages.length, 1);
  const subject = decodeMessageSubject(messages[0]);
  const body = decodeMessageBody(messages[0]);
  assert.equal(subject, '借用：无线领夹麦克风');
  assert.match(body, /设备名称：无线领夹麦克风/);
  assert.match(body, /设备型号：暂未录入（待管理员上线后补充）/);
  assert.match(body, /设备提醒：记得有时间上线这个设备喔/);
  assert.match(body, /借用明细：/);
  assert.match(body, /无线领夹麦克风/);
  assert.equal((body.match(/记得有时间上线这个设备喔/g) || []).length, 1);
});

// 旧模板兼容契约：未插入新变量时，其他设备仍自动补充待上线提醒。
test('legacy single-device template adds the other-device reminder automatically', async t => {
  const env = await startEmailTestServer();
  t.after(env.cleanup);

  const save = await request('/api/admin/email-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-session-id': env.sessionId },
    body: JSON.stringify({
      enabled: true,
      notifyBorrow: true,
      notifyReturn: false,
      notifyAdminReturn: false,
      recipients: ['admin@example.com'],
      smtp: { host: '127.0.0.1', port: env.smtp.port, security: 'none', username: 'sender@example.com', secret: 'secret' },
      templates: {
        borrow: { subject: '借用：{{deviceName}}', body: '设备名称：{{deviceName}}\n设备型号：{{deviceModel}}' },
        return: { subject: '归还：{{deviceName}}', body: '设备：{{deviceName}}' },
        adminReturn: { subject: '管理员归还：{{deviceName}}', body: '设备：{{deviceName}}' }
      }
    })
  });
  assert.equal(save.response.status, 200, env.output);

  const borrowed = await request('/api/records/borrow-other', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      otherDeviceName: '临时录音设备',
      borrowerName: '旧模板用户',
      borrowerPhone: '13700005555',
      major: '网络安全',
      purpose: '测试提醒'
    })
  });
  assert.equal(borrowed.response.status, 200);

  const messages = await waitForMessageCount(env.smtp, 1);
  const body = decodeMessageBody(messages[0]);
  assert.match(body, /设备名称：临时录音设备/);
  assert.match(body, /记得有时间上线这个设备喔/);
  assert.equal((body.match(/记得有时间上线这个设备喔/g) || []).length, 1);
});

// 测试邮件契约：管理员测试当前模板时，借用明细必须和正式通知使用同一格式。
test('template test email renders the grouped record list', async t => {
  const env = await startEmailTestServer();
  t.after(env.cleanup);

  const payload = {
    enabled: true,
    notifyBorrow: true,
    notifyReturn: false,
    notifyAdminReturn: false,
    recipients: ['admin@example.com'],
    smtp: { host: '127.0.0.1', port: env.smtp.port, security: 'none', username: 'sender@example.com', secret: 'secret' },
    templates: {
      borrow: { subject: '借用测试', body: '通知内容\n{{recordList}}' },
      return: { subject: '归还测试', body: '{{recordList}}' },
      adminReturn: { subject: '管理员归还测试', body: '{{recordList}}' }
    }
  };
  const save = await request('/api/admin/email-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-session-id': env.sessionId },
    body: JSON.stringify(payload)
  });
  assert.equal(save.response.status, 200, env.output);

  const testMail = await request('/api/admin/email-settings/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-session-id': env.sessionId },
    body: JSON.stringify({ ...payload, previewEvent: 'borrow' })
  });
  assert.equal(testMail.response.status, 200, env.output);

  const messages = await waitForMessageCount(env.smtp, 1);
  assert.equal(messages.length, 1);
  const body = decodeMessageBody(messages[0]);
  assert.match(body, /借用人：示\*\*户/);
  assert.match(body, /联系电话：138\*\*\*\*/);
  assert.match(body, /设备明细：/);
  assert.match(body, /1\. 示例设备（型号：DEMO-001，编号：DEMO-DEVICE）/);
});

// 同一人批量借用邮件契约：借用人信息只出现一次，设备明细集中展示。
test('batch borrowing groups one borrower once and keeps the detail list compact', async t => {
  const env = await startEmailTestServer();
  t.after(env.cleanup);

  const save = await request('/api/admin/email-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-session-id': env.sessionId },
    body: JSON.stringify({
      enabled: true,
      notifyBorrow: true,
      notifyReturn: false,
      notifyAdminReturn: false,
      recipients: ['admin@example.com'],
      smtp: { host: '127.0.0.1', port: env.smtp.port, security: 'none', username: 'sender@example.com', secret: 'secret' },
      templates: {
        borrow: { subject: '批量借用', body: '借出明细\n{{recordList}}' },
        return: { subject: '归还', body: '{{recordList}}' },
        adminReturn: { subject: '管理员归还', body: '{{recordList}}' }
      }
    })
  });
  assert.equal(save.response.status, 200, env.output);

  const borrowed = await request('/api/records/borrow-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deviceIds: ['DEV_EMAIL', 'DEV_EMAIL_2'],
      borrowerName: '批量借用用户',
      borrowerPhone: '13700002222',
      major: '网络安全',
      purpose: '批量邮件展示'
    })
  });
  assert.equal(borrowed.response.status, 200);

  const messages = await waitForMessageCount(env.smtp, 1);
  assert.equal(messages.length, 1);
  const body = decodeMessageBody(messages[0]);
  assert.equal((body.match(/批\*{4}户/g) || []).length, 1);
  assert.equal((body.match(/137\*\*\*\*/g) || []).length, 1);
  assert.equal((body.match(/测试相机/g) || []).length, 1);
  assert.equal((body.match(/测试镜头/g) || []).length, 1);
  assert.match(body, /设备明细/);
});

test('three event types render their own independent templates', async t => {
  const env = await startEmailTestServer();
  t.after(env.cleanup);

  const save = await request('/api/admin/email-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-session-id': env.sessionId },
    body: JSON.stringify({
      enabled: true,
      notifyBorrow: true,
      notifyReturn: true,
      notifyAdminReturn: true,
      recipients: ['admin@example.com'],
      smtp: { host: '127.0.0.1', port: env.smtp.port, security: 'none', username: 'sender@example.com', secret: 'secret' },
      templates: {
        borrow: { subject: '【借出】{{deviceName}}', body: '借出正文\n设备：{{deviceName}}\n姓名：{{borrowerName}}\n借用时间：{{borrowedAt}}' },
        return: { subject: '【归还】{{deviceName}}', body: '归还正文\n设备：{{deviceName}}\n备注：{{returnNotes}}' },
        adminReturn: { subject: '【管理归还】{{deviceName}}', body: '管理归还正文\n设备：{{deviceName}}' }
      }
    })
  });
  assert.equal(save.response.status, 200, env.output);
  assert.equal(save.body.data.templates.borrow.subject, '【借出】{{deviceName}}');
  assert.equal(save.body.data.templates.return.subject, '【归还】{{deviceName}}');
  assert.equal(save.body.data.templates.adminReturn.subject, '【管理归还】{{deviceName}}');

  const borrowBody = { deviceId: 'DEV_EMAIL', borrowerName: '张三', borrowerId: '2026000001', borrowerPhone: '13800138000', major: '网络安全', purpose: '课程拍摄' };
  const borrow = await request('/api/records/borrow', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(borrowBody)
  });
  assert.equal(borrow.response.status, 200);

  let messages = await waitForMessageCount(env.smtp, 1);
  assert.equal(messages.length, 1);
  assert.match(decodeMessageSubject(messages[0]), /【借出】测试相机/);
  assert.match(decodeMessageBody(messages[0]), /借出正文/);
  // 时间变量渲染为北京时间可读格式，而不是原始 ISO 字符串。
  assert.match(decodeMessageBody(messages[0]), /借用时间：\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  assert.doesNotMatch(decodeMessageBody(messages[0]), /T\d{2}:\d{2}:\d{2}\.\d{3}Z/);

  const lookup = await request('/api/records/return-lookup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ borrowerName: '张三', borrowerPhone: '13800138000' })
  });
  assert.equal(lookup.response.status, 200);
  const firstRecordId = lookup.body.data.records[0].recordId;

  const returned = await request('/api/records/return', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recordId: firstRecordId, returnToken: lookup.body.data.returnToken, notes: '完好归还' })
  });
  assert.equal(returned.response.status, 200);

  messages = await waitForMessageCount(env.smtp, 2);
  assert.match(decodeMessageSubject(messages[1]), /【归还】测试相机/);
  assert.match(decodeMessageBody(messages[1]), /归还正文/);
  assert.match(decodeMessageBody(messages[1]), /备注：完好归还/);

  const borrowAgain = await request('/api/records/borrow', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(borrowBody)
  });
  assert.equal(borrowAgain.response.status, 200);
  messages = await waitForMessageCount(env.smtp, 3);
  assert.match(decodeMessageSubject(messages[2]), /【借出】测试相机/);

  const lookupAgain = await request('/api/records/return-lookup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ borrowerName: '张三', borrowerPhone: '13800138000' })
  });
  const secondRecordId = lookupAgain.body.data.records[0].recordId;
  const forceReturn = await request(`/api/records/${secondRecordId}/force-return`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-id': env.sessionId },
    body: JSON.stringify({ notes: '管理员确认归还' })
  });
  assert.equal(forceReturn.response.status, 200);

  messages = await waitForMessageCount(env.smtp, 4);
  assert.match(decodeMessageSubject(messages[3]), /【管理归还】测试相机/);
  assert.match(decodeMessageBody(messages[3]), /管理归还正文/);
});

test('legacy subject and body templates act as a fallback for every event', async t => {
  const env = await startEmailTestServer();
  t.after(env.cleanup);

  const save = await request('/api/admin/email-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-session-id': env.sessionId },
    body: JSON.stringify({
      enabled: true,
      notifyBorrow: true,
      notifyReturn: true,
      notifyAdminReturn: true,
      recipients: ['admin@example.com'],
      smtp: { host: '127.0.0.1', port: env.smtp.port, security: 'none', username: 'sender@example.com', secret: 'secret' },
      subjectTemplate: '旧模板主题：{{eventLabel}}',
      bodyTemplate: '旧模板正文：{{deviceName}}'
    })
  });
  assert.equal(save.response.status, 200, env.output);
  assert.equal(save.body.data.templates.borrow.subject, '旧模板主题：{{eventLabel}}');
  assert.equal(save.body.data.templates.return.subject, '旧模板主题：{{eventLabel}}');
  assert.equal(save.body.data.templates.adminReturn.subject, '旧模板主题：{{eventLabel}}');
  assert.equal(save.body.data.subjectTemplate, '旧模板主题：{{eventLabel}}');

  const borrow = await request('/api/records/borrow', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: 'DEV_EMAIL', borrowerName: '张三', borrowerId: '2026000001', borrowerPhone: '13800138000', major: '网络安全', purpose: '课程拍摄' })
  });
  assert.equal(borrow.response.status, 200);
  let messages = await waitForMessageCount(env.smtp, 1);
  assert.match(decodeMessageSubject(messages[0]), /旧模板主题：设备借出/);
  assert.match(decodeMessageBody(messages[0]), /旧模板正文：测试相机/);

  const lookup = await request('/api/records/return-lookup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ borrowerName: '张三', borrowerPhone: '13800138000' })
  });
  const returned = await request('/api/records/return', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recordId: lookup.body.data.records[0].recordId, returnToken: lookup.body.data.returnToken, notes: '归还' })
  });
  assert.equal(returned.response.status, 200);
  messages = await waitForMessageCount(env.smtp, 2);
  assert.match(decodeMessageSubject(messages[1]), /旧模板主题：用户归还/);
});

// 批量借出/用户批量归还/管理员批量归还各自只发一封汇总邮件，旧字段继续兼容。
test('batch operations send one summary email with a device list', async t => {
  const env = await startEmailTestServer();
  t.after(env.cleanup);

  const save = await request('/api/admin/email-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-session-id': env.sessionId },
    body: JSON.stringify({
      enabled: true,
      notifyBorrow: true,
      notifyReturn: true,
      notifyAdminReturn: true,
      recipients: ['admin@example.com'],
      smtp: { host: '127.0.0.1', port: env.smtp.port, security: 'none', username: 'sender@example.com', secret: 'secret' },
      templates: {
        borrow: { subject: '【借出】{{deviceName}}', body: '借出汇总\n设备名称：{{deviceName}}\n设备型号：{{deviceModel}}\n姓名：{{borrowerName}}' },
        return: { subject: '【归还】{{deviceName}}', body: '归还汇总\n设备名称：{{deviceName}}\n设备型号：{{deviceModel}}' },
        adminReturn: { subject: '【管理归还】{{deviceName}}', body: '管理归还汇总\n设备名称：{{deviceName}}\n设备型号：{{deviceModel}}' }
      }
    })
  });
  assert.equal(save.response.status, 200, env.output);

  const borrowBody = { deviceIds: ['DEV_EMAIL', 'DEV_EMAIL_2'], borrowerName: '张三', borrowerId: '2026000001', borrowerPhone: '13800138000', major: '网络安全', purpose: '课程拍摄' };
  const batchBorrow = await request('/api/records/borrow-batch', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(borrowBody)
  });
  assert.equal(batchBorrow.response.status, 200);
  assert.equal(batchBorrow.body.data.borrowed.length, 2);

  // 借出 2 台只发 1 封汇总邮件，{{deviceName}}/{{deviceModel}} 渲染为顿号分隔清单。
  let messages = await waitForMessageCount(env.smtp, 1);
  assert.equal(messages.length, 1);
  assert.match(decodeMessageSubject(messages[0]), /【借出】测试相机、测试镜头/);
  assert.match(decodeMessageBody(messages[0]), /设备名称：测试相机、测试镜头/);
  assert.match(decodeMessageBody(messages[0]), /设备型号：EMAIL-1、LENS-1/);

  const lookup = await request('/api/records/return-lookup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ borrowerName: '张三', borrowerPhone: '13800138000' })
  });
  assert.equal(lookup.body.data.records.length, 2);
  const recordIds = lookup.body.data.records.map(record => record.recordId);

  // 用户批量归还 2 台只发 1 封，设备清单同样通过既有字段渲染。
  const batchReturn = await request('/api/records/return-batch', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recordIds, returnToken: lookup.body.data.returnToken, notes: '统一归还' })
  });
  assert.equal(batchReturn.response.status, 200);
  assert.equal(batchReturn.body.data.returned.length, 2);
  messages = await waitForMessageCount(env.smtp, 2);
  assert.equal(messages.length, 2);
  assert.match(decodeMessageSubject(messages[1]), /【归还】测试相机、测试镜头/);
  assert.match(decodeMessageBody(messages[1]), /设备名称：测试相机、测试镜头/);
  assert.match(decodeMessageBody(messages[1]), /设备型号：EMAIL-1、LENS-1/);

  // 再次批量借出，管理员批量归还 2 台只发 1 封管理归还邮件。
  const borrowAgain = await request('/api/records/borrow-batch', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(borrowBody)
  });
  assert.equal(borrowAgain.response.status, 200);
  messages = await waitForMessageCount(env.smtp, 3);

  const active = await request('/api/records/active', { headers: { 'x-session-id': env.sessionId } });
  const activeIds = active.body.data.map(record => record.id);
  const forceReturn = await request('/api/records/force-return-batch', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-id': env.sessionId },
    body: JSON.stringify({ recordIds: activeIds, notes: '管理员统一归还' })
  });
  assert.equal(forceReturn.response.status, 200);
  assert.equal(forceReturn.body.data.returned.length, 2);
  messages = await waitForMessageCount(env.smtp, 4);
  assert.equal(messages.length, 4);
  // 设备清单顺序跟随归还记录顺序（可能反序），只校验事件名与两台设备都在。
  assert.match(decodeMessageSubject(messages[3]), /^【管理归还】/);
  assert.match(decodeMessageSubject(messages[3]), /测试相机/);
  assert.match(decodeMessageSubject(messages[3]), /测试镜头/);
  assert.match(decodeMessageBody(messages[3]), /设备名称：/);
  assert.match(decodeMessageBody(messages[3]), /测试相机/);
  assert.match(decodeMessageBody(messages[3]), /测试镜头/);
  assert.match(decodeMessageBody(messages[3]), /设备型号：/);
  assert.match(decodeMessageBody(messages[3]), /EMAIL-1/);
  assert.match(decodeMessageBody(messages[3]), /LENS-1/);
});

// 未使用 {{recordList}} 的旧批量模板仍会自动补充逐条明细，且不能丢失重复设备。
test('batch summary email preserves every repeated device name and model', async t => {
  const devices = Array.from({ length: 10 }, (_, index) => ({
    id: 'DEV_DUP_' + (index + 1),
    name: index % 2 === 0 ? '单反相机' : '测试设备',
    model: index % 3 === 0 ? 'DUP-1' : 'DUP-2',
    category: 'cat-camera',
    status: 'available'
  }));
  const env = await startEmailTestServer(devices);
  t.after(env.cleanup);

  const save = await request('/api/admin/email-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-session-id': env.sessionId },
    body: JSON.stringify({
      enabled: true,
      notifyBorrow: true,
      notifyReturn: false,
      notifyAdminReturn: false,
      recipients: ['admin@example.com'],
      smtp: { host: '127.0.0.1', port: env.smtp.port, security: 'none', username: 'sender@example.com', secret: 'secret' },
      templates: {
        borrow: {
          subject: '借出：{{deviceName}}',
          body: '设备名称：{{deviceName}}\n设备型号：{{deviceModel}}\n设备编号：{{deviceId}}\n借用时间：{{borrowedAt}}'
        }
      }
    })
  });
  assert.equal(save.response.status, 200, env.output);

  const borrowed = await request('/api/records/borrow-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deviceIds: devices.map(device => device.id),
      borrowerName: '批量测试用户',
      borrowerPhone: '13800138000',
      major: '网络安全',
      purpose: '重复字段邮件回归测试'
    })
  });
  assert.equal(borrowed.response.status, 200);
  assert.equal(borrowed.body.data.borrowed.length, 10);

  const messages = await waitForMessageCount(env.smtp, 1);
  assert.equal(messages.length, 1);
  const body = decodeMessageBody(messages[0]);
  const lines = body.split('\n');
  assert.equal(lines[0], '设备名称：' + devices.map(device => device.name).join('、'));
  assert.equal(lines[1], '设备型号：' + devices.map(device => device.model).join('、'));
  assert.equal(lines[2], '设备编号：' + devices.map(device => device.id).join('、'));
  assert.match(lines[3], /^借用时间：\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.match(body, /借用明细：/);
  assert.equal((body.match(/单反相机/g) || []).length, 10);
  assert.equal((body.match(/测试设备/g) || []).length, 10);
  assert.doesNotMatch(body, /&#x20;|\\/);
});

// 管理员批量归还邮件契约：多个借用人按组展示，姓名和电话不串用第一条记录。
test('batch administrator return groups different borrowers separately', async t => {
  const env = await startEmailTestServer();
  t.after(env.cleanup);

  const save = await request('/api/admin/email-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-session-id': env.sessionId },
    body: JSON.stringify({
      enabled: true,
      notifyBorrow: false,
      notifyReturn: false,
      notifyAdminReturn: true,
      recipients: ['admin@example.com'],
      smtp: { host: '127.0.0.1', port: env.smtp.port, security: 'none', username: 'sender@example.com', secret: 'secret' },
      templates: {
        borrow: { subject: '借出', body: '{{recordList}}' },
        return: { subject: '归还', body: '{{recordList}}' },
        adminReturn: { subject: '管理员批量归还', body: '归还明细\n{{recordList}}' }
      }
    })
  });
  assert.equal(save.response.status, 200, env.output);

  for (const [deviceId, borrowerName, borrowerPhone] of [
    ['DEV_EMAIL', '归还用户甲', '13700003333'],
    ['DEV_EMAIL_2', '归还用户乙', '13700004444']
  ]) {
    const borrowed = await request('/api/records/borrow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, borrowerName, borrowerPhone, major: '网络安全', purpose: '管理员批量归还' })
    });
    assert.equal(borrowed.response.status, 200);
  }

  const active = await request('/api/records/active', { headers: { 'x-session-id': env.sessionId } });
  const forceReturn = await request('/api/records/force-return-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-session-id': env.sessionId },
    body: JSON.stringify({ recordIds: active.body.data.map(record => record.id), notes: '管理员统一归还' })
  });
  assert.equal(forceReturn.response.status, 200);
  assert.equal(forceReturn.body.data.returned.length, 2);

  const messages = await waitForMessageCount(env.smtp, 1);
  assert.equal(messages.length, 1);
  const body = decodeMessageBody(messages[0]);
  assert.equal((body.match(/归\*{3}甲/g) || []).length, 1);
  assert.equal((body.match(/归\*{3}乙/g) || []).length, 1);
  assert.equal((body.match(/137\*\*\*\*/g) || []).length, 2);
  assert.match(body, /测试相机/);
  assert.match(body, /测试镜头/);
  assert.match(body, /归还明细/);
});

// 旧批量模板契约：多个借用人不能把第一人的姓名冒充成整封邮件的唯一借用人。
test('legacy batch template labels multiple borrowers before the detailed groups', async t => {
  const env = await startEmailTestServer();
  t.after(env.cleanup);

  const save = await request('/api/admin/email-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-session-id': env.sessionId },
    body: JSON.stringify({
      enabled: true,
      notifyBorrow: false,
      notifyReturn: false,
      notifyAdminReturn: true,
      recipients: ['admin@example.com'],
      smtp: { host: '127.0.0.1', port: env.smtp.port, security: 'none', username: 'sender@example.com', secret: 'secret' },
      templates: {
        borrow: { subject: '借出', body: '{{deviceName}}' },
        return: { subject: '归还', body: '{{deviceName}}' },
        adminReturn: { subject: '管理员归还：{{deviceName}}', body: '借用人：{{borrowerName}}\n联系电话：{{borrowerPhone}}\n设备：{{deviceName}}' }
      }
    })
  });
  assert.equal(save.response.status, 200, env.output);

  for (const [deviceId, borrowerName, borrowerPhone] of [
    ['DEV_EMAIL', '旧模板用户甲', '13700006666'],
    ['DEV_EMAIL_2', '旧模板用户乙', '13700007777']
  ]) {
    const borrowed = await request('/api/records/borrow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, borrowerName, borrowerPhone, major: '网络安全', purpose: '旧模板批量归还' })
    });
    assert.equal(borrowed.response.status, 200);
  }

  const active = await request('/api/records/active', { headers: { 'x-session-id': env.sessionId } });
  const forceReturn = await request('/api/records/force-return-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-session-id': env.sessionId },
    body: JSON.stringify({ recordIds: active.body.data.map(record => record.id), notes: '统一归还' })
  });
  assert.equal(forceReturn.response.status, 200);

  const messages = await waitForMessageCount(env.smtp, 1);
  const body = decodeMessageBody(messages[0]);
  assert.match(body, /借用人：多人（详见下方明细）/);
  assert.doesNotMatch(body.split('\n')[0], /借用人：旧\*+甲/);
  assert.match(body, /旧\*+甲/);
  assert.match(body, /旧\*+乙/);
  assert.match(body, /归还明细：/);
});

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
      close: () => new Promise(done => server.close(done))
    }));
  });
}

async function waitForServer() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/api/devices/available`);
      if (response.ok) return;
    } catch {
      // 服务仍在启动。
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('测试服务启动超时');
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
    child.kill();
    await smtp.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  await waitForServer();
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

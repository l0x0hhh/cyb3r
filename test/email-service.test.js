// SMTP 客户端契约：用本地伪服务器验证认证、收件人和 UTF-8 邮件内容。
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { sendSmtpMail } = require('../email-service');

function startFakeSmtpServer() {
  let receivedMessage = '';
  const server = net.createServer(socket => {
    socket.setEncoding('utf8');
    socket.write('220 fake.smtp.test ready\r\n');
    let buffer = '';
    let dataMode = false;
    let authStep = '';

    const handleCommand = line => {
      if (line.startsWith('EHLO ')) {
        socket.write('250-fake.smtp.test\r\n250 AUTH LOGIN\r\n');
      } else if (line === 'AUTH LOGIN') {
        authStep = 'username';
        socket.write('334 VXNlcm5hbWU6\r\n');
      } else if (authStep && /^[A-Za-z0-9+/=]+$/.test(line)) {
        if (authStep === 'username') {
          authStep = 'password';
          socket.write('334 UGFzc3dvcmQ6\r\n');
        } else if (authStep === 'password' && line === Buffer.from('secret', 'utf8').toString('base64')) {
          authStep = '';
          socket.write('235 2.7.0 authenticated\r\n');
        }
      } else if (line.startsWith('MAIL FROM:')) {
        socket.write('250 2.1.0 sender ok\r\n');
      } else if (line.startsWith('RCPT TO:')) {
        socket.write('250 2.1.5 recipient ok\r\n');
      } else if (line === 'DATA') {
        dataMode = true;
        socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
      } else if (line === 'QUIT') {
        socket.write('221 2.0.0 bye\r\n');
        socket.end();
        setTimeout(() => socket.destroy(), 20);
      }
    };

    socket.on('data', chunk => {
      buffer += chunk;
      if (dataMode) {
        const end = buffer.indexOf('\r\n.\r\n');
        if (end === -1) return;
        receivedMessage = buffer.slice(0, end);
        buffer = buffer.slice(end + 5);
        dataMode = false;
        socket.write('250 2.0.0 queued\r\n');
      }
      const lines = buffer.split('\r\n');
      buffer = lines.pop() || '';
      lines.filter(Boolean).forEach(handleCommand);
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      resolve({
        port: server.address().port,
        getMessage: () => receivedMessage,
        close: () => new Promise(done => server.close(done))
      });
    });
  });
}

test('SMTP client authenticates and sends a UTF-8 plain-text message', async t => {
  const fake = await startFakeSmtpServer();
  t.after(() => fake.close());

  await sendSmtpMail({
    smtp: {
      host: '127.0.0.1',
      port: fake.port,
      security: 'none',
      username: 'sender@example.com'
    },
    secret: 'secret',
    recipients: ['admin@example.com', 'backup@example.com'],
    subject: '设备借用通知',
    text: '设备名称：测试相机\n借用人：张三'
  });

  const message = fake.getMessage();
  assert.match(message, /From: <sender@example\.com>/);
  assert.match(message, /To: <admin@example\.com>, <backup@example\.com>/);
  assert.match(message, /Subject: =\?UTF-8\?B\?/);
  assert.match(message, /Content-Transfer-Encoding: base64/);
  const body = message.split('\r\n\r\n').at(-1).replace(/\r\n/g, '');
  assert.equal(Buffer.from(body, 'base64').toString('utf8'), '设备名称：测试相机\n借用人：张三');
});

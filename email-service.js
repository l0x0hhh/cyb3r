// 内置 SMTP 客户端：支持 SSL、STARTTLS 和授权码认证，不把邮件依赖带入生产部署。
const net = require('node:net');
const tls = require('node:tls');

const SMTP_TIMEOUT_MS = 15000;

function encodeMimeHeader(value) {
  return `=?UTF-8?B?${Buffer.from(String(value || ''), 'utf8').toString('base64')}?=`;
}

function wrapBase64(value) {
  const encoded = Buffer.from(String(value || ''), 'utf8').toString('base64');
  return encoded.match(/.{1,76}/g)?.join('\r\n') || '';
}

function createMessage({ from, recipients, subject, text }) {
  const toHeader = recipients.map(recipient => `<${recipient}>`).join(', ');
  return [
    `From: <${from}>`,
    `To: ${toHeader}`,
    `Subject: ${encodeMimeHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(text)
  ].join('\r\n');
}

class SmtpConnection {
  constructor({ host, port, security }) {
    this.host = host;
    this.port = Number(port);
    this.security = security;
    this.socket = null;
    this.buffer = '';
    this.responseWaiter = null;
  }

  async connect() {
    const socket = this.security === 'ssl'
      ? tls.connect({ host: this.host, port: this.port, servername: this.host })
      : net.connect({ host: this.host, port: this.port });
    await this.attachSocket(socket, this.security === 'ssl' ? 'secureConnect' : 'connect');
    await this.readResponse([220]);
    await this.command(`EHLO device-management-${process.pid}`,[250]);

    if (this.security === 'starttls') {
      await this.command('STARTTLS', [220]);
      this.detachSocket();
      const secureSocket = tls.connect({ socket: this.socket, servername: this.host });
      await this.attachSocket(secureSocket, 'secureConnect');
      await this.command(`EHLO device-management-${process.pid}`, [250]);
    }
  }

  attachSocket(socket, readyEvent) {
    this.socket = socket;
    this.buffer = '';
    socket.setEncoding('utf8');
    socket.setTimeout(SMTP_TIMEOUT_MS, () => socket.destroy(new Error('SMTP 连接超时')));
    return new Promise((resolve, reject) => {
      const onReady = () => {
        socket.removeListener('error', onError);
        resolve();
      };
      const onError = error => {
        socket.removeListener(readyEvent, onReady);
        reject(error);
      };
      socket.once(readyEvent, onReady);
      socket.once('error', onError);
    });
  }

  detachSocket() {
    if (!this.socket) return;
    this.socket.removeAllListeners('data');
    this.socket.removeAllListeners('error');
    this.socket.removeAllListeners('end');
    this.socket.removeAllListeners('close');
    this.socket.removeAllListeners('timeout');
  }

  readResponse(expectedCodes = []) {
    if (this.responseWaiter) throw new Error('SMTP 响应读取冲突');
    return new Promise((resolve, reject) => {
      this.responseWaiter = { expectedCodes, resolve, reject, lines: [] };
      let onData;
      let onError;
      let onEnd;
      const cleanup = () => {
        this.socket.removeListener('data', onData);
        this.socket.removeListener('error', onError);
        this.socket.removeListener('end', onEnd);
      };
      onData = chunk => {
        this.buffer += chunk;
        const lines = this.buffer.split('\r\n');
        this.buffer = lines.pop() || '';
        for (const line of lines) {
          const match = line.match(/^(\d{3})([ -])(.*)$/);
          if (!match) continue;
          this.responseWaiter.lines.push(line);
          if (match[2] !== ' ') continue;
          const response = this.responseWaiter;
          this.responseWaiter = null;
          cleanup();
          const code = Number(match[1]);
          if (response.expectedCodes.length && !response.expectedCodes.includes(code)) {
            response.reject(new Error(`SMTP 返回 ${code}: ${response.lines.join(' | ')}`));
          } else {
            response.resolve({ code, lines: response.lines });
          }
          return;
        }
      };
      onError = error => {
        if (!this.responseWaiter) return;
        this.responseWaiter = null;
        cleanup();
        reject(error);
      };
      onEnd = () => onError(new Error('SMTP 连接提前关闭'));
      this.socket.on('data', onData);
      this.socket.once('error', onError);
      this.socket.once('end', onEnd);
    });
  }

  async command(command, expectedCodes = []) {
    this.socket.write(`${command}\r\n`);
    return this.readResponse(expectedCodes);
  }

  async authenticate(username, secret) {
    let response;
    try {
      response = await this.command('AUTH LOGIN', [334]);
      if (!response) throw new Error('SMTP 未进入 AUTH LOGIN 流程');
      await this.command(Buffer.from(username, 'utf8').toString('base64'), [334]);
      await this.command(Buffer.from(secret, 'utf8').toString('base64'), [235]);
    } catch (error) {
      throw new Error(`SMTP 认证失败：${error.message}`);
    }
  }

  async send({ from, recipients, subject, text, username, secret }) {
    await this.connect();
    await this.authenticate(username, secret);
    await this.command(`MAIL FROM:<${from}>`, [250]);
    for (const recipient of recipients) {
      await this.command(`RCPT TO:<${recipient}>`, [250, 251]);
    }
    await this.command('DATA', [354]);
    this.socket.write(`${createMessage({ from, recipients, subject, text })}\r\n.\r\n`);
    await this.readResponse([250]);
    await this.command('QUIT', [221]);
  }

  close() {
    if (!this.socket || this.socket.destroyed) return;
    this.socket.end();
  }
}

async function sendSmtpMail({ smtp, secret, recipients, subject, text }) {
  const connection = new SmtpConnection(smtp);
  try {
    await connection.send({
      from: smtp.username,
      recipients,
      subject,
      text,
      username: smtp.username,
      secret
    });
  } finally {
    connection.close();
  }
}

module.exports = { sendSmtpMail, encodeMimeHeader, createMessage };

// 归还凭证按服务实例隔离，保留十分钟有效期和逐条消费规则。
const crypto = require('crypto');
const RETURN_TOKEN_TTL_MS = 10 * 60 * 1000;

function createReturnAuthorizationStore({ now = Date.now } = {}) {
  const returnAuthorizations = new Map();

  function createReturnAuthorization(recordIds) {
    const token = crypto.randomBytes(24).toString('hex');
    returnAuthorizations.set(token, {
      recordIds: [...recordIds],
      expiresAt: now() + RETURN_TOKEN_TTL_MS
    });
    return token;
  }

  function getReturnAuthorization(token) {
    const authorization = returnAuthorizations.get(String(token || ''));
    if (!authorization) return null;
    if (authorization.expiresAt <= now()) {
      returnAuthorizations.delete(String(token || ''));
      return null;
    }
    return authorization;
  }

  function removeReturnAuthorization(token) {
    returnAuthorizations.delete(token);
  }

  return { createReturnAuthorization, getReturnAuthorization, removeReturnAuthorization };
}

module.exports = { createReturnAuthorizationStore };

const { DatabaseSync } = require('node:sqlite');
const { randomBytes, createHash } = require('node:crypto');
const fs = require('node:fs');

const digest = value => createHash('sha256').update(value).digest('hex');
function readCookies(header = '') {
  const result = {};
  for (const item of String(header).split(';')) {
    const index = item.indexOf('=');
    if (index < 0) continue;
    const key = item.slice(0, index).trim();
    if (!Object.hasOwn(result, key)) result[key] = item.slice(index + 1).trim();
  }
  return result;
}

function createSiteState(databasePath, now = Date.now) {
  const db = new DatabaseSync(databasePath);
  try { fs.chmodSync(databasePath, 0o600); } catch {}
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS site_sessions(token_hash TEXT PRIMARY KEY, admin_id TEXT NOT NULL, auth_version TEXT NOT NULL, login_at TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS site_sessions_admin ON site_sessions(admin_id);
    CREATE TABLE IF NOT EXISTS visitor_devices(visitor_hash TEXT NOT NULL, record_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(visitor_hash,record_id));
    CREATE TABLE IF NOT EXISTS auth_failures(key_hash TEXT PRIMARY KEY, failures INTEGER NOT NULL, window_start INTEGER NOT NULL, blocked_until INTEGER NOT NULL DEFAULT 0);`);
  const failWindow=15*60*1000;
  const failureKeys=(username,ip,scope='login')=>[
    {key:digest(scope+':pair:'+JSON.stringify([username,ip])),limit:5},
    {key:digest(scope+':account:'+username),limit:10},
    {key:digest(scope+':ip:'+ip),limit:20}
  ];
  let lastCleanup = 0;
  function cleanup() {
    if (now() - lastCleanup < 3600000) return;
    db.prepare('DELETE FROM site_sessions WHERE expires_at<=?').run(now());
    db.prepare('DELETE FROM visitor_devices WHERE created_at<?').run(now() - 365 * 86400000);
    db.prepare('DELETE FROM auth_failures WHERE window_start<? AND blocked_until<=?').run(now()-failWindow,now());
    lastCleanup = now();
  }
  return {
    loginStatus(username,ip,scope='login') {
      cleanup();
      const remaining=failureKeys(username,ip,scope).map(({key})=>db.prepare('SELECT blocked_until FROM auth_failures WHERE key_hash=?').get(key)?.blocked_until || 0);
      return Math.max(0,Math.ceil((Math.max(...remaining)-now())/1000));
    },
    loginFailure(username,ip,scope='login') {
      const select=db.prepare('SELECT * FROM auth_failures WHERE key_hash=?');
      const write=db.prepare('INSERT OR REPLACE INTO auth_failures VALUES(?,?,?,?)');
      db.exec('BEGIN IMMEDIATE');
      try {
        for(const {key,limit} of failureKeys(username,ip,scope)) {
          const row=select.get(key);
          if(row?.blocked_until>now()) continue;
          const fresh=!row || row.window_start+failWindow<=now();
          const count=fresh?1:row.failures+1;
          write.run(key,count,fresh?now():row.window_start,count>=limit?now()+failWindow:0);
        }
        db.exec('COMMIT');
      } catch(error) {db.exec('ROLLBACK');throw error;}
    },
    loginSuccess(username,ip,scope='login') {
      for(const {key} of failureKeys(username,ip,scope).slice(0,2)) db.prepare('DELETE FROM auth_failures WHERE key_hash=?').run(key);
    },
    createSession(token, user, ttl) {
      cleanup();
      db.prepare('INSERT INTO site_sessions VALUES(?,?,?,?,?)').run(digest(token), user.id, digest(user.passwordHash), new Date(now()).toISOString(), now() + ttl);
    },
    getSession(token, getUser) {
      cleanup();
      if (!/^[a-f0-9]{32,64}$/.test(String(token || ''))) return null;
      const row = db.prepare('SELECT * FROM site_sessions WHERE token_hash=?').get(digest(token));
      if (!row) return null;
      const user = getUser(row.admin_id);
      if (row.expires_at <= now() || !user || row.auth_version !== digest(user.passwordHash)) {
        db.prepare('DELETE FROM site_sessions WHERE token_hash=?').run(digest(token));
        return null;
      }
      return { isAdmin:true, adminUserId:user.id, loginAt:row.login_at, expiresAt:row.expires_at };
    },
    revoke(token) { if (token) db.prepare('DELETE FROM site_sessions WHERE token_hash=?').run(digest(String(token))); },
    revokeUser(id) { db.prepare('DELETE FROM site_sessions WHERE admin_id=?').run(id); },
    attach(visitorHash, ids) {
      cleanup();
      const insert = db.prepare('INSERT OR IGNORE INTO visitor_devices VALUES(?,?,?)');
      for (const id of ids) insert.run(visitorHash, String(id), now());
    },
    records(visitorHash) { return db.prepare('SELECT record_id FROM visitor_devices WHERE visitor_hash=? ORDER BY created_at DESC LIMIT 100').all(visitorHash).map(row=>row.record_id); },
    close() { db.close(); }
  };
}

function siteCookies(req, res, next) {
  if (!req.path.startsWith('/api/')) return next();
  res.set('Cache-Control', 'no-store');
  const cookies = readCookies(req.headers.cookie);
  const valid = value => /^[A-Za-z0-9_-]{43}$/.test(value || '');
  // 接续旧物资访客标识，避免升级后丢失原浏览器的借用与录入关联。
  const legacy = req.path.startsWith('/api/v2/') && valid(cookies.materials_guest) ? cookies.materials_guest : null;
  const visitor = legacy || (valid(cookies.ccs_visitor) ? cookies.ccs_visitor : randomBytes(32).toString('base64url'));
  if (cookies.ccs_visitor !== visitor) res.cookie('ccs_visitor', visitor, { httpOnly:true, sameSite:'lax', secure:req.secure, path:'/', maxAge:365 * 86400000 });
  if (legacy) res.clearCookie('materials_guest', { httpOnly:true, sameSite:'strict', secure:req.secure, path:'/api/v2' });
  req.siteVisitorHash = digest(visitor);
  req.adminToken = req.headers['x-session-id'] || cookies.ccs_admin || '';
  if (!['GET','HEAD','OPTIONS'].includes(req.method)) {
    const expected = `${req.protocol}://${req.get('host')}`;
    if ((req.headers.origin && req.headers.origin !== expected) || req.headers['sec-fetch-site'] === 'cross-site') {
      return res.status(403).json({ success:false, message:'请在本站页面提交操作' });
    }
  }
  next();
}
module.exports = { createSiteState, siteCookies, readCookies };

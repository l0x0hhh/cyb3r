const { DatabaseSync } = require('node:sqlite');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

class MaterialError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const fail = (message, status) => { throw new MaterialError(message, status); };
const hash = value => createHash('sha256').update(String(value)).digest('hex');
const now = () => new Date().toISOString();
function text(value, label, max = 200, required = true) {
  const result = String(value ?? '').trim();
  if ((required && !result) || result.length > max) fail(`${label}${!result ? '不能为空' : `不能超过${max}字`}`);
  return result;
}
function quantity(value, label = '数量', allowZero = false) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > 1000000) fail(`${label}应为${allowZero ? '非负' : '正'}整数，且不超过100万`);
  return value;
}
const json = value => JSON.stringify(value);
function phoneKey(value) {
  return String(value ?? '').trim().replace(/[\s()-]/g, '');
}
function checkedPhone(value) {
  const phone = text(value, '手机号码', 30);
  if (!/^\+?\d{6,20}$/.test(phoneKey(phone))) fail('请填写完整有效的手机号码');
  return phone;
}
function consumptionPercent(value) {
  if (!Number.isInteger(value) || value < 0 || value > 100) fail('消耗审核阈值应为0至100的整数百分比');
  return value;
}

function createMaterialsStore({ databasePath, demo = false }) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS mat_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS mat_materials(
      id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, model TEXT NOT NULL,
      unit TEXT NOT NULL, location TEXT NOT NULL, consumable INTEGER NOT NULL CHECK(consumable IN(0,1)),
      quantity INTEGER NOT NULL CHECK(quantity>=0), quarantine INTEGER NOT NULL DEFAULT 0 CHECK(quarantine>=0),
      images TEXT NOT NULL DEFAULT '[]', notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN('active','inactive')), created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS mat_uploads(image TEXT PRIMARY KEY, owner_hash TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS mat_loans(
      id TEXT PRIMARY KEY, owner_hash TEXT NOT NULL, receipt_hash TEXT NOT NULL UNIQUE,
      request_id TEXT NOT NULL, request_hash TEXT NOT NULL, name TEXT NOT NULL, phone TEXT NOT NULL,
      organization TEXT NOT NULL, purpose TEXT NOT NULL, due_at TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(owner_hash,request_id));
    CREATE TABLE IF NOT EXISTS mat_access(owner_hash TEXT NOT NULL, loan_id TEXT NOT NULL REFERENCES mat_loans(id), PRIMARY KEY(owner_hash,loan_id));
    CREATE TABLE IF NOT EXISTS mat_lookup_access(
      owner_hash TEXT NOT NULL, loan_id TEXT NOT NULL REFERENCES mat_loans(id), expires_at INTEGER NOT NULL,
      PRIMARY KEY(owner_hash,loan_id));
    CREATE TABLE IF NOT EXISTS mat_lines(
      id TEXT PRIMARY KEY, loan_id TEXT NOT NULL REFERENCES mat_loans(id), material_id TEXT NOT NULL REFERENCES mat_materials(id),
      name TEXT NOT NULL, unit TEXT NOT NULL, location TEXT NOT NULL, image TEXT NOT NULL DEFAULT '', consumable INTEGER NOT NULL,
      borrowed INTEGER NOT NULL CHECK(borrowed>0), returned INTEGER NOT NULL DEFAULT 0 CHECK(returned>=0),
      damaged INTEGER NOT NULL DEFAULT 0 CHECK(damaged>=0), consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed>=0),
      lost INTEGER NOT NULL DEFAULT 0 CHECK(lost>=0), CHECK(returned+damaged+consumed+lost<=borrowed));
    CREATE TABLE IF NOT EXISTS mat_returns(
      id TEXT PRIMARY KEY, loan_id TEXT NOT NULL REFERENCES mat_loans(id), owner_hash TEXT NOT NULL,
      request_id TEXT NOT NULL, request_hash TEXT NOT NULL, lines TEXT NOT NULL, notes TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','rejected')),
      review_note TEXT NOT NULL DEFAULT '', reviewed_by TEXT, created_at TEXT NOT NULL, reviewed_at TEXT,
      UNIQUE(owner_hash,request_id));
    CREATE TABLE IF NOT EXISTS mat_entries(
      id TEXT PRIMARY KEY, owner_hash TEXT NOT NULL, request_id TEXT NOT NULL, request_hash TEXT NOT NULL,
      submitter TEXT NOT NULL, data TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','rejected')),
      material_id TEXT REFERENCES mat_materials(id), review_note TEXT NOT NULL DEFAULT '', reviewed_by TEXT,
      created_at TEXT NOT NULL, reviewed_at TEXT, UNIQUE(owner_hash,request_id));
    CREATE TABLE IF NOT EXISTS mat_ledger(
      id INTEGER PRIMARY KEY AUTOINCREMENT, material_id TEXT NOT NULL REFERENCES mat_materials(id),
      type TEXT NOT NULL, delta INTEGER NOT NULL, quarantine_delta INTEGER NOT NULL DEFAULT 0,
      outstanding_delta INTEGER NOT NULL DEFAULT 0, balance INTEGER NOT NULL, reference TEXT NOT NULL,
      actor TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS mat_loans_owner ON mat_loans(owner_hash);
    CREATE INDEX IF NOT EXISTS mat_lines_loan ON mat_lines(loan_id);
    CREATE INDEX IF NOT EXISTS mat_lines_material ON mat_lines(material_id);
    CREATE INDEX IF NOT EXISTS mat_ledger_material_id ON mat_ledger(material_id,id);
    CREATE INDEX IF NOT EXISTS mat_return_status ON mat_returns(status);`);
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); db.exec('COMMIT'); return value; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  // 原借用单ID保持不变，增量增加手机号查询索引并回填既有记录。
  transaction(() => {
    if (!all('PRAGMA table_info(mat_loans)').some(column => column.name === 'phone_key')) {
      db.exec("ALTER TABLE mat_loans ADD COLUMN phone_key TEXT NOT NULL DEFAULT ''");
      for (const loan of all('SELECT id,phone FROM mat_loans')) run('UPDATE mat_loans SET phone_key=? WHERE id=?', phoneKey(loan.phone), loan.id);
    }
    if (!all('PRAGMA table_info(mat_materials)').some(column => column.name === 'consumption_review_percent')) {
      db.exec('ALTER TABLE mat_materials ADD COLUMN consumption_review_percent INTEGER NOT NULL DEFAULT 30 CHECK(consumption_review_percent BETWEEN 0 AND 100)');
    }
    db.exec('CREATE INDEX IF NOT EXISTS mat_loans_phone_name ON mat_loans(phone_key,name); PRAGMA user_version=3;');
  });
  function ledger(id, type, delta, q, outstanding, reference, actor, note = '') {
    run('INSERT INTO mat_ledger(material_id,type,delta,quarantine_delta,outstanding_delta,balance,reference,actor,note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
      id, type, delta, q, outstanding, get('SELECT quantity FROM mat_materials WHERE id=?', id).quantity, reference, actor, note, now());
  }
  function normalizeMaterial(input) {
    return {
      name: text(input.name, '物资名称', 80), category: text(input.category || '其他物资', '分类', 30),
      model: text(input.model, '规格', 100, false), unit: text(input.unit, '单位', 10),
      location: text(input.location, '存放地点', 100), consumable: input.consumable === true ? 1 : 0,
      quantity: quantity(input.quantity, '入库数量'), notes: text(input.notes, '备注', 1000, false),
      consumptionLimitPercent: consumptionPercent(input.consumptionLimitPercent ?? 30),
      images: Array.isArray(input.images) && input.images.length <= 6 ? input.images.map(image => text(image, '图片地址', 200)) : fail('最多上传6张图片')
    };
  }
  function checkImages(images, owner) {
    for (const image of images) if (!get('SELECT image FROM mat_uploads WHERE image=? AND owner_hash=?', image, owner)) fail('图片不存在或不属于本次提交者');
  }
  function insertMaterial(data, actor, reference) {
    const id = randomUUID();
    run('INSERT INTO mat_materials(id,name,category,model,unit,location,consumable,quantity,images,notes,created_at,consumption_review_percent) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      id, data.name, data.category, data.model, data.unit, data.location, data.consumable, data.quantity, json(data.images), data.notes, now(), data.consumptionLimitPercent ?? 30);
    ledger(id, '入库', data.quantity, 0, 0, reference || id, actor);
    return id;
  }
  function listMaterials(admin = false) {
    return all(`SELECT m.*, COALESCE(t.outstanding,0) outstanding FROM mat_materials m LEFT JOIN (SELECT material_id,SUM(borrowed-returned-damaged-consumed-lost) outstanding FROM mat_lines GROUP BY material_id) t ON t.material_id=m.id ${admin ? '' : "WHERE status='active'"} ORDER BY m.created_at,m.id`)
      .map(row => ({ ...row, consumable: Boolean(row.consumable), images: JSON.parse(row.images) }));
  }
  function remaining(line) { return line.borrowed - line.returned - line.damaged - line.consumed - line.lost; }
  function canAccess(id, owner) {
    return Boolean(get(`SELECT id FROM mat_loans WHERE id=? AND (owner_hash=?
      OR EXISTS(SELECT 1 FROM mat_access WHERE loan_id=mat_loans.id AND owner_hash=?)
      OR EXISTS(SELECT 1 FROM mat_lookup_access WHERE loan_id=mat_loans.id AND owner_hash=? AND expires_at>?))`, id, owner, owner, owner, Date.now()));
  }
  function loanRecords(owner, admin = false) {
    const rows = admin ? all('SELECT * FROM mat_loans ORDER BY created_at DESC') : all(`SELECT * FROM mat_loans WHERE owner_hash=?
      OR id IN(SELECT loan_id FROM mat_access WHERE owner_hash=?)
      OR id IN(SELECT loan_id FROM mat_lookup_access WHERE owner_hash=? AND expires_at>?) ORDER BY created_at DESC`, owner, owner, owner, Date.now());
    return formatLoanRecords(rows, admin);
  }
  function formatLoanRecords(rows, admin = false) {
    return rows.map(row => {
      const lines = all('SELECT l.*,m.consumption_review_percent FROM mat_lines l JOIN mat_materials m ON m.id=l.material_id WHERE l.loan_id=?', row.id).map(line => ({ ...line, consumable: Boolean(line.consumable), remaining: remaining(line) }));
      const returns = all('SELECT id,lines,notes,status,review_note,created_at,reviewed_at FROM mat_returns WHERE loan_id=? ORDER BY created_at DESC', row.id).map(r => ({ ...r, lines: JSON.parse(r.lines) }));
      return { id: row.id, name: admin ? row.name : `${row.name.slice(0, 1)}${'*'.repeat(Math.min(row.name.length - 1, 3))}`,
        phone: admin ? row.phone : `${row.phone.slice(0, 3)}****${row.phone.slice(-2)}`, organization: row.organization,
        purpose: row.purpose, due_at: row.due_at, created_at: row.created_at, lines, returns,
        remaining: lines.reduce((sum, line) => sum + line.remaining, 0) };
    });
  }
  function lookupRecords(owner, input) {
    const name = text(input.name, '借用人姓名', 40), phone = checkedPhone(input.phone);
    return transaction(() => {
      const rows = all(`SELECT l.* FROM mat_loans l WHERE l.phone_key=? AND l.name=?
        AND EXISTS(SELECT 1 FROM mat_lines WHERE loan_id=l.id AND borrowed-returned-damaged-consumed-lost>0)
        ORDER BY l.created_at DESC,l.id`, phoneKey(phone), name);
      // 查询结果仅授权本次精确匹配的单据；换一组查询条件时撤销前次查询授权。
      run('DELETE FROM mat_lookup_access WHERE owner_hash=? OR expires_at<=?', owner, Date.now());
      const expiresAt = Date.now() + 10 * 60 * 1000;
      for (const row of rows) run('INSERT INTO mat_lookup_access(owner_hash,loan_id,expires_at) VALUES(?,?,?)', owner, row.id, expiresAt);
      return formatLoanRecords(rows);
    });
  }
  function borrow(owner, input) {
    const requestId = text(input.requestId, '请求标识', 100);
    const fingerprint = hash(json(input));
    return transaction(() => {
      const previous = get('SELECT id,request_hash FROM mat_loans WHERE owner_hash=? AND request_id=?', owner, requestId);
      if (previous) {
        if (previous.request_hash !== fingerprint) fail('同一请求标识不能用于不同的借用内容', 409);
        return { id: previous.id, repeated: true };
      }
      const name = text(input.name, '姓名', 40), phone = checkedPhone(input.phone);
      const organization = text(input.organization, '所属组织／专业', 80), purpose = text(input.purpose, '用途', 300);
      const due = new Date(input.dueAt);
      if (!Number.isFinite(due.getTime()) || due.getTime() <= Date.now()) fail('预计归还时间应晚于当前时间');
      if (!Array.isArray(input.items) || !input.items.length || input.items.length > 30) fail('请选择1至30种物资');
      const seen = new Set(), items = input.items.map(item => {
        if (seen.has(item.materialId)) fail('同一物资请合并数量'); seen.add(item.materialId);
        const qty = quantity(item.quantity), material = get('SELECT * FROM mat_materials WHERE id=?', String(item.materialId));
        if (!material || material.status !== 'active') fail('物资不存在或已停用', 409);
        if (material.quantity < qty) fail(`${material.name}库存不足，目前可借${material.quantity}${material.unit}`, 409);
        return { material, qty };
      });
      const id = `B${Date.now().toString(36).toUpperCase()}${randomBytes(3).toString('hex').toUpperCase()}`;
      const receipt = randomBytes(24).toString('base64url');
      run('INSERT INTO mat_loans(id,owner_hash,receipt_hash,request_id,request_hash,name,phone,phone_key,organization,purpose,due_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', id, owner, hash(receipt), requestId, fingerprint, name, phone, phoneKey(phone), organization, purpose, due.toISOString(), now());
      for (const { material: m, qty } of items) {
        const updated = run("UPDATE mat_materials SET quantity=quantity-? WHERE id=? AND quantity>=? AND status='active'", qty, m.id, qty);
        if (updated.changes !== 1) fail('库存已变化，请刷新后重试', 409);
        run('INSERT INTO mat_lines(id,loan_id,material_id,name,unit,location,image,consumable,borrowed) VALUES(?,?,?,?,?,?,?,?,?)', randomUUID(), id, m.id, m.name, m.unit, m.location, JSON.parse(m.images)[0] || '', m.consumable, qty);
        ledger(m.id, '借出', -qty, 0, qty, id, '用户借用');
      }
      return { id, receipt, repeated: false };
    });
  }
  function restore(owner, receipt) {
    const loan = get('SELECT id FROM mat_loans WHERE receipt_hash=?', hash(text(receipt, '借用凭证', 100)));
    if (!loan) fail('凭证无效，请检查或联系管理员', 404);
    run('INSERT OR IGNORE INTO mat_access(owner_hash,loan_id) VALUES(?,?)', owner, loan.id);
    return { id: loan.id };
  }
  function submitReturn(owner, input) {
    const requestId = text(input.requestId, '请求标识', 100), fingerprint = hash(json(input));
    return transaction(() => {
      const previous = get('SELECT id,request_hash,status FROM mat_returns WHERE owner_hash=? AND request_id=?', owner, requestId);
      if (previous) { if (previous.request_hash !== fingerprint) fail('请求内容已变化', 409); return { id: previous.id, status: previous.status, repeated: true }; }
      if (!canAccess(input.loanId, owner)) fail('没有此单据权限，请先使用姓名＋手机号查询后再提交归还', 403);
      if (!Array.isArray(input.lines) || !input.lines.length || input.lines.length > 30) fail('请选择需要归还的物资');
      const notes = text(input.notes, '说明', 1000, false), seen = new Set();
      const pending = all("SELECT lines FROM mat_returns WHERE loan_id=? AND status='pending'", input.loanId).flatMap(r => JSON.parse(r.lines).map(line => line.lineId));
      const lines = input.lines.map(item => {
        const line = get('SELECT * FROM mat_lines WHERE id=? AND loan_id=?', String(item.lineId), input.loanId);
        if (!line || seen.has(line.id)) fail('物资明细不存在或重复'); seen.add(line.id);
        if (pending.includes(line.id)) fail(`${line.name}已有待确认归还，请等待处理`, 409);
        const data = { lineId: line.id, name: line.name, unit: line.unit, good: quantity(item.good, '完好归还量', true), damaged: quantity(item.damaged, '破损量', true), consumed: quantity(item.consumed, '消耗量', true), lost: quantity(item.lost, '异常核销量', true) };
        const sum = data.good + data.damaged + data.consumed + data.lost;
        if (sum === 0 || sum > remaining(line)) fail(`${line.name}申报合计应为1至${remaining(line)}${line.unit}`);
        if (data.consumed && !line.consumable) fail(`${line.name}不是消耗品，请使用异常核销并说明原因`);
        if ((data.consumed || data.damaged || data.lost) && !notes) fail('消耗、破损或异常核销请填写情况说明');
        const policy = get('SELECT consumption_review_percent FROM mat_materials WHERE id=?', line.material_id).consumption_review_percent;
        if (data.consumed > 0 && data.consumed * 100 > line.borrowed * policy) {
          data.reviewReason = `本次消耗${data.consumed}${line.unit}超过原借出${line.borrowed}${line.unit}的${policy}%`;
        }
        data.needsReview = Boolean(data.reviewReason || data.damaged || data.lost);
        return data;
      });
      const id = randomUUID();
      run('INSERT INTO mat_returns(id,loan_id,owner_hash,request_id,request_hash,lines,notes,created_at) VALUES(?,?,?,?,?,?,?,?)', id, input.loanId, owner, requestId, fingerprint, json(lines), notes, now());
      const needsReview = lines.some(line => line.needsReview);
      if (!needsReview) {
        settleReturnLines(id, lines, 'system:auto');
        run("UPDATE mat_returns SET status='approved',review_note=?,reviewed_by='system:auto',reviewed_at=? WHERE id=?", '正常归还／阈值内消耗，系统自动结算', now(), id);
      }
      return { id, status: needsReview ? 'pending' : 'approved' };
    });
  }
  function settleReturnLines(id, lines, actor) {
    for (const data of lines) {
      const line = get('SELECT * FROM mat_lines WHERE id=?', data.lineId);
      const sum = data.good + data.damaged + data.consumed + data.lost;
      if (sum > remaining(line)) fail('待处理数量已变化，不能超量确认', 409);
      run('UPDATE mat_lines SET returned=returned+?,damaged=damaged+?,consumed=consumed+?,lost=lost+? WHERE id=?', data.good, data.damaged, data.consumed, data.lost, line.id);
      run('UPDATE mat_materials SET quantity=quantity+?,quarantine=quarantine+? WHERE id=?', data.good, data.damaged, line.material_id);
      ledger(line.material_id, '归还结算', data.good, data.damaged, -sum, id, actor, `完好${data.good}，破损${data.damaged}，消耗${data.consumed}，异常${data.lost}`);
    }
  }
  function confirmNormalReturn(owner, id) {
    return transaction(() => {
      const request = get('SELECT * FROM mat_returns WHERE id=?', id);
      if (!request || !canAccess(request.loan_id, owner)) fail('没有此单据权限，请先查询借用记录', 403);
      const lines = JSON.parse(request.lines);
      if (lines.some(line => line.consumed > 0 || line.damaged > 0 || line.lost > 0)) fail('此记录包含消耗或异常，不能按正常归还确认');
      if (request.status === 'approved') return { id, status:'approved', repeated:true };
      if (request.status !== 'pending') fail('此记录已驳回，请重新提交归还', 409);
      settleReturnLines(id, lines, 'system:auto');
      run("UPDATE mat_returns SET status='approved',review_note=?,reviewed_by='system:auto',reviewed_at=? WHERE id=?", '借用人按新规则确认正常归还', now(), id);
      return { id, status:'approved' };
    });
  }
  function reviewReturn(id, decision, reviewNote, actor) {
    if (!['approved', 'rejected'].includes(decision)) fail('审核结果无效');
    const note = text(reviewNote, '审核意见', 1000, decision === 'rejected');
    return transaction(() => {
      const request = get('SELECT * FROM mat_returns WHERE id=?', id);
      if (!request) fail('归还申请不存在', 404);
      if (request.status !== 'pending') { if (request.status === decision) return { repeated: true }; fail('此申请已处理', 409); }
      if (decision === 'approved') settleReturnLines(id, JSON.parse(request.lines), actor);
      run("UPDATE mat_returns SET status=?,review_note=?,reviewed_by=?,reviewed_at=? WHERE id=? AND status='pending'", decision, note, actor, now(), id);
      return { id };
    });
  }
  function submitEntry(owner, input) {
    const requestId = text(input.requestId, '请求标识', 100), fingerprint = hash(json(input));
    return transaction(() => {
      const previous = get('SELECT id,request_hash FROM mat_entries WHERE owner_hash=? AND request_id=?', owner, requestId);
      if (previous) { if (previous.request_hash !== fingerprint) fail('请求内容已变化', 409); return { id: previous.id, repeated: true }; }
      const data = normalizeMaterial({ ...input, consumptionLimitPercent:30 }); checkImages(data.images, owner);
      const submitter = text(input.submitter, '录入人', 40), id = randomUUID();
      run('INSERT INTO mat_entries(id,owner_hash,request_id,request_hash,submitter,data,created_at) VALUES(?,?,?,?,?,?,?)', id, owner, requestId, fingerprint, submitter, json(data), now());
      return { id };
    });
  }
  function reviewEntry(id, decision, note, actor, targetId) {
    if (!['approved', 'rejected'].includes(decision)) fail('审核结果无效');
    const reviewNote = text(note, '审核意见', 1000, decision === 'rejected');
    return transaction(() => {
      const entry = get('SELECT * FROM mat_entries WHERE id=?', id);
      if (!entry) fail('录入申请不存在', 404);
      if (entry.status !== 'pending') { if (entry.status === decision) return { repeated: true }; fail('此申请已处理', 409); }
      let materialId = null;
      if (decision === 'approved') {
        const data = JSON.parse(entry.data);
        if (targetId) {
          const target = get('SELECT * FROM mat_materials WHERE id=?', targetId);
          if (!target || target.name !== data.name || target.unit !== data.unit || target.model !== data.model || target.location !== data.location || target.consumable !== data.consumable) fail('合并入库的名称、规格、单位、地点和消耗属性必须一致');
          run('UPDATE mat_materials SET quantity=quantity+? WHERE id=?', data.quantity, targetId);
          ledger(targetId, '补充入库', data.quantity, 0, 0, id, actor); materialId = targetId;
        } else materialId = insertMaterial(data, actor, id);
      }
      run('UPDATE mat_entries SET status=?,material_id=?,review_note=?,reviewed_by=?,reviewed_at=? WHERE id=?', decision, materialId, reviewNote, actor, now(), id);
      return { id, materialId };
    });
  }
  function entries(owner, admin = false) {
    return (admin ? all('SELECT * FROM mat_entries ORDER BY created_at DESC') : all('SELECT * FROM mat_entries WHERE owner_hash=? ORDER BY created_at DESC', owner))
      .map(({ owner_hash, request_id, request_hash, ...entry }) => ({ ...entry, data: JSON.parse(entry.data) }));
  }
  function adminReturns() {
    return all('SELECT r.id,r.loan_id,r.lines,r.notes,r.status,r.review_note,r.created_at,r.reviewed_at,l.name,l.organization FROM mat_returns r JOIN mat_loans l ON l.id=r.loan_id ORDER BY r.created_at DESC')
      .map(row => ({ ...row, lines: JSON.parse(row.lines) }));
  }
  function addMaterial(owner, input, actor) {
    const data = normalizeMaterial(input); checkImages(data.images, owner);
    return transaction(() => ({ id: insertMaterial(data, actor) }));
  }
  function adjust(id, delta, reason, actor) {
    if (!Number.isSafeInteger(delta) || !delta || Math.abs(delta) > 1000000) fail('调整数量应为非零整数，且不超过100万');
    const note = text(reason, '调整原因', 300);
    return transaction(() => {
      if (run('UPDATE mat_materials SET quantity=quantity+? WHERE id=? AND quantity+?>=0', delta, id, delta).changes !== 1) fail('物资不存在或调整后库存小于零');
      ledger(id, '盘点调整', delta, 0, 0, randomUUID(), actor, note); return { id };
    });
  }
  function stocktake(id, input, actor) {
    const counted = quantity(input.counted, '实盘完好在库数量', true);
    const expected = quantity(input.expected, '账面数量', true);
    const note = text(input.reason, '盘点原因', 300);
    const requestId = text(input.requestId, '盘点请求标识', 100);
    const key = `stocktake:${requestId}`, fingerprint = hash(json({ id, counted, expected, note, actor }));
    return transaction(() => {
      const previous = get('SELECT value FROM mat_meta WHERE key=?', key);
      if (previous) { if (previous.value !== fingerprint) fail('盘点请求内容已变化', 409); return { repeated:true }; }
      const material = get('SELECT quantity FROM mat_materials WHERE id=?', id);
      if (!material) fail('物资不存在', 404);
      if (material.quantity !== expected) fail('盘点期间库存已变化，请刷新后重新核对', 409);
      run('UPDATE mat_materials SET quantity=? WHERE id=?', counted, id);
      ledger(id, '实物盘点', counted-expected, 0, 0, requestId, actor, `账面${expected}，实盘${counted}；${note}`);
      run('INSERT INTO mat_meta(key,value) VALUES(?,?)', key, fingerprint);
      return { before:expected, after:counted, difference:counted-expected };
    });
  }
  function consumptionAlerts() {
    return all(`SELECT l.id loan_id, x.id line_id, x.name, x.unit, x.borrowed, x.consumed,
      m.consumption_review_percent threshold FROM mat_lines x
      JOIN mat_loans l ON l.id=x.loan_id JOIN mat_materials m ON m.id=x.material_id
      WHERE x.consumable=1 AND x.consumed>0 AND x.consumed*100>x.borrowed*m.consumption_review_percent
      ORDER BY l.created_at DESC LIMIT 100`);
  }
  function setConsumptionPolicy(id, percent, actor) {
    consumptionPercent(percent);
    return transaction(() => {
      const material = get('SELECT * FROM mat_materials WHERE id=?', id);
      if (!material) fail('物资不存在', 404);
      if (!material.consumable) fail('仅消耗品设置消耗审核阈值');
      run('UPDATE mat_materials SET consumption_review_percent=? WHERE id=?', percent, id);
      ledger(id, '审核规则调整', 0, 0, 0, id, actor, `单次消耗审核阈值：${material.consumption_review_percent}% → ${percent}%`);
      return { id, consumptionLimitPercent:percent };
    });
  }
  function setStatus(id, status, actor) {
    if (!['active', 'inactive'].includes(status)) fail('状态无效');
    return transaction(() => {
      const material = get('SELECT * FROM mat_materials WHERE id=?', id);
      if (!material) fail('物资不存在', 404);
      if (status === 'inactive' && get('SELECT COALESCE(SUM(borrowed-returned-damaged-consumed-lost),0) value FROM mat_lines WHERE material_id=?', id).value > 0) fail('物资仍有借出数量，结清后可停用', 409);
      if (material.status === status) return { id, repeated: true };
      run('UPDATE mat_materials SET status=? WHERE id=?', status, id);
      ledger(id, status === 'active' ? '启用' : '停用', 0, 0, 0, id, actor); return { id };
    });
  }
  function importMaterials(owner, inputs, actor, batchId) {
    if (!Array.isArray(inputs) || !inputs.length || inputs.length > 500) fail('每次导入1至500行');
    const key = `import:${text(batchId, '导入批次', 100)}`, fingerprint = hash(json(inputs));
    return transaction(() => {
      const previous = get('SELECT value FROM mat_meta WHERE key=?', key);
      if (previous) { if (previous.value !== fingerprint) fail('同一批次不能导入不同内容', 409); return { repeated: true, count: inputs.length }; }
      const materials = inputs.map(input => { const data = normalizeMaterial(input); checkImages(data.images, owner); return data; });
      for (const data of materials) insertMaterial(data, actor, key);
      run('INSERT INTO mat_meta(key,value) VALUES(?,?)', key, fingerprint); return { count: materials.length };
    });
  }
  if (demo && !get("SELECT key FROM mat_meta WHERE key='demo_seeded'")) transaction(() => {
    if (get('SELECT COUNT(*) count FROM mat_materials').count === 0) {
      const examples = [
        ['活动折叠椅', '活动器材', '便携折叠款', '把', '物资室 / A柜', false, 24, 'chairs', '适用于讲座、迎新及户外活动，请保持清洁后归还。'],
        ['无线麦克风', '电子设备', 'U段一拖二', '支', '物资室 / B柜', false, 6, 'microphone', '借用前检查电量；请与接收器配套使用。'],
        ['一次性纸杯', '消耗品', '250ml / 单个计量', '个', '物资室 / C柜', true, 200, 'cups', '未使用的纸杯可归还，实际消耗需说明活动用途。'],
        ['便携插线板', '电子设备', '6位 / 3米', '个', '物资室 / B柜', false, 12, 'power', '使用后整理线材，发现破损请在归还时说明。'],
        ['透明胶带', '办公用品', '48mm × 60m', '卷', '物资室 / C柜', true, 18, 'tape', '按卷借用与结算，使用完毕可提交消耗核销。'],
        ['活动手持旗', '活动器材', '学院主题 / 标准款', '面', '物资室 / A柜', false, 30, 'flag', '活动结束请清点数量并整齐收纳。']
      ];
      for (const [name, category, model, unit, location, consumable, qty, image, notes] of examples) insertMaterial({ name, category, model, unit, location, consumable: Number(consumable), quantity: qty, images: [`/assets/materials/${image}.svg`], notes }, '演示初始化');
    }
    run("INSERT INTO mat_meta(key,value) VALUES('demo_seeded','1')");
  });
  return { databasePath, listMaterials, borrow, loanRecords, lookupRecords, restore, submitReturn, confirmNormalReturn, reviewReturn, submitEntry, reviewEntry,
    entries, adminReturns, addMaterial, adjust, stocktake, consumptionAlerts, setConsumptionPolicy, setStatus, importMaterials,
    registerImage: (owner, image) => run('INSERT INTO mat_uploads(image,owner_hash,created_at) VALUES(?,?,?)', image, owner, now()),
    ledger: () => all('SELECT l.*,m.name,m.unit FROM mat_ledger l JOIN mat_materials m ON m.id=l.material_id ORDER BY l.id DESC LIMIT 1000'),
    close: () => db.close() };
}
module.exports = { createMaterialsStore, MaterialError, hash };

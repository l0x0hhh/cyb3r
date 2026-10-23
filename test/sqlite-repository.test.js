// 仓储差异写入契约：仅用内存 SQLite 和合成数据观察行变更、快照顺序及异常回滚。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');

const repositoryPath = path.join(__dirname, '..', 'db', 'repository.js');
const source = fs.readFileSync(repositoryPath, 'utf8');
const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

function openStore(t) {
  // 仅替换依赖入口，不改仓储公开签名；运行完整仓储 SQL，不创建或读取任何业务数据库文件。
  let db;
  let closeCalls = 0;
  const commands = [];
  class MemoryDatabase extends DatabaseSync {
    constructor() {
      super(':memory:');
      db = this;
      super.exec(schema);
      super.exec(`
        CREATE TEMP TABLE record_writes (kind TEXT, id TEXT);
        CREATE TEMP TRIGGER record_insert AFTER INSERT ON records
        BEGIN INSERT INTO record_writes VALUES ('insert', NEW.id); END;
        CREATE TEMP TRIGGER record_update AFTER UPDATE ON records
        BEGIN INSERT INTO record_writes VALUES ('update', NEW.id); END;
        CREATE TEMP TRIGGER record_delete AFTER DELETE ON records
        BEGIN INSERT INTO record_writes VALUES ('delete', OLD.id); END;
      `);
    }
    exec(sql) {
      commands.push(sql);
      return super.exec(sql);
    }
    close() {
      closeCalls += 1;
      return super.close();
    }
  }
  const loaded = { exports: {} };
  const load = vm.compileFunction(source, ['require', 'module', 'exports'], { filename: repositoryPath });
  load(name => {
    if (name === 'node:fs') return { existsSync: () => true };
    if (name === 'node:sqlite') return { DatabaseSync: MemoryDatabase };
    if (name === '../scripts/migrate-json-to-sqlite') {
      return { migrate: () => { throw new Error('This fixture must never migrate a database'); } };
    }
    return require(name);
  }, loaded, loaded.exports);
  const store = loaded.exports.createSqliteStore({ dataDir: __dirname, databasePath: ':memory:' });
  t.after(() => store.close());
  return {
    store, db, commands,
    get closeCalls() { return closeCalls; },
    writes: () => db.prepare('SELECT * FROM record_writes ORDER BY rowid').all().map(row => ({ ...row })),
    clearWrites: () => db.exec('DELETE FROM record_writes'),
    rawRows: () => db.prepare('SELECT rowid AS snapshot_rowid, * FROM records ORDER BY rowid').all().map(row => ({ ...row }))
  };
}

function record(id, extra = {}) {
  return {
    id, deviceId: 'DEV_SYNTHETIC', deviceName: '合成设备', deviceModel: '',
    borrowerName: '合成用户', borrowerPhone: 'masked-example',
    createdAt: '2026-10-23T00:00:00.000Z', ...extra
  };
}

test('unchanged full snapshots perform zero record writes after field normalization', t => {
  const fixture = openStore(t);
  const { store } = fixture;
  const input = [record('REC_A', { deviceId: '', returnedAt: '', deletedAt: '', deletedBy: '', isOtherDevice: false })];
  store.writeCollection('records.json', input);
  const persisted = store.readCollection('records.json');
  fixture.clearWrites();

  assert.equal(store.writeCollection('records.json', input), undefined);
  store.writeCollection('records.json', JSON.parse(JSON.stringify(persisted)));
  assert.deepEqual(fixture.writes(), []);
  assert.deepEqual(store.readCollection('records.json'), persisted);
  assert.equal(input[0].deviceId, '', 'normalization must not mutate the caller snapshot');
  assert.equal(persisted[0].deviceId, null);
  assert.equal(persisted[0].returnedAt, null);
  assert.equal(persisted[0].deletedAt, null);
  assert.equal(persisted[0].deletedBy, null);
});

test('full snapshots insert, update and remove only differing IDs, including empty snapshots', t => {
  const fixture = openStore(t);
  const { store } = fixture;
  store.writeCollection('records.json', [record('REC_A'), record('REC_B'), record('REC_C')]);
  const before = store.readCollection('records.json');
  fixture.clearWrites();
  const next = [before[0], { ...before[1], returnNotes: '合成归还备注' }, record('REC_D')];
  store.writeCollection('records.json', next);
  assert.deepEqual(fixture.writes(), [
    { kind: 'delete', id: 'REC_C' }, { kind: 'update', id: 'REC_B' }, { kind: 'insert', id: 'REC_D' }
  ]);
  assert.deepEqual(store.readCollection('records.json').map(row => row.id), ['REC_A', 'REC_B', 'REC_D']);
  assert.equal(store.readCollection('records.json')[1].returnNotes, '合成归还备注');

  fixture.clearWrites();
  store.writeCollection('records.json', []);
  assert.deepEqual(fixture.writes(), next.map(row => ({ kind: 'delete', id: row.id })));
  assert.deepEqual(store.readCollection('records.json'), []);
  fixture.clearWrites();
  store.writeCollection('records.json', []);
  assert.deepEqual(fixture.writes(), []);
});

test('middle insertion, reorder, deletion and append keep incoming snapshot order', t => {
  const fixture = openStore(t);
  const { store } = fixture;
  store.writeCollection('records.json', [record('REC_Z'), record('REC_A'), record('REC_M')]);
  const [z, a, m] = store.readCollection('records.json');
  fixture.clearWrites();
  store.writeCollection('records.json', [z, record('REC_MIDDLE'), a, m]);
  assert.deepEqual(store.readCollection('records.json').map(row => row.id), ['REC_Z', 'REC_MIDDLE', 'REC_A', 'REC_M']);
  assert.deepEqual(fixture.writes(), [
    { kind: 'insert', id: 'REC_MIDDLE' }, { kind: 'update', id: 'REC_A' }, { kind: 'update', id: 'REC_M' }
  ]);

  fixture.clearWrites();
  store.writeCollection('records.json', [m, z, a]);
  assert.deepEqual(store.readCollection('records.json'), [m, z, a]);
  assert.deepEqual(fixture.writes(), [
    { kind: 'delete', id: 'REC_MIDDLE' }, { kind: 'update', id: 'REC_Z' }, { kind: 'update', id: 'REC_A' }
  ]);
  fixture.clearWrites();
  store.writeCollection('records.json', [m, a, record('REC_LAST')]);
  assert.deepEqual(fixture.writes(), [{ kind: 'delete', id: 'REC_Z' }, { kind: 'insert', id: 'REC_LAST' }]);
  const ordered = store.readCollection('records.json');
  assert.deepEqual(ordered.map(row => row.id), ['REC_M', 'REC_A', 'REC_LAST']);
  fixture.clearWrites();
  store.writeCollection('records.json', ordered);
  assert.deepEqual(fixture.writes(), []);
});

test('legacy fields, archived records and nullable versus empty text retain existing adaptation', t => {
  const { store, db, clearWrites, writes } = openStore(t);
  store.writeCollection('records.json', [record('REC_LEGACY', {
    department: '旧专业', notes: '旧用途', major: null, purpose: undefined,
    isOtherDevice: true, otherDeviceName: '合成其他设备', type: '',
    returnedAt: '2026-10-23T01:00:00.000Z', returnNotes: '',
    deletedAt: '2026-10-23T02:00:00.000Z', deletedBy: 'synthetic-admin'
  })]);
  const archived = store.readCollection('records.json')[0];
  assert.equal(archived.major, '', 'repository must not add a new department fallback');
  assert.equal(archived.purpose, '', 'repository must not add a new notes fallback');
  assert.equal(archived.department, '旧专业');
  assert.equal(archived.notes, '旧用途');
  assert.equal(archived.type, '');
  assert.equal(archived.isOtherDevice, true);
  assert.equal(archived.deletedBy, 'synthetic-admin');
  clearWrites();
  store.writeCollection('records.json', [archived]);
  assert.deepEqual(writes(), []);

  // 人工写入过的空字符串仍按旧快照转换为 NULL，不能把本应发生的规范化更新跳过。
  db.exec("UPDATE records SET returned_at = '', deleted_at = '', deleted_by = '' WHERE id = 'REC_LEGACY'");
  clearWrites();
  store.writeCollection('records.json', store.readCollection('records.json'));
  assert.deepEqual(writes(), [{ kind: 'update', id: 'REC_LEGACY' }]);
  const normalized = store.readCollection('records.json')[0];
  assert.equal(normalized.returnedAt, null);
  assert.equal(normalized.deletedAt, null);
  assert.equal(normalized.deletedBy, null);
  assert.equal(normalized.department, '旧专业');
  assert.equal(normalized.notes, '旧用途');
});

test('duplicate normalized IDs still fail without silently discarding a snapshot entry', t => {
  const fixture = openStore(t);
  fixture.store.writeCollection('records.json', [record('REC_KEEP')]);
  const before = fixture.rawRows();
  fixture.clearWrites();
  for (const invalid of [[record('REC_DUP'), record('REC_DUP')], [record(7), record('7')], [record(null), record('')]]) {
    assert.throws(() => fixture.store.writeCollection('records.json', invalid), /UNIQUE constraint failed/);
    assert.deepEqual(fixture.rawRows(), before);
    assert.deepEqual(fixture.writes(), []);
  }
});

test('mid-write failure rolls back deletes, updates, inserts and row order, then allows retry', t => {
  const fixture = openStore(t);
  const { store, db } = fixture;
  store.writeCollection('records.json', [record('REC_A'), record('REC_B'), record('REC_C')]);
  const [a, b] = store.readCollection('records.json');
  const before = fixture.rawRows();
  fixture.clearWrites();
  db.exec(`CREATE TEMP TRIGGER reject_record BEFORE INSERT ON records WHEN NEW.id = 'REC_FAIL'
    BEGIN SELECT RAISE(ABORT, 'injected record failure'); END`);
  assert.throws(() => store.writeCollection('records.json', [
    { ...b, returnNotes: '失败时应恢复' }, a, record('REC_NEW'), record('REC_FAIL')
  ]), /injected record failure/);
  assert.deepEqual(fixture.rawRows(), before);
  assert.deepEqual(fixture.writes(), []);
  store.writeCollection('records.json', [a, { ...b, returnNotes: '重试成功' }]);
  assert.deepEqual(fixture.writes(), [{ kind: 'delete', id: 'REC_C' }, { kind: 'update', id: 'REC_B' }]);
});

test('nested transactions share current database state and outer rollback covers all collections', t => {
  const fixture = openStore(t);
  const { store } = fixture;
  store.writeCollection('records.json', [record('REC_A')]);
  const original = store.readCollection('records.json');
  fixture.clearWrites();
  assert.throws(() => store.transaction(() => {
    store.writeCollection('records.json', [{ ...original[0], returnNotes: '第一次写入' }]);
    store.transaction(() => {
      const current = store.readCollection('records.json');
      assert.equal(current[0].returnNotes, '第一次写入');
      store.writeCollection('records.json', [{ ...current[0], returnNotes: '第二次写入' }]);
      store.writeCollection('admin-users.json', [{ id: 'synthetic-admin', permissions: ['records'] }]);
    });
    throw new Error('outer failure');
  }), /outer failure/);
  assert.deepEqual(store.readCollection('records.json'), original);
  assert.deepEqual(store.readCollection('admin-users.json'), []);
  assert.deepEqual(fixture.writes(), []);
  assert.equal(store.transaction(() => store.transaction(() => 'sync-result')), 'sync-result');

  store.transaction(() => {
    store.writeCollection('records.json', [{ ...original[0], returnNotes: '第一次提交' }]);
    const current = store.readCollection('records.json');
    store.transaction(() => store.writeCollection('records.json', current));
    store.writeCollection('records.json', [{ ...current[0], returnNotes: '最终提交' }]);
  });
  assert.equal(store.readCollection('records.json')[0].returnNotes, '最终提交');
  assert.deepEqual(fixture.writes(), [{ kind: 'update', id: 'REC_A' }, { kind: 'update', id: 'REC_A' }]);
});

test('store API, JSON settings, transaction configuration and idempotent close stay compatible', t => {
  const fixture = openStore(t);
  const { store, commands } = fixture;
  assert.deepEqual(Object.keys(store).sort(), ['close', 'databasePath', 'readCollection', 'transaction', 'writeCollection']);
  assert.equal(store.databasePath, ':memory:');
  assert.ok(commands.some(sql => /foreign_keys = ON/.test(sql) && /journal_mode = WAL/.test(sql) && /busy_timeout = 5000/.test(sql)));
  store.writeCollection('admin-users.json', [{ id: 'synthetic-admin', permissions: ['records', 'devices'] }]);
  assert.deepEqual(store.readCollection('admin-users.json')[0].permissions, ['records', 'devices']);
  const settings = { recipients: ['synthetic@example.invalid'], smtp: { host: 'smtp.example.invalid', secretEncrypted: 'synthetic' }, templates: { borrow: { subject: '合成主题' } } };
  store.writeCollection('email-settings.json', settings);
  const saved = store.readCollection('email-settings.json');
  assert.deepEqual(saved.recipients, settings.recipients);
  assert.deepEqual(saved.smtp, settings.smtp);
  assert.deepEqual(saved.templates, settings.templates);
  assert.throws(() => store.readCollection('unsupported.json'), /Unsupported SQLite data file/);
  store.close();
  store.close();
  assert.equal(fixture.closeCalls, 1);
  assert.throws(() => store.readCollection('records.json'));
});

// 发布边界回归：保护手动增量权限规则，并用临时目录演练代码回退与持久化保护。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const skill = fs.readFileSync(path.join(root, 'skills/sync-device-management/SKILL.md'), 'utf8');
const scriptPath = path.join(root, 'deploy/update-from-git.sh');
const setupSource = fs.readFileSync(path.join(root, 'deploy/setup-cd.sh'), 'utf8');
const nginxConfig = fs.readFileSync(path.join(root, 'deploy/nginx.conf'), 'utf8');
const linuxOnly = { skip: process.platform !== 'linux' && 'Bash integration runs on the Linux CI runner' };

function bash(source, extraEnv = {}) {
  return spawnSync('bash', ['-c', 'source "$RELEASE_SCRIPT"\n' + source], {
    encoding: 'utf8', timeout: 10000,
    env: { ...process.env, RELEASE_SCRIPT: scriptPath, ...extraEnv }
  });
}

test('manual incremental fallback preserves application ownership and readability', () => {
  assert.match(skill, /sudo install[^\n]*-o deviceapp[^\n]*-g deviceapp[^\n]*-m 0644/);
  assert.match(skill, /must not preserve uploader-owned directory metadata/i);
  assert.match(skill, /namei -l/);
  assert.match(skill, /sudo -u deviceapp test -r/);
});

test('release entry accepts only a full immutable commit identifier', linuxOnly, () => {
  for (const commit of ['a'.repeat(40), '0123456789abcdef'.repeat(2) + '01234567']) {
    assert.equal(bash('validate_commit "$TARGET"', { TARGET: commit }).status, 0);
  }
  for (const commit of ['main', 'abc123', 'a'.repeat(41), 'A'.repeat(40), 'a'.repeat(40) + '; id', '--help', '$(id)']) {
    assert.notEqual(bash('validate_commit "$TARGET"', { TARGET: commit }).status, 0, commit);
  }
});

test('source guard rejects data, secrets and generated files even with unusual filenames', linuxOnly, () => {
  for (const file of ['data/device-management.sqlite', 'uploads/a photo.jpg', 'public/qrcodes/qr.png', 'frontend/dist/index.html', 'node_modules/a.js', '.env', 'config/.env.production', 'certs/private.key', 'data/line\nbreak']) {
    const result = bash('printf "%s\\0" "$SOURCE_PATH" | check_source_paths', { SOURCE_PATH: file });
    assert.notEqual(result.status, 0, file);
  }
  for (const file of ['.env.example', 'deploy/device-management.env.example', 'server.js', 'db/schema.sql', 'public/fonts/noto-sans-sc.css']) {
    assert.equal(bash('printf "%s\\0" "$SOURCE_PATH" | check_source_paths', { SOURCE_PATH: file }).status, 0, file);
  }
});

test('failed release restores previous link and preserves failure status and business files', linuxOnly, t => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'device-cd-rollback-'));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  for (const directory of ['previous', 'new', 'persistent']) fs.mkdirSync(path.join(fixture, directory));
  const database = path.join(fixture, 'persistent/database');
  fs.writeFileSync(database, 'new business writes must survive rollback');
  fs.symlinkSync(path.join(fixture, 'new'), path.join(fixture, 'app'));
  const result = bash(`
APP_DIR="$FIXTURE/app"
previous_dir="$FIXTURE/previous"
switch_started=true
systemctl() { printf '%s\\n' "$*" >> "$FIXTURE/service.log"; }
health_check() { [[ "$(readlink -f "$APP_DIR")" == "$previous_dir" ]]; }
trap on_exit EXIT
exit 23
`, { FIXTURE: fixture });
  assert.equal(result.status, 23, result.stderr);
  assert.equal(fs.realpathSync(path.join(fixture, 'app')), path.join(fixture, 'previous'));
  assert.equal(fs.readFileSync(database, 'utf8'), 'new business writes must survive rollback');
  assert.match(fs.readFileSync(path.join(fixture, 'service.log'), 'utf8'), /stop device-management\nstart device-management/);
  assert.match(result.stdout, /Previous release restored/);
});

test('preparation failure leaves the running release untouched', linuxOnly, t => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'device-cd-prepare-'));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  fs.mkdirSync(path.join(fixture, 'old'));
  fs.symlinkSync(path.join(fixture, 'old'), path.join(fixture, 'app'));
  const result = bash(`
APP_DIR="$FIXTURE/app"
previous_dir="$FIXTURE/old"
switch_started=false
restore_previous() { touch "$FIXTURE/unexpected-rollback"; }
trap on_exit EXIT
exit 17
`, { FIXTURE: fixture });
  assert.equal(result.status, 17);
  assert.equal(fs.realpathSync(path.join(fixture, 'app')), path.join(fixture, 'old'));
  assert.equal(fs.existsSync(path.join(fixture, 'unexpected-rollback')), false);
});

test('SSH forced command rejects arbitrary shell input before invoking sudo', linuxOnly, t => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'device-cd-ssh-'));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  const wrapper = setupSource.match(/<<'WRAPPER'\n([\s\S]*?)\nWRAPPER/);
  assert.ok(wrapper, 'fixed SSH wrapper must be present');
  const wrapperPath = path.join(fixture, 'wrapper.sh');
  fs.writeFileSync(wrapperPath, wrapper[1]);
  for (const command of ['', 'bash', 'scp -t /tmp/file', 'deploy main', 'deploy ' + 'a'.repeat(40) + '; id']) {
    const result = spawnSync('bash', [wrapperPath], {
      encoding: 'utf8', timeout: 10000,
      env: { ...process.env, SSH_ORIGINAL_COMMAND: command }
    });
    assert.equal(result.status, 1, command);
    assert.match(result.stderr, /Only deploy/);
  }
});

test('nginx upload limit leaves multipart overhead above the 20 MB app limit', () => {
  assert.match(nginxConfig, /client_max_body_size\s+22m;/);
});

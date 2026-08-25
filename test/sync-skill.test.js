// 增量部署必须避免把上传账号的目录所有权和 0700 权限带入生产应用目录。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const skillPath = path.resolve(__dirname, '../skills/sync-device-management/SKILL.md');
const skill = fs.readFileSync(skillPath, 'utf8');
const updateScriptPath = path.resolve(__dirname, '../deploy/update-from-git.sh');
const updateScript = fs.readFileSync(updateScriptPath, 'utf8');

test('sync skill installs changed files without preserving staging directory metadata', () => {
  assert.doesNotMatch(skill, /Copy staging contents with `sudo cp -a/);
  assert.match(skill, /sudo install[^\n]*-o deviceapp[^\n]*-g deviceapp[^\n]*-m 0644/);
  assert.match(skill, /must not preserve uploader-owned directory metadata/i);
});

test('sync skill verifies service-user traversal before building', () => {
  assert.match(skill, /namei -l/);
  assert.match(skill, /sudo -u deviceapp test -r/);
  assert.match(skill, /package\.json/);
  assert.match(skill, /frontend\/index\.html/);
});

// Git 更新脚本中的 npm 和 Git 命令必须在应用目录执行，不能继承调用者的当前目录。
test('git updater runs service-user commands from the application directory', () => {
  assert.match(updateScript, /bash -c 'cd "\$1" && shift && exec "\$@"'/);
});

// 上次构建失败后，即使新提交只改部署脚本，也必须识别过期的前端产物并重建。
test('git updater rebuilds when frontend output is older than its inputs', () => {
  assert.match(updateScript, /frontend\/src/);
  assert.match(updateScript, /-newer "\$\{APP_DIR\}\/frontend\/dist\/index\.html"/);
});

// 提交已同步但上次构建中断时，脚本必须继续执行恢复检查，不能提前退出。
test('git updater keeps recovery checks after an already-current commit', () => {
  assert.match(updateScript, /if \[\[ "\$\{before_commit\}" == "\$\{target_commit\}" \]\]; then/);
  assert.doesNotMatch(updateScript, /Already up to date[\s\S]*?exit 0/);
  assert.match(updateScript, /frontend_dist_index="\$\{APP_DIR\}\/frontend\/dist\/index\.html"/);
});

// 本次拉取包含脚本更新时，当前进程应立即切换到仓库中的新脚本继续部署。
test('git updater re-executes itself after pulling a script update', () => {
  assert.match(updateScript, /script_changed=false/);
  assert.match(updateScript, /deploy\/update-from-git\.sh\)\n\s+script_changed=true/);
  assert.match(updateScript, /exec bash "\$\{APP_DIR\}\/deploy\/update-from-git\.sh"/);
});

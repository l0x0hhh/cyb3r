// 增量部署必须避免把上传账号的目录所有权和 0700 权限带入生产应用目录。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const skillPath = path.resolve(__dirname, '../skills/sync-device-management/SKILL.md');
const skill = fs.readFileSync(skillPath, 'utf8');

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

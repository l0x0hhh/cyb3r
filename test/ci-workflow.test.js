// CI/CD 回归：类型检查先于测试/构建，发布仍限制 main、完整提交及主机校验。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflowPath = path.resolve(__dirname, '../.github/workflows/ci.yml');

test('CI checks frontend types before tests and build', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
  assert.equal(packageJson.scripts.typecheck, 'tsc --noEmit --pretty false');
  const typecheck = workflow.indexOf('run: npm run typecheck');
  assert.ok(typecheck >= 0);
  assert.ok(typecheck < workflow.indexOf('run: node --test'));
  assert.ok(typecheck < workflow.indexOf('run: npm run build'));
});

test('CI validates CommonJS syntax and validates the ESM frontend through Vite', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /node --check server\.js/);
  assert.match(workflow, /node --check db\/repository\.js/);
  assert.doesNotMatch(workflow, /node --check frontend\/src\/main\.js/);
  assert.match(workflow, /run: node --test --test-concurrency=1/);
  assert.doesNotMatch(workflow, /npm test -- --test-concurrency/);
  assert.match(workflow, /run: npm run build/);
});

test('production deployment is gated by successful main CI and explicit initial enablement', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  const deploy = workflow.slice(workflow.indexOf('  deploy:'));
  assert.match(deploy, /needs: verify/);
  assert.match(deploy, /github\.ref == 'refs\/heads\/main'/);
  assert.match(deploy, /github\.event_name == 'push'/);
  assert.match(deploy, /github\.event_name == 'workflow_dispatch'/);
  assert.match(deploy, /vars\.CD_ENABLED == 'true'/);
  assert.match(deploy, /cancel-in-progress: false/);
  assert.doesNotMatch(workflow, /pull_request_target/);
  assert.doesNotMatch(workflow.slice(0, workflow.indexOf('  deploy:')), /secrets\./);
});

test('deployment uses the verified SHA with strict host verification and no password shell', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  assert.match(workflow, /"deploy \$GITHUB_SHA"/);
  assert.match(workflow, /StrictHostKeyChecking=yes/);
  assert.match(workflow, /BatchMode=yes/);
  assert.match(workflow, /device-deploy@/);
  assert.doesNotMatch(workflow, /StrictHostKeyChecking=no|sshpass|curl[^\n]*\|\s*(?:sudo\s+)?bash/);
});

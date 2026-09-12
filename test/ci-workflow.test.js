// CI 配置回归：前端 ESM 入口由 Vite 构建解析，不能交给 CommonJS 的 node --check。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflowPath = path.resolve(__dirname, '../.github/workflows/ci.yml');

test('CI validates CommonJS syntax and validates the ESM frontend through Vite', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /node --check server\.js/);
  assert.match(workflow, /node --check db\/repository\.js/);
  assert.doesNotMatch(workflow, /node --check frontend\/src\/main\.js/);
  assert.match(workflow, /run: node --test --test-concurrency=1/);
  assert.doesNotMatch(workflow, /npm test -- --test-concurrency/);
  assert.match(workflow, /run: npm run build/);
});

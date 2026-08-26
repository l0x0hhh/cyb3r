// Regression coverage for legacy device image variant migration.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const sharp = require('sharp');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function createWorkspace() {
  const dataDir = fs.mkdtempSync(path.join(PROJECT_ROOT, '.image-migration-test-'));
  const uploadDir = path.join(dataDir, 'uploads');
  fs.mkdirSync(uploadDir, { recursive: true });
  return { dataDir, uploadDir };
}

function cleanupWorkspace(dataDir) {
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

function runMigration(dataDir, uploadDir, args = []) {
  return spawnSync(process.execPath, ['scripts/migrate-image-variants.js', ...args], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, DATA_DIR: dataDir, UPLOAD_DIR: uploadDir },
    encoding: 'utf8',
    timeout: 30000
  });
}

test('legacy image migration previews without writing files', async t => {
  const { dataDir, uploadDir } = createWorkspace();
  t.after(() => cleanupWorkspace(dataDir));

  const sourcePath = path.join(uploadDir, 'legacy.jpg');
  await sharp({ create: { width: 1600, height: 900, channels: 3, background: '#c58b57' } })
    .jpeg()
    .toFile(sourcePath);
  const devices = [{ id: 'DEV_LEGACY', image: '/uploads/legacy.jpg', imageThumb: '/uploads/legacy.jpg' }];
  const devicesFile = path.join(dataDir, 'devices.json');
  fs.writeFileSync(devicesFile, JSON.stringify(devices, null, 2));
  const before = fs.readFileSync(devicesFile, 'utf8');

  const result = runMigration(dataDir, uploadDir, ['--dry-run']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /dry-run: scanned=1 planned=1/);
  assert.equal(fs.existsSync(path.join(uploadDir, 'legacy-detail.webp')), false);
  assert.equal(fs.existsSync(path.join(uploadDir, 'legacy-thumb.webp')), false);
  assert.equal(fs.readFileSync(devicesFile, 'utf8'), before);
});

test('legacy image migration creates variants, keeps originals, and is idempotent', async t => {
  const { dataDir, uploadDir } = createWorkspace();
  t.after(() => cleanupWorkspace(dataDir));

  const sourcePath = path.join(uploadDir, 'legacy.jpg');
  await sharp({ create: { width: 1600, height: 900, channels: 3, background: '#4a8f9c' } })
    .jpeg()
    .toFile(sourcePath);
  const devicesFile = path.join(dataDir, 'devices.json');
  fs.writeFileSync(devicesFile, JSON.stringify([
    { id: 'DEV_LEGACY', image: '/uploads/legacy.jpg', imageThumb: '/uploads/legacy.jpg' },
    { id: 'DEV_EMPTY', image: null, imageThumb: null }
  ], null, 2));

  let result = runMigration(dataDir, uploadDir);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /completed: scanned=2 planned=0 updated=1 skipped=1 created=2/);
  assert.equal(fs.existsSync(sourcePath), true);

  const devices = JSON.parse(fs.readFileSync(devicesFile, 'utf8'));
  assert.deepEqual(devices[0], {
    id: 'DEV_LEGACY',
    image: '/uploads/legacy-detail.webp',
    imageThumb: '/uploads/legacy-thumb.webp',
    imageWidth: 1280,
    imageHeight: 720
  });
  const detailMetadata = await sharp(fs.readFileSync(path.join(uploadDir, 'legacy-detail.webp'))).metadata();
  const thumbMetadata = await sharp(fs.readFileSync(path.join(uploadDir, 'legacy-thumb.webp'))).metadata();
  assert.deepEqual({ width: detailMetadata.width, height: detailMetadata.height }, { width: 1280, height: 720 });
  assert.deepEqual({ width: thumbMetadata.width, height: thumbMetadata.height }, { width: 480, height: 270 });

  result = runMigration(dataDir, uploadDir, ['--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /dry-run: scanned=2 planned=0 updated=0 skipped=2 created=0/);

  result = runMigration(dataDir, uploadDir);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /completed: scanned=2 planned=0 updated=0 skipped=2 created=0/);
});

// Migrate legacy device images to cached detail and thumbnail WebP variants.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(PROJECT_ROOT, 'data');
const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(PROJECT_ROOT, 'uploads');
const DEVICES_FILE = path.join(DATA_DIR, 'devices.json');

function parseArgs(argv) {
  const args = new Set(argv);
  if (args.has('--help') || args.has('-h')) {
    return { help: true, dryRun: false };
  }
  const supported = new Set(['--dry-run']);
  const unknown = argv.find(arg => !supported.has(arg));
  if (unknown) throw new Error(`未知参数：${unknown}`);
  return { help: false, dryRun: args.has('--dry-run') };
}

function readDevices() {
  if (!fs.existsSync(DEVICES_FILE)) throw new Error(`设备数据文件不存在：${DEVICES_FILE}`);
  const devices = JSON.parse(fs.readFileSync(DEVICES_FILE, 'utf8'));
  if (!Array.isArray(devices)) throw new Error('设备数据文件格式不正确：根节点必须是数组');
  return devices;
}

function resolveUploadPath(imageUrl) {
  const value = String(imageUrl || '').trim();
  const prefix = '/uploads/';
  if (!value.startsWith(prefix)) return null;
  const filename = value.slice(prefix.length);
  if (!filename || filename.includes('/') || filename.includes('\\') || filename === '.' || filename === '..') {
    return null;
  }
  const resolved = path.resolve(UPLOAD_DIR, filename);
  const uploadRoot = path.resolve(UPLOAD_DIR);
  if (path.dirname(resolved) !== uploadRoot) return null;
  return { filename, path: resolved };
}

function getVariantFilenames(filename) {
  const parsed = path.parse(filename);
  const baseName = parsed.name.replace(/-(?:detail|thumb)$/i, '');
  return {
    detailFilename: `${baseName}-detail.webp`,
    thumbFilename: `${baseName}-thumb.webp`
  };
}

async function readMetadata(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return await sharp(filePath).metadata();
  } catch {
    return null;
  }
}

async function ensureVariant(sourcePath, targetPath, options, tempDir, label) {
  const existing = await readMetadata(targetPath);
  if (existing?.width && existing?.height) return { created: false, metadata: existing };
  if (path.resolve(sourcePath) === path.resolve(targetPath)) {
    throw new Error(`${label}源文件无法读取：${sourcePath}`);
  }

  const tempPath = path.join(tempDir, `${label}-${crypto.randomBytes(6).toString('hex')}.webp`);
  await sharp(sourcePath)
    .rotate()
    .resize(options.resize)
    .webp(options.webp)
    .toFile(tempPath);
  if (fs.existsSync(targetPath)) fs.rmSync(targetPath);
  fs.renameSync(tempPath, targetPath);
  return { created: true, metadata: await readMetadata(targetPath) };
}

function writeDevices(devices) {
  const tempPath = `${DEVICES_FILE}.migration-${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tempPath, JSON.stringify(devices, null, 2));
    fs.renameSync(tempPath, DEVICES_FILE);
  } finally {
    if (fs.existsSync(tempPath)) fs.rmSync(tempPath);
  }
}

async function migrateDevice(device, tempDir, dryRun) {
  const source = resolveUploadPath(device?.image);
  if (!source) return { status: 'skipped', reason: 'image-not-local' };
  if (!fs.existsSync(source.path)) {
    throw new Error(`设备 ${device.id || '(无编号)'} 的图片不存在：${source.path}`);
  }

  const { detailFilename, thumbFilename } = getVariantFilenames(source.filename);
  const detailPath = path.join(UPLOAD_DIR, detailFilename);
  const thumbPath = path.join(UPLOAD_DIR, thumbFilename);
  const detailUrl = `/uploads/${detailFilename}`;
  const thumbUrl = `/uploads/${thumbFilename}`;

  if (dryRun) {
    const detailMetadata = await readMetadata(detailPath);
    const thumbMetadata = await readMetadata(thumbPath);
    const creates = (detailMetadata ? 0 : 1) + (thumbMetadata ? 0 : 1);
    const updates = device.image !== detailUrl || device.imageThumb !== thumbUrl || !device.imageWidth || !device.imageHeight ? 1 : 0;
    if (!creates && !updates) return { status: 'skipped' };
    return {
      status: 'planned',
      planned: 1,
      creates,
      updates
    };
  }

  const detail = await ensureVariant(source.path, detailPath, {
    resize: { width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true },
    webp: { quality: 80, effort: 4 }
  }, tempDir, 'detail');
  const thumb = await ensureVariant(source.path, thumbPath, {
    resize: { width: 480, height: 640, fit: 'inside', withoutEnlargement: true },
    webp: { quality: 72, effort: 4 }
  }, tempDir, 'thumb');
  const metadata = detail.metadata || await readMetadata(detailPath);
  if (!metadata?.width || !metadata?.height || !thumb.metadata?.width || !thumb.metadata?.height) {
    throw new Error(`设备 ${device.id || '(无编号)'} 的 WebP 变体生成后无法读取尺寸`);
  }

  const changed = device.image !== detailUrl
    || device.imageThumb !== thumbUrl
    || device.imageWidth !== metadata.width
    || device.imageHeight !== metadata.height;
  Object.assign(device, {
    image: detailUrl,
    imageThumb: thumbUrl,
    imageWidth: metadata.width,
    imageHeight: metadata.height
  });
  return { status: changed ? 'updated' : 'skipped', created: Number(detail.created) + Number(thumb.created) };
}

async function migrate({ dryRun = false } = {}) {
  if (!fs.existsSync(UPLOAD_DIR)) throw new Error(`上传目录不存在：${UPLOAD_DIR}`);
  const devices = readDevices();
  const tempDir = fs.mkdtempSync(path.join(UPLOAD_DIR, '.image-migration-'));
  const summary = { scanned: 0, planned: 0, updated: 0, skipped: 0, created: 0 };

  try {
    for (const device of devices) {
      summary.scanned += 1;
      const result = await migrateDevice(device, tempDir, dryRun);
      if (result.status === 'planned') summary.planned += result.planned || 0;
      if (result.status === 'updated') summary.updated += 1;
      if (result.status === 'skipped') summary.skipped += 1;
      summary.created += result.created || result.creates || 0;
    }
    if (!dryRun && summary.updated > 0) writeDevices(devices);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  return summary;
}

function printHelp() {
  console.log([
    '用法：npm run migrate:images [-- --dry-run]',
    '',
    '默认生成旧设备缺失的详情 WebP 和缩略 WebP，并更新 devices.json 引用。',
    '原始图片保留不删除；--dry-run 只预览，不写入文件。'
  ].join('\n'));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return printHelp();
  const summary = await migrate(options);
  const mode = options.dryRun ? 'dry-run' : 'completed';
  console.log(`${mode}: scanned=${summary.scanned} planned=${summary.planned} updated=${summary.updated} skipped=${summary.skipped} created=${summary.created}`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`image migration failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  getVariantFilenames,
  migrate,
  parseArgs,
  resolveUploadPath
};

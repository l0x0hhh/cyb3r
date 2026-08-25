const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const indexHtml = fs.readFileSync(path.join(projectRoot, 'frontend/index.html'), 'utf8');
const serverSource = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');
const viteSource = fs.readFileSync(path.join(projectRoot, 'vite.config.js'), 'utf8');

function getPngAlphaBounds(filePath) {
  const sharp = require('sharp');

  return sharp(filePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
    .then(({ data, info }) => {
      let left = info.width;
      let top = info.height;
      let right = -1;
      let bottom = -1;

      for (let y = 0; y < info.height; y += 1) {
        for (let x = 0; x < info.width; x += 1) {
          const alpha = data[(y * info.width + x) * info.channels + 3];
          if (alpha === 0) continue;
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x);
          bottom = Math.max(bottom, y);
        }
      }

      return { ...info, left, top, right, bottom, data };
    });
}

function readPngDimensions(filePath) {
  const buffer = fs.readFileSync(filePath);
  assert.equal(buffer.subarray(1, 4).toString('ascii'), 'PNG');
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    size: buffer.length
  };
}

test('frontend dependencies are pinned and a production build is available', () => {
  assert.match(packageJson.dependencies?.vue || '', /^\d+\.\d+\.\d+$/);
  // Excel 工作簿在浏览器端生成和解析，依赖必须固定版本以保证模板兼容性。
  assert.match(packageJson.dependencies?.exceljs || '', /^\d+\.\d+\.\d+$/);
  assert.match(packageJson.devDependencies?.vite || '', /^\d+\.\d+\.\d+$/);
  assert.equal(packageJson.scripts?.build, 'vite build');
});

test('server includes an image processor for upload-time responsive variants', () => {
  assert.match(packageJson.dependencies?.sharp || '', /^\d+\.\d+\.\d+$/);
  assert.match(serverSource, /require\(['"]sharp['"]\)/);
  assert.match(serverSource, /imageThumb/);
  assert.match(serverSource, /immutable:\s*true/);
});

test('frontend no longer depends on runtime CDN imports or user-scalable=no', () => {
  assert.doesNotMatch(indexHtml, /unpkg\.com/);
  assert.doesNotMatch(indexHtml, /<script type="importmap">/);
  assert.doesNotMatch(indexHtml, /user-scalable=no/);
});

test('frontend declares a favicon so browsers do not create a noisy 404', () => {
  assert.match(indexHtml, /<link\s+rel=["']icon["']/i);
});

test('college branding publishes the tightly cropped emblem and a square shield favicon', async () => {
  const emblemPath = path.join(projectRoot, 'public/assets/jnu-cyber-security-emblem.png');
  const faviconPath = path.join(projectRoot, 'public/assets/jnu-cyber-security-shield.png');
  const emblem = readPngDimensions(emblemPath);
  const favicon = readPngDimensions(faviconPath);
  const alpha = await getPngAlphaBounds(emblemPath);

  assert.deepEqual({ width: emblem.width, height: emblem.height }, { width: 391, height: 391 });
  assert.ok(emblem.size < 100 * 1024);
  assert.equal(alpha.data[3], 0);
  assert.equal(alpha.data[((alpha.width - 1) * alpha.channels) + 3], 0);
  assert.equal(alpha.data[(((alpha.height - 1) * alpha.width) * alpha.channels) + 3], 0);
  assert.equal(alpha.data[(((alpha.height * alpha.width) - 1) * alpha.channels) + 3], 0);
  assert.ok(alpha.left <= 3);
  assert.ok(alpha.top <= 3);
  assert.ok((alpha.width - 1 - alpha.right) <= 3);
  assert.ok((alpha.height - 1 - alpha.bottom) <= 3);
  assert.equal(favicon.width, favicon.height);
  assert.ok(favicon.width >= 128);
  assert.match(indexHtml, /href="\/assets\/jnu-cyber-security-shield\.png"/);
});

test('emblem presentation follows the transparent outline without a white backing plate', () => {
  const sharedRule = indexHtml.match(
    /\.portal-emblem, \.nav-emblem, \.login-emblem, \.redirect-emblem\s*\{([^}]+)\}/
  );

  assert.ok(sharedRule);
  assert.match(sharedRule[1], /filter:\s*drop-shadow\(/);
  assert.doesNotMatch(sharedRule[1], /background\s*:/);
  assert.doesNotMatch(sharedRule[1], /box-shadow\s*:/);
  assert.doesNotMatch(sharedRule[1], /border\s*:/);
  assert.doesNotMatch(indexHtml, /\.(?:portal|nav|login|redirect)-emblem\s*\{[^}]*padding\s*:/g);
});

test('server publishes the built frontend when dist exists', () => {
  assert.match(serverSource, /FRONTEND_DIST_DIR\s*=\s*path\.join\(__dirname,\s*'frontend',\s*'dist'\)/);
  assert.match(serverSource, /STATIC_DIR/);
});

test('Vite bundles the compiler-enabled Vue build used by inline templates', () => {
  assert.match(viteSource, /vue\.esm-bundler\.js/);
});

// frontend 已作为 Vite 根目录，使用默认 index.html 可避免 Linux 上重复解析入口路径。
test('Vite uses the frontend root default entry across operating systems', () => {
  assert.match(viteSource, /root:\s*['"]frontend['"]/);
  assert.doesNotMatch(viteSource, /rollupOptions\s*:/);
  assert.doesNotMatch(viteSource, /input:\s*resolve\([^\n]*frontend\/index\.html/);
});

test('document loads Noto Sans SC from Google Fonts CDN with preconnect', () => {
  assert.match(indexHtml, /fonts\.googleapis\.com/);
  assert.match(indexHtml, /Noto Sans SC/);
  assert.match(indexHtml, /preconnect/);
});

test('server publishes Content-Security-Policy font-src allowing fonts.gstatic.com', () => {
  assert.match(serverSource, /fontSrc/);
});

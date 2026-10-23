// 字体资源回归：校验压缩文件指纹和体积，并确保每条真实答案都在生成的字符清单中。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const fontModule = import(pathToFileURL(path.join(root, 'frontend/src/content/answer-book-font.js')).href);

test('answer font is a small valid WOFF asset whose filename matches its fingerprint', async () => {
  const { answerBookFont } = await fontModule;
  assert.match(answerBookFont.url, /^\/fonts\/answer-book-results-[a-f0-9]{12}\.woff$/);
  const font = fs.readFileSync(path.join(root, 'public', answerBookFont.url.slice(1)));
  const hash = createHash('sha256').update(font).digest('hex');
  assert.equal(font.toString('ascii', 0, 4), 'wOFF');
  assert.equal(font.readUInt32BE(8), font.length);
  assert.equal(font.length, answerBookFont.bytes);
  assert.equal(hash, answerBookFont.sha256);
  const original = fs.readFileSync(path.join(root, 'public/assets/answer-book.ttf'));
  assert.equal(original.length, answerBookFont.sourceBytes);
  assert.equal(createHash('sha256').update(original).digest('hex'), answerBookFont.sourceSha256);
  assert.ok(answerBookFont.url.includes(hash.slice(0, 12)));
  assert.ok(font.length < 64 * 1024, 'The result font must stay below 64 KiB; do not serve the full TTF');
  assert.ok(font.length < answerBookFont.sourceBytes / 10);
});

test('every possible answer and its quote marks are covered by the generated font character list', async () => {
  const { answerBookFont } = await fontModule;
  const answers = JSON.parse(fs.readFileSync(path.join(root, 'frontend/src/content/answer-book-responses.json'), 'utf8'));
  assert.ok(Array.isArray(answers) && answers.length > 0);
  assert.ok(answers.every(answer => typeof answer === 'string' && answer.length > 0));
  const supported = new Set(answerBookFont.characters);
  const missing = [...new Set(answers.join('') + '“” ')].filter(character => !supported.has(character));
  assert.deepEqual(missing, [], 'New answer glyphs require regenerating the font with scripts/subset-answer-font.py');
  const documentSource = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
  assert.ok(documentSource.includes(`url('${answerBookFont.url}') format('woff')`));
  assert.doesNotMatch(documentSource, /url\(['"]\/assets\/answer-book\.ttf['"]\)/);
});

# 答案字体离线生成：从实际答案提取字符，保留原字形并输出带指纹的压缩子集及元数据。
"""Run with Python + fontTools; no Python dependency is needed by the deployed app."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import re

import fontTools
from fontTools import subset
from fontTools.ttLib import TTFont


ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--answers-source', default='frontend/src/content/answer-book-responses.json')
    args = parser.parse_args()
    source_path = (ROOT / args.answers_source).resolve()
    source_relative = source_path.relative_to(ROOT).as_posix()
    answers = json.loads(source_path.read_text(encoding='utf-8'))
    if not isinstance(answers, list) or not answers or not all(isinstance(answer, str) and answer for answer in answers):
        raise SystemExit('Answers source must be a nonempty JSON array of strings.')
    characters = ''.join(sorted(set(''.join(answers) + '“” ')))
    original_path = ROOT / 'public/assets/answer-book.ttf'
    original = original_path.read_bytes()
    font = TTFont(io.BytesIO(original), recalcTimestamp=False)
    missing = set(map(ord, characters)) - set(font.getBestCmap())
    if missing:
        raise SystemExit('Original font is missing: ' + ', '.join(f'U+{code:04X}' for code in sorted(missing)))

    options = subset.Options()
    options.layout_features = ['*']
    # 保留字体名称、版权及已有授权信息；旧 AAT/签名表不适用于裁剪后的字形集合。
    options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
    options.drop_tables += ['mort', 'DSIG']
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(text=characters)
    subsetter.subset(font)
    if not set(map(ord, characters)).issubset(font.getBestCmap()):
        raise SystemExit('Subset cmap does not cover the complete answer text.')

    # WOFF 使用标准 zlib，无需在项目或生产服务器引入 Brotli/Python 依赖。
    font.flavor = 'woff'
    buffer = io.BytesIO()
    font.save(buffer)
    payload = buffer.getvalue()
    font.close()
    fingerprint = hashlib.sha256(payload).hexdigest()
    filename = f'answer-book-results-{fingerprint[:12]}.woff'
    asset_path = ROOT / 'public/fonts' / filename
    metadata = {
        'url': '/fonts/' + filename,
        'family': 'AnswerBookFont',
        'type': 'font/woff',
        'characters': characters,
        'sha256': fingerprint,
        'bytes': len(payload),
        'sourceBytes': len(original),
        'sourceSha256': hashlib.sha256(original).hexdigest(),
        'answersSource': source_relative,
        'fontToolsVersion': fontTools.__version__,
    }
    generated_source = (
        '// @ts-check\n'
        '// 由 scripts/subset-answer-font.py 生成；修改答案后重新生成字体、字符清单与指纹。\n'
        'export const answerBookFont = Object.freeze('
        + json.dumps(metadata, ensure_ascii=False, indent=2) + ');\n'
    )
    html_path = ROOT / 'frontend/index.html'
    html = html_path.read_text(encoding='utf-8')
    font_face = re.compile(
        r"(@font-face\s*\{\s*font-family:\s*'AnswerBookFont';\s*src:\s*)"
        r"url\('[^']+'\)\s*format\('[^']+'\)"
    )
    html, count = font_face.subn(lambda found: found.group(1) + f"url('{metadata['url']}') format('woff')", html)
    if count != 1:
        raise SystemExit('Expected one AnswerBookFont @font-face declaration; no output written.')

    data_path = ROOT / 'frontend/src/content/answer-book-font.js'
    data_path.parent.mkdir(parents=True, exist_ok=True)
    asset_path.write_bytes(payload)
    data_path.write_text(generated_source, encoding='utf-8')
    html_path.write_text(html, encoding='utf-8')
    print(f'{len(answers)} answers, {len(characters)} characters; all glyphs covered')
    print(f'{len(original):,} -> {len(payload):,} bytes ({100 * (1 - len(payload) / len(original)):.2f}% smaller)')
    print(f'Asset: {asset_path.relative_to(ROOT).as_posix()}')
    print('Updated frontend/index.html and frontend/src/content/answer-book-font.js')
    print('Old fingerprint assets are retained; do not delete one still referenced by another branch.')


if __name__ == '__main__':
    main()

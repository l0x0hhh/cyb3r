// @ts-check
// 仅在答案页进入时提前请求结果字体，不阻塞抽签，也不让借还页预下载该字体。
import { answerBookFont } from '../content/answer-book-font.js';

/** @param {Document} [targetDocument] */
export function preloadAnswerFont(targetDocument = document) {
  const existing = targetDocument.head.querySelector(`link[rel="preload"][href="${answerBookFont.url}"]`);
  if (existing) return;
  const preload = targetDocument.createElement('link');
  preload.rel = 'preload';
  preload.as = 'font';
  preload.href = answerBookFont.url;
  preload.type = answerBookFont.type;
  preload.crossOrigin = 'anonymous';
  targetDocument.head.appendChild(preload);
}

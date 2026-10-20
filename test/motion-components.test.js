// 动效行为回归：实际渲染注册表，验证原生元素与视口/静态策略，不启动浏览器。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createSSRApp } = require('vue');
const { renderToString } = require('vue/server-renderer');

const motionModule = import(pathToFileURL(path.resolve(__dirname, '../frontend/src/components/borrow-motion.js')).href);

test('registered Motion elements render native article, button and div from a string template', async () => {
  const { borrowMotionComponents } = await motionModule;
  const warnings = [];
  const app = createSSRApp({
    components: borrowMotionComponents,
    template: `
      <MotionArticle :initial="false">
        <MotionButton type="button" :initial="false">填写信息并借用</MotionButton>
        <MotionButton type="button" disabled :initial="false">不可重复提交</MotionButton>
        <MotionDiv role="status" :initial="false">借用成功</MotionDiv>
      </MotionArticle>
    `
  });
  app.config.warnHandler = message => warnings.push(message);
  const html = await renderToString(app);
  assert.match(html, /<article\b/);
  assert.match(html, /<button\b[^>]*type="button"/);
  assert.match(html, /<button\b[^>]*\bdisabled(?:\s|=|>)/);
  assert.match(html, /<div\b[^>]*role="status"/);
  assert.doesNotMatch(html, /<motion\.|<Motion(?:Article|Button|Div)/);
  assert.equal(warnings.some(message => message.includes('Failed to resolve component')), false);
});

test('offscreen cards wait for viewport entry and remain visible if it never fires', async () => {
  const { getDeviceCardMotionProps } = await motionModule;
  const props = getDeviceCardMotionProps(false, true);
  assert.equal(props.initial, 'offscreen');
  assert.equal(props.animate, undefined);
  assert.equal(props.whileInView, 'onscreen');
  assert.equal(props.variants.offscreen.opacity, 1);
  assert.equal(props.variants.onscreen.y, 0);
  assert.equal(props.inViewOptions.once, true);
  assert.equal(props.inViewOptions.amount, 'some');
});

test('reduced motion or unavailable observer resets cards immediately without viewport animation', async () => {
  const { getDeviceCardMotionProps } = await motionModule;
  for (const [reduced, supported] of [[true, true], [false, false], [true, false]]) {
    const props = getDeviceCardMotionProps(reduced, supported);
    assert.equal(props.initial, false);
    assert.deepEqual(props.animate, { opacity: 1, y: 0 });
    assert.equal(props.whileInView, undefined);
    assert.equal(props.transition.duration, 0);
  }
});

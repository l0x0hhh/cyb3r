// 展示逻辑回归：覆盖真实响应式缓存、分类映射、图片状态和旧字段兜底，无需浏览器。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { reactive, ref } = require('vue');

const presentationModule = import(pathToFileURL(path.resolve(__dirname, '../frontend/src/composables/use-device-presentation.js')).href);

function cardFixture(overrides = {}) {
  return reactive({
    id: 'device-fixture', name: '测试相机', model: '测试型号', category: 'cat-camera',
    status: 'available', imageThumb: '/uploads/fixture-thumb.webp', ...overrides
  });
}

function imageLoadEvent(width, height) {
  const event = new Event('load');
  Object.defineProperty(event, 'target', { value: { naturalWidth: width, naturalHeight: height } });
  return event;
}

test('category IDs use configured local icons, including asynchronous metadata changes', async () => {
  const { useDevicePresentation } = await presentationModule;
  const categories = ref([]);
  const view = useDevicePresentation(categories);
  const item = cardFixture({ category: 'cat-custom' });
  const fallback = view.getDeviceCardPresentation(item);
  assert.equal(fallback.categoryIcon, view.categoryIcon('other'));
  assert.equal(view.categoryIcon('cat-camera'), view.categoryIcon('camera'));
  assert.notEqual(view.categoryIcon('cat-camera'), view.categoryIcon('other'));

  categories.value = [{ id: 'cat-custom', name: '测试分类', icon: 'lens' }];
  const configured = view.getDeviceCardPresentation(item);
  assert.notStrictEqual(configured, fallback);
  assert.equal(configured.categoryIcon, view.categoryIcon('lens'));
  assert.equal(configured.categoryClass, 'cat-other');
  categories.value[0].icon = '<svg onload="alert(1)">';
  assert.equal(view.getDeviceCardPresentation(item).categoryIcon, view.categoryIcon('other'));
  assert.equal(view.categoryIcon('__proto__'), view.categoryIcon('other'));
});

test('unchanged cards reuse presentation objects and image events update only their source', async () => {
  const { useDevicePresentation } = await presentationModule;
  const view = useDevicePresentation(ref([]));
  const item = cardFixture();
  const otherItem = cardFixture({ id: 'other-fixture', imageThumb: '/uploads/other-thumb.webp' });
  const initial = view.getDeviceCardPresentation(item);
  const other = view.getDeviceCardPresentation(otherItem);
  assert.strictEqual(view.getDeviceCardPresentation(item), initial);

  view.handleCardImageLoad({ source: item.imageThumb, event: imageLoadEvent(600, 900) });
  const loaded = view.getDeviceCardPresentation(item);
  assert.notStrictEqual(loaded, initial);
  assert.equal(loaded.imageLoaded, true);
  assert.equal(loaded.aspectRatio, '600 / 900');
  assert.strictEqual(view.getDeviceCardPresentation(otherItem), other);
  item.imageThumb = '/uploads/changed-thumb.webp';
  assert.equal(view.getDeviceCardPresentation(item).imageLoaded, false);
  assert.equal(view.getDeviceCardPresentation(item).aspectRatio, '4 / 3');
});

test('image failures remain isolated per page instance and a later load can recover', async () => {
  const { useDevicePresentation } = await presentationModule;
  const first = useDevicePresentation(ref([]));
  const second = useDevicePresentation(ref([]));
  const item = cardFixture();
  first.handleCardImageError(item.imageThumb);
  assert.equal(first.getDeviceCardPresentation(item).hasImage, false);
  assert.equal(second.getDeviceCardPresentation(item).hasImage, true);
  first.markImageLoaded(item.imageThumb, imageLoadEvent(640, 480));
  assert.equal(first.getDeviceCardPresentation(item).hasImage, true);
  assert.equal(first.getDeviceCardPresentation(item).imageLoaded, true);
  assert.equal(second.getDeviceCardPresentation(item).imageLoaded, false);
});

test('missing crop positions center images while an explicit zero remains valid', async () => {
  const { useDevicePresentation } = await presentationModule;
  const view = useDevicePresentation(ref([]));
  for (const position of [undefined, null, '', ' ', -1, 101, 1.5, Infinity]) {
    assert.equal(view.imageDisplayPositionY({ imageDisplayPositionY: position }), 50);
  }
  for (const position of [0, 50, 100]) {
    assert.equal(view.imageDisplayPositionY({ imageDisplayPositionY: position }), position);
  }
  assert.equal(view.imageDisplayAspectRatio({ imageWidth: Infinity, imageHeight: 480 }), '4 / 3');
  assert.equal(view.imageDisplayAspectRatio({ imageWidth: 800, imageHeight: 600, imageDisplayAspectRatio: 0.1 }), '800 / 600');
});

test('saved crop ratios take priority over legacy detail height and share vertical positioning', async () => {
  const { useDevicePresentation } = await presentationModule;
  const view = useDevicePresentation(ref([]));
  const item = cardFixture({ imageDisplayAspectRatio: 1.5, imageDisplayHeight: 320, imageDisplayPositionY: 0 });
  assert.equal(view.getDeviceCardPresentation(item).aspectRatio, 1.5);
  assert.deepEqual(view.detailMediaStyle(item), {
    '--detail-media-position-y': '0%', '--detail-media-aspect-ratio': '1.5'
  });
  item.imageDisplayAspectRatio = null;
  item.imageDisplayPositionY = null;
  assert.deepEqual(view.detailMediaStyle(item), {
    '--detail-media-position-y': '50%', '--detail-media-height': '320px'
  });
  assert.equal(view.detailImageHeight({ imageDisplayHeight: 721 }), null);
});

test('responsive srcset omits missing or duplicate image variants', async () => {
  const { useDevicePresentation } = await presentationModule;
  const view = useDevicePresentation(ref([]));
  for (const item of [{}, { imageThumb: '/thumb.webp' }, { image: '/detail.webp' }, { image: '/same.webp', imageThumb: '/same.webp' }]) {
    assert.equal(view.buildSrcset(item), '');
  }
  assert.equal(view.buildSrcset({ image: '/detail.webp', imageThumb: '/thumb.webp' }), '/thumb.webp 480w, /detail.webp 1280w');
});

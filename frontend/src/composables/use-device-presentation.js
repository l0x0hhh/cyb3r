// @ts-check
// 用户端展示状态独立于借还业务；每次调用隔离图片缓存，列表、详情和归还共用同一套规则。
import { computed, reactive } from 'vue';

/** @typedef {import('../types/device').DeviceImageFields} DeviceImageFields */
/** @typedef {import('../types/device').PortalDevice} PortalDevice */
/** @typedef {import('../types/device').DeviceCardPresentation} DeviceCardPresentation */

// 图标只能来自本地白名单，分类接口只提供图标名称，不能注入任意 SVG/HTML。
const CATEGORY_ICONS = new Map([
  ['camera', '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="2" y="6" width="16" height="11" rx="2" stroke="currentColor" stroke-width="1.4"/><circle cx="10" cy="12" r="3.5" stroke="currentColor" stroke-width="1.4"/><path d="M7 6L8 3h4l1 3" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>'],
  ['lens', '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="9" cy="9" r="5.5" stroke="currentColor" stroke-width="1.4"/><path d="M13 13l4 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>'],
  ['stabilizer', '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 3v14M3 10h14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M7 6l3-3 3 3M7 14l3 3 3-3M6 7l-3 3 3 3M14 7l3 3-3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'],
  ['microphone', '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="7" y="2" width="6" height="10" rx="3" stroke="currentColor" stroke-width="1.4"/><path d="M5 11a5 5 0 0010 0" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M10 17v-2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>'],
  ['other', '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="2" y="4" width="16" height="12" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M2 8h16" stroke="currentColor" stroke-width="1.4"/><path d="M8 8v8" stroke="currentColor" stroke-width="1.4" stroke-dasharray="2 1"/></svg>']
]);
const DEFAULT_CATEGORY_ICONS = new Map([
  ['cat-camera', 'camera'], ['cat-lens', 'lens'], ['cat-stabilizer', 'stabilizer'],
  ['cat-microphone', 'microphone'], ['cat-other', 'other']
]);

/** @param {unknown} value */
function imageNumber(value) {
  // 空值表示尚未设置；不能通过 Number(null) / Number('') 被误判为顶端 0%。
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return NaN;
  return Number(value);
}

/** @param {import('vue').Ref<import('../types/device').DeviceCategory[]>} categories */
export function useDevicePresentation(categories) {
  const categoryIcons = computed(() => new Map(categories.value.map(category => [category.id, category.icon])));
  /** @type {Set<string>} */
  const failedImages = reactive(new Set());
  /** @type {Set<string>} */
  const loadedImages = reactive(new Set());
  /** @type {Map<string, string>} */
  const imageRatios = reactive(new Map());
  /** @type {WeakMap<PortalDevice, import('vue').ComputedRef<DeviceCardPresentation>>} */
  const deviceCardPresentations = new WeakMap();

  /** @param {string} categoryIdOrIcon */
  function categoryIcon(categoryIdOrIcon) {
    const icon = categoryIcons.value.get(categoryIdOrIcon)
      || DEFAULT_CATEGORY_ICONS.get(categoryIdOrIcon) || categoryIdOrIcon;
    return CATEGORY_ICONS.get(icon) || CATEGORY_ICONS.get('other') || '';
  }

  /** @param {string} categoryId */
  function categoryColorClass(categoryId) {
    return DEFAULT_CATEGORY_ICONS.has(categoryId) ? categoryId : 'cat-other';
  }

  /** @param {DeviceImageFields | null | undefined} item @param {string | null} [source] */
  function hasImage(item, source = item?.image) {
    return !!source && !failedImages.has(source);
  }

  /** @param {string | null | undefined} source */
  function markImageFailed(source) {
    if (source) failedImages.add(source);
  }

  /** @param {string | null | undefined} source @param {Event} [event] */
  function markImageLoaded(source, event) {
    if (!source) return;
    loadedImages.add(source);
    // 同一 URL 后续实际加载成功时，清除先前失败状态。
    failedImages.delete(source);
    const image = event?.target;
    if (!image || !('naturalWidth' in image) || !('naturalHeight' in image)) return;
    const width = imageNumber(image.naturalWidth);
    const height = imageNumber(image.naturalHeight);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      imageRatios.set(source, `${width} / ${height}`);
    }
  }

  /** @param {import('../types/device').CardImageLoadPayload} payload */
  function handleCardImageLoad(payload) {
    markImageLoaded(payload.source, payload.event);
  }

  /** @param {string | null | undefined} source */
  function isImageLoaded(source) {
    return !!source && loadedImages.has(source);
  }

  /** @param {DeviceImageFields | null | undefined} item */
  function imageAspectRatio(item) {
    const width = imageNumber(item?.imageWidth);
    const height = imageNumber(item?.imageHeight);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) return `${width} / ${height}`;
    for (const source of [item?.imageThumb, item?.image]) {
      const ratio = source && imageRatios.get(source);
      if (ratio) return ratio;
    }
    return '4 / 3';
  }

  /** @param {DeviceImageFields | null | undefined} item */
  function detailImageAspectRatio(item) {
    const ratio = imageNumber(item?.imageDisplayAspectRatio);
    return Number.isFinite(ratio) && ratio >= 0.2 && ratio <= 20 ? ratio : null;
  }

  /** @param {DeviceImageFields | null | undefined} item */
  function imageDisplayAspectRatio(item) {
    return detailImageAspectRatio(item) ?? imageAspectRatio(item);
  }

  /** @param {DeviceImageFields | null | undefined} item */
  function imageDisplayPositionY(item) {
    const position = imageNumber(item?.imageDisplayPositionY);
    return Number.isInteger(position) && position >= 0 && position <= 100 ? position : 50;
  }

  /** @param {DeviceImageFields | null | undefined} item */
  function buildSrcset(item) {
    const thumb = item?.imageThumb || item?.image;
    const detail = item?.image;
    return thumb && detail && thumb !== detail ? `${thumb} 480w, ${detail} 1280w` : '';
  }

  /** @param {DeviceImageFields | null | undefined} item */
  function detailImageHeight(item) {
    const height = imageNumber(item?.imageDisplayHeight);
    return Number.isInteger(height) && height >= 120 && height <= 720 ? height : null;
  }

  /** @param {DeviceImageFields | null | undefined} item */
  function detailMediaStyle(item) {
    const aspectRatio = detailImageAspectRatio(item);
    const height = detailImageHeight(item);
    /** @type {Record<string, string>} */
    const style = { '--detail-media-position-y': `${imageDisplayPositionY(item)}%` };
    if (aspectRatio) style['--detail-media-aspect-ratio'] = String(aspectRatio);
    if (!aspectRatio && height) style['--detail-media-height'] = `${height}px`;
    return style;
  }

  /** @param {PortalDevice} item @returns {DeviceCardPresentation} */
  function getDeviceCardPresentation(item) {
    let presentation = deviceCardPresentations.get(item);
    if (!presentation) {
      // 依赖图片和分类的响应式状态，未变化时复用对象，避免页脚计时触发卡片更新。
      presentation = computed(() => {
        const imageSource = item.imageThumb || item.image || '';
        return {
          categoryClass: categoryColorClass(item.category), categoryIcon: categoryIcon(item.category),
          imageSource, hasImage: hasImage(item, imageSource), imageLoaded: isImageLoaded(imageSource),
          aspectRatio: imageDisplayAspectRatio(item), positionY: imageDisplayPositionY(item)
        };
      });
      deviceCardPresentations.set(item, presentation);
    }
    return presentation.value;
  }

  return {
    categoryIcon, categoryColorClass, hasImage, markImageFailed, markImageLoaded, isImageLoaded,
    handleCardImageLoad, handleCardImageError: markImageFailed, getDeviceCardPresentation,
    imageAspectRatio, imageDisplayAspectRatio, imageDisplayPositionY, buildSrcset,
    detailImageHeight, detailImageAspectRatio, detailMediaStyle
  };
}

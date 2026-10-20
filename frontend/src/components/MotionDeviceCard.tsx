// 用户端设备卡片：渲染明确类型的展示数据，保留原生链接/按钮及图片事件。
import { computed, defineComponent, type PropType } from 'vue';
import { motion } from 'motion-v';
import { getDeviceCardMotionProps } from './borrow-motion.js';
import type { CardImageLoadPayload, DeviceCardEntry, DeviceCardPresentation, PortalDevice } from '../types/device';

export default defineComponent({
  name: 'MotionDeviceCard',
  props: {
    entry: { type: Object as PropType<DeviceCardEntry>, required: true },
    presentation: { type: Object as PropType<DeviceCardPresentation>, required: true },
    inCart: { type: Boolean, default: false },
    prefersReducedMotion: { type: Boolean, default: false }
  },
  emits: {
    'open-device': (deviceId: string) => typeof deviceId === 'string',
    'toggle-cart': (item: PortalDevice) => typeof item?.id === 'string',
    'image-load': (payload: CardImageLoadPayload) => typeof payload?.source === 'string' && !!payload.event,
    'image-error': (source: string) => typeof source === 'string'
  },
  setup(props, { emit }) {
    const device = computed(() => props.entry.item);

    function openDevice(event: MouseEvent) {
      event.preventDefault();
      emit('open-device', device.value.id);
    }

    function toggleCart(event: MouseEvent) {
      event.stopPropagation();
      emit('toggle-cart', device.value);
    }

    function reportImageLoad(source: string, event: Event) {
      emit('image-load', { source, event } satisfies CardImageLoadPayload);
    }

    return () => {
      const item = device.value;
      const view = props.presentation;
      const imageSource = view.imageSource;
      const supportsViewport = typeof window !== 'undefined' && typeof window.IntersectionObserver === 'function';
      const motionProps = getDeviceCardMotionProps(props.prefersReducedMotion, supportsViewport);

      return (
        <motion.article
          {...motionProps}
          class={[
            'portal-device-row',
            'portal-device-row--' + view.categoryClass,
            { 'portal-device-row--selected': props.inCart }
          ]}
          style={{ '--card-index': props.entry.index }}
        >
          <a
            href={'/borrow?id=' + item.id}
            data-device-id={item.id}
            role="button"
            onClick={openDevice}
            class="portal-device-row__link"
          >
            <span
              class="portal-device-row__media"
              style={{ aspectRatio: view.aspectRatio }}
            >
              {view.hasImage ? (
                <img
                  src={imageSource}
                  alt={item.name}
                  width={item.imageWidth || undefined}
                  height={item.imageHeight || undefined}
                  class={['portal-media-image', { 'is-loaded': view.imageLoaded }]}
                  style={{ objectPosition: '50% ' + view.positionY + '%' }}
                  loading={props.entry.index < 2 ? 'eager' : 'lazy'}
                  fetchpriority={props.entry.index < 2 ? 'high' : 'auto'}
                  decoding="async"
                  onLoad={(event: Event) => reportImageLoad(imageSource, event)}
                  onError={() => emit('image-error', imageSource)}
                />
              ) : (
                <span class="portal-image-placeholder portal-image-placeholder--small">暂无图片</span>
              )}
            </span>
            <span class="portal-device-row__content">
              <span class="portal-device-row__icon" innerHTML={view.categoryIcon}></span>
              <strong>{item.name}</strong>
              <span>{item.model}</span>
              <small>{item.location || '位置未填写'}</small>
            </span>
          </a>
          {item.status === 'available' && item.operationalStatus !== 'offline' ? (
            <button
              type="button"
              class={['portal-device-row__cart', { 'portal-device-row__cart--active': props.inCart }]}
              aria-pressed={props.inCart}
              onClick={toggleCart}
            >
              {props.inCart ? '已加入 ✓' : '＋ 加入借用'}
            </button>
          ) : null}
        </motion.article>
      );
    };
  }
});

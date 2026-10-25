// 共享页脚状态按页面实例创建，保留一言降级、减少动态效果和计时器清理。
import * as Vue from 'vue';
import { useReducedMotion } from 'motion-v';

// 站点运行时长由浏览器本地计算，避免为页脚引入额外后端请求。
const SITE_LAUNCH_TIMESTAMP = Date.parse('2026-07-21T12:00:00+08:00');
function formatSiteRuntime(now = Date.now()) {
  const elapsedSeconds = Math.max(0, Math.floor((now - SITE_LAUNCH_TIMESTAMP) / 1000));
  const days = Math.floor(elapsedSeconds / 86400);
  const hours = Math.floor((elapsedSeconds % 86400) / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;
  return `本站已运行 ${days} 天 ${hours} 小时 ${minutes} 分 ${seconds} 秒`;
}

function useSiteRuntime() {
  const siteRuntime = Vue.ref(formatSiteRuntime());
  let timerId = null;
  Vue.onMounted(() => {
    timerId = window.setInterval(() => {
      siteRuntime.value = formatSiteRuntime();
    }, 1000);
  });
  Vue.onBeforeUnmount(() => {
    if (timerId !== null) window.clearInterval(timerId);
  });
  return siteRuntime;
}

// 每次页面装载从诗词和哲学中请求一言，失败时保留本地文案。
function useHitokoto() {
  // 统一使用 Motion 的减少动态效果状态，避免页脚一言与其他页面各自判定产生偏差。
  const prefersReducedMotion = useReducedMotion();
  const fallbackText = '山高水长，行稳致远。';
  const hitokotoText = Vue.ref('');
  const hitokotoUrl = Vue.ref('');
  const isHitokotoTyping = Vue.ref(false);
  let typingTimerId = null;
  let cursorTimerId = null;

  function clearTypewriterTimers() {
    if (typingTimerId !== null) window.clearInterval(typingTimerId);
    if (cursorTimerId !== null) window.clearTimeout(cursorTimerId);
    typingTimerId = null;
    cursorTimerId = null;
  }

  function typeHitokoto(text) {
    clearTypewriterTimers();
    const chars = Array.from(text);
    if (prefersReducedMotion.value) {
      hitokotoText.value = text;
      isHitokotoTyping.value = false;
      return;
    }

    hitokotoText.value = '';
    isHitokotoTyping.value = true;
    let index = 0;
    typingTimerId = window.setInterval(() => {
      hitokotoText.value += chars[index];
      index += 1;
      if (index >= chars.length) {
        window.clearInterval(typingTimerId);
        typingTimerId = null;
        cursorTimerId = window.setTimeout(() => {
          isHitokotoTyping.value = false;
          cursorTimerId = null;
        }, 1000);
      }
    }, 60);
  }

  async function loadHitokoto() {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 2500);
    try {
      const response = await fetch('https://v1.hitokoto.cn/?c=i&c=k&max_length=40&encode=json', {
        headers: { Accept: 'application/json' },
        signal: controller.signal
      });
      if (!response.ok) return;
      const data = await response.json();
      if (typeof data.hitokoto !== 'string' || !data.hitokoto.trim()) throw new Error('一言内容为空');
      typeHitokoto(data.hitokoto.trim());
      hitokotoUrl.value = typeof data.uuid === 'string' && data.uuid
        ? `https://hitokoto.cn/?uuid=${encodeURIComponent(data.uuid)}`
        : '';
    } catch (error) {
      // 网络失败或超时播放本地文案，底栏无需打断用户操作。
      typeHitokoto(fallbackText);
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  Vue.onMounted(loadHitokoto);
  Vue.onBeforeUnmount(() => {
    clearTypewriterTimers();
  });
  return { hitokotoText, hitokotoUrl, isHitokotoTyping };
}

export function useSiteFooter() {
  const siteRuntime = useSiteRuntime();
  const { hitokotoText, hitokotoUrl, isHitokotoTyping } = useHitokoto();
  return { filingNumber: import.meta.env.VITE_ICP_NUMBER || '', siteRuntime, hitokotoText, hitokotoUrl, isHitokotoTyping };
}

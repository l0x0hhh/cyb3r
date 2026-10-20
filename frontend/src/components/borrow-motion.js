// @ts-check
// 用户端动效入口：字符串模板显式注册组件，卡片仅在进入视口时播放位移。
import { AnimatePresence, motion } from 'motion-v';

export const borrowMotionComponents = {
  AnimatePresence,
  MotionArticle: motion.article,
  MotionButton: motion.button,
  MotionDiv: motion.div
};

/** @type {import('motion-v').MotionProps<'article'>['variants']} */
const cardVariants = {
  // 观察器未触发时也保持内容可见，避免设备卡片无法访问。
  offscreen: { opacity: 1, y: 18 },
  onscreen: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring', bounce: 0.4, duration: 0.8 }
  }
};

/** @type {import('motion-v').MotionProps<'article'>['inViewOptions']} */
const cardViewportOptions = { once: true, amount: 'some' };

/**
 * @param {boolean} prefersReducedMotion
 * @param {boolean} supportsViewport
 * @returns {import('motion-v').MotionProps<'article'>}
 */
export function getDeviceCardMotionProps(prefersReducedMotion, supportsViewport) {
  if (prefersReducedMotion || !supportsViewport) {
    // 系统偏好发生变化或浏览器缺少观察器时，立即归位并取消视口动画。
    return {
      initial: false,
      animate: { opacity: 1, y: 0 },
      whileInView: undefined,
      transition: { duration: 0 }
    };
  }

  return {
    initial: 'offscreen',
    // 不在挂载时设置 onscreen，屏幕外的卡片等待首次进入视口。
    animate: undefined,
    whileInView: 'onscreen',
    variants: cardVariants,
    inViewOptions: cardViewportOptions,
    transition: { duration: 0.4 }
  };
}

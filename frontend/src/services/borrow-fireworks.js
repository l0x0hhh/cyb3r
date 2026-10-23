// 用户端点击特效按需加载，管理员后台不创建 Canvas 也不请求特效脚本。
export function loadBorrowFireworks(canvasEl) {
  if (!canvasEl) return Promise.resolve(() => {});

  function loadScript(src) {
    const existing = document.querySelector(`script[data-device-effect="${src}"]`);
    if (existing) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.dataset.deviceEffect = src;
      script.onload = resolve;
      script.onerror = reject;
      document.body.appendChild(script);
    });
  }

  return loadScript('/js/anime.min.js')
    .then(() => loadScript('/js/fireworks.js'))
    .then(() => typeof window.initBorrowFireworks === 'function'
      ? window.initBorrowFireworks(canvasEl)
      : () => {})
    .catch(() => () => {});
}

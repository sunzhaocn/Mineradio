'use strict';
(function installVideoRenderer() {
  if (window !== window.top) return;
  Object.defineProperty(window, 'desktopWindow', { value: Object.freeze({
    isDesktop: true, onStateChange: () => {},
    getState: async () => ({ isVisible: true, isMinimized: false, isFullScreen: true, isNativeFullScreen: true }),
  }) });
  Object.defineProperty(window, 'mineradioVideoRender', { value: Object.freeze({
    getConfig: async () => (await fetch('/__config')).json(),
  }) });
  const send = value => window.ipc.postMessage(JSON.stringify(value));
  const children = new WeakMap();
  function stepFrames(parent, time) {
    for (const iframe of parent.document.querySelectorAll('iframe')) {
      try {
        const child = iframe.contentWindow;
        const performance = child.performance;
        let animation = children.get(child);
        if (!animation) {
          const beginning = performance.now(), pending = new Map();
          let sequence = 0;
          animation = { now: beginning, beginning, pending };
          Object.defineProperty(performance, 'now', { configurable: true, value: () => animation.now });
          child.requestAnimationFrame = callback => { pending.set(++sequence, callback); return sequence; };
          child.cancelAnimationFrame = id => pending.delete(id);
          children.set(child, animation);
        }
        animation.now = animation.beginning + time * 1000;
        const jobs = Array.from(animation.pending.values());
        animation.pending.clear();
        for (const job of jobs) job(animation.now);
        stepFrames(child, time);
      } catch (_) {}
    }
  }
  window.__mineradioDrawVideoFrame = async function (sequence, time, samples) {
    try {
      const current = await window.mineradioRenderVideoFrame(time, samples);
      stepFrames(window, time);
      send({ type: 'drawn', sequence, preset: current?.preset });
    } catch (error) {
      send({ type: 'drawn', sequence, error: String(error?.message || '视频预设渲染失败').slice(0, 500) });
    }
  };
  const timer = setInterval(() => {
    const ready = window.MINERADIO_VIDEO_READY;
    const error = window.MINERADIO_VIDEO_ERROR || window.MINERADIO_MODULE_STATUS?.error;
    if (!ready && !error) return;
    clearInterval(timer);
    send({ type: 'ready', error: error ? String(error).slice(0, 500) : null });
  }, 60);
})();

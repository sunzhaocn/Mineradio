'use strict';

// Function declarations load before ordered initialization to preserve the legacy
// global hoisting contract. Every module runs as its own external classic script.
(async function loadMineradioModules() {
  const bundledSource = document.currentScript && document.currentScript.dataset.bundle;
  const status = window.MINERADIO_MODULE_STATUS = { loaded: 0, total: 0, ready: false, error: '' };
  try {
    const response = await fetch('js/module-manifest.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error('Unable to load the player module manifest');
    const manifest = await response.json();
    const shaders = {};
    await Promise.all(Object.entries(manifest.resources.shaders).map(async ([name, url]) => {
      const resource = await fetch(url, { cache: 'no-cache' });
      if (!resource.ok) throw new Error('Unable to load shader: ' + url);
      shaders[name] = await resource.text();
    }));
    window.MINERADIO_SHADERS = Object.freeze(shaders);
    const modulePaths = [...manifest.declarations, ...manifest.runtime];
    status.total = modulePaths.length;
    const loaded = (bundledSource ? [bundledSource] : modulePaths).map(modulePath => new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.async = false;
      script.src = modulePath;
      script.onload = () => { status.loaded += bundledSource ? modulePaths.length : 1; resolve(); };
      script.onerror = () => reject(new Error('Unable to load player module: ' + modulePath));
      document.head.appendChild(script);
    }));
    await Promise.all(loaded);
    if (document.readyState === 'loading') {
      await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    }
    status.ready = true;
    const callbacks = window.MINERADIO_DOM_READY_CALLBACKS || [];
    callbacks.splice(0).forEach(callback => queueMicrotask(callback));
    window.dispatchEvent(new Event('mineradio:ready'));
  } catch (error) {
    status.error = String(error && error.message || error);
    console.error('Player initialization failed:', error);
    const hint = document.getElementById('hint');
    if (hint) hint.textContent = '播放器模块加载失败，请刷新页面';
  }
})();

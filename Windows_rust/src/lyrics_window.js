'use strict';
(function installDesktopLyricsBridge() {
  if (window.top !== window || location.href !== __MINERADIO_LYRICS_PAGE__) return;
  const listeners = new Set();
  async function send(method, value) { window.ipc.postMessage(JSON.stringify({ method, value })); }
  Object.defineProperty(window, '__mineradioLyricsState', {
    value: state => listeners.forEach(callback => callback(state)),
  });
  Object.defineProperty(window, 'desktopOverlay', {
    value: Object.freeze({
      onLyricsState: function (callback) {
        if (typeof callback === 'function') listeners.add(callback);
        return () => listeners.delete(callback);
      },
      closeLyrics: () => send('close'),
      setLyricsLockState: locked => send('lock', !!locked),
      moveLyricsBy: (x, y) => send('move', [Number(x) || 0, Number(y) || 0]),
    }),
  });
  document.addEventListener('DOMContentLoaded', () => { send('ready').catch(() => {}); });
})();

'use strict';
(function () {
  window.mineradioRemoteApp = new URLSearchParams(location.search).get('app') === 'ipad';
  window.mineradioWebPlayer = !(window.desktopWindow && window.desktopWindow.isDesktop);
  window.mineradioPlayerControls = true;
  document.documentElement.classList.add('player-controls-shell');
  if (window.mineradioWebPlayer) document.documentElement.classList.add('web-player-shell');
  window.mineradioTabletApp = typeof window.mineradioDetectTablet === 'function' ? window.mineradioDetectTablet() :
    window.mineradioRemoteApp && !/iPhone|iPod/.test(navigator.userAgent) && Math.min(screen.width, screen.height) >= 600;
  if (window.mineradioRemoteApp) document.documentElement.classList.add('ipad-app-shell');
  window.mineradioHoverPanels = !window.mineradioRemoteApp && !window.mineradioTabletApp && !window.__mineradioAndroid
    && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  document.documentElement.classList.toggle('hover-player-panels', window.mineradioHoverPanels);
  // Native clients ship their complete UI. Their fresh bootstrap has already
  // retired legacy shell workers; do not register or duplicate UI assets here.
  if ((window.desktopWindow && window.desktopWindow.isDesktop) || window.MineradioAndroid) return;
  var offline = document.createElement('script');
  offline.src = '/js/features/shell/offline-shell.js';
  document.head.appendChild(offline);
})();

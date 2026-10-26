'use strict';



function toggleFullscreen() {
  var api = window.desktopWindow;
  if (api && api.isDesktop && typeof api.toggleFullscreen === 'function') {
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(function () { });
      scheduleMainRendererViewportRefresh('document-fullscreen-exit');
      return;
    }
    api.toggleFullscreen();
    scheduleMainRendererViewportRefresh('desktop-fullscreen-toggle');
    return;
  }
  if (api && api.isDesktop && desktopFullscreenActive && !document.fullscreenElement && typeof api.exitFullscreenWindowed === 'function') {
    api.exitFullscreenWindowed();
    scheduleMainRendererViewportRefresh('desktop-fullscreen-exit');
    return;
  }
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(function () {
      if (api && api.isDesktop && typeof api.toggleFullscreen === 'function') api.toggleFullscreen();
      else showToast('全屏被浏览器拒绝');
    });
  } else {
    document.exitFullscreen();
    scheduleMainRendererViewportRefresh('document-fullscreen-exit');
  }
}
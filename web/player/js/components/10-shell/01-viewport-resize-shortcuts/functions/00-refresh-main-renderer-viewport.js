'use strict';

// ============================================================
function refreshMainRendererViewport(reason) {
  if (typeof camera !== 'undefined' && camera) {
    camera.aspect = Math.max(1, innerWidth) / Math.max(1, innerHeight);
    camera.updateProjectionMatrix();
  }
  applyRendererPowerMode();
  if (typeof requestStageLyricCameraSnap === 'function' && (desktopRuntimeState.fullscreen || document.fullscreenElement)) {
    requestStageLyricCameraSnap(reason === 'resize' ? 4 : 10);
  }
}

function scheduleMainRendererViewportRefresh(reason) {
  refreshMainRendererViewport(reason || 'sync');
  [48, 140, 320].forEach(function (delay) {
    setTimeout(function () { refreshMainRendererViewport(reason || 'sync'); }, delay);
  });
}
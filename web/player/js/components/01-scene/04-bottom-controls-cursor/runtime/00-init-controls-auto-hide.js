'use strict';



(function initControlsAutoHide() {
  var bar = document.getElementById('bottom-bar');
  var handle = document.getElementById('bottom-handle');
  if (!bar) return;
  var lastTouchAt = -Infinity;
  document.addEventListener('pointerdown', function (event) {
    if (event.pointerType === 'touch') lastTouchAt = performance.now();
  }, true);
  function enterControls() {
    if (window.mineradioRemoteApp && (performance.now() - lastTouchAt < 1000 || window.matchMedia('(hover: none)').matches)) return;
    controlsHovering = true;
    wakeBottomHandle();
    setControlsHidden(false);
    if (controlsHideTimer) { clearTimeout(controlsHideTimer); controlsHideTimer = null; }
  }
  function leaveControls() {
    controlsHovering = false;
    scheduleControlsHide(70);
    wakeBottomHandle(900);
  }
  bar.addEventListener('mouseenter', enterControls);
  bar.addEventListener('mouseleave', leaveControls);
  bar.addEventListener('pointerup', function (event) {
    if (window.mineradioRemoteApp && event.pointerType === 'touch') {
      controlsHovering = false;
      holdBottomControlsVisible(3500);
    }
  });
  if (handle) {
    handle.addEventListener('mouseenter', function () {
      if (window.mineradioRemoteApp && (performance.now() - lastTouchAt < 1000 || window.matchMedia('(hover: none)').matches)) return;
      controlsHovering = true;
      revealBottomControls(900);
    });
    handle.addEventListener('mouseleave', leaveControls);
    handle.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); toggleBottomControlsFromHandle(); });
  }
  updateControlsChromeState();
})();


['mousemove', 'pointermove', 'mousedown', 'wheel', 'touchstart'].forEach(function (type) {
  window.addEventListener(type, revealCursorForActivity, { passive: true, capture: true });
});

syncCursorAutoHideMode();

// ============================================================
//  指针 / 拖拽控制
//   v7.1: 用 userOrbit 替代 targetOrbit; 加 drag 距离判断

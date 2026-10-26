'use strict';


renderer.domElement.addEventListener('click', function (e) {
  if (!shelfManager || shelfManager.getMode() === 'off') return;
  if (typeof shelfPlaybackSwitchGuardActive === 'function' && shelfPlaybackSwitchGuardActive()) return;
  if (document.body.classList.contains('splash-active')) return;
  if (isPointerOverUi(e)) return;
  if (mouseDownAt.hadDrag) { mouseDownAt.hadDrag = false; return; }

  var rc = raycasterFromPointerEvent(e);
  var mode = shelfManager.getMode();
  var canInteract = shelfManager.canInteract && shelfManager.canInteract();

  // 优先二级内容框
  if (shelfManager.hasOpenContent()) {
    var cl = shelfManager.getContentList && shelfManager.getContentList();
    if (cl) {
      var rowHit = cl.raycastRows(rc);
      if (!rowHit && cl.pickRowAtScreen) rowHit = cl.pickRowAtScreen(e.clientX, e.clientY);
      if (rowHit) {
        if (cl.pulseRow) cl.pulseRow(rowHit.row, 0.72);
        var selectedRow = Math.abs(rowHit.row.index - cl.getCenterIdx()) < 0.5;
        var rowIsPodcastRadio = !!(rowHit.row.song && rowHit.row.song.type === 'podcast-radio');
        var hitLikeButton = rowHit.uv && rowHit.uv.x > 0.61 && rowHit.uv.x < 0.68 && rowHit.uv.y > 0.20 && rowHit.uv.y < 0.82;
        var hitCollectButton = rowHit.uv && rowHit.uv.x >= 0.68 && rowHit.uv.x < 0.75 && rowHit.uv.y > 0.20 && rowHit.uv.y < 0.82;
        var hitNextButton = rowHit.uv && rowHit.uv.x >= 0.75 && rowHit.uv.x < 0.82 && rowHit.uv.y > 0.20 && rowHit.uv.y < 0.82;
        var hitPlayButton = rowHit.uv && rowHit.uv.x >= 0.82 && rowHit.uv.y > 0.20 && rowHit.uv.y < 0.82;
        var screenAction = (!rowHit.uv && cl.rowActionAtScreen) ? cl.rowActionAtScreen(rowHit.row, e.clientX, e.clientY) : null;
        hitLikeButton = hitLikeButton || screenAction === 'like';
        hitCollectButton = hitCollectButton || screenAction === 'collect';
        hitNextButton = hitNextButton || screenAction === 'next';
        hitPlayButton = hitPlayButton || screenAction === 'play';
        // 详情页支持直接点歌曲播放；红心/收藏按钮仍然保留原动作。
        if (selectedRow && !rowIsPodcastRadio && hitLikeButton) {
          toggleLikeDetailSong(rowHit.row.song);
        } else if (selectedRow && !rowIsPodcastRadio && hitCollectButton) {
          collectDetailSong(rowHit.row.song);
        } else if (selectedRow && !rowIsPodcastRadio && hitNextButton) {
          queueDetailSongNext(rowHit.row.song);
        } else if ((rowHit.row.song && rowHit.row.song.id) || rowIsPodcastRadio || (selectedRow && hitPlayButton)) {
          cl.playRow(rowHit.row);
        } else {
          // 滚到这行
          cl.scrollBy(rowHit.row.index - cl.getCenterIdx());
        }
        return;
      }
      var returnHit = shelfManager.raycastCards(rc);
      safeShelfCloseContent('shelf-card-return');
      if (mode === 'side') setShelfPinnedOpen(true, true);
      if (returnHit && returnHit.card) {
        shelfManager.scrollBy(returnHit.card.index - shelfManager.getCenterIdx());
      }
      return;
    }
  }

  // 一级卡片
  var hit = pointerCardHit(rc, e, mode === 'side' && !shelfPinnedOpen && shelfAlwaysVisible() ? 18 : undefined);
  if (mode === 'side' && !shelfPinnedOpen && !canUseSideShelfWithoutPinnedOpen()) return;

  if (hit) {
    if (mode === 'side') setShelfPinnedOpen(true, true);
    var idx = hit.card.index;
    if (Math.abs(idx - shelfManager.getCenterIdx()) < 0.5) {
      if (isShelfPlaylistPlayHit(hit) && shelfManager.playPlaylistAt && shelfManager.playPlaylistAt(idx)) return;
      shelfManager.openContent(idx);
    } else {
      shelfManager.scrollBy(idx - shelfManager.getCenterIdx());
    }
  } else if (mode === 'side' && shelfPinnedOpen) {
    setShelfPinnedOpen(false, true);
    focusCameraOnShelf(null);
  }
});


function openShelfAtFocus() {
  if (typeof shelfPlaybackSwitchGuardUntil !== 'undefined') shelfPlaybackSwitchGuardUntil = 0;
  setShelfPinnedOpen(true, true);
  focusCameraOnShelf('shelf-side');
}

function openShelfContextMenu(e) {
  if (document.body.classList.contains('splash-active')) return;
  if (isPointerOverUi(e)) return;
  e.preventDefault();
  e.stopPropagation();
  if (typeof suppressBottomControlsForShelf === 'function') suppressBottomControlsForShelf(980);
  if (!shelfManager) return;
  var mode = shelfManager.getMode && shelfManager.getMode();
  if (mode === 'off') {
    setShelfMode('side');
    mode = 'side';
  }
  if (mode !== 'side') return;
  if (shelfManager.hasOpenContent && shelfManager.hasOpenContent()) {
    var rc = raycasterFromPointerEvent(e);
    var cl = shelfManager.getContentList && shelfManager.getContentList();
    var rowHit = cl && cl.raycastRows ? cl.raycastRows(rc) : null;
    if (rowHit && rowHit.row && rowHit.row.song && rowHit.row.song.id && rowHit.row.song.type !== 'podcast-radio') {
      if (cl.pulseRow) cl.pulseRow(rowHit.row, 0.88);
      queueDetailSongNext(rowHit.row.song);
      return;
    }
    safeShelfCloseContent('shelf-context-toggle');
    openShelfAtFocus();
    return;
  }
  var viewDisplaced = typeof orbit !== 'undefined' && orbit &&
    (Math.abs(orbit.userTheta - orbit.baselineTheta) > 0.015 || Math.abs(orbit.userPhi - orbit.baselinePhi) > 0.015
      || Math.abs(orbit.userRadius - orbit.baselineRadius) > 0.08);
  var freeView = typeof freeCamera !== 'undefined' && freeCamera &&
    (freeCamera.active || freeCamera.locked || freeCamera.resetTween);
  if (!shelfPinnedOpen || viewDisplaced || orbit.recentering || freeView) {
    openShelfAtFocus(); return;
  }
  setShelfPinnedOpen(false, true);
  focusCameraOnShelf(null);
}
renderer.domElement.addEventListener('contextmenu', openShelfContextMenu);

// iPad does not reliably dispatch contextmenu for a held canvas. Recognize a
// stationary touch ourselves; scrolling, multitouch and release cancel it.
(function () {
  var canvas = renderer.domElement, held = null, timer = 0, suppressUntil = 0;
  canvas.classList.add('mineradio-particle-surface');
  // WebKit may start its native selection gesture over a canvas despite the
  // CSS callout rules. Own touch defaults only on this interactive surface.
  // Preventing touchstart also removes compatibility clicks, so deliver a tap
  // once ourselves, keeping the existing pointer-based shelf drag unchanged.
  var tap = null, touchOwned = false, nativeClickUntil = 0;
  canvas.addEventListener('touchstart', function (event) {
    if (document.body.classList.contains('splash-active') || isPointerOverUi(event)) return;
    event.preventDefault();
    if (!touchOwned && event.touches.length === 1) {
      var point = event.touches[0];
      tap = { id: point.identifier, x: point.clientX, y: point.clientY };
      mouseDownAt.hadDrag = false;
    } else { tap = null; cancel(); }
    touchOwned = true;
    var selection = window.getSelection && window.getSelection();
    if (selection && selection.rangeCount) selection.removeAllRanges();
  }, { passive: false });
  canvas.addEventListener('touchmove', function (event) {
    if (!touchOwned) return;
    event.preventDefault();
    if (!tap) return;
    var point = Array.from(event.touches).find(function (p) { return p.identifier === tap.id; });
    if (!point || Math.hypot(point.clientX - tap.x, point.clientY - tap.y) > 8) { tap = null; cancel(); }
  }, { passive: false });
  canvas.addEventListener('touchend', function (event) {
    if (!touchOwned) return;
    event.preventDefault();
    if (event.touches.length) { tap = null; return; }
    var point = tap; tap = null; touchOwned = false;
    nativeClickUntil = performance.now() + 800;
    if (!point || performance.now() < suppressUntil || mouseDownAt.hadDrag) return;
    var click = new MouseEvent('click', { bubbles: true, cancelable: true,
      view: window, clientX: point.x, clientY: point.y, button: 0 });
    click.mineradioSurfaceTap = true;
    canvas.dispatchEvent(click);
  }, { passive: false });
  function cancelTouch() { tap = null; touchOwned = false; nativeClickUntil = performance.now() + 800; cancel(); }
  canvas.addEventListener('touchcancel', cancelTouch);
  canvas.addEventListener('click', function (event) {
    if (!event.mineradioSurfaceTap && performance.now() < nativeClickUntil) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }, true);
  ['contextmenu', 'selectstart', 'dragstart'].forEach(function (type) {
    canvas.addEventListener(type, function (event) {
      event.preventDefault();
      if (type === 'contextmenu' && touchOwned) event.stopImmediatePropagation();
    }, true);
  });
  function cancel() { clearTimeout(timer); timer = 0; held = null; }
  canvas.addEventListener('pointerdown', function (event) {
    cancel();
    if (event.isPrimary === false || event.pointerType !== 'touch' || event.button !== 0 ||
        document.body.classList.contains('splash-active') || isPointerOverUi(event)) return;
    held = { id: event.pointerId, x: event.clientX, y: event.clientY };
    timer = setTimeout(function () {
      var point = held; cancel();
      if (!point || document.hidden || document.body.classList.contains('splash-active')) return;
      suppressUntil = performance.now() + 1000;
      openShelfContextMenu({ clientX: point.x, clientY: point.y, target: canvas,
        preventDefault: function () {}, stopPropagation: function () {} });
    }, 550);
  }, true);
  canvas.addEventListener('pointermove', function (event) {
    if (!held || event.pointerId !== held.id) return;
    var dx = event.clientX - held.x, dy = event.clientY - held.y;
    if (dx * dx + dy * dy > 64) cancel();
  }, true);
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (type) {
    canvas.addEventListener(type, cancel, true);
  });
  ['click', 'contextmenu'].forEach(function (type) {
    canvas.addEventListener(type, function (event) {
      if (performance.now() >= suppressUntil) return;
      event.preventDefault(); event.stopImmediatePropagation();
    }, true);
  });
  window.addEventListener('blur', cancel);
  document.addEventListener('visibilitychange', cancel);
  window.addEventListener('blur', cancelTouch);
  document.addEventListener('visibilitychange', cancelTouch);
}());


// 滚轮: 在真实卡片或右侧窄热区内滚卡片; 否则保留给封面粒子/视角
//   side 模式: 常驻不再用半屏预览区接管滚轮
//   stage 模式: 鼠标 y > 60% 屏幕高
//   shift + wheel: 强制滚卡片
var wheelOverShelf = false;

renderer.domElement.addEventListener('wheel', function (e) {
  var target = shelfScrollTarget(e);
  if (!target) return;
  markRenderInteraction('shelf-wheel', 900);
  e.preventDefault();
  e.stopImmediatePropagation();
  target.scrollBy(e.deltaY > 0 ? 1 : -1);
}, { passive: false, capture: true });

// 3D 卡片没有浏览器原生滚动条，单指滑动需要转成与滚轮相同的选项移动。
(function () {
  var canvas = renderer.domElement, drag = null, suppressClickUntil = 0;
  function finish(cancelled) {
    if (!drag) return;
    var previous = drag;
    drag = null;
    if (previous.moved || cancelled) suppressClickUntil = performance.now() + 700;
    if (canvas.hasPointerCapture && canvas.hasPointerCapture(previous.id)) canvas.releasePointerCapture(previous.id);
  }
  function stillActive() {
    if (!drag || shelfManager !== drag.manager || shelfManager.getMode() !== drag.mode) return false;
    if (document.body.classList.contains('splash-active')) return false;
    if (typeof shelfPlaybackSwitchGuardActive === 'function' && shelfPlaybackSwitchGuardActive()) return false;
    return drag.target === shelfManager ? !shelfManager.hasOpenContent() :
      shelfManager.hasOpenContent() && shelfManager.getContentList() === drag.target;
  }
  canvas.addEventListener('pointerdown', function (e) {
    if (e.isPrimary === false) { finish(true); return; }
    finish(true);
    suppressClickUntil = 0;
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
    if (e.button !== 0) return;
    var target = shelfScrollTarget(e);
    if (!target) return;
    mouseDownAt.hadDrag = false;
    drag = { id:e.pointerId, manager:shelfManager, target:target, mode:shelfManager.getMode(),
      x:e.clientX, y:e.clientY, lastX:e.clientX, lastY:e.clientY, pending:0, moved:false, axis:'y' };
    if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (!stillActive()) { finish(true); return; }
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved) {
      if (dx * dx + dy * dy < 64) return;
      drag.moved = true;
      if (drag.target === shelfManager && drag.mode === 'stage' && Math.abs(dx) > Math.abs(dy)) drag.axis = 'x';
    }
    mouseDownAt.hadDrag = true;
    e.preventDefault();
    e.stopImmediatePropagation();
    markRenderInteraction('shelf-touch', 900);
    drag.pending += drag.axis === 'x' ? drag.lastX - e.clientX : drag.lastY - e.clientY;
    drag.lastX = e.clientX; drag.lastY = e.clientY;
    var steps = Math.trunc(drag.pending / 48);
    if (steps) {
      drag.pending -= steps * 48;
      drag.target.scrollBy(steps);
    }
  }, { passive:false });
  canvas.addEventListener('pointerup', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    var cancelled = !stillActive();
    if (drag.moved || cancelled) { e.preventDefault(); e.stopImmediatePropagation(); }
    finish(cancelled);
  });
  ['pointercancel', 'lostpointercapture'].forEach(function (type) {
    canvas.addEventListener(type, function (e) { if (drag && e.pointerId === drag.id) finish(true); });
  });
  ['click', 'contextmenu'].forEach(function (type) {
    canvas.addEventListener(type, function (e) {
      if (performance.now() >= suppressClickUntil) return;
      e.preventDefault();e.stopImmediatePropagation();mouseDownAt.hadDrag = false;
    }, true);
  });
  window.addEventListener('blur', function () { finish(true); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) finish(true); });
}());

// 键盘 / 全局事件

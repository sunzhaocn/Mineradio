'use strict';

// ============================================================
function raycasterFromPointerEvent(e) {
  var mx = (e.clientX / innerWidth) * 2 - 1;
  var my = -(e.clientY / innerHeight) * 2 + 1;
  var rc = new THREE.Raycaster();
  rc.setFromCamera(new THREE.Vector2(mx, my), camera);
  return rc;
}

function pointerCardHit(rc, e, screenPad) {
  if (!shelfManager) return null;
  return shelfManager.raycastCards(rc) || (shelfManager.pickCardAtScreen && shelfManager.pickCardAtScreen(e.clientX, e.clientY, screenPad));
}

// 滚轮和触摸共用命中规则，手势从歌单外开始时仍留给原来的界面。
function shelfScrollTarget(e) {
  if (isPointerOverUi(e) || !shelfManager || shelfManager.getMode() === 'off') return null;
  if (document.body.classList.contains('splash-active')) return null;
  if (typeof shelfPlaybackSwitchGuardActive === 'function' && shelfPlaybackSwitchGuardActive()) return null;
  var rc = raycasterFromPointerEvent(e);
  if (shelfManager.hasOpenContent()) {
    var cl = shelfManager.getContentList();
    if (cl) {
      var rowHit = cl.raycastRows(rc);
      var panelHit = !rowHit && cl.raycastPanel ? cl.raycastPanel(rc) : null;
      var panelScreenHit = !rowHit && !panelHit && cl.screenContainsPanel ? cl.screenContainsPanel(e.clientX, e.clientY) : false;
      return rowHit || panelHit || panelScreenHit ? cl : null;
    }
  }
  var mode = shelfManager.getMode();
  var canScroll = shelfManager.canInteract && shelfManager.canInteract();
  if (!canScroll) return null;
  var preview = shelfAutoHiddenInputReady();
  var hit = pointerCardHit(rc, e, mode === 'side' && !shelfPinnedOpen && shelfAlwaysVisible() ? 18 : undefined);
  if (e.shiftKey && (mode !== 'side' || shelfPinnedOpen || preview || shelfAlwaysVisible())) return shelfManager;
  if (mode === 'side') {
    if (shelfPinnedOpen || (!shelfAlwaysVisible() && preview)) return isShelfWheelZone(e) || hit ? shelfManager : null;
    return shelfAlwaysVisible() && hit ? shelfManager : null;
  }
  return mode === 'stage' && hit ? shelfManager : null;
}

function isSideShelfFocusHit(e) {
  if (!e || !shelfManager || !shelfManager.getMode || shelfManager.getMode() !== 'side') return false;
  if (typeof shelfPlaybackSwitchGuardActive === 'function' && shelfPlaybackSwitchGuardActive()) return false;
  if (shelfPinnedOpen) return true;
  if (shelfAlwaysVisible()) return !!pointerCardHit(raycasterFromPointerEvent(e), e, 18);
  if (!shelfAutoHiddenInputReady()) return false;
  if (shelfVisibility > 0.34 && (isShelfClickZone(e) || isShelfPreviewUseZone(e))) return true;
  return !!(shelfPreviewIsVisible() && pointerCardHit(raycasterFromPointerEvent(e), e, 24));
}

function updateShelfCardHoverSelection(e) {
  if (!shelfManager || !shelfManager.clearSelected || !shelfManager.setSelected) return;
  if (typeof shelfPlaybackSwitchGuardActive === 'function' && shelfPlaybackSwitchGuardActive()) {
    shelfManager.clearSelected();
    return;
  }
  if (!e || document.body.classList.contains('splash-active') || isPointerOverUi(e)) {
    shelfManager.clearSelected();
    return;
  }
  var mode = shelfManager.getMode && shelfManager.getMode();
  if (!mode || mode === 'off') {
    shelfManager.clearSelected();
    return;
  }
  if (shelfManager.hasOpenContent && shelfManager.hasOpenContent()) {
    shelfManager.clearSelected();
    return;
  }
  var canInteract = shelfManager.canInteract && shelfManager.canInteract();
  if (!canInteract) {
    shelfManager.clearSelected();
    return;
  }
  if (mode === 'side') {
    if (!shelfPinnedOpen && shelfAlwaysVisible()) {
      var alwaysHit = pointerCardHit(raycasterFromPointerEvent(e), e, 18);
      if (alwaysHit && alwaysHit.card) shelfManager.setSelected(alwaysHit.card.index);
      else shelfManager.clearSelected();
      return;
    }
    var sideUsable = shelfPinnedOpen || shelfAutoHiddenInputReady();
    if (!sideUsable) {
      shelfManager.clearSelected();
      return;
    }
  } else if (mode !== 'stage') {
    shelfManager.clearSelected();
    return;
  }
  var hit = pointerCardHit(raycasterFromPointerEvent(e), e);
  if (hit && hit.card) shelfManager.setSelected(hit.card.index);
  else shelfManager.clearSelected();
}

function isShelfPlaylistPlayHit(hit) {
  if (!hit || !hit.card || !hit.uv || !hit.card.item || hit.card.item.type !== 'playlist') return false;
  return hit.uv.x >= 0.49 && hit.uv.x <= 0.72 && hit.uv.y >= 0.13 && hit.uv.y <= 0.42;
}

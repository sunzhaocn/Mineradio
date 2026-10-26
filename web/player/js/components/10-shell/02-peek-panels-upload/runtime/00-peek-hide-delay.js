'use strict';

// ============================================================
var PEEK_HIDE_DELAY = 170;

var PLAYLIST_PANEL_HIDE_DELAY = 72;

var peekTimers = { search: null, fx: null, pl: null };

var searchPeekRevealToken = 0;

var searchPeekRevealPending = false;

var PLAYLIST_PANEL_MOTION_MS = 360;

var PLAYLIST_PANEL_OPEN_ANIM_COOLDOWN = 520;

var PLAYLIST_PANEL_OPEN_DURATION_RANGE = { min: 0.08, max: 0.72, fallback: 0.28 };

var PLAYLIST_PANEL_CLOSE_DURATION_RANGE = { min: 0.06, max: 0.48, fallback: 0.18 };

var secondaryPlaylistEdgeGuard = { enteredAt: 0, timer: null, x: 0, y: 0, H: 0 };

var SECONDARY_PLAYLIST_EDGE_MIN_X = 14;

var SECONDARY_PLAYLIST_EDGE_MAX_X = 112;

var SECONDARY_PLAYLIST_EDGE_DWELL_MS = 220;

var SECONDARY_PLAYLIST_SEAM_CLOSE_X = 6;

var PLAYLIST_PANEL_EDGE_TRIGGER_X = 104;

var PLAYLIST_PANEL_FULLSCREEN_EDGE_TRIGGER_X = 128;

var PLAYLIST_PANEL_HOME_EDGE_TRIGGER_X = 16;

var PLAYLIST_PANEL_FULLSCREEN_FOCUS_HOLD_X = 14;

var PLAYLIST_PANEL_FULLSCREEN_EDGE_LEAVE_TOLERANCE_X = -8;

var PLAYLIST_PANEL_BOTTOM_LEFT_BLOCK_X = 176;

document.addEventListener('mouseleave', function (e) {
  if (shouldHidePlaylistPanelOnWindowLeave(e)) closePlaylistPanelSoft('window-leave');
}, true);

window.addEventListener('blur', function () {
  if (playlistPanelPinned) return;
  setTimeout(function () { closePlaylistPanelSoft('window-blur'); }, 60);
});

var peekPointerFrame = 0, peekPointerEvent = null;
window.addEventListener('mousemove', function (e) {
  peekPointerEvent = e;
  if (!peekPointerFrame) peekPointerFrame = requestAnimationFrame(function () {
    peekPointerFrame = 0;
    var latest = peekPointerEvent; peekPointerEvent = null;
    if (latest) updatePeekPanelsFromPointer(latest);
  });
}, { passive: true });
function cancelPeekPointerFrame() {
  if (peekPointerFrame) cancelAnimationFrame(peekPointerFrame);
  peekPointerFrame = 0; peekPointerEvent = null;
}
window.addEventListener('blur', cancelPeekPointerFrame);
document.addEventListener('mouseleave', cancelPeekPointerFrame, true);

function updateFxHoverFromPointer(fp, ex, ey, W, H) {
  // 控制台: 右下角触发；一旦面板出现，就按真实面板矩形保留显示
  var fpOn = fp.classList.contains('peek') || fp.classList.contains('show');
  var fpRect = fp.getBoundingClientRect();
  var fab = document.getElementById('fx-fab');
  var fabRect = fab ? fab.getBoundingClientRect() : { left: W, right: W, top: H, bottom: H };
  var inFxPanel = fpOn && ex >= fpRect.left - 24 && ex <= fpRect.right + 24 && ey >= fpRect.top - 24 && ey <= fpRect.bottom + 24;
  var inFxFab = ex >= fabRect.left - 18 && ex <= fabRect.right + 18 && ey >= fabRect.top - 18 && ey <= fabRect.bottom + 18;
  var inFxBridge = fpOn && ex >= Math.min(fpRect.left, fabRect.left) - 18 && ex <= W
    && ey >= Math.min(fpRect.bottom, fabRect.bottom) - 18 && ey <= Math.max(fpRect.top, fabRect.top) + 18;
  if (!diyPlayerMode) inFxPanel = inFxFab = inFxBridge = false;
  if (window.mineradioHoverPanels || !window.mineradioPlayerControls) {
    if (inFxFab || inFxPanel || inFxBridge) setPeek(fp, true, 'fx');
    else if (fpOn) setPeek(fp, false, 'fx');
  }
}

function updatePeekPanelsFromPointer(e) {
  var sa = document.getElementById('search-area');
  var fp = document.getElementById('fx-panel');
  var pp = document.getElementById('playlist-panel');
  var ex = e.clientX, ey = e.clientY, W = innerWidth, H = innerHeight;
  // Touch browsers emit compatibility mouse moves after taps. Edge-hover panels
  // would otherwise cover the content the user just touched on a narrow screen.
  if (window.mineradioRemoteApp || window.mineradioTabletApp || e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents || document.body.classList.contains('web-adapter') && W <= 900 && !window.mineradioHoverPanels) return;
  updateUserCapsuleAutoHideFromPointer(ex, ey);
  updateFxFabAutoHideFromPointer(ex, ey);
  updateFullscreenDiyPeekFromPointer(ex, ey);
  if (document.body.classList.contains('splash-active')) {
    updateShelfHoverCueFromPointer(null);
    updateShelfCardHoverSelection(null);
    setFocusZone(null);
    return;
  }
  updateFxHoverFromPointer(fp, ex, ey, W, H);
  if (immersiveMode) {
    updateShelfHoverCueFromPointer(e);
    updateShelfCardHoverSelection(e);
    updateControlsAutoHideFromPointer(ex, ey);
    var ppOnImm = isPlaylistPanelActiveState(pp);
    var ppRectImm = pp.getBoundingClientRect();
    var inQueueTriggerImm = isPlaylistEdgeTrigger(ex, ey, H, e.target);
    var inQueuePanelImm = isPlaylistPanelPanelHit(pp, ppRectImm, ex, ey);
    var inQueueBridgeImm = isPlaylistPanelBridgeHit(pp, ppRectImm, ex, ey, H);
    if (inQueueTriggerImm || inQueuePanelImm || inQueueBridgeImm) setPeek(pp, true, 'pl');
    else if (shouldClosePlaylistPanelFromPointer(ppOnImm, ex, ppRectImm, ey, H)) setPeek(pp, false, 'pl');
    var shelfCanFocusImm = !!(shelfManager && shelfManager.canInteract && shelfManager.canInteract());
    var newFocusImm = null;
    var queueFocusImm = isPlaylistPanelFocusActive(inQueueTriggerImm, inQueuePanelImm || inQueueBridgeImm, pp, ex, ppRectImm, ey, H);
    var shelfHoverFocusImm = !!(shelfCanFocusImm && isSideShelfFocusHit(e));
    if (queueFocusImm) newFocusImm = 'queue';
    else if (shelfManager && shelfManager.hasOpenContent && shelfManager.hasOpenContent()) newFocusImm = 'shelf-detail';
    else if (shelfHoverFocusImm) newFocusImm = 'shelf-side';
    else if (shelfCanFocusImm && shelfManager.getMode() === 'stage' && ey > H * 0.55) newFocusImm = 'shelf-stage';
    setFocusZone(newFocusImm, newFocusImm === 'queue');
    return;
  }
  updateShelfHoverCueFromPointer(e);
  updateShelfCardHoverSelection(e);
  // 搜索 (上): 顶部 48px 内进入; 已显示时鼠标在 280px 内保留
  var saOn = sa.classList.contains('peek');
  var saRect = sa.getBoundingClientRect();
  var searchFocused = document.activeElement === $input;
  var uploadTip = document.getElementById('upload-tip');
  var uploadTipOpen = !!(uploadTip && uploadTip.classList.contains('show'));
  var uploadImportOpen = typeof isUploadImportActive === 'function' && isUploadImportActive();
  var inSearchPanel = saOn && ex >= saRect.left - 24 && ex <= saRect.right + 24 && ey >= saRect.top - 22 && ey <= saRect.bottom + 42;
  if (ey < 66 || inSearchPanel || searchFocused || uploadTipOpen || uploadImportOpen) setPeek(sa, true, 'search');
  else if ((saOn || isSearchPeekRevealPending()) && !emptyHomeActive) setPeek(sa, false, 'search');
  // 歌单/队列 DOM 面板只在左侧明确停留时出现，避免和右侧 3D 架抢焦点
  var ppOn = isPlaylistPanelActiveState(pp);
  var ppRect = pp.getBoundingClientRect();
  var inQueueTrigger = isPlaylistEdgeTrigger(ex, ey, H, e.target);
  var inQueuePanel = isPlaylistPanelPanelHit(pp, ppRect, ex, ey);
  var inQueueBridge = isPlaylistPanelBridgeHit(pp, ppRect, ex, ey, H);
  if (inQueueTrigger || inQueuePanel || inQueueBridge) setPeek(pp, true, 'pl');
  else if (shouldClosePlaylistPanelFromPointer(ppOn, ex, ppRect, ey, H)) setPeek(pp, false, 'pl');

  // v8: 镜头跟拍触发判断
  //   - 队列面板 peek 时 → queue focus
  //   - 3D shelf side 模式只在点击展开后 → shelf-side
  //   - 3D shelf stage 模式 + 鼠标在下 35% → shelf-stage
  var shelfCanFocus = !!(shelfManager && shelfManager.canInteract && shelfManager.canInteract());
  if (!shelfCanFocus && !(shelfManager && shelfManager.hasOpenContent && shelfManager.hasOpenContent())) {
    shelfPinnedOpen = false;
    if (fx) fx.shelfPinnedOpen = false;
  }

  var newFocus = null;
  var queueFocusActive = isPlaylistPanelFocusActive(inQueueTrigger, inQueuePanel || inQueueBridge, pp, ex, ppRect, ey, H);
  var shelfHoverFocus = !!(shelfCanFocus && isSideShelfFocusHit(e));
  if (queueFocusActive) {
    newFocus = 'queue';
  } else if (shelfManager && shelfManager.hasOpenContent && shelfManager.hasOpenContent()) {
    newFocus = 'shelf-detail';
  } else if (shelfHoverFocus) {
    newFocus = 'shelf-side';
  } else if (shelfCanFocus && shelfManager.getMode() === 'stage' && ey > H * 0.55) {
    newFocus = 'shelf-stage';
  }
  setFocusZone(newFocus, newFocus === 'queue');
}

// ============================================================
//  启动页 (splash) 控制

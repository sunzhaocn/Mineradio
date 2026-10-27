'use strict';


function playlistPanelMotionRange(type) {
  return type === 'close' ? PLAYLIST_PANEL_CLOSE_DURATION_RANGE : PLAYLIST_PANEL_OPEN_DURATION_RANGE;
}

function playlistPanelMotionMs(type) {
  var key = type === 'close' ? 'playlistPanelCloseDuration' : 'playlistPanelOpenDuration';
  var range = playlistPanelMotionRange(type);
  var value = (typeof fx !== 'undefined' && fx && isFinite(fx[key])) ? Number(fx[key]) : range.fallback;
  return Math.round(clampRange(value, range.min, range.max) * 1000);
}

function playlistPeekHideDelay(key) {
  return key === 'pl' ? PLAYLIST_PANEL_HIDE_DELAY : PEEK_HIDE_DELAY;
}

function markPlaylistPanelMotion(panel, duration) {
  if (!panel) return;
  panel.__playlistMotionUntil = performance.now() + (duration == null ? PLAYLIST_PANEL_MOTION_MS : duration);
  if (typeof markRenderInteraction === 'function') markRenderInteraction('playlist-panel', (duration || PLAYLIST_PANEL_MOTION_MS) + 100);
}

function isPlaylistPanelInMotion(panel) {
  return !!(panel && panel.__playlistMotionUntil && performance.now() < panel.__playlistMotionUntil);
}

function isPlaylistPanelOpeningMotion(panel) {
  return !!(isPlaylistPanelInMotion(panel) && !panel.classList.contains('playlist-panel-closing'));
}

function isSearchGlassReadyForReveal() {
  var root = document.documentElement;
  return !root.classList.contains('control-glass-svg-ok') ||
    root.classList.contains('search-glass-ready') ||
    root.classList.contains('search-glass-fallback');
}

function cancelPendingSearchPeekReveal() {
  searchPeekRevealToken += 1;
  searchPeekRevealPending = false;
}

function isSearchPeekRevealPending() {
  return searchPeekRevealPending;
}

function scheduleSearchPeekAfterGlassReady(el) {
  if (!el) return;
  var token = searchPeekRevealToken + 1;
  searchPeekRevealToken = token;
  searchPeekRevealPending = true;
  var startedAt = performance.now();
  function waitForGlass() {
    if (token !== searchPeekRevealToken) return;
    if (isSearchGlassReadyForReveal() || performance.now() - startedAt > 140) {
      searchPeekRevealPending = false;
      if (immersiveMode) return;
      el.classList.add('peek');
      return;
    }
    requestAnimationFrame(waitForGlass);
  }
  requestAnimationFrame(waitForGlass);
}

function shouldAnimatePlaylistPanelOpen(panel) {
  if (!panel) return false;
  var now = performance.now();
  if (panel.__lastOpenListAnimAt && now - panel.__lastOpenListAnimAt < PLAYLIST_PANEL_OPEN_ANIM_COOLDOWN) return false;
  panel.__lastOpenListAnimAt = now;
  return true;
}

function setPeek(el, on, key) {
  if (!el) return;
  if (key === 'pl' && on && el.__dismissedUntil > performance.now()) return;
  if (key === 'fx' && !on && fxPanelPinned) return;
  if (immersiveMode && on && (key === 'search' || key === 'fx' && !window.mineradioHoverPanels)) return;
  if (on && !diyPlayerMode && key === 'fx') return;
  if (!on && key === 'search' && emptyHomeActive && !immersiveMode) return;
  if (!on && key === 'pl' && playlistPanelPinned) return;
  if (on && key === 'fx') document.body.classList.remove('fullscreen-diy-peek');
  if (on) {
    if (key === 'pl') resetSecondaryPlaylistEdgeGuard();
    var wasPeek = el.classList.contains('peek');
    if (peekTimers[key]) { clearTimeout(peekTimers[key]); peekTimers[key] = null; }
    if (key === 'fx') el.classList.remove('closing');
    if (key === 'pl') el.classList.remove('playlist-panel-closing');
    if (key === 'search' && typeof prepareSearchGlassBeforePeek === 'function' && !wasPeek) {
      var searchGlassReady = prepareSearchGlassBeforePeek();
      if (!searchGlassReady) {
        scheduleSearchPeekAfterGlassReady(el);
        return;
      }
    }
    var runPlaylistOpenAnimation = key === 'pl' && !wasPeek ? shouldAnimatePlaylistPanelOpen(el) : false;
    if (key === 'pl' && !wasPeek) preparePlaylistPanelTabOnOpen(el);
    el.classList.add('peek');
    if (key === 'pl' && !wasPeek) markPlaylistPanelMotion(el, playlistPanelMotionMs('open'));
    if (key === 'pl' && !wasPeek) {
      scheduleUiWarmTask(function () {
        flushDeferredQueuePanel('playlist-panel-peek');
        if (runPlaylistOpenAnimation) animatePlaylistPanelCurrentTab(el, { scrollActive: false });
      }, playlistPanelMotionMs('open') + 32);
    }
    if (key === 'fx') {
      var fabOn = document.getElementById('fx-fab');
      if (fabOn) fabOn.classList.add('active');
    }
  } else {
    if (key === 'search') cancelPendingSearchPeekReveal();
    if (key === 'pl') resetSecondaryPlaylistEdgeGuard();
    if (peekTimers[key]) clearTimeout(peekTimers[key]);
    peekTimers[key] = setTimeout(function () {
      if (key === 'pl') el.classList.add('playlist-panel-closing');
      el.classList.remove('peek');
      if (key === 'pl' && window.mineradioHoverPanels) el.classList.remove('show');
      if (key === 'pl') markPlaylistPanelMotion(el, playlistPanelMotionMs('close'));
      if (key === 'pl') setTimeout(function () { el.classList.remove('playlist-panel-closing'); }, playlistPanelMotionMs('close') + 80);
      if (key === 'fx') {
        var fabOff = document.getElementById('fx-fab');
        if (fabOff && !el.classList.contains('show')) fabOff.classList.remove('active');
      }
      peekTimers[key] = null;
    }, playlistPeekHideDelay(key));
  }
}

function uploadTipWasSeen() {
  try { return localStorage.getItem(UPLOAD_TIP_STORE_KEY) === '1'; } catch (e) { return true; }
}

function markUploadTipSeen() {
  try { localStorage.setItem(UPLOAD_TIP_STORE_KEY, '1'); } catch (e) { }
}

function closeUploadTip(manual) {
  var tip = document.getElementById('upload-tip');
  if (uploadTipTimer) { clearTimeout(uploadTipTimer); uploadTipTimer = null; }
  if (manual) markUploadTipSeen();
  if (!tip || !tip.classList.contains('show')) return;
  if (window.gsap) {
    window.gsap.killTweensOf(tip);
    window.gsap.to(tip, {
      autoAlpha: 0,
      y: -8,
      scale: 0.98,
      duration: 0.24,
      ease: 'power2.in',
      overwrite: true,
      onComplete: function () {
        tip.classList.remove('show');
        window.gsap.set(tip, { clearProps: 'opacity,visibility,transform,filter' });
      }
    });
  } else {
    tip.classList.remove('show');
  }
}

function maybeShowUploadTipOnce() {
  if (!diyPlayerMode) return;
  if (uploadTipWasSeen()) return;
  if (immersiveMode) {
    setTimeout(maybeShowUploadTipOnce, 1800);
    return;
  }
  if (document.body.classList.contains('splash-active') || loginGuideAnimating) {
    setTimeout(maybeShowUploadTipOnce, 900);
    return;
  }
  var loginModal = document.getElementById('login-modal');
  var userModal = document.getElementById('user-modal');
  var coverModal = document.getElementById('cover-crop-modal');
  var hasModal = (loginModal && loginModal.classList.contains('show')) ||
    (userModal && userModal.classList.contains('show')) ||
    (coverModal && coverModal.classList.contains('show'));
  if (hasModal) {
    uploadTipAttempts++;
    if (uploadTipAttempts < 18) setTimeout(maybeShowUploadTipOnce, 1800);
    return;
  }
  var area = document.getElementById('search-area');
  var tip = document.getElementById('upload-tip');
  if (!area || !tip) return;
  markUploadTipSeen();
  setPeek(area, true, 'search');
  tip.classList.add('show');
  if (window.gsap) {
    window.gsap.killTweensOf(tip);
    window.gsap.fromTo(tip,
      { autoAlpha: 0, y: -10, scale: 0.975 },
      { autoAlpha: 1, y: 0, scale: 1, duration: 0.62, ease: 'expo.out', overwrite: true }
    );
    var uploadBtn = document.getElementById('upload-btn');
    if (uploadBtn) {
      window.gsap.fromTo(uploadBtn,
        { scale: 1, boxShadow: '0 10px 32px rgba(0,0,0,.22)' },
        { scale: 1.07, boxShadow: '0 0 0 8px rgba(244,210,138,0),0 16px 46px rgba(244,210,138,.14)', duration: 0.58, ease: 'sine.inOut', yoyo: true, repeat: 3, overwrite: true }
      );
    }
  }
  uploadTipTimer = setTimeout(function () {
    uploadTipTimer = null;
    closeUploadTip(false);
    setPeek(area, false, 'search');
  }, 6800);
}

function isPlaylistFullscreenEdgeMode() {
  return !!((typeof desktopRuntimeState !== 'undefined' && desktopRuntimeState && desktopRuntimeState.fullscreen) ||
    (typeof desktopFullscreenActive !== 'undefined' && desktopFullscreenActive) ||
    document.fullscreenElement ||
    document.body.classList.contains('desktop-fullscreen'));
}

function isSecondaryLeftDisplaySeamGuardActive() {
  var state = (typeof desktopWindowState !== 'undefined' && desktopWindowState) ? desktopWindowState : {};
  return !!(!isPlaylistFullscreenEdgeMode() && window.desktopWindow && window.desktopWindow.isDesktop && state.isPrimaryDisplay === false && state.hasDisplayOnLeft);
}

function resetSecondaryPlaylistEdgeGuard() {
  if (secondaryPlaylistEdgeGuard.timer) {
    clearTimeout(secondaryPlaylistEdgeGuard.timer);
    secondaryPlaylistEdgeGuard.timer = null;
  }
  secondaryPlaylistEdgeGuard.enteredAt = 0;
}

function playlistPanelEdgeTopGutter(H) {
  return Math.max(82, Math.min(132, Math.round(H * (isPlaylistFullscreenEdgeMode() ? 0.10 : 0.14))));
}

function playlistPanelEdgeBottomGutter(H) {
  return Math.max(104, Math.min(150, Math.round(H * (isPlaylistFullscreenEdgeMode() ? 0.13 : 0.16))));
}

function isPlaylistPanelBottomControlsConflict(ex, ey, H) {
  var nearBottomLeft = ey >= H - 112 && ex < PLAYLIST_PANEL_BOTTOM_LEFT_BLOCK_X;
  var handle = document.getElementById('bottom-handle');
  var bar = document.getElementById('bottom-bar');
  var handleRect = handle ? handle.getBoundingClientRect() : null;
  var barRect = bar ? bar.getBoundingClientRect() : null;
  var overHandle = !!(handleRect && ex >= handleRect.left - 28 && ex <= handleRect.right + 28 && ey >= handleRect.top - 18 && ey <= handleRect.bottom + 22);
  var barActive = !!((bar && bar.classList.contains('visible') && !bar.classList.contains('soft-hidden')) || document.body.classList.contains('controls-visible'));
  var overBarLeft = !!(barActive && barRect && ex >= barRect.left - 22 && ex <= Math.min(barRect.left + 300, barRect.right + 22) && ey >= barRect.top - 28 && ey <= barRect.bottom + 22);
  return nearBottomLeft || overHandle || overBarLeft;
}

function isSecondaryPlaylistSafeBandPoint(ex, ey, H) {
  return ey > playlistPanelEdgeTopGutter(H) && ey < H - playlistPanelEdgeBottomGutter(H) &&
    ex >= SECONDARY_PLAYLIST_EDGE_MIN_X && ex < SECONDARY_PLAYLIST_EDGE_MAX_X &&
    !isPlaylistPanelBottomControlsConflict(ex, ey, H);
}

function armSecondaryPlaylistEdgeDwell() {
  if (secondaryPlaylistEdgeGuard.timer) return;
  secondaryPlaylistEdgeGuard.timer = setTimeout(function () {
    secondaryPlaylistEdgeGuard.timer = null;
    if (!isSecondaryLeftDisplaySeamGuardActive()) return;
    if (!isSecondaryPlaylistSafeBandPoint(secondaryPlaylistEdgeGuard.x, secondaryPlaylistEdgeGuard.y, secondaryPlaylistEdgeGuard.H)) return;
    var panel = document.getElementById('playlist-panel');
    if (panel) setPeek(panel, true, 'pl');
  }, SECONDARY_PLAYLIST_EDGE_DWELL_MS);
}

function playlistPanelInitialEdgeTriggerX(defaultWidth, eventTarget) {
  if (!emptyHomeActive || !eventTarget || !eventTarget.closest || !eventTarget.closest('#empty-home')) return defaultWidth;
  var panel = document.getElementById('playlist-panel');
  if (isPlaylistPanelActiveState(panel)) return defaultWidth;
  return Math.min(defaultWidth, PLAYLIST_PANEL_HOME_EDGE_TRIGGER_X);
}

function isPlaylistEdgeTrigger(ex, ey, H, eventTarget) {
  var inVerticalBand = ey > playlistPanelEdgeTopGutter(H) && ey < H - playlistPanelEdgeBottomGutter(H);
  if (!inVerticalBand) {
    resetSecondaryPlaylistEdgeGuard();
    return false;
  }
  if (isPlaylistPanelBottomControlsConflict(ex, ey, H)) {
    resetSecondaryPlaylistEdgeGuard();
    return false;
  }
  if (isPlaylistFullscreenEdgeMode()) {
    resetSecondaryPlaylistEdgeGuard();
    return ex >= 0 && ex < playlistPanelInitialEdgeTriggerX(PLAYLIST_PANEL_FULLSCREEN_EDGE_TRIGGER_X, eventTarget);
  }
  if (!isSecondaryLeftDisplaySeamGuardActive()) {
    resetSecondaryPlaylistEdgeGuard();
    return ex >= 0 && ex < playlistPanelInitialEdgeTriggerX(PLAYLIST_PANEL_EDGE_TRIGGER_X, eventTarget);
  }
  if (ex < SECONDARY_PLAYLIST_SEAM_CLOSE_X) {
    resetSecondaryPlaylistEdgeGuard();
    return false;
  }
  var inSafeBand = isSecondaryPlaylistSafeBandPoint(ex, ey, H);
  if (!inSafeBand) {
    resetSecondaryPlaylistEdgeGuard();
    return false;
  }
  secondaryPlaylistEdgeGuard.x = ex;
  secondaryPlaylistEdgeGuard.y = ey;
  secondaryPlaylistEdgeGuard.H = H;
  var now = performance.now();
  if (!secondaryPlaylistEdgeGuard.enteredAt) secondaryPlaylistEdgeGuard.enteredAt = now;
  armSecondaryPlaylistEdgeDwell();
  return now - secondaryPlaylistEdgeGuard.enteredAt >= SECONDARY_PLAYLIST_EDGE_DWELL_MS;
}

function playlistPanelExitPadding() {
  return isSecondaryLeftDisplaySeamGuardActive() ? 28 : 46;
}

function playlistPanelFocusPadding() {
  return isSecondaryLeftDisplaySeamGuardActive() ? 30 : 42;
}

function isPlaylistPanelActiveState(panel) {
  return !!(panel && (panel.classList.contains('peek') || panel.classList.contains('show') || isPlaylistPanelOpeningMotion(panel)));
}

function isPlaylistFullscreenEdgeFocusHold(panel, ex, ey, H) {
  if (!isPlaylistFullscreenEdgeMode() || !isPlaylistPanelActiveState(panel)) return false;
  if (isPlaylistPanelBottomControlsConflict(ex, ey, H)) return false;
  return ex >= PLAYLIST_PANEL_FULLSCREEN_EDGE_LEAVE_TOLERANCE_X && ex <= PLAYLIST_PANEL_FULLSCREEN_FOCUS_HOLD_X &&
    ey > playlistPanelEdgeTopGutter(H) && ey < H - playlistPanelEdgeBottomGutter(H);
}

function isFullscreenPlaylistQueueFocusLockedAtEdge(e) {
  var panel = document.getElementById('playlist-panel');
  if (!panel || !isPlaylistPanelActiveState(panel)) return false;
  var ex = e && isFinite(e.clientX) ? e.clientX : 0;
  var ey = e && isFinite(e.clientY) ? e.clientY : (shelfHoverCue && isFinite(shelfHoverCue.y) ? shelfHoverCue.y : innerHeight * 0.5);
  return isPlaylistFullscreenEdgeFocusHold(panel, ex, ey, innerHeight);
}

function playlistPanelTargetRect(panel, currentRect) {
  currentRect = currentRect || { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  if (!panel) return currentRect;
  var width = panel.offsetWidth || currentRect.width || Math.max(0, currentRect.right - currentRect.left);
  var height = panel.offsetHeight || currentRect.height || Math.max(0, currentRect.bottom - currentRect.top);
  var left = isFinite(panel.offsetLeft) ? panel.offsetLeft : currentRect.left;
  var top = isFinite(panel.offsetTop) ? panel.offsetTop : currentRect.top;
  return { left: left, top: top, right: left + width, bottom: top + height, width: width, height: height };
}

function isPlaylistPanelPanelHit(panel, ppRect, ex, ey) {
  if (!isPlaylistPanelActiveState(panel)) return false;
  var targetRect = playlistPanelTargetRect(panel, ppRect);
  return ex >= targetRect.left - 26 && ex <= targetRect.right + 28 && ey >= targetRect.top - 30 && ey <= targetRect.bottom + 30;
}

function isPlaylistPanelBridgeHit(panel, ppRect, ex, ey, H) {
  if (!isPlaylistPanelActiveState(panel)) return false;
  if (isSecondaryLeftDisplaySeamGuardActive() && ex < SECONDARY_PLAYLIST_SEAM_CLOSE_X) return false;
  var targetRect = playlistPanelTargetRect(panel, ppRect);
  var top = Math.max(0, targetRect.top - 34);
  var bottom = Math.min(H, targetRect.bottom + 34);
  if (ey < top || ey > bottom) return false;
  return ex >= 0 && ex <= targetRect.right + playlistPanelFocusPadding();
}

function shouldClosePlaylistPanelFromPointer(ppOn, ex, ppRect, ey, H) {
  if (!ppOn) return false;
  var panel = document.getElementById('playlist-panel');
  var targetRect = playlistPanelTargetRect(panel, ppRect);
  if (isPlaylistPanelBottomControlsConflict(ex, ey, H)) return true;
  if (isPlaylistPanelOpeningMotion(panel) && ex < targetRect.right + playlistPanelFocusPadding()) return false;
  if (isSecondaryLeftDisplaySeamGuardActive() && ex < SECONDARY_PLAYLIST_SEAM_CLOSE_X) return true;
  return ex > targetRect.right + playlistPanelExitPadding();
}

function isPlaylistPanelFocusActive(inTrigger, inPanel, pp, ex, ppRect, ey, H) {
  if (isSecondaryLeftDisplaySeamGuardActive() && ex < SECONDARY_PLAYLIST_SEAM_CLOSE_X) return false;
  return inTrigger || inPanel || isPlaylistFullscreenEdgeFocusHold(pp, ex, ey, H);
}

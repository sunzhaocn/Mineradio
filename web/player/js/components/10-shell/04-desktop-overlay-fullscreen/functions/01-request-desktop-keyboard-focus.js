'use strict';



function requestDesktopKeyboardFocus(reason) {
  var api = getDesktopWindowApi();
  var mode = desktopIconShieldModeState();
  if (!api || typeof api.requestDesktopKeyboardFocus !== 'function'
    || !mode.active
    || desktopWallpaperRuntimeState.softwareInteractionLocked === true) return false;
  try {
    Promise.resolve(api.requestDesktopKeyboardFocus(reason || 'renderer-pointerdown')).catch(function () {});
    return true;
  } catch (_) {
    return false;
  }
}


function setDesktopSoftwareInteractionLocked(desired, event) {
  var restoreKeyboardFocus = desired !== true && !!(event && event.isTrusted);
  consumeDesktopModeControlEvent(event);
  var api = getDesktopWindowApi();
  var mode = desktopIconShieldModeState();
  if (!api || typeof api.setDesktopSoftwareLocked !== 'function' || !mode.active) {
    if (typeof showToast === 'function') showToast('当前软件操作锁定不可用');
    return Promise.resolve({ ok: false, error: 'DESKTOP_SOFTWARE_LOCK_INACTIVE' });
  }
  if (desktopSoftwareLockPending) return Promise.resolve({ ok: false, error: 'DESKTOP_SOFTWARE_LOCK_BUSY' });
  desired = desired === true;
  var operation = ++desktopSoftwareLockOperation;
  desktopSoftwareLockPending = true;
  updateDesktopModeControl(desktopWallpaperRuntimeState);
  return Promise.resolve(api.setDesktopSoftwareLocked(desired)).then(function (result) {
    if (operation !== desktopSoftwareLockOperation) return result;
    result = result && typeof result === 'object' ? result : { ok: false, error: 'DESKTOP_SOFTWARE_LOCK_RESULT_INVALID' };
    if (result.status) {
      applyDesktopWallpaperRuntimeStatus(result.status);
    } else if (result.ok === true) {
      desktopWallpaperRuntimeState.softwareInteractionLocked = desired;
      updateDesktopModeControl(desktopWallpaperRuntimeState);
    }
    if (typeof showToast === 'function') {
      showToast(result.ok === true
        ? (desired ? '软件操作已锁定；移到右上角可随时解锁' : '软件操作已恢复')
        : (desired ? '软件操作锁定失败' : '软件操作解锁失败'));
    }
    if (result.ok === true && restoreKeyboardFocus) {
      requestDesktopKeyboardFocus('software-unlocked');
    }
    return result;
  }).catch(function (error) {
    if (operation !== desktopSoftwareLockOperation) return { ok: false, error: String(error && error.message || error) };
    if (typeof showToast === 'function') showToast(desired ? '软件操作锁定失败' : '软件操作解锁失败');
    return { ok: false, error: String(error && error.message || error) };
  }).then(function (result) {
    if (operation === desktopSoftwareLockOperation) {
      desktopSoftwareLockPending = false;
      updateDesktopModeControl(desktopWallpaperRuntimeState);
      scheduleDesktopPointerRouteReport(null, true);
    }
    return result;
  });
}


function toggleDesktopSoftwareInteractionLocked(event) {
  return setDesktopSoftwareInteractionLocked(!(desktopWallpaperRuntimeState
    && desktopWallpaperRuntimeState.softwareInteractionLocked === true), event);
}


function cancelDesktopModeControlHide() {
  if (!desktopModeControlDockState.hideTimer) return;
  clearTimeout(desktopModeControlDockState.hideTimer);
  desktopModeControlDockState.hideTimer = 0;
}


function cancelDesktopModeControlPeekHide() {
  if (!desktopModeControlDockState.peekTimer) return;
  clearTimeout(desktopModeControlDockState.peekTimer);
  desktopModeControlDockState.peekTimer = 0;
}


function setDesktopModeControlPeek(peek) {
  peek = peek === true && desktopIconShieldModeState().active;
  if (peek) cancelDesktopModeControlPeekHide();
  if (desktopModeControlDockState.peek === peek) return;
  desktopModeControlDockState.peek = peek;
  if (document.body) document.body.classList.toggle('desktop-mode-control-peek', peek);
  scheduleDesktopIconShieldReport(false);
}


function scheduleDesktopModeControlPeekHide(delay) {
  cancelDesktopModeControlPeekHide();
  desktopModeControlDockState.peekTimer = setTimeout(function () {
    desktopModeControlDockState.peekTimer = 0;
    var dock = document.getElementById('desktop-mode-control-dock');
    if (desktopModeControlDockState.open
      || (dock && (dock.matches(':hover') || dock.contains(document.activeElement)))) return;
    setDesktopModeControlPeek(false);
  }, Math.max(180, Number(delay) || 980));
}


function setDesktopModeControlsOpen(open) {
  open = open === true && desktopIconShieldModeState().active;
  cancelDesktopModeControlHide();
  if (open) setDesktopModeControlPeek(true);
  if (desktopModeControlDockState.open === open) return;
  desktopModeControlDockState.open = open;
  var dock = document.getElementById('desktop-mode-control-dock');
  var handle = document.getElementById('desktop-mode-control-handle');
  var panel = document.getElementById('desktop-mode-control-panel');
  if (dock) dock.classList.toggle('is-open', open);
  if (handle) handle.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (panel) {
    panel.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open) panel.removeAttribute('inert');
    else panel.setAttribute('inert', '');
    panel.querySelectorAll('button').forEach(function (button) {
      button.tabIndex = open ? 0 : -1;
    });
  }
  document.body.classList.toggle('desktop-mode-controls-open', open);
  if (!open) scheduleDesktopModeControlPeekHide(900);
  scheduleDesktopIconShieldReport(false);
  scheduleDesktopPointerRouteReport(null, true);
}


function scheduleDesktopModeControlHide(delay) {
  cancelDesktopModeControlHide();
  desktopModeControlDockState.hideTimer = setTimeout(function () {
    desktopModeControlDockState.hideTimer = 0;
    var dock = document.getElementById('desktop-mode-control-dock');
    if (dock && (dock.matches(':hover') || dock.contains(document.activeElement))) return;
    setDesktopModeControlsOpen(false);
  }, Math.max(120, Number(delay) || 680));
}


function desktopPointInClientRect(x, y, rect) {
  return !!rect && x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
}


function desktopControlPointState(x, y) {
  var handle = document.getElementById('desktop-mode-control-handle');
  var panel = document.getElementById('desktop-mode-control-panel');
  var rootStyle = null;
  try { rootStyle = window.getComputedStyle(document.documentElement); } catch (_) { }
  var safeTop = rootStyle ? parseFloat(rootStyle.getPropertyValue('--desktop-safe-top')) || 0 : 0;
  var safeRight = rootStyle ? parseFloat(rootStyle.getPropertyValue('--desktop-safe-right')) || 0 : 0;
  var overRevealEdge = x >= Math.max(0, window.innerWidth - safeRight - 92)
    && x < Math.max(0, window.innerWidth - safeRight)
    && y >= safeTop && y < safeTop + 104;
  var overHotspot = !!(handle && desktopIconShieldElementVisible(handle, { ignoreAriaHidden: true })
    && desktopPointInClientRect(x, y, handle.getBoundingClientRect()));
  var overPanel = !!(desktopModeControlDockState.open && panel
    && desktopIconShieldElementVisible(panel, { ignoreAriaHidden: true })
    && desktopPointInClientRect(x, y, panel.getBoundingClientRect()));
  return {
    overRevealEdge: overRevealEdge,
    overHotspot: overHotspot,
    overPanel: overPanel,
    overControls: overRevealEdge || overHotspot || overPanel
  };
}


function desktopPointerOverSoftwareUi(x, y) {
  var collected = collectDesktopIconShieldRects();
  for (var i = 0; i < collected.rects.length; i++) {
    var rect = collected.rects[i];
    if (!rect || rect.kind === 'desktop-controls') continue;
    if (x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height) return true;
  }
  return false;
}


function flushDesktopPointerRouteReport(force) {
  if (desktopPointerRouteReporter.timer) {
    clearTimeout(desktopPointerRouteReporter.timer);
    desktopPointerRouteReporter.timer = 0;
  }
  var api = getDesktopWindowApi();
  if (!api || typeof api.updateDesktopPointerRoute !== 'function') return;
  var mode = desktopIconShieldModeState();
  var overSoftwareUi = false;
  var overDesktopControls = false;
  if (mode.active && desktopPointerRouteReporter.hasPointer) {
    var pointState = desktopControlPointState(desktopPointerRouteReporter.x, desktopPointerRouteReporter.y);
    overDesktopControls = pointState.overControls;
    if (overDesktopControls) {
      setDesktopModeControlPeek(true);
      cancelDesktopModeControlHide();
      cancelDesktopModeControlPeekHide();
    }
    else if (desktopModeControlDockState.open) {
      scheduleDesktopModeControlHide(desktopWallpaperRuntimeState
        && desktopWallpaperRuntimeState.softwareInteractionLocked === true ? 120 : 680);
    }
    else scheduleDesktopModeControlPeekHide(980);
    overSoftwareUi = desktopPointerOverSoftwareUi(desktopPointerRouteReporter.x, desktopPointerRouteReporter.y);
  }
  var key = (overSoftwareUi ? '1' : '0') + '|' + (overDesktopControls ? '1' : '0');
  if (!force && key === desktopPointerRouteReporter.lastKey) return;
  desktopPointerRouteReporter.lastKey = key;
  try {
    api.updateDesktopPointerRoute({
      overSoftwareUi: overSoftwareUi,
      overDesktopControls: overDesktopControls
    });
  } catch (_) { }
}


function scheduleDesktopPointerRouteReport(event, force) {
  if (event && isFinite(event.clientX) && isFinite(event.clientY)) {
    desktopPointerRouteReporter.x = Number(event.clientX);
    desktopPointerRouteReporter.y = Number(event.clientY);
    desktopPointerRouteReporter.hasPointer = true;
    var mode = desktopIconShieldModeState();
    var nextOverControls = mode.active
      && desktopControlPointState(desktopPointerRouteReporter.x, desktopPointerRouteReporter.y).overControls;
    if (nextOverControls !== desktopPointerRouteReporter.overControls) force = true;
    desktopPointerRouteReporter.overControls = nextOverControls;
  }
  if (force === true) desktopPointerRouteReporter.forcePending = true;
  if (desktopPointerRouteReporter.timer) {
    if (force !== true) return;
    clearTimeout(desktopPointerRouteReporter.timer);
    desktopPointerRouteReporter.timer = 0;
  }
  desktopPointerRouteReporter.timer = setTimeout(function () {
    var forcePending = desktopPointerRouteReporter.forcePending;
    desktopPointerRouteReporter.forcePending = false;
    flushDesktopPointerRouteReport(forcePending);
  }, force === true ? 0 : 48);
}


function initDesktopModeControls(api) {
  var dock = document.getElementById('desktop-mode-control-dock');
  var handle = document.getElementById('desktop-mode-control-handle');
  var panel = document.getElementById('desktop-mode-control-panel');
  var softwareLockButton = document.getElementById('desktop-software-lock-toggle');
  var iconsButton = document.getElementById('desktop-icons-visible-toggle');
  if (!dock || !handle || !panel) return;
  setDesktopModeControlsOpen(false);
  handle.addEventListener('click', function (event) {
    consumeDesktopModeControlEvent(event);
    setDesktopModeControlsOpen(!desktopModeControlDockState.open);
  });
  handle.addEventListener('keydown', function (event) {
    if (event.key === 'ArrowDown') {
      consumeDesktopModeControlEvent(event);
      setDesktopModeControlsOpen(true);
      if (softwareLockButton) softwareLockButton.focus();
      else if (iconsButton) iconsButton.focus();
    }
  });
  dock.addEventListener('mouseenter', function () {
    setDesktopModeControlPeek(true);
    cancelDesktopModeControlHide();
    cancelDesktopModeControlPeekHide();
  });
  dock.addEventListener('mouseleave', function () {
    scheduleDesktopModeControlHide(680);
    scheduleDesktopModeControlPeekHide(980);
  });
  dock.addEventListener('focusin', function () {
    setDesktopModeControlPeek(true);
    cancelDesktopModeControlHide();
    cancelDesktopModeControlPeekHide();
  });
  dock.addEventListener('focusout', function () {
    scheduleDesktopModeControlHide(680);
    scheduleDesktopModeControlPeekHide(980);
  });
  dock.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    consumeDesktopModeControlEvent(event);
    setDesktopModeControlsOpen(false);
    handle.focus();
  });
  if (softwareLockButton) softwareLockButton.addEventListener('click', toggleDesktopSoftwareInteractionLocked);
  if (iconsButton) iconsButton.addEventListener('click', toggleDesktopIconsVisibility);
  document.addEventListener('pointerdown', function (event) {
    if (event && event.isTrusted) requestDesktopKeyboardFocus('pointerdown');
    if (!desktopModeControlDockState.open || dock.contains(event.target)) return;
    var focused = document.activeElement;
    if (focused && panel.contains(focused) && typeof focused.blur === 'function') focused.blur();
    setDesktopModeControlsOpen(false);
  }, true);
  document.addEventListener('mousemove', function (event) {
    scheduleDesktopPointerRouteReport(event, false);
  }, { passive: true });
  window.addEventListener('blur', function () {
    setDesktopModeControlsOpen(false);
    scheduleDesktopModeControlPeekHide(360);
  });
  window.addEventListener('pagehide', function () {
    cancelDesktopModeControlHide();
    cancelDesktopModeControlPeekHide();
    desktopPointerRouteReporter.hasPointer = false;
    desktopPointerRouteReporter.overControls = false;
    flushDesktopPointerRouteReport(true);
  }, { once: true });
  updateDesktopModeControl(desktopWallpaperRuntimeState);
  setDesktopModeControlPeek(false);
  scheduleDesktopPointerRouteReport(null, true);
}


function desktopIconShieldPayloadKey(payload) {
  var rectKey = [];
  var rects = payload.rects || [];
  for (var i = 0; i < rects.length; i++) {
    var rect = rects[i];
    rectKey.push([rect.x, rect.y, rect.width, rect.height, rect.kind || ''].join(','));
  }
  return [
    payload.enabled ? 1 : 0,
    payload.interactive ? 1 : 0,
    payload.viewport.width,
    payload.viewport.height,
    payload.viewport.scaleFactor,
    payload.runtimeGeneration,
    rectKey.join(';')
  ].join('|');
}


function flushDesktopIconShieldReport(forceEmpty) {
  if (desktopIconShieldReporter.timer) {
    clearTimeout(desktopIconShieldReporter.timer);
    desktopIconShieldReporter.timer = 0;
  }
  var api = getDesktopWindowApi();
  if (!api || typeof api.updateDesktopIconShields !== 'function') return;
  var mode = desktopIconShieldModeState();
  var collected = mode.active && !forceEmpty
    ? collectDesktopIconShieldRects()
    : {
      width: Math.max(0, Math.round(window.innerWidth || 0)),
      height: Math.max(0, Math.round(window.innerHeight || 0)),
      rects: []
    };
  applyDesktopIconRevealMask(forceEmpty ? [] : collected.rects);
  var payload = {
    enabled: mode.enabled,
    interactive: mode.interactive,
    viewport: {
      width: collected.width,
      height: collected.height,
      scaleFactor: Math.max(0.25, Number(window.devicePixelRatio) || 1)
    },
    runtimeGeneration: Math.max(-1, Number(desktopWallpaperRuntimeState && desktopWallpaperRuntimeState.generation) || 0),
    rects: forceEmpty ? [] : collected.rects.slice(0, 64)
  };
  var key = desktopIconShieldPayloadKey(payload);
  if (key === desktopIconShieldReporter.lastKey) return;
  desktopIconShieldReporter.lastKey = key;
  try {
    api.updateDesktopIconShields(payload);
  } catch (_) { }
}
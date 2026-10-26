'use strict';


function getDesktopWindowApi() {
  return window.desktopWindow && window.desktopWindow.isDesktop ? window.desktopWindow : null;
}


function desktopIconShieldModeState() {
  var status = desktopWallpaperRuntimeState || {};
  var windowState = desktopWindowState || {};
  var body = document.body;
  var hasWindowEnabled = typeof windowState.isDesktopEmbedded === 'boolean';
  var hasWindowInteractive = typeof windowState.isDesktopInteractive === 'boolean';
  var hasStatusEnabled = typeof status.enabled === 'boolean' || typeof status.active === 'boolean';
  var hasStatusInteractive = typeof status.interactive === 'boolean';
  var enabled = hasWindowEnabled
    ? windowState.isDesktopEmbedded === true
    : (hasStatusEnabled
      ? (status.enabled === true || status.active === true)
      : !!(body && body.classList.contains('desktop-wallpaper-mode')));
  var interactive = hasWindowInteractive
    ? windowState.isDesktopInteractive === true
    : (hasStatusInteractive
      ? status.interactive === true
      : !!(body && body.classList.contains('desktop-wallpaper-interactive')));
  var visible = document.visibilityState !== 'hidden'
    && windowState.isVisible !== false
    && windowState.isMinimized !== true;
  return {
    enabled: !!enabled,
    interactive: !!interactive,
    active: !!(enabled && interactive && visible)
  };
}


function desktopIconShieldElementVisible(element, target) {
  if (!element || element.nodeType !== 1 || element.hidden) return false;
  if ((!target || target.ignoreAriaHidden !== true)
    && String(element.getAttribute('aria-hidden') || '').toLowerCase() === 'true') return false;
  var style;
  try {
    style = window.getComputedStyle ? window.getComputedStyle(element) : element.currentStyle;
  } catch (_) {
    style = null;
  }
  if (style) {
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    if (style.contentVisibility === 'hidden') return false;
    var opacity = parseFloat(style.opacity);
    if (isFinite(opacity) && opacity <= 0.01) return false;
    if ((!target || target.visual !== true) && style.pointerEvents === 'none') return false;
  }
  if (!element.getClientRects || element.getClientRects().length < 1) return false;
  return true;
}


function desktopIconShieldClippedRect(rect, viewportWidth, viewportHeight, kind) {
  if (!rect) return null;
  var left = Math.max(0, Math.floor(Number(rect.left) || 0));
  var top = Math.max(0, Math.floor(Number(rect.top) || 0));
  var right = Math.min(viewportWidth, Math.ceil(Number(rect.right)));
  var bottom = Math.min(viewportHeight, Math.ceil(Number(rect.bottom)));
  if (!isFinite(right) || !isFinite(bottom) || right <= left || bottom <= top) return null;
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    kind: kind || 'ui'
  };
}


function desktopIconShieldMeshRect(mesh, viewportWidth, viewportHeight, kind, pad) {
  if (!mesh || !mesh.geometry || typeof THREE === 'undefined' || typeof camera === 'undefined' || !camera) return null;
  var current = mesh;
  while (current) {
    if (current.visible === false) return null;
    current = current.parent;
  }
  var params = mesh.geometry.parameters || {};
  var halfWidth = Math.max(0.02, Number(params.width) || 0) / 2;
  var halfHeight = Math.max(0.02, Number(params.height) || 0) / 2;
  if (!isFinite(halfWidth) || !isFinite(halfHeight)) return null;
  var points = [
    new THREE.Vector3(-halfWidth, -halfHeight, 0),
    new THREE.Vector3(halfWidth, -halfHeight, 0),
    new THREE.Vector3(halfWidth, halfHeight, 0),
    new THREE.Vector3(-halfWidth, halfHeight, 0)
  ];
  var minX = Infinity;
  var minY = Infinity;
  var maxX = -Infinity;
  var maxY = -Infinity;
  try {
    mesh.updateMatrixWorld(true);
    for (var i = 0; i < points.length; i++) {
      points[i].applyMatrix4(mesh.matrixWorld).project(camera);
      var x = (points[i].x + 1) * viewportWidth / 2;
      var y = (1 - points[i].y) * viewportHeight / 2;
      if (!isFinite(x) || !isFinite(y)) return null;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  } catch (_) {
    return null;
  }
  var safePad = Math.max(12, Math.min(96, Number(pad) || 32));
  return desktopIconShieldClippedRect({
    left: minX - safePad,
    top: minY - safePad,
    right: maxX + safePad,
    bottom: maxY + safePad
  }, viewportWidth, viewportHeight, kind);
}


function desktopIconShieldUnionRects(rects, viewportWidth, viewportHeight, kind) {
  if (!rects || !rects.length) return null;
  var left = viewportWidth;
  var top = viewportHeight;
  var right = 0;
  var bottom = 0;
  for (var i = 0; i < rects.length; i++) {
    var rect = rects[i];
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.width);
    bottom = Math.max(bottom, rect.y + rect.height);
  }
  return desktopIconShieldClippedRect({ left: left, top: top, right: right, bottom: bottom }, viewportWidth, viewportHeight, kind);
}


function desktopIconShieldShelfRects(viewportWidth, viewportHeight) {
  var pinned = typeof shelfPinnedOpen !== 'undefined' && shelfPinnedOpen === true;
  var contentOpen = false;
  var mode = 'off';
  var canInteract = false;
  var alwaysVisible = false;
  var previewVisible = false;
  try {
    contentOpen = !!(typeof shelfManager !== 'undefined' && shelfManager
      && shelfManager.hasOpenContent && shelfManager.hasOpenContent());
    mode = String(shelfManager && shelfManager.getMode && shelfManager.getMode() || 'off');
    canInteract = !!(shelfManager && shelfManager.canInteract && shelfManager.canInteract());
    alwaysVisible = typeof shelfAlwaysVisible === 'function' && shelfAlwaysVisible();
    previewVisible = typeof shelfPreviewIsVisible === 'function' && shelfPreviewIsVisible();
  } catch (_) {
    contentOpen = false;
  }
  var sideActive = mode === 'side' && canInteract && (pinned || contentOpen || alwaysVisible || previewVisible);
  var stageActive = mode === 'stage' && canInteract;
  if (!sideActive && !stageActive && !contentOpen) return [];

  var projected = [];
  try {
    var cards = shelfManager && shelfManager.getCards ? shelfManager.getCards() : [];
    for (var i = 0; i < cards.length && projected.length < 28; i++) {
      var cardRect = desktopIconShieldMeshRect(cards[i] && cards[i].mesh, viewportWidth, viewportHeight, 'shelf-card', 42);
      if (cardRect) projected.push(cardRect);
    }
    var content = shelfManager && shelfManager.getContentList ? shelfManager.getContentList() : null;
    var rows = contentOpen && content && content.getRows ? content.getRows() : [];
    for (var j = 0; j < rows.length && projected.length < 52; j++) {
      var rowRect = desktopIconShieldMeshRect(rows[j] && rows[j].mesh, viewportWidth, viewportHeight, 'shelf-detail-row', 28);
      if (rowRect) projected.push(rowRect);
    }
  } catch (_) {
    projected = [];
  }
  var union = desktopIconShieldUnionRects(projected, viewportWidth, viewportHeight,
    contentOpen ? 'shelf-detail' : (mode === 'stage' ? 'shelf-stage' : 'shelf-side'));
  if (union) return [union];

  if (mode === 'stage') {
    return [desktopIconShieldClippedRect({
      left: 0,
      top: Math.round(viewportHeight * 0.46),
      right: viewportWidth,
      bottom: viewportHeight
    }, viewportWidth, viewportHeight, 'shelf-stage-fallback')].filter(Boolean);
  }
  var width = contentOpen
    ? Math.min(viewportWidth, Math.max(560, Math.round(viewportWidth * 0.68)))
    : Math.min(viewportWidth, Math.max(390, Math.round(viewportWidth * 0.42)));
  return [desktopIconShieldClippedRect({
    left: viewportWidth - width,
    top: Math.max(56, Math.round(viewportHeight * 0.04)),
    right: viewportWidth,
    bottom: viewportHeight - Math.max(84, Math.round(viewportHeight * 0.08))
  }, viewportWidth, viewportHeight, contentOpen ? 'shelf-detail-fallback' : 'shelf-side-fallback')].filter(Boolean);
}


function desktopIconShieldShelfNeedsGeometryTracking() {
  try {
    if (typeof shelfManager === 'undefined' || !shelfManager || !shelfManager.getMode
      || !shelfManager.canInteract || !shelfManager.canInteract()) return false;
    var mode = String(shelfManager.getMode() || 'off');
    if (mode === 'stage') return true;
    if (mode !== 'side') return false;
    return (typeof shelfPinnedOpen !== 'undefined' && shelfPinnedOpen === true)
      || !!(shelfManager.hasOpenContent && shelfManager.hasOpenContent())
      || (typeof shelfAlwaysVisible === 'function' && shelfAlwaysVisible())
      || (typeof shelfPreviewIsVisible === 'function' && shelfPreviewIsVisible());
  } catch (_) {
    return false;
  }
}


function collectDesktopIconShieldRects() {
  var viewportWidth = Math.max(0, Math.round(window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || 0));
  var viewportHeight = Math.max(0, Math.round(window.innerHeight || (document.documentElement && document.documentElement.clientHeight) || 0));
  var rects = [];
  if (!viewportWidth || !viewportHeight) return { width: viewportWidth, height: viewportHeight, rects: rects };
  for (var i = 0; i < DESKTOP_ICON_SHIELD_TARGETS.length && rects.length < 64; i++) {
    var target = DESKTOP_ICON_SHIELD_TARGETS[i];
    var elements;
    try {
      elements = document.querySelectorAll(target.selector);
    } catch (_) {
      elements = [];
    }
    for (var j = 0; j < elements.length && rects.length < 64; j++) {
      var element = elements[j];
      if (!desktopIconShieldElementVisible(element, target)) continue;
      var clientRects = element.getClientRects ? element.getClientRects() : [];
      for (var k = 0; k < clientRects.length && rects.length < 64; k++) {
        var clipped = desktopIconShieldClippedRect(clientRects[k], viewportWidth, viewportHeight, target.kind);
        if (clipped) rects.push(clipped);
      }
    }
  }
  if (rects.length < 64) {
    var shelfRects = desktopIconShieldShelfRects(viewportWidth, viewportHeight);
    for (var shelfIndex = 0; shelfIndex < shelfRects.length && rects.length < 64; shelfIndex++) {
      if (shelfRects[shelfIndex]) rects.push(shelfRects[shelfIndex]);
    }
  }
  return { width: viewportWidth, height: viewportHeight, rects: rects };
}


function desktopIconsAreVisible(status) {
  status = status || desktopWallpaperRuntimeState || {};
  return !Object.prototype.hasOwnProperty.call(status, 'desktopIconsVisible')
    || status.desktopIconsVisible !== false;
}


function desktopUsesLayeredExplorerColorkey(status) {
  return !!(status && status.iconLayerMode === 'explorer-layered-colorkey');
}


function clearDesktopIconRevealMask() {
  var shell = document.getElementById('desktop-window-shell');
  if (!shell) return;
  shell.style.removeProperty('-webkit-mask-image');
  shell.style.removeProperty('-webkit-mask-repeat');
  shell.style.removeProperty('-webkit-mask-position');
  shell.style.removeProperty('-webkit-mask-size');
  shell.style.removeProperty('mask-image');
  shell.style.removeProperty('mask-repeat');
  shell.style.removeProperty('mask-position');
  shell.style.removeProperty('mask-size');
}


function applyDesktopIconRevealMask(shieldRects) {
  document.body.classList.remove('desktop-icons-locked');
  clearDesktopIconRevealMask();
}


function updateDesktopModeControl(status) {
  status = status || desktopWallpaperRuntimeState || {};
  var api = getDesktopWindowApi();
  var active = desktopIconShieldModeState().active;
  var softwareLocked = status.softwareInteractionLocked === true;
  var softwareLockButton = document.getElementById('desktop-software-lock-toggle');
  var softwareLockState = document.getElementById('desktop-software-lock-state');
  var iconsVisible = desktopIconsAreVisible(status);
  var iconsButton = document.getElementById('desktop-icons-visible-toggle');
  var iconsState = document.getElementById('desktop-icons-visible-state');
  if (softwareLockButton) {
    var softwareLockSupported = !!(api && typeof api.setDesktopSoftwareLocked === 'function');
    softwareLockButton.setAttribute('aria-checked', softwareLocked ? 'true' : 'false');
    softwareLockButton.setAttribute('aria-busy', desktopSoftwareLockPending ? 'true' : 'false');
    softwareLockButton.disabled = desktopSoftwareLockPending || !active || !softwareLockSupported;
    softwareLockButton.title = softwareLocked ? '恢复 Mineradio 操作' : '暂时把操作交给 Windows 桌面';
  }
  if (softwareLockState) softwareLockState.textContent = softwareLocked ? '软件操作已锁定，可在此解锁' : '软件可正常操作';
  if (document.body) document.body.classList.toggle('desktop-software-locked', active && softwareLocked);
  if (iconsButton) {
    var iconsSupported = !!(api && typeof api.setDesktopIconsVisible === 'function');
    iconsButton.setAttribute('aria-checked', iconsVisible ? 'true' : 'false');
    iconsButton.setAttribute('aria-busy', desktopIconVisibilityPending ? 'true' : 'false');
    iconsButton.disabled = desktopIconVisibilityPending || !active || !iconsSupported;
    iconsButton.title = iconsVisible ? '隐藏 Windows 桌面图标' : '显示 Windows 桌面图标';
  }
  if (iconsState) iconsState.textContent = iconsVisible ? '图标已显示' : '图标已隐藏';
}


function updateDesktopIconLockControl(status) {
  updateDesktopModeControl(status);
}


function consumeDesktopModeControlEvent(event) {
  if (!event) return;
  if (typeof event.preventDefault === 'function') event.preventDefault();
  if (typeof event.stopPropagation === 'function') event.stopPropagation();
}


function setDesktopIconsVisibility(desired, event) {
  consumeDesktopModeControlEvent(event);
  var api = getDesktopWindowApi();
  var mode = desktopIconShieldModeState();
  if (!api || typeof api.setDesktopIconsVisible !== 'function' || !mode.active) {
    if (typeof showToast === 'function') showToast('当前桌面图标显示控制不可用');
    return Promise.resolve({ ok: false, error: 'DESKTOP_ICON_VISIBILITY_INACTIVE' });
  }
  if (desktopIconVisibilityPending) return Promise.resolve({ ok: false, error: 'DESKTOP_ICON_VISIBILITY_BUSY' });
  desired = desired !== false;
  var operation = ++desktopIconVisibilityOperation;
  desktopIconVisibilityPending = true;
  updateDesktopModeControl(desktopWallpaperRuntimeState);
  return Promise.resolve(api.setDesktopIconsVisible(desired)).then(function (result) {
    if (operation !== desktopIconVisibilityOperation) return result;
    result = result && typeof result === 'object' ? result : { ok: false, error: 'DESKTOP_ICON_VISIBILITY_RESULT_INVALID' };
    if (result.status) {
      applyDesktopWallpaperRuntimeStatus(result.status);
    } else if (result.ok === true) {
      desktopWallpaperRuntimeState.desktopIconsVisible = desired;
      updateDesktopModeControl(desktopWallpaperRuntimeState);
    }
    if (typeof showToast === 'function') {
      showToast(result.ok === true
        ? (desired ? '桌面图标已显示' : '桌面图标已隐藏')
        : (desired ? '桌面图标显示失败' : '桌面图标隐藏失败'));
    }
    return result;
  }).catch(function (error) {
    if (operation !== desktopIconVisibilityOperation) return { ok: false, error: String(error && error.message || error) };
    if (typeof showToast === 'function') showToast(desired ? '桌面图标显示失败' : '桌面图标隐藏失败');
    return { ok: false, error: String(error && error.message || error) };
  }).then(function (result) {
    if (operation === desktopIconVisibilityOperation) {
      desktopIconVisibilityPending = false;
      updateDesktopModeControl(desktopWallpaperRuntimeState);
      scheduleDesktopIconShieldReport(false);
    }
    return result;
  });
}


function toggleDesktopIconsVisibility(event) {
  return setDesktopIconsVisibility(!desktopIconsAreVisible(desktopWallpaperRuntimeState), event);
}
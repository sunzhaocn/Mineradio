'use strict';


function guideTargetRect(step) {
  if (step && step.target === 'stage') {
    var stageW = Math.min(620, Math.max(260, innerWidth - 72));
    var stageH = Math.min(310, Math.max(178, innerHeight * 0.34));
    var stageLeft = innerWidth * 0.5 - stageW * 0.5;
    var stageTop = Math.max(116, innerHeight * 0.32 - stageH * 0.5);
    return { left: stageLeft, top: stageTop, width: stageW, height: stageH, right: stageLeft + stageW, bottom: stageTop + stageH };
  }
  if (step && step.target === 'shelf' && typeof shelfCueRect === 'function') {
    var shelfRect = shelfCueRect();
    var shelfLeft = shelfRect.left;
    var shelfTop = shelfRect.top - 26;
    var shelfRight = Math.min(innerWidth - 12, shelfRect.right + 18);
    var shelfBottom = shelfRect.bottom + 26;
    return { left: shelfLeft, top: shelfTop, width: shelfRight - shelfLeft, height: shelfBottom - shelfTop, right: shelfRight, bottom: shelfBottom };
  }
  if (step && step.selector === '#bottom-bar') {
    var bar = document.getElementById('bottom-bar');
    var progress = document.getElementById('progress-bar');
    var controls = document.getElementById('controls');
    if (bar) {
      var br = bar.getBoundingClientRect();
      var left = br.left, top = br.top, right = br.right, bottom = br.bottom;
      [progress, controls].forEach(function (el) {
        if (!el) return;
        var r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        left = Math.min(left, r.left);
        top = Math.min(top, r.top);
        right = Math.max(right, r.right);
        bottom = Math.max(bottom, r.bottom);
      });
      return { left: left, top: top, width: right - left, height: bottom - top, right: right, bottom: bottom };
    }
  }
  var isFullscreenDiyStep = !!(step && step.selector === '#diy-mode-btn' && (desktopRuntimeState.fullscreen || desktopFullscreenActive || document.fullscreenElement || document.body.classList.contains('desktop-fullscreen')));
  var useFullscreenDiyTarget = isFullscreenDiyStep && !shouldSuppressFullscreenDiyPeek();
  if (useFullscreenDiyTarget) {
    layoutFullscreenDiyZone();
    document.body.classList.add('fullscreen-diy-peek');
  }
  var target = step && step.selector ? document.querySelector(useFullscreenDiyTarget ? '#fullscreen-diy-btn' : step.selector) : null;
  if (target) {
    var style = window.getComputedStyle(target);
    var rect = target.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden') return rect;
  }
  if (step && step.selector === '#diy-mode-btn') {
    var fallbackRight = Math.max(116, innerWidth - 26);
    var fallbackTop = 16;
    return { left: fallbackRight - 88, top: fallbackTop, width: 88, height: 38, right: fallbackRight, bottom: fallbackTop + 38 };
  }
  return { left: innerWidth * 0.5 - 120, top: innerHeight * 0.5 - 40, width: 240, height: 80, right: innerWidth * 0.5 + 120, bottom: innerHeight * 0.5 + 40 };
}

function positionVisualGuideStep() {
  if (!visualGuideActive) return;
  var guide = document.getElementById('visual-guide');
  var ring = document.getElementById('visual-guide-ring');
  var card = document.getElementById('visual-guide-card');
  if (!guide || !ring || !card) return;
  var step = activeVisualGuideSteps()[visualGuideStep];
  var rect = guideTargetRect(step);
  ring.classList.toggle('shelf-target', !!(step && step.target === 'shelf'));
  var pad = step && step.target === 'shelf' ? 14 : (step && step.selector === '#bottom-bar' ? 10 : 8);
  var left = Math.max(12, rect.left - pad);
  var top = Math.max(12, rect.top - pad);
  var width = Math.min(innerWidth - left - 12, rect.width + pad * 2);
  var height = Math.min(innerHeight - top - 12, rect.height + pad * 2);
  ring.style.left = left + 'px';
  ring.style.top = top + 'px';
  ring.style.width = Math.max(44, width) + 'px';
  ring.style.height = Math.max(38, height) + 'px';
  ring.style.borderRadius = step && step.target === 'shelf' ? '28px' : ((step && step.selector === '#bottom-bar') ? '20px' : '16px');
  var scrim = guide.querySelector('.visual-guide-scrim');
  if (scrim) {
    scrim.style.setProperty('--gx', ((rect.left + rect.width / 2) / Math.max(1, innerWidth) * 100).toFixed(2) + '%');
    scrim.style.setProperty('--gy', ((rect.top + rect.height / 2) / Math.max(1, innerHeight) * 100).toFixed(2) + '%');
  }
  var cardW = Math.min(326, innerWidth - 32);
  var cardH = card.offsetHeight || 170;
  var cardLeft = rect.left + rect.width / 2 - cardW / 2;
  cardLeft = Math.max(16, Math.min(innerWidth - cardW - 16, cardLeft));
  var below = rect.bottom + 18;
  var above = rect.top - cardH - 18;
  var cardTop = below + cardH < innerHeight - 16 ? below : Math.max(16, above);
  card.style.left = cardLeft + 'px';
  card.style.top = cardTop + 'px';
}

function nextVisualGuideStep() {
  var steps = activeVisualGuideSteps();
  if (visualGuideStep >= steps.length - 1) {
    closeVisualGuide(true);
    return;
  }
  showVisualGuideStep(visualGuideStep + 1);
}

function closeVisualGuide(markSeen) {
  var guide = document.getElementById('visual-guide');
  visualGuideActive = false;
  if (markSeen) markVisualGuideSeen();
  if (guide) {
    guide.classList.remove('show');
    guide.setAttribute('aria-hidden', 'true');
  }
  document.body.classList.remove('visual-guide-active');
  document.body.classList.remove('fullscreen-diy-peek');
  var search = document.getElementById('search-area');
  var bottom = document.getElementById('bottom-bar');
  var fxPanel = document.getElementById('fx-panel');
  var playlistPanel = document.getElementById('playlist-panel');
  if (typeof setShelfGuideCueActive === 'function') setShelfGuideCueActive(false);
  if (search && !visualGuideState.searchWasPeek && document.activeElement !== $input) setPeek(search, false, 'search');
  if (fxPanel && !visualGuideState.fxWasPeek) setPeek(fxPanel, false, 'fx');
  if (playlistPanel && !visualGuideState.plWasPeek) setPeek(playlistPanel, false, 'pl');
  if (bottom && !visualGuideState.bottomWasVisible && !playing) bottom.classList.remove('visible', 'soft-hidden');
}

function handleVisualGuideSurfaceClick(e) {
  if (!visualGuideActive) return;
  if (e && e.target && e.target.closest && e.target.closest('button')) return;
  if (e && e.preventDefault) e.preventDefault();
  nextVisualGuideStep();
}


// ============================================================
//  动态库加载
// ============================================================
function loadScriptOnce(src) {
  return new Promise(function (resolve, reject) {
    var hit = document.querySelector('script[src="' + src + '"]');
    if (hit) { resolve(); return; }
    var sc = document.createElement('script'); sc.src = src; sc.async = true;
    sc.onload = resolve; sc.onerror = reject;
    document.head.appendChild(sc);
  });
}
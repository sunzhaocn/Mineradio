'use strict';



function pushDesktopLyricsState(force) {
  var api = getDesktopWindowApi();
  if (!api || typeof api.updateDesktopLyrics !== 'function') return;
  var now = performance.now();
  if (!force && now - desktopOverlayPushState.lyricsAt < desktopLyricsPushInterval()) return;
  var currentCustomFontId = desktopLyricsCurrentCustomFontId();
  var includeCustomFontData = !!currentCustomFontId && currentCustomFontId !== desktopOverlayPushState.lastLyricsCustomFontId;
  var payload = desktopLyricsPayload(!!force, includeCustomFontData);
  var colors = payload.colors || {};
  var motion = payload.motion || {};
  var payloadCustomFontId = payload.customFont ? payload.customFont.id : '';
  var key = payload.enabled + '|' + payload.text + '|' + Math.round(payload.progress * 1000) + '|' + Math.round((payload.progressSpan || 0) * 100) + '|' + payload.playing + '|' + payload.size + '|' + payload.opacity + '|' + payload.y + '|' + payload.clickThrough + '|' + payload.cinema + '|' + payload.highlightFollow + '|' + payload.frameRate + '|' + payload.fontFamily + '|' + payloadCustomFontId + '|' + payload.fontWeight + '|' + payload.letterSpacing + '|' + payload.lineHeight + '|' + payload.lyricScale + '|' + payload.feather + '|' + payload.beatMapKey + '|' + colors.primary + '|' + colors.secondary + '|' + colors.highlight + '|' + colors.glow + '|' + motion.lyricGlow + '|' + motion.lyricGlowBeat + '|' + Math.round((motion.lyricGlowStrength || 0) * 100) + '|' + Math.round((motion.highBloom || 0) * 100) + '|' + Math.round((motion.beatGlow || 0) * 100) + '|' + Math.round((motion.beatPulse || 0) * 100) + '|' + Math.round((motion.bass || 0) * 100);
  if (!force && key === desktopOverlayPushState.lastLyricsKey && now - desktopOverlayPushState.lyricsAt < 900) return;
  desktopOverlayPushState.lyricsAt = now;
  desktopOverlayPushState.lastLyricsKey = key;
  desktopOverlayPushState.lastLyricsCustomFontId = payloadCustomFontId;
  api.updateDesktopLyrics(payload).catch(function (e) { console.warn('desktop lyrics update failed:', e); });
}

function applyDesktopLyricsState(force) {
  var api = getDesktopWindowApi();
  if (!api) return;
  normalizeDevelopmentLockedFxState();
  var payload = desktopLyricsPayload(true, true);
  var payloadCustomFontId = payload.customFont ? payload.customFont.id : '';
  if (typeof api.setDesktopLyricsEnabled === 'function') {
    desktopOverlayPushState.lastLyricsCustomFontId = payloadCustomFontId;
    api.setDesktopLyricsEnabled(!!payload.enabled, payload).catch(function (e) { console.warn('desktop lyrics state failed:', e); });
  } else {
    desktopOverlayPushState.lastLyricsCustomFontId = '';
  }
  pushDesktopLyricsState(!!force);
}

function syncDesktopOverlayState() {
  if (fx.desktopLyrics) pushDesktopLyricsState(false);
}


function desktopWindowReducedMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}


function clearDesktopWindowTransitionClasses() {
  document.body.classList.remove('desktop-window-minimizing');
  document.body.classList.remove('desktop-window-restoring');
}


function animateDesktopWindowMinimize(api, activationEvent) {
  if (!api || typeof api.minimize !== 'function') return;
  // A minimize request must originate from a real activation of the visible
  // title-bar control. This keeps stale timers or synthetic DOM clicks from
  // unexpectedly putting the player in the taskbar during playback.
  if (!activationEvent || activationEvent.isTrusted !== true) return;
  if (desktopWindowReducedMotion()) {
    api.minimize();
    return;
  }
  clearTimeout(desktopWindowMinimizeTimer);
  clearTimeout(desktopWindowRestoreTimer);
  document.body.classList.remove('desktop-window-restoring');
  document.body.classList.add('desktop-window-minimizing');
  desktopWindowMinimizeTimer = setTimeout(function () {
    document.body.classList.remove('desktop-window-minimizing');
    api.minimize();
  }, 150);
}


function animateDesktopWindowRestore() {
  if (desktopWindowReducedMotion()) {
    clearDesktopWindowTransitionClasses();
    return;
  }
  clearTimeout(desktopWindowMinimizeTimer);
  clearTimeout(desktopWindowRestoreTimer);
  document.body.classList.remove('desktop-window-minimizing');
  document.body.classList.add('desktop-window-restoring');
  desktopWindowRestoreTimer = setTimeout(function () {
    document.body.classList.remove('desktop-window-restoring');
  }, 280);
}

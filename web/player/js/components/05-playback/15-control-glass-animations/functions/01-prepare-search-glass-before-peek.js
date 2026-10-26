'use strict';


function prepareSearchGlassBeforePeek() {
  if (!document.documentElement.classList.contains('control-glass-svg-ok')) return true;
  setSearchGlassFallback(false);
  var ready = updateSearchBoxGlassDisplacementMap();
  updateSearchPillGlassDisplacementMap();
  if (!ready || !glassImageHasHref(document.getElementById('search-box-glass-map'))) {
    setSearchGlassPriming(false);
    setSearchGlassFallback(true);
    return true;
  }
  if (document.documentElement.classList.contains('search-glass-ready')) return true;
  return syncSearchGlassReadyState(true, false);
}

function initControlGlassSurface() {
  if (supportsControlGlassSvgFilter()) document.documentElement.classList.add('control-glass-svg-ok');
  applyControlGlassChromaticOffset();
  updateControlGlassDisplacementMap();
  prepareSearchGlassBeforePeek();
  requestAnimationFrame(prepareSearchGlassBeforePeek);
  setTimeout(prepareSearchGlassBeforePeek, 140);
  updateAccountPillGlassDisplacementMap();
  var bar = document.getElementById('bottom-bar');
  var searchBox = document.getElementById('search-box');
  var searchTabs = document.getElementById('search-mode-tabs');
  var searchResults = document.getElementById('search-results');
  var userBtn = document.getElementById('user-btn');
  if (window.ResizeObserver && (bar || searchBox || searchTabs || searchResults || userBtn)) {
    var ro = new ResizeObserver(function () {
      requestAnimationFrame(updateControlGlassDisplacementMap);
      requestAnimationFrame(syncWallpaperEngineControlGlassSurface);
      requestAnimationFrame(updateSearchBoxGlassDisplacementMap);
      requestAnimationFrame(updateSearchPillGlassDisplacementMap);
      requestAnimationFrame(updateAccountPillGlassDisplacementMap);
    });
    if (bar) ro.observe(bar);
    if (searchBox) ro.observe(searchBox);
    if (searchTabs) ro.observe(searchTabs);
    if (searchResults) ro.observe(searchResults);
    if (userBtn) ro.observe(userBtn);
  }
  if (window.MutationObserver && bar) {
    var barObserver = new MutationObserver(function () {
      animateWallpaperEngineControlGlassSurface(520);
    });
    barObserver.observe(bar, { attributes: true, attributeFilter: ['class', 'style'] });
  }
  if (window.MutationObserver && (searchTabs || searchResults || userBtn)) {
    var mo = new MutationObserver(function () {
      requestAnimationFrame(updateSearchPillGlassDisplacementMap);
      requestAnimationFrame(updateAccountPillGlassDisplacementMap);
    });
    if (searchTabs) mo.observe(searchTabs, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    if (searchResults) mo.observe(searchResults, { childList: true, subtree: true });
    if (userBtn) mo.observe(userBtn, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }
  window.addEventListener('resize', function () {
    requestAnimationFrame(updateControlGlassDisplacementMap);
    animateWallpaperEngineControlGlassSurface(520);
    requestAnimationFrame(updateSearchBoxGlassDisplacementMap);
    requestAnimationFrame(updateSearchPillGlassDisplacementMap);
    requestAnimationFrame(updateAccountPillGlassDisplacementMap);
  });
  if (bar) {
    bar.addEventListener('transitionrun', function () {
      animateWallpaperEngineControlGlassSurface(520);
    });
    bar.addEventListener('transitionend', function () {
      syncWallpaperEngineControlGlassSurface(true);
    });
  }
}


function bindPlayerControlAnimations() {
  if (!window.gsap) return;
  document.querySelectorAll('#bottom-bar .ctrl-btn').forEach(function (btn) {
    if (!btn || btn.dataset.controlAnimBound === '1') return;
    btn.dataset.controlAnimBound = '1';
    var isPlay = btn.id === 'play-btn';
    var iconTarget = btn.querySelector('svg,.lyrics-word-icon,#quality-btn-label');
    function canAnimate() {
      return !btn.disabled && !btn.classList.contains('busy');
    }
    function hoverIn(e) {
      if (!canAnimate() || (e && e.pointerType === 'touch')) return;
      window.gsap.to(btn, { y: -2, scale: isPlay ? 1.07 : 1.08, duration: 0.20, ease: 'power2.out', overwrite: 'auto' });
      if (iconTarget) window.gsap.to(iconTarget, { scale: isPlay ? 1.08 : 1.10, duration: 0.22, ease: 'power2.out', overwrite: 'auto' });
    }
    function hoverOut() {
      window.gsap.to(btn, { y: 0, scale: 1, rotate: 0, duration: 0.26, ease: 'power2.out', overwrite: 'auto' });
      if (iconTarget) window.gsap.to(iconTarget, { scale: 1, rotate: 0, duration: 0.22, ease: 'power2.out', overwrite: 'auto' });
    }
    function pressDown() {
      if (!canAnimate()) return;
      window.gsap.to(btn, { y: 0, scale: isPlay ? 0.91 : 0.90, duration: 0.10, ease: 'power2.out', overwrite: 'auto' });
      if (iconTarget) window.gsap.to(iconTarget, { scale: 0.88, duration: 0.10, ease: 'power2.out', overwrite: 'auto' });
    }
    function release(e) {
      if (!canAnimate()) return;
      var hovered = e && e.pointerType !== 'touch' && btn.matches(':hover');
      window.gsap.to(btn, { y: hovered ? -2 : 0, scale: hovered ? (isPlay ? 1.07 : 1.08) : 1, duration: 0.24, ease: 'back.out(1.9)', overwrite: 'auto' });
      if (iconTarget) window.gsap.to(iconTarget, { scale: hovered ? 1.06 : 1, duration: 0.22, ease: 'back.out(1.8)', overwrite: 'auto' });
    }
    function clickPulse() {
      if (!canAnimate() || btn.id === 'play-mode-btn') return;
      var pulseSize = isPlay ? 18 : 10;
      var pulseColor = isPlay ? 'rgba(255,63,85,.34)' : 'rgba(255,255,255,.22)';
      window.gsap.killTweensOf(btn, 'boxShadow');
      window.gsap.fromTo(btn,
        { boxShadow: '0 0 0 0 ' + pulseColor },
        { boxShadow: '0 0 0 ' + pulseSize + 'px rgba(255,63,85,0)', duration: isPlay ? 0.58 : 0.42, ease: 'sine.out', overwrite: false, onComplete: function () { window.gsap.set(btn, { clearProps: 'boxShadow' }); } }
      );
      if (iconTarget) window.gsap.fromTo(iconTarget, { rotate: isPlay ? 0 : -5 }, { rotate: 0, duration: 0.34, ease: 'elastic.out(1,0.55)', overwrite: 'auto' });
    }
    btn.addEventListener('pointerenter', hoverIn);
    btn.addEventListener('pointerleave', hoverOut);
    btn.addEventListener('pointercancel', hoverOut);
    btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    btn.addEventListener('pointerdown', pressDown);
    btn.addEventListener('pointerup', release);
    btn.addEventListener('click', clickPulse);
    btn.addEventListener('focus', function () { hoverIn(); });
    btn.addEventListener('blur', hoverOut);
  });
}


function clearPlayerControlFocusState(reason) {
  try {
    document.querySelectorAll('#bottom-bar .ctrl-btn').forEach(function (btn) {
      if (!btn) return;
      if (document.activeElement === btn) btn.blur();
      btn.classList.remove('focus-visible');
      if (window.gsap) {
        window.gsap.killTweensOf(btn);
        window.gsap.set(btn, { y: 0, scale: 1, rotate: 0, clearProps: 'boxShadow' });
        var iconTarget = btn.querySelector('svg,.lyrics-word-icon,#quality-btn-label');
        if (iconTarget) {
          window.gsap.killTweensOf(iconTarget);
          window.gsap.set(iconTarget, { scale: 1, rotate: 0 });
        }
      } else {
        btn.style.transform = '';
        btn.style.boxShadow = '';
      }
    });
  } catch (e) {
    console.warn('[ControlFocusClear]', reason || 'unknown', e);
  }
}
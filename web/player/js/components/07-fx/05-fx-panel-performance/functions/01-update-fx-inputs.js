'use strict';


function updateFxInputs() {
  normalizeDevelopmentLockedFxState();
  applyShelfCameraDefaultAngle(false);
  setRange('fx-intensity', fx.intensity);
  setRange('fx-cineshake', fx.cinemaShake);
  setRange('fx-depth', fx.depth);
  setRange('fx-coverres', fx.coverResolution);
  setRange('fx-lyricglow', fx.lyricGlowStrength);
  setRange('fx-lyricbgadapt', fx.lyricBackgroundAdapt);
  setRange('fx-sonicamp', fx.sonicGroundAmplitude);
  setRange('fx-sonicspeed', fx.sonicGroundMotionSpeed);
  setRange('fx-sonicdensity', fx.sonicGroundDensity);
  setRange('fx-sonicrange', fx.sonicGroundRange);
  setRange('fx-soniclower', fx.sonicGroundLower);
  setRange('fx-sonicdepth', fx.sonicGroundDepth);
  setRange('fx-sonicautorotate', fx.sonicGroundAutoRotate);
  setRange('fx-sonicaudiosensitivity', fx.sonicAudioSensitivity);
  setRange('fx-sonicaudiobandstart', fx.sonicAudioBandStart);
  setRange('fx-sonicaudiobandend', fx.sonicAudioBandEnd);
  setRange('fx-sonicaudiothreshold', fx.sonicAudioThreshold);
  setRange('fx-sonicaudiopulse', fx.sonicAudioPulseStrength);
  setRange('fx-sonicwegain', fx.sonicWorkshopInputGain);
  setRange('fx-sonicweaudio', fx.sonicWorkshopAudioIntensity);
  setRange('fx-sonicwerange', fx.sonicWorkshopResponseRange);
  setRange('fx-sonicwepeak', fx.sonicWorkshopPeakIntensity);
  setRange('fx-sonicsubbass', fx.sonicGroundSubBass);
  setRange('fx-sonicbass', fx.sonicGroundBass);
  setRange('fx-soniclowmid', fx.sonicGroundLowMid);
  setRange('fx-sonicmid', fx.sonicGroundMid);
  setRange('fx-sonichighmid', fx.sonicGroundHighMid);
  setRange('fx-sonicpresence', fx.sonicGroundPresence);
  setRange('fx-sonicbrilliance', fx.sonicGroundBrilliance);
  setRange('fx-sonicair', fx.sonicGroundAir);
  setRange('fx-sonicglow', fx.sonicGroundGlow);
  setRange('fx-sonicfloatcount', fx.sonicGroundFloatingCount);
  setRange('fx-sonicfloatintensity', fx.sonicGroundFloatingIntensity);
  setRange('fx-sonicfloatmin', fx.sonicGroundFloatingMinSize);
  setRange('fx-sonicfloatmax', fx.sonicGroundFloatingMaxSize);
  setRange('fx-sonicfloatspeed', fx.sonicGroundFloatingSpeed);
  setRange('fx-bgopacity', fx.backgroundOpacity == null ? 1 : fx.backgroundOpacity);
  setRange('fx-bgcropx', fx.backgroundMediaCropX == null ? fxDefaults.backgroundMediaCropX : fx.backgroundMediaCropX);
  setRange('fx-bgcropy', fx.backgroundMediaCropY == null ? fxDefaults.backgroundMediaCropY : fx.backgroundMediaCropY);
  setRange('fx-bgzoom', fx.backgroundMediaZoom == null ? fxDefaults.backgroundMediaZoom : fx.backgroundMediaZoom);
  setRange('fx-windowbgopacity', fx.windowBackgroundOpacity == null ? fxDefaults.windowBackgroundOpacity : fx.windowBackgroundOpacity);
  setRange('fx-bgglassopacity', fx.backgroundGlassOpacity == null ? fxDefaults.backgroundGlassOpacity : fx.backgroundGlassOpacity);
  setRange('fx-glassaberration', fx.controlGlassChromaticOffset);
  setRange('fx-playlistblur', fx.playlistPanelGlassBlur);
  setRange('fx-playlistdensity', fx.playlistPanelGlassDensity);
  setRange('fx-playlistopen', fx.playlistPanelOpenDuration);
  setRange('fx-playlistclose', fx.playlistPanelCloseDuration);
  setRange('fx-desktoplyricssize', fx.desktopLyricsSize);
  setRange('fx-desktoplyricsopacity', fx.desktopLyricsOpacity);
  setRange('fx-desktoplyricsy', fx.desktopLyricsY);
  setRange('fx-wallpaperopacity', fx.wallpaperOpacity);
  setRange('fx-shelfsize', fx.shelfSize);
  setRange('fx-shelfx', fx.shelfOffsetX);
  setRange('fx-shelfy', fx.shelfOffsetY);
  setRange('fx-shelfz', fx.shelfOffsetZ);
  setRange('fx-shelfangle', fx.shelfAngleY);
  setRange('fx-shelfopacity', fx.shelfOpacity);
  setRange('fx-shelfbgalpha', fx.shelfBgOpacity);
  setRange('fx-shelfdetailx', fx.shelfDetailOffsetX);
  setRange('fx-shelfdetaily', fx.shelfDetailOffsetY);
  setRange('fx-shelfdetailz', fx.shelfDetailOffsetZ);
  setRange('fx-shelfdetailscale', fx.shelfDetailScale);
  setRange('fx-shelfdetailanglex', fx.shelfDetailAngleX);
  setRange('fx-shelfdetailangley', fx.shelfDetailAngleY);
  setRange('fx-shelfdetailrowgap', fx.shelfDetailRowGap);
  setRange('fx-shelfdetailopen', fx.shelfDetailOpenDuration);
  setRange('fx-shelfdetailclose', fx.shelfDetailCloseDuration);
  setRange('fx-shelfdetailrowtime', fx.shelfDetailRowDuration);
  setRange('fx-shelfdetailintro', fx.shelfDetailIntroStrength);
  setRange('fx-shelfdetailparallax', fx.shelfDetailParallax);
  setRange('fx-shelfsummonopen', fx.shelfSummonOpenDuration);
  setRange('fx-shelfsummonclose', fx.shelfSummonCloseDuration);
  setRange('fx-shelfsummonslide', fx.shelfSummonSlide);
  setRange('fx-shelfsummonstagger', fx.shelfSummonStagger);
  setRange('fx-shelfsummonscale', fx.shelfSummonScale);
  setRange('fx-shelfsummonparallax', fx.shelfSummonParallax);
  setRange('fx-shelfcamenter', fx.shelfCameraEnterSpeed);
  setRange('fx-shelfcamexit', fx.shelfCameraExitSpeed);
  setRange('fx-lyricspacing', fx.lyricLetterSpacing);
  setRange('fx-lyriclineheight', fx.lyricLineHeight);
  setRange('fx-lyricweight', fx.lyricWeight);
  setRange('fx-lyriccustomlines', fx.lyricCustomLineCount);
  setRange('fx-lyricglitchintensity', fx.lyricGlitchIntensity);
  setRange('fx-lyricglitchslice', fx.lyricGlitchSlice);
  setRange('fx-lyricglitchchroma', fx.lyricGlitchChroma);
  setRange('fx-lyricglitchrate', fx.lyricGlitchRate);
  setRange('fx-lyricglitchjitter', fx.lyricGlitchJitter);
  setRange('fx-lyriccontextopacity', fx.lyricContextOpacity);
  setRange('fx-lyriccontextspread', fx.lyricContextSpread);
  setRange('fx-lyrictranslationgap', fx.lyricTranslationGap);
  setRange('fx-lyrictranslationscale', fx.lyricTranslationScale);
  setRange('fx-lyrictranslationopacity', fx.lyricTranslationOpacity);
  setRange('fx-lyricedgefade', fx.lyricEdgeFade);
  setRange('fx-lyricmotionsoftness', fx.lyricMotionSoftness);
  setRange('fx-lyricscale', fx.lyricScale);
  setRange('fx-lyricx', fx.lyricOffsetX);
  setRange('fx-lyricy', fx.lyricOffsetY);
  setRange('fx-lyricz', fx.lyricOffsetZ);
  setRange('fx-lyrictiltx', fx.lyricTiltX);
  setRange('fx-lyrictilty', fx.lyricTiltY);
  setRange('fx-point', fx.point);
  setRange('fx-speed', fx.speed);
  setRange('fx-twist', fx.twist);
  setRange('fx-color', fx.color);
  setRange('fx-bloom', fx.bloomStrength);
  setRange('fx-scatter', fx.scatter);
  setRange('fx-bgfade', fx.bgFade);
  updateLyricGlowControls();
  applyPlaylistPanelFxSettings();
  // 同步开关
  document.getElementById('t-float').classList.toggle('on', fx.floatLayer);
  var floatToggle = document.getElementById('t-float');
  if (floatToggle) floatToggle.classList.toggle('on', fx.floatLayer);
  document.getElementById('t-cinema').classList.toggle('on', fx.cinema);
  var lyricGlowToggle = document.getElementById('t-lyricGlow');
  if (lyricGlowToggle) lyricGlowToggle.classList.toggle('on', fx.lyricGlow);
  var lyricGlowBeatToggle = document.getElementById('t-lyricGlowBeat');
  if (lyricGlowBeatToggle) lyricGlowBeatToggle.classList.toggle('on', fx.lyricGlowBeat);
  var lyricGlowEnableBtn = document.getElementById('lyric-glow-enable-btn');
  if (lyricGlowEnableBtn) lyricGlowEnableBtn.classList.toggle('active', fx.lyricGlow);
  var lyricGlowBeatBtn = document.getElementById('lyric-glow-beat-btn');
  if (lyricGlowBeatBtn) lyricGlowBeatBtn.classList.toggle('active', fx.lyricGlowBeat);
  var lyricGlowParticlesToggle = document.getElementById('t-lyricGlowParticles');
  if (lyricGlowParticlesToggle) lyricGlowParticlesToggle.classList.toggle('on', fx.lyricGlowParticles);
  var backgroundStarRiverToggle = document.getElementById('t-backgroundStarRiver');
  if (backgroundStarRiverToggle) backgroundStarRiverToggle.classList.toggle('on', fx.backgroundStarRiver !== false);
  var lyricVerticalFloatToggle = document.getElementById('t-lyricVerticalFloat');
  if (lyricVerticalFloatToggle) lyricVerticalFloatToggle.classList.toggle('on', fx.lyricVerticalFloat !== false);
  var lyricLiveViewportFitToggle = document.getElementById('t-lyricLiveViewportFit');
  if (lyricLiveViewportFitToggle) lyricLiveViewportFitToggle.classList.toggle('on', fx.lyricLiveViewportFit !== false);
  var lyricContextHighQualityToggle = document.getElementById('t-lyricContextHighQuality');
  if (lyricContextHighQualityToggle) lyricContextHighQualityToggle.classList.toggle('on', fx.lyricContextHighQuality !== false);
  var lyricBackdropAdaptToggle = document.getElementById('t-lyricBackdropAdapt');
  if (lyricBackdropAdaptToggle) lyricBackdropAdaptToggle.classList.toggle('on', fx.lyricBackdropAdapt !== false);
  var coverBackdropAdaptToggle = document.getElementById('t-coverBackdropAdapt');
  if (coverBackdropAdaptToggle) coverBackdropAdaptToggle.classList.toggle('on', fx.coverBackdropAdapt !== false);
  var lyricPauseHoldToggle = document.getElementById('t-lyricPauseHold');
  if (lyricPauseHoldToggle) lyricPauseHoldToggle.classList.toggle('on', fx.lyricPauseHold !== false);
  var lyricCameraLockToggle = document.getElementById('t-lyricCameraLock');
  if (lyricCameraLockToggle) lyricCameraLockToggle.classList.toggle('on', fx.lyricCameraLock);
  document.getElementById('t-bloom').classList.toggle('on', fx.bloom);
  document.getElementById('t-edge').classList.toggle('on', fx.edge);
  var desktopLyricsToggle = document.getElementById('t-desktopLyrics');
  if (desktopLyricsToggle) desktopLyricsToggle.classList.toggle('on', fx.desktopLyrics);
  var desktopLyricsClickToggle = document.getElementById('t-desktopLyricsClickThrough');
  if (desktopLyricsClickToggle) desktopLyricsClickToggle.classList.toggle('on', fx.desktopLyricsClickThrough !== false);
  var desktopLyricsCinemaToggle = document.getElementById('t-desktopLyricsCinema');
  if (desktopLyricsCinemaToggle) desktopLyricsCinemaToggle.classList.toggle('on', fx.desktopLyricsCinema !== false);
  var desktopLyricsHighlightToggle = document.getElementById('t-desktopLyricsHighlight');
  if (desktopLyricsHighlightToggle) desktopLyricsHighlightToggle.classList.toggle('on', fx.desktopLyricsHighlight === true);
  updateDesktopLyricsFpsControls();
  updateWallpaperFpsControls();
  var wallpaperModeToggle = document.getElementById('t-wallpaperMode');
  if (wallpaperModeToggle) wallpaperModeToggle.classList.toggle('on', fx.wallpaperMode);
  var shelfPodcastsToggle = document.getElementById('t-shelfShowPodcasts');
  if (shelfPodcastsToggle) shelfPodcastsToggle.classList.toggle('on', fx.shelfShowPodcasts !== false);
  var shelfMergeToggle = document.getElementById('t-shelfMergeCollections');
  if (shelfMergeToggle) shelfMergeToggle.classList.toggle('on', fx.shelfMergeCollections === true);
  var liveBackgroundKeepToggle = document.getElementById('t-liveBackgroundKeep');
  if (liveBackgroundKeepToggle) liveBackgroundKeepToggle.classList.toggle('on', fx.liveBackgroundKeep === true);
  var sonicFloatingToggle = document.getElementById('t-sonicGroundFloatingEnabled');
  if (sonicFloatingToggle) sonicFloatingToggle.classList.toggle('on', fx.sonicGroundFloatingEnabled !== false);
  var sonicAudioToggle = document.getElementById('t-sonicAudioMonitorEnabled');
  if (sonicAudioToggle) sonicAudioToggle.classList.toggle('on', fx.sonicAudioMonitorEnabled !== false);
  var sonicAudioAutoToggle = document.getElementById('t-sonicAudioAutoTrack');
  if (sonicAudioAutoToggle) sonicAudioAutoToggle.classList.toggle('on', fx.sonicAudioAutoTrack !== false);
  if (typeof refreshSonicAudioMonitorUi === 'function') refreshSonicAudioMonitorUi();
  applyStartupAutoplayUi();
  updatePerformanceControls();
  if (typeof updateMemoryControls === 'function') updateMemoryControls();
  updateDevelopmentFxControls();
  var aiDepthToggle = document.getElementById('t-aidepth');
  if (aiDepthToggle) aiDepthToggle.classList.toggle('on', fx.aiDepth);
  // 三态
  document.querySelectorAll('#shelf-seg button').forEach(function (b) { b.classList.toggle('active', b.dataset.shelf === fx.shelf); });
  updateShelfControlUi();
  if (typeof syncGestureCameraUi === 'function') syncGestureCameraUi();
  else document.querySelectorAll('#cam-seg button').forEach(function (b) { b.classList.toggle('active', b.dataset.cam === fx.cam); });
  if (typeof applyGestureSettingsUi === 'function') applyGestureSettingsUi();
  refreshPresetGrid();
  updateLyricColorControls();
  updateLyricHighlightControls();
  updateLyricGlowControls();
  updateLyricDisplayModeControls();
  updateLyricTranslationModeControls();
  updateLyricMotionStyleControls();
  updateLyricFontControls();
  updateLyricTextureClarityControls();
  updateUiAccentControls();
  updateHomeAccentControls();
  updateIconAccentControls();
  updateCustomBackgroundControls();
  updateVisualTintControls();
  if (typeof updateSonicGroundColorControls === 'function') updateSonicGroundColorControls();
  if (typeof updateSonicWorkshopColorControls === 'function') updateSonicWorkshopColorControls();
  updateSonicSeriesControlVisibility();
  applyControlGlassChromaticOffset();
  syncFxUniforms();
}

function animateFxResetButton(btn) {
  if (!btn || !window.gsap) return;
  window.gsap.fromTo(btn, { rotate: -120, scale: 0.88 }, { rotate: 0, scale: 1, duration: 0.48, ease: 'expo.out', overwrite: true });
  window.gsap.fromTo(btn, { boxShadow: '0 0 0 0 rgba(244,210,138,.38)' }, { boxShadow: '0 0 0 8px rgba(244,210,138,0)', duration: 0.55, ease: 'sine.out', overwrite: true });
}

function isStageLyricRealtimeFxKey(key) {
  return key === 'lyricLetterSpacing'
    || key === 'lyricLineHeight'
    || key === 'lyricWeight'
    || key === 'lyricCustomLineCount'
    || key === 'lyricContextOpacity'
    || key === 'lyricContextSpread'
    || key === 'lyricTranslationGap'
    || key === 'lyricTranslationScale'
    || key === 'lyricTranslationOpacity'
    || key === 'lyricEdgeFade'
    || key === 'lyricMotionSoftness'
    || key === 'lyricBackgroundAdapt'
    || /^lyricGlitch/.test(key);
}

function isDesktopLyricRealtimeFxKey(key) {
  return isStageLyricRealtimeFxKey(key)
    || key === 'lyricScale'
    || key === 'lyricGlowStrength';
}

function flushStageLyricRealtimeRefresh() {
  if (lyricRealtimeRefreshTimer) {
    clearTimeout(lyricRealtimeRefreshTimer);
    lyricRealtimeRefreshTimer = null;
  }
  lyricRealtimeLastRefreshAt = window.performance && performance.now ? performance.now() : Date.now();
  refreshStageLyricDisplayMode();
}

function scheduleStageLyricRealtimeRefresh(deferred) {
  if (!deferred) {
    flushStageLyricRealtimeRefresh();
    return;
  }
  var now = window.performance && performance.now ? performance.now() : Date.now();
  var wait = Math.max(0, 120 - (now - lyricRealtimeLastRefreshAt));
  if (wait <= 0) {
    flushStageLyricRealtimeRefresh();
    return;
  }
  if (lyricRealtimeRefreshTimer) clearTimeout(lyricRealtimeRefreshTimer);
  lyricRealtimeRefreshTimer = setTimeout(flushStageLyricRealtimeRefresh, wait);
}

function syncLyricRealtimeFxChange(key, opts) {
  opts = opts || {};
  if (key === 'lyricCustomLineCount') updateLyricDisplayModeControls();
  if (key === 'lyricMotionSoftness' || /^lyricGlitch/.test(key)) updateLyricMotionStyleControls();
  if (isStageLyricRealtimeFxKey(key)) scheduleStageLyricRealtimeRefresh(!!opts.deferred);
  else if (key === 'lyricLetterSpacing' || key === 'lyricLineHeight' || key === 'lyricWeight') refreshCurrentLyricStyle();
  if (isDesktopLyricRealtimeFxKey(key)) pushDesktopLyricsState(true);
}

function resetFxSliderValue(id, key, btn) {
  if (!Object.prototype.hasOwnProperty.call(fxDefaults, key)) return;
  if (key === 'shelfAngleY') {
    fx.shelfAngleYManual = false;
    fx.shelfAngleY = shelfDefaultAngleForCameraMode(fx.shelfCameraMode);
  } else {
    fx[key] = fxDefaults[key];
  }
  setRange(id, fx[key]);
  if (key === 'coverResolution') applyCoverParticleResolution(fx[key], { reload: true });
  if (key === 'backgroundOpacity' || key === 'windowBackgroundOpacity' || key === 'backgroundGlassOpacity' || key === 'backgroundMediaCropX' || key === 'backgroundMediaCropY' || key === 'backgroundMediaZoom') updateCustomBackgroundControls();
  if (key === 'controlGlassChromaticOffset') applyControlGlassChromaticOffset();
  if (/^playlistPanel/.test(key)) applyPlaylistPanelFxSettings();
  syncFxUniforms();
  if (/^shelf/.test(key) && shelfManager && shelfManager.refreshTheme) shelfManager.refreshTheme();
  syncLyricRealtimeFxChange(key);
  saveLyricLayout({ syncDisk: key === 'controlGlassChromaticOffset', user: true, reason: 'reset:' + key });
  animateFxResetButton(btn);
  showToast('已恢复默认数值');
}

function ensureFxSliderResetButton(id, key) {
  var el = document.getElementById(id);
  if (!el || !el.parentElement || el.parentElement.querySelector('.fx-reset-one')) return;
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'fx-reset-one';
  btn.title = '恢复当前滑条默认值';
  btn.setAttribute('aria-label', '恢复当前滑条默认值');
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>';
  btn.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    resetFxSliderValue(id, key, btn);
  });
  el.parentElement.appendChild(btn);
}

function setFxPanelTab(tab) {
  var allowed = { home: 1, interface: 1, lyrics: 1, motion: 1, shelf: 1, system: 1 };
  var panel = document.getElementById('fx-panel');
  var nextTab = allowed[tab] ? tab : 'home';
  var previousTab = fxPanelTab;
  if (panel && previousTab !== nextTab && panel.getAttribute('data-console-layout') === 'task-first-v2') {
    fxPanelTabScroll[previousTab] = panel.scrollTop;
  }
  fxPanelTab = nextTab;
  if (panel) panel.setAttribute('data-active-tab', fxPanelTab);
  document.querySelectorAll('#fx-panel-tabs [data-fx-tab]').forEach(function (btn) {
    var active = btn.getAttribute('data-fx-tab') === fxPanelTab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
    btn.setAttribute('tabindex', active ? '0' : '-1');
    if (active && previousTab !== fxPanelTab) btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
  document.querySelectorAll('#fx-panel .fx-tab-page').forEach(function (page) {
    var active = page.getAttribute('data-fx-page') === fxPanelTab;
    page.classList.toggle('active', active);
    page.setAttribute('aria-hidden', active ? 'false' : 'true');
  });
  if (panel && previousTab !== fxPanelTab && panel.getAttribute('data-console-layout') === 'task-first-v2') {
    requestAnimationFrame(function () {
      panel.scrollTop = Object.prototype.hasOwnProperty.call(fxPanelTabScroll, fxPanelTab) ? fxPanelTabScroll[fxPanelTab] : 0;
    });
  }
  repositionFxFloatingPanels();
}

function fxPanelInputId(node) {
  var input = node && node.querySelector ? node.querySelector('input[id]') : null;
  return input ? input.id : '';
}

function fxPanelTargetForNode(node, current) {
  if (!node) return current || 'presets';
  var id = node.id || '';
  var inputId = fxPanelInputId(node);
  if (id === 'preset-grid' || id === 'user-archive-grid') return 'presets';
  if (id === 'fx-lyric-fold') return 'lyrics';
  if (id === 'fx-overlay-fold' || id === 'fx-stage-fold') return 'motion';
  if (id === 'fx-advanced' || node.classList.contains('fx-actions')) return 'advanced';
  if (node.classList.contains('lyric-color-row') || node.classList.contains('cover-color-pop') || node.classList.contains('color-lab-pop') || node.classList.contains('cover-color-loupe')) return 'appearance';
  if (inputId === 'fx-bgopacity' || inputId === 'fx-bgcropx' || inputId === 'fx-bgcropy' || inputId === 'fx-bgzoom' || inputId === 'fx-windowbgopacity' || inputId === 'fx-bgglassopacity' || inputId === 'fx-glassaberration' || /^fx-playlist/.test(inputId)) return 'appearance';
  if (inputId === 'fx-lyricglow' || inputId === 'fx-lyricbgadapt') return 'lyrics';
  if (/^fx-sonic/.test(inputId)) return 'motion';
  if (/^fx-(intensity|depth|coverres|cineshake|shelf)/.test(inputId)) return 'motion';
  return current || 'presets';
}
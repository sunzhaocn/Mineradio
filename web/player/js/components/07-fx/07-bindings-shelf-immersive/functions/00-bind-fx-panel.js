'use strict';

function bindFxPanel() {
  liftFxFloatingPopups();
  relabelFxPanelControls();
  organizeFxPanel();
  bindHotkeySettings();
  bindCloseBehaviorControls();
  bindStartupResumeModeControls();
  bindAudioOutputControls();
  if (typeof bindSystemMemoryControls === 'function') bindSystemMemoryControls();
  buildPresetGrid();
  renderUserFxArchives();
  buildLyricColorControls();
  var ids = [
    ['fx-intensity', 'intensity'], ['fx-depth', 'depth'], ['fx-coverres', 'coverResolution'], ['fx-cineshake', 'cinemaShake'], ['fx-lyricglow', 'lyricGlowStrength'], ['fx-lyricbgadapt', 'lyricBackgroundAdapt'],
    ['fx-sonicamp', 'sonicGroundAmplitude'], ['fx-sonicspeed', 'sonicGroundMotionSpeed'], ['fx-sonicdensity', 'sonicGroundDensity'],
    ['fx-sonicrange', 'sonicGroundRange'], ['fx-soniclower', 'sonicGroundLower'], ['fx-sonicdepth', 'sonicGroundDepth'], ['fx-sonicautorotate', 'sonicGroundAutoRotate'],
    ['fx-sonicaudiosensitivity', 'sonicAudioSensitivity'], ['fx-sonicaudiobandstart', 'sonicAudioBandStart'], ['fx-sonicaudiobandend', 'sonicAudioBandEnd'], ['fx-sonicaudiothreshold', 'sonicAudioThreshold'], ['fx-sonicaudiopulse', 'sonicAudioPulseStrength'],
    ['fx-sonicwegain', 'sonicWorkshopInputGain'], ['fx-sonicweaudio', 'sonicWorkshopAudioIntensity'], ['fx-sonicwerange', 'sonicWorkshopResponseRange'], ['fx-sonicwepeak', 'sonicWorkshopPeakIntensity'],
    ['fx-sonicsubbass', 'sonicGroundSubBass'], ['fx-sonicbass', 'sonicGroundBass'], ['fx-soniclowmid', 'sonicGroundLowMid'], ['fx-sonicmid', 'sonicGroundMid'], ['fx-sonichighmid', 'sonicGroundHighMid'], ['fx-sonicpresence', 'sonicGroundPresence'], ['fx-sonicbrilliance', 'sonicGroundBrilliance'], ['fx-sonicair', 'sonicGroundAir'],
    ['fx-sonicglow', 'sonicGroundGlow'], ['fx-sonicfloatcount', 'sonicGroundFloatingCount'], ['fx-sonicfloatintensity', 'sonicGroundFloatingIntensity'], ['fx-sonicfloatmin', 'sonicGroundFloatingMinSize'], ['fx-sonicfloatmax', 'sonicGroundFloatingMaxSize'], ['fx-sonicfloatspeed', 'sonicGroundFloatingSpeed'],
    ['fx-bgopacity', 'backgroundOpacity'], ['fx-bgcropx', 'backgroundMediaCropX'], ['fx-bgcropy', 'backgroundMediaCropY'], ['fx-bgzoom', 'backgroundMediaZoom'], ['fx-windowbgopacity', 'windowBackgroundOpacity'], ['fx-bgglassopacity', 'backgroundGlassOpacity'], ['fx-glassaberration', 'controlGlassChromaticOffset'],
    ['fx-playlistblur', 'playlistPanelGlassBlur'], ['fx-playlistdensity', 'playlistPanelGlassDensity'], ['fx-playlistopen', 'playlistPanelOpenDuration'], ['fx-playlistclose', 'playlistPanelCloseDuration'],
    ['fx-desktoplyricssize', 'desktopLyricsSize'], ['fx-desktoplyricsopacity', 'desktopLyricsOpacity'], ['fx-desktoplyricsy', 'desktopLyricsY'], ['fx-wallpaperopacity', 'wallpaperOpacity'],
    ['fx-shelfsize', 'shelfSize'], ['fx-shelfx', 'shelfOffsetX'], ['fx-shelfy', 'shelfOffsetY'], ['fx-shelfz', 'shelfOffsetZ'], ['fx-shelfangle', 'shelfAngleY'], ['fx-shelfopacity', 'shelfOpacity'], ['fx-shelfbgalpha', 'shelfBgOpacity'],
    ['fx-shelfdetailx', 'shelfDetailOffsetX'], ['fx-shelfdetaily', 'shelfDetailOffsetY'], ['fx-shelfdetailz', 'shelfDetailOffsetZ'], ['fx-shelfdetailscale', 'shelfDetailScale'], ['fx-shelfdetailanglex', 'shelfDetailAngleX'], ['fx-shelfdetailangley', 'shelfDetailAngleY'], ['fx-shelfdetailrowgap', 'shelfDetailRowGap'],
    ['fx-shelfdetailopen', 'shelfDetailOpenDuration'], ['fx-shelfdetailclose', 'shelfDetailCloseDuration'], ['fx-shelfdetailrowtime', 'shelfDetailRowDuration'], ['fx-shelfdetailintro', 'shelfDetailIntroStrength'], ['fx-shelfdetailparallax', 'shelfDetailParallax'],
    ['fx-shelfsummonopen', 'shelfSummonOpenDuration'], ['fx-shelfsummonclose', 'shelfSummonCloseDuration'], ['fx-shelfsummonslide', 'shelfSummonSlide'], ['fx-shelfsummonstagger', 'shelfSummonStagger'], ['fx-shelfsummonscale', 'shelfSummonScale'], ['fx-shelfsummonparallax', 'shelfSummonParallax'],
    ['fx-shelfcamenter', 'shelfCameraEnterSpeed'], ['fx-shelfcamexit', 'shelfCameraExitSpeed'],
    ['fx-lyricspacing', 'lyricLetterSpacing'], ['fx-lyriclineheight', 'lyricLineHeight'], ['fx-lyricweight', 'lyricWeight'],
    ['fx-lyriccustomlines', 'lyricCustomLineCount'],
    ['fx-lyricglitchintensity', 'lyricGlitchIntensity'], ['fx-lyricglitchslice', 'lyricGlitchSlice'], ['fx-lyricglitchchroma', 'lyricGlitchChroma'], ['fx-lyricglitchrate', 'lyricGlitchRate'], ['fx-lyricglitchjitter', 'lyricGlitchJitter'],
    ['fx-lyriccontextopacity', 'lyricContextOpacity'], ['fx-lyriccontextspread', 'lyricContextSpread'], ['fx-lyrictranslationgap', 'lyricTranslationGap'], ['fx-lyrictranslationscale', 'lyricTranslationScale'], ['fx-lyrictranslationopacity', 'lyricTranslationOpacity'], ['fx-lyricedgefade', 'lyricEdgeFade'], ['fx-lyricmotionsoftness', 'lyricMotionSoftness'],
    ['fx-lyricscale', 'lyricScale'], ['fx-lyricx', 'lyricOffsetX'], ['fx-lyricy', 'lyricOffsetY'], ['fx-lyricz', 'lyricOffsetZ'], ['fx-lyrictiltx', 'lyricTiltX'], ['fx-lyrictilty', 'lyricTiltY'],
    ['fx-point', 'point'], ['fx-speed', 'speed'], ['fx-twist', 'twist'],
    ['fx-color', 'color'], ['fx-bloom', 'bloomStrength'], ['fx-scatter', 'scatter'], ['fx-bgfade', 'bgFade'],
  ];
  ids.forEach(function (pair) {
    var el = document.getElementById(pair[0]);
    if (!el) return;
    ensureFxSliderResetButton(pair[0], pair[1]);
    el.addEventListener('input', function () {
      fx[pair[1]] = parseFloat(el.value);
      var out = el.parentElement.querySelector('output');
      if (/^sonicGround/.test(pair[1])) fx[pair[1]] = Math.round(clampRange(fx[pair[1]], 0, 100));
      if (pair[1] === 'lyricBackgroundAdapt') fx.lyricBackgroundAdapt = clampRange(fx.lyricBackgroundAdapt, 0, 1);
      if (/^sonicWorkshop/.test(pair[1])) {
        if (pair[1] === 'sonicWorkshopInputGain') fx[pair[1]] = Math.round(clampRange(fx[pair[1]], 40, 100));
        else if (pair[1] === 'sonicWorkshopAudioIntensity') fx[pair[1]] = clampRange(fx[pair[1]], 0.3, 2.5);
        else if (pair[1] === 'sonicWorkshopResponseRange') fx[pair[1]] = clampRange(fx[pair[1]], 0.3, 2);
        else if (pair[1] === 'sonicWorkshopPeakIntensity') fx[pair[1]] = clampRange(fx[pair[1]], 0, 1.4);
      }
      if (/^sonicAudio/.test(pair[1])) {
        var maxAudioValue = pair[1] === 'sonicAudioBandStart' ? 510 : (pair[1] === 'sonicAudioBandEnd' ? 512 : 100);
        var minAudioValue = pair[1] === 'sonicAudioBandEnd' ? 2 : 0;
        fx[pair[1]] = Math.round(clampRange(fx[pair[1]], minAudioValue, maxAudioValue));
        if (typeof sonicAudioNormalizeFx === 'function') sonicAudioNormalizeFx(fx);
        el.value = fx[pair[1]];
      }
      if (pair[1] === 'coverResolution') {
        fx.coverResolution = normalizeCoverResolution(fx.coverResolution);
        applyCoverParticleResolution(fx.coverResolution, { reload: true });
      }
      if (pair[1] === 'lyricWeight') fx.lyricWeight = Math.round(clampRange(fx.lyricWeight, 500, 900) / 50) * 50;
      if (pair[1] === 'lyricCustomLineCount') {
        fx.lyricCustomLineCount = lyricCustomLineCountValue();
        fx.lyricDisplayMode = 'custom';
        updateLyricDisplayModeControls();
      }
      if (pair[1] === 'backgroundOpacity') {
        fx.backgroundOpacity = clampRange(fx.backgroundOpacity, 0, 1);
        fx.backgroundColorMode = 'custom';
        fx.backgroundColorCustom = true;
        updateCustomBackgroundControls();
      }
      if (pair[1] === 'backgroundMediaCropX' || pair[1] === 'backgroundMediaCropY') {
        fx[pair[1]] = Math.round(clampRange(fx[pair[1]], 0, 100));
        el.value = fx[pair[1]];
        updateCustomBackgroundControls();
      }
      if (pair[1] === 'backgroundMediaZoom') {
        fx.backgroundMediaZoom = clampRange(fx.backgroundMediaZoom, 1, 2.8);
        updateCustomBackgroundControls();
      }
      if (pair[1] === 'windowBackgroundOpacity') {
        fx.windowBackgroundOpacity = clampRange(fx.windowBackgroundOpacity, 0, 1);
        updateCustomBackgroundControls();
      }
      if (pair[1] === 'backgroundGlassOpacity') {
        fx.backgroundGlassOpacity = clampRange(fx.backgroundGlassOpacity, 0, 1);
        updateCustomBackgroundControls();
      }
      if (pair[1] === 'controlGlassChromaticOffset') {
        fx.controlGlassChromaticOffset = normalizeControlGlassChromaticOffset(fx.controlGlassChromaticOffset);
        applyControlGlassChromaticOffset();
      }
      if (pair[1] === 'playlistPanelGlassBlur') fx.playlistPanelGlassBlur = Math.round(clampRange(fx.playlistPanelGlassBlur, 14, 60));
      if (pair[1] === 'playlistPanelGlassDensity') fx.playlistPanelGlassDensity = clampRange(fx.playlistPanelGlassDensity, 0.55, 1);
      if (pair[1] === 'playlistPanelOpenDuration') fx.playlistPanelOpenDuration = clampRange(fx.playlistPanelOpenDuration, 0.08, 0.72);
      if (pair[1] === 'playlistPanelCloseDuration') fx.playlistPanelCloseDuration = clampRange(fx.playlistPanelCloseDuration, 0.06, 0.48);
      if (pair[1] === 'desktopLyricsSize') fx.desktopLyricsSize = clampRange(fx.desktopLyricsSize, 0.72, 1.55);
      if (pair[1] === 'desktopLyricsOpacity') fx.desktopLyricsOpacity = clampRange(fx.desktopLyricsOpacity, 0.28, 1);
      if (pair[1] === 'desktopLyricsY') fx.desktopLyricsY = clampRange(fx.desktopLyricsY, 0.08, 0.92);
      if (pair[1] === 'wallpaperOpacity') fx.wallpaperOpacity = clampRange(fx.wallpaperOpacity, 0.35, 1);
      if (pair[1] === 'shelfSize') fx.shelfSize = clampRange(fx.shelfSize, 0.65, 1.45);
      if (pair[1] === 'shelfOffsetX') fx.shelfOffsetX = clampRange(fx.shelfOffsetX, -1.2, 1.2);
      if (pair[1] === 'shelfOffsetY') fx.shelfOffsetY = clampRange(fx.shelfOffsetY, -0.9, 0.9);
      if (pair[1] === 'shelfOffsetZ') fx.shelfOffsetZ = clampRange(fx.shelfOffsetZ, -0.9, 0.9);
      if (pair[1] === 'shelfAngleY') {
        fx.shelfAngleYManual = true;
        fx.shelfAngleY = Math.round(clampRange(fx.shelfAngleY, -30, 30));
      }
      if (pair[1] === 'shelfOpacity') fx.shelfOpacity = clampRange(fx.shelfOpacity, 0.25, 1);
      if (pair[1] === 'shelfBgOpacity') fx.shelfBgOpacity = clampRange(fx.shelfBgOpacity, 0.25, 0.98);
      if (pair[1] === 'shelfDetailOffsetX') fx.shelfDetailOffsetX = clampRange(fx.shelfDetailOffsetX, -4.8, 4.8);
      if (pair[1] === 'shelfDetailOffsetY') fx.shelfDetailOffsetY = clampRange(fx.shelfDetailOffsetY, -3.6, 3.6);
      if (pair[1] === 'shelfDetailOffsetZ') fx.shelfDetailOffsetZ = clampRange(fx.shelfDetailOffsetZ, -3.6, 3.6);
      if (pair[1] === 'shelfDetailScale') fx.shelfDetailScale = clampRange(fx.shelfDetailScale, 0.72, 1.35);
      if (pair[1] === 'shelfDetailAngleX') fx.shelfDetailAngleX = Math.round(clampRange(fx.shelfDetailAngleX, -24, 24));
      if (pair[1] === 'shelfDetailAngleY') fx.shelfDetailAngleY = Math.round(clampRange(fx.shelfDetailAngleY, -28, 28));
      if (pair[1] === 'shelfDetailRowGap') fx.shelfDetailRowGap = clampRange(fx.shelfDetailRowGap, 0.72, 1.32);
      if (pair[1] === 'shelfDetailOpenDuration') fx.shelfDetailOpenDuration = clampRange(fx.shelfDetailOpenDuration, 0.12, 1.2);
      if (pair[1] === 'shelfDetailCloseDuration') fx.shelfDetailCloseDuration = clampRange(fx.shelfDetailCloseDuration, 0.08, 0.8);
      if (pair[1] === 'shelfDetailRowDuration') fx.shelfDetailRowDuration = clampRange(fx.shelfDetailRowDuration, 0.16, 1.6);
      if (pair[1] === 'shelfDetailIntroStrength') fx.shelfDetailIntroStrength = clampRange(fx.shelfDetailIntroStrength, 0, 1.8);
      if (pair[1] === 'shelfDetailParallax') fx.shelfDetailParallax = clampRange(fx.shelfDetailParallax, 0, 1.8);
      if (pair[1] === 'shelfSummonOpenDuration') fx.shelfSummonOpenDuration = clampRange(fx.shelfSummonOpenDuration, 0.08, 2);
      if (pair[1] === 'shelfSummonCloseDuration') fx.shelfSummonCloseDuration = clampRange(fx.shelfSummonCloseDuration, 0.08, 1.6);
      if (pair[1] === 'shelfSummonSlide') fx.shelfSummonSlide = clampRange(fx.shelfSummonSlide, 0, 4);
      if (pair[1] === 'shelfSummonStagger') fx.shelfSummonStagger = clampRange(fx.shelfSummonStagger, 0, 3);
      if (pair[1] === 'shelfSummonScale') fx.shelfSummonScale = clampRange(fx.shelfSummonScale, 0, 3);
      if (pair[1] === 'shelfSummonParallax') fx.shelfSummonParallax = clampRange(fx.shelfSummonParallax, 0, 2.5);
      if (pair[1] === 'shelfCameraEnterSpeed') fx.shelfCameraEnterSpeed = clampRange(fx.shelfCameraEnterSpeed, 0.2, 1.5);
      if (pair[1] === 'shelfCameraExitSpeed') fx.shelfCameraExitSpeed = clampRange(fx.shelfCameraExitSpeed, 0.2, 1.5);
      if (pair[1] === 'lyricOffsetX') fx.lyricOffsetX = clampRange(fx.lyricOffsetX, -4.0, 4.0);
      if (pair[1] === 'lyricOffsetY') fx.lyricOffsetY = clampRange(fx.lyricOffsetY, -2.4, 2.7);
      if (pair[1] === 'lyricOffsetZ') fx.lyricOffsetZ = clampRange(fx.lyricOffsetZ, -3.2, 3.2);
      if (pair[1] === 'lyricTiltX' || pair[1] === 'lyricTiltY') fx[pair[1]] = Math.round(clampRange(fx[pair[1]], -84, 84));
      if (pair[1] === 'lyricLineHeight') fx.lyricLineHeight = clampRange(fx.lyricLineHeight, 0.72, 1.80);
      if (pair[1] === 'lyricContextSpread') fx.lyricContextSpread = clampRange(fx.lyricContextSpread, 0.60, 2.40);
      if (pair[1] === 'lyricTranslationGap') fx.lyricTranslationGap = clampRange(fx.lyricTranslationGap, 0.28, 2.20);
      if (pair[1] === 'lyricTranslationScale') fx.lyricTranslationScale = clampRange(fx.lyricTranslationScale, 0.46, 1.12);
      if (pair[1] === 'lyricTranslationOpacity') fx.lyricTranslationOpacity = clampRange(fx.lyricTranslationOpacity, 0.20, 1);
      if (pair[1] === 'lyricGlitchJitter') fx.lyricGlitchJitter = clampRange(fx.lyricGlitchJitter, 0, 1.8);
      if (out) out.textContent = pair[1] === 'coverResolution'
        ? coverParticleCountLabel(fx.coverResolution)
        : (pair[1] === 'lyricWeight' || /^sonicGround/.test(pair[1]) || /^sonicAudio/.test(pair[1]) || pair[1] === 'sonicWorkshopInputGain' || pair[1] === 'controlGlassChromaticOffset' || pair[1] === 'playlistPanelGlassBlur' || pair[1] === 'backgroundMediaCropX' || pair[1] === 'backgroundMediaCropY' || pair[1] === 'lyricTiltX' || pair[1] === 'lyricTiltY' || pair[1] === 'shelfAngleY' || pair[1] === 'shelfDetailAngleX' || pair[1] === 'shelfDetailAngleY' ? String(Math.round(fx[pair[1]])) : Number(el.value).toFixed(pair[1] === 'lyricLetterSpacing' ? 3 : 2));
      if (typeof refreshSonicAudioMonitorUi === 'function' && /^sonicAudio/.test(pair[1])) refreshSonicAudioMonitorUi();
      if (/^sonicWorkshop/.test(pair[1]) && window.MineradioSonicWorkshop && typeof MineradioSonicWorkshop.pushProperties === 'function') MineradioSonicWorkshop.pushProperties(true);
      syncFxUniforms();
      if (/^playlistPanel/.test(pair[1])) applyPlaylistPanelFxSettings();
      if (/^shelf(Size|OffsetX|OffsetY|OffsetZ|AngleY|Opacity|BgOpacity|Detail|Summon|Camera)/.test(pair[1]) && shelfManager && shelfManager.refreshTheme) shelfManager.refreshTheme();
      syncLyricRealtimeFxChange(pair[1], { deferred: true });
      if (/^(desktopLyricsSize|desktopLyricsOpacity|desktopLyricsY)$/.test(pair[1])) pushDesktopLyricsState(true);
      if (pair[1] === 'wallpaperOpacity') pushWallpaperState(true);
      var saveOpts = { user: true, reason: /^backgroundMedia(CropX|CropY|Zoom)$/.test(pair[1]) ? 'backgroundMediaCrop' : pair[1] };
      if (pair[1] === 'controlGlassChromaticOffset') saveOpts.syncDisk = true;
      if (isStageLyricRealtimeFxKey(pair[1]) || isDesktopLyricRealtimeFxKey(pair[1])) scheduleLyricLayoutSave(360, saveOpts);
      else saveLyricLayout(saveOpts);
    });
  });
  var lyricPicker = document.getElementById('lyric-color-picker');
  if (lyricPicker) {
    lyricPicker.addEventListener('input', function () { setLyricColorCustom(lyricPicker.value, true); });
    lyricPicker.addEventListener('change', function () {
      setLyricColorCustom(lyricPicker.value, true);
      showToast('歌词颜色: ' + normalizeHexColor(lyricPicker.value).toUpperCase());
    });
  }
  var lyricHighlightPicker = document.getElementById('lyric-highlight-picker');
  if (lyricHighlightPicker) {
    lyricHighlightPicker.addEventListener('input', function () { setLyricHighlightCustom(lyricHighlightPicker.value, true); });
    lyricHighlightPicker.addEventListener('change', function () {
      setLyricHighlightCustom(lyricHighlightPicker.value, true);
      showToast('高亮颜色: ' + normalizeHexColor(lyricHighlightPicker.value).toUpperCase());
    });
  }
  var lyricGlowPicker = document.getElementById('lyric-glow-picker');
  if (lyricGlowPicker) {
    lyricGlowPicker.addEventListener('input', function () { setLyricGlowCustom(lyricGlowPicker.value, true); });
    lyricGlowPicker.addEventListener('change', function () {
      setLyricGlowCustom(lyricGlowPicker.value, true);
      showToast('溢光颜色: ' + normalizeHexColor(lyricGlowPicker.value).toUpperCase());
    });
  }
  var uiAccentPicker = document.getElementById('ui-accent-picker');
  if (uiAccentPicker) {
    uiAccentPicker.addEventListener('input', function () { setUiAccentColor(uiAccentPicker.value, true); });
    uiAccentPicker.addEventListener('change', function () {
      showToast('界面高亮: ' + normalizeHexColor(
        uiAccentPicker.value,
        fxDefaults.uiAccentColor || '#ffffff'
      ).toUpperCase());
    });
  }
  var visualTintPicker = document.getElementById('visual-tint-picker');
  if (visualTintPicker) {
    visualTintPicker.addEventListener('input', function () { setVisualTintCustom(visualTintPicker.value, true); });
    visualTintPicker.addEventListener('change', function () { showToast('视觉主色: ' + normalizeHexColor(visualTintPicker.value).toUpperCase()); });
  }
  [
    ['sonic-ground-base-picker', 'sonicGroundBaseColor'],
    ['sonic-ground-cool-picker', 'sonicGroundCoolColor'],
    ['sonic-ground-warm-picker', 'sonicGroundWarmColor'],
    ['sonic-ground-accent-picker', 'sonicGroundAccentColor']
  ].forEach(function (pair) {
    var picker = document.getElementById(pair[0]);
    if (!picker) return;
    picker.addEventListener('input', function () { setSonicGroundColor(pair[1], picker.value, true); });
    picker.addEventListener('change', function () { setSonicGroundColor(pair[1], picker.value); });
  });
  [
    ['sonic-workshop-cover-picker', 'theme'],
    ['sonic-workshop-base-picker', 'base'],
    ['sonic-workshop-warm-picker', 'warm'],
    ['sonic-workshop-cool-picker', 'cool'],
    ['sonic-workshop-ripple-picker', 'ripple'],
    ['sonic-workshop-peak-picker', 'peak']
  ].forEach(function (pair) {
    var picker = document.getElementById(pair[0]);
    if (!picker) return;
    picker.addEventListener('input', function () { setSonicWorkshopRegionColorFromPicker(pair[1], picker.value, true); });
    picker.addEventListener('change', function () { setSonicWorkshopRegionColorFromPicker(pair[1], picker.value); });
  });
  var homeAccentPicker = document.getElementById('home-accent-picker');
  if (homeAccentPicker) {
    homeAccentPicker.addEventListener('input', function () { setHomeAccentColor(homeAccentPicker.value, true); });
    homeAccentPicker.addEventListener('change', function () { showToast('Home 填充: ' + normalizeHexColor(homeAccentPicker.value).toUpperCase()); });
  }
  var homeIconPicker = document.getElementById('home-icon-picker');
  if (homeIconPicker) {
    homeIconPicker.addEventListener('input', function () { setHomeIconColor(homeIconPicker.value, true); });
    homeIconPicker.addEventListener('change', function () { showToast('主页图标: ' + normalizeHexColor(homeIconPicker.value, '#f4d28a').toUpperCase()); });
  }
  var visualIconPicker = document.getElementById('visual-icon-picker');
  if (visualIconPicker) {
    visualIconPicker.addEventListener('input', function () { setVisualIconColor(visualIconPicker.value, true); });
    visualIconPicker.addEventListener('change', function () { showToast('视觉图标: ' + normalizeHexColor(visualIconPicker.value, '#7fd8ff').toUpperCase()); });
  }
  var bgColorPicker = document.getElementById('bg-color-picker');
  if (bgColorPicker) {
    bgColorPicker.addEventListener('input', function () { setCustomBackgroundColor(bgColorPicker.value, true); });
    bgColorPicker.addEventListener('change', function () { showToast('背景颜色: ' + normalizeHexColor(bgColorPicker.value, '#000000').toUpperCase()); });
  }
  var shelfAccentPicker = document.getElementById('shelf-accent-picker');
  if (shelfAccentPicker) {
    shelfAccentPicker.addEventListener('input', function () { setShelfAccentColor(shelfAccentPicker.value, true); });
    shelfAccentPicker.addEventListener('change', function () { showToast('歌单架颜色: ' + shelfAccentHex().toUpperCase()); });
  }
  var bgImageInput = document.getElementById('background-image-input');
  if (bgImageInput) {
    bgImageInput.addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (file) readBackgroundMediaFile(file);
      e.target.value = '';
    });
  }
  ['ui-accent-picker', 'visual-tint-picker', 'sonic-ground-base-picker', 'sonic-ground-cool-picker', 'sonic-ground-warm-picker', 'sonic-ground-accent-picker', 'sonic-workshop-cover-picker', 'sonic-workshop-base-picker', 'sonic-workshop-warm-picker', 'sonic-workshop-cool-picker', 'sonic-workshop-ripple-picker', 'sonic-workshop-peak-picker', 'home-accent-picker', 'home-icon-picker', 'visual-icon-picker', 'bg-color-picker', 'shelf-accent-picker', 'lyric-color-picker', 'lyric-highlight-picker', 'lyric-glow-picker'].forEach(function (id) {
    bindColorLabPicker(document.getElementById(id));
  });
  bindColorLabRows();
  var sv = document.getElementById('color-lab-sv');
  if (sv && !sv._bound) {
    sv._bound = true;
    sv.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      colorLabState.dragging = true;
      sv.setPointerCapture && sv.setPointerCapture(e.pointerId);
      updateColorLabFromSv(e);
    });
    sv.addEventListener('pointermove', function (e) { if (colorLabState.dragging) updateColorLabFromSv(e); });
    sv.addEventListener('pointerup', function () {
      colorLabState.dragging = false;
      if (typeof commitColorLabValue === 'function') commitColorLabValue(true);
    });
    sv.addEventListener('pointercancel', function () {
      colorLabState.dragging = false;
      if (typeof commitColorLabValue === 'function') commitColorLabValue(true);
    });
  }
  var hue = document.getElementById('color-lab-hue');
  if (hue && !hue._bound) {
    hue._bound = true;
    hue.addEventListener('input', function () {
      colorLabState.h = clampRange(Number(hue.value) || 0, 0, 360) / 360;
      var hex = hsvToHex(colorLabState.h, colorLabState.s, colorLabState.v);
      syncColorLabUi(hex);
      applyColorLabValue(hex, true);
    });
  }
  var hexInput = document.getElementById('color-lab-hex');
  if (hexInput && !hexInput._bound) {
    hexInput._bound = true;
    hexInput.addEventListener('change', function () {
      var hex = normalizeHexColor(hexInput.value || '#000000', '#000000');
      syncColorLabUi(hex);
      applyColorLabValue(hex);
    });
  }
  var presets = document.getElementById('color-lab-presets');
  if (presets && !presets._bound) {
    presets._bound = true;
    presets.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-color]') : null;
      if (!btn) return;
      var hex = normalizeHexColor(btn.getAttribute('data-color') || '#000000', '#000000');
      syncColorLabUi(hex);
      applyColorLabValue(hex);
    });
  }
  if (!document._colorLabOutsideBound) {
    document._colorLabOutsideBound = true;
    document.addEventListener('mousedown', function (e) {
      var pop = document.getElementById('color-lab-pop');
      if (!pop || !pop.classList.contains('show')) return;
      if (e.target && (e.target.closest('#color-lab-pop') || e.target.closest('.lyric-color-picker') || e.target.closest('.lyric-color-row'))) return;
      closeColorLab();
    }, true);
    document.addEventListener('mousedown', function (e) {
      var pop = document.getElementById('cover-color-pop');
      if (!pop || !pop.classList.contains('show')) return;
      if (e.target && (e.target.closest('#cover-color-pop') || e.target.closest('#visual-tint-auto-btn'))) return;
      closeCoverColorPicker();
    }, true);
  }
  // 三态
  document.querySelectorAll('#shelf-seg button').forEach(function (b) {
    b.addEventListener('click', function () { setShelfMode(b.dataset.shelf); });
  });
  document.querySelectorAll('#shelf-camera-seg [data-shelf-camera]').forEach(function (b) {
    b.addEventListener('click', function () { setShelfCameraMode(b.getAttribute('data-shelf-camera')); });
  });
  document.querySelectorAll('#shelf-presence-seg [data-shelf-presence]').forEach(function (b) {
    b.addEventListener('click', function () { setShelfPresence(b.getAttribute('data-shelf-presence')); });
  });
  document.querySelectorAll('#cam-seg button').forEach(function (b) {
    b.addEventListener('click', function () { setCamMode(b.dataset.cam); });
  });
  document.querySelectorAll('#desktop-lyrics-fps-seg [data-desktop-lyrics-fps]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      fx.desktopLyricsFps = normalizeDesktopLyricsFps(btn.getAttribute('data-desktop-lyrics-fps'));
      updateDesktopLyricsFpsControls();
      saveLyricLayout({ user: true, reason: 'desktopLyricsFps' });
      pushDesktopLyricsState(true);
      showToast(fx.desktopLyricsFps ? ('桌面歌词帧数 ' + fx.desktopLyricsFps) : '桌面歌词帧数无上限');
    });
  });
  document.querySelectorAll('#wallpaper-fps-seg [data-wallpaper-fps]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      fx.wallpaperFps = normalizeWallpaperFps(btn.getAttribute('data-wallpaper-fps'));
      updateWallpaperFpsControls();
      saveLyricLayout({ user: true, reason: 'wallpaperFps' });
      if (fx.wallpaperMode) pushWallpaperState(true);
      showToast('壁纸帧数 ' + fx.wallpaperFps);
    });
  });
  document.querySelectorAll('#performance-background-seg [data-performance-background]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      setPerformanceBackgroundMode(btn.getAttribute('data-performance-background'));
    });
  });
  document.querySelectorAll('#performance-quality-seg [data-performance-quality]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      setPerformanceQualityMode(btn.getAttribute('data-performance-quality'));
    });
  });
  document.querySelectorAll('#foreground-fps-seg [data-foreground-fps]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      setForegroundFpsMode(btn.getAttribute('data-foreground-fps'));
    });
  });
  updateFxInputs();
  if (typeof initFxConsoleSearchAndHistory === 'function') initFxConsoleSearchAndHistory();
}
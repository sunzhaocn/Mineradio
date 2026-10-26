'use strict';


function defaultUserFxArchiveName(index) {
  return '存档 ' + (index + 1);
}

function normalizeUserFxArchiveName(name, index) {
  name = String(name || '').replace(/\s+/g, ' ').trim();
  if (!name) name = defaultUserFxArchiveName(index);
  return name.slice(0, 18);
}

function archiveNumber(raw, key, fallback, min, max) {
  var value = raw && raw[key] != null ? Number(raw[key]) : fallback;
  if (!isFinite(value)) value = fallback;
  return clampRange(value, min, max);
}

function archiveMode(raw, key, pattern, fallback) {
  var value = String(raw && raw[key] != null ? raw[key] : fallback);
  return pattern.test(value) ? value : fallback;
}

function archiveHasCameraState(raw) {
  if (!raw || typeof raw !== 'object') return false;
  if (raw.cameraViewSaved === true) return true;
  var keys = [
    'cameraViewMode',
    'cameraOrbitTheta',
    'cameraOrbitPhi',
    'cameraOrbitRadius',
    'cameraFreePositionX',
    'cameraFreePositionY',
    'cameraFreePositionZ',
    'cameraFreeYaw',
    'cameraFreePitch',
    'cameraFreeRoll',
    'cameraFreeFov'
  ];
  return keys.some(function (key) { return raw[key] != null; });
}

function archiveHasVisualRotationState(raw) {
  if (!raw || typeof raw !== 'object') return false;
  return raw.visualRotationSaved === true || raw.visualRotationX != null || raw.visualRotationY != null;
}

function isCameraArchiveKey(key) {
  return /^camera(View|Orbit|Free)/.test(String(key || '')) || /^visualRotation/.test(String(key || ''));
}

function normalizeFxArchiveSnapshot(raw) {
  if (!raw || typeof raw !== 'object') return null;
  var savedPreset = clampRange(Number(raw.preset) || 0, 0, presetMeta.length - 1);
  if (savedPreset === 3 && raw.visualPresetSchema !== VISUAL_PRESET_SCHEMA) savedPreset = 5;
  var archiveShelfMode = archiveMode(raw, 'shelf', /^(off|side|stage)$/, fxDefaults.shelf);
  var archiveShelfPresence = archiveShelfMode === 'off' ? 'auto' : archiveMode(raw, 'shelfPresence', /^(auto|always)$/, fxDefaults.shelfPresence);
  var archiveShelfPinnedOpen = archiveShelfMode === 'side' && archiveShelfPresence === 'always' && raw.shelfPinnedOpen === true;
  var archiveCameraSaved = archiveHasCameraState(raw);
  var archiveVisualRotationSaved = archiveHasVisualRotationState(raw);
  return {
    visualPresetSchema: VISUAL_PRESET_SCHEMA,
    preset: savedPreset,
    intensity: archiveNumber(raw, 'intensity', fxDefaults.intensity, 0.2, 1.6),
    cinemaShake: archiveNumber(raw, 'cinemaShake', fxDefaults.cinemaShake, 0, 1.8),
    depth: archiveNumber(raw, 'depth', fxDefaults.depth, 0.2, 1.8),
    coverResolution: normalizeCoverResolution(raw.coverResolution),
    point: archiveNumber(raw, 'point', fxDefaults.point, 0.5, 2.2),
    speed: archiveNumber(raw, 'speed', fxDefaults.speed, 0.2, 2.5),
    twist: archiveNumber(raw, 'twist', fxDefaults.twist, 0, 0.6),
    color: archiveNumber(raw, 'color', fxDefaults.color, 0.5, 2.0),
    scatter: archiveNumber(raw, 'scatter', fxDefaults.scatter, 0, 0.5),
    bgFade: archiveNumber(raw, 'bgFade', fxDefaults.bgFade, 0, 1.2),
    bloomStrength: archiveNumber(raw, 'bloomStrength', fxDefaults.bloomStrength, 0, 1.6),
    lyricGlowStrength: archiveNumber(raw, 'lyricGlowStrength', fxDefaults.lyricGlowStrength, 0, 0.85),
    lyricBackgroundAdapt: archiveNumber(raw, 'lyricBackgroundAdapt', fxDefaults.lyricBackgroundAdapt, 0, 1),
    lyricScale: archiveNumber(raw, 'lyricScale', fxDefaults.lyricScale, 0.35, 1.65),
    lyricOffsetX: archiveNumber(raw, 'lyricOffsetX', fxDefaults.lyricOffsetX, -4.0, 4.0),
    lyricOffsetY: archiveNumber(raw, 'lyricOffsetY', fxDefaults.lyricOffsetY, -2.4, 2.7),
    lyricOffsetZ: archiveNumber(raw, 'lyricOffsetZ', fxDefaults.lyricOffsetZ, -3.2, 3.2),
    lyricTiltX: archiveNumber(raw, 'lyricTiltX', fxDefaults.lyricTiltX, -84, 84),
    lyricTiltY: archiveNumber(raw, 'lyricTiltY', fxDefaults.lyricTiltY, -84, 84),
    lyricCameraLock: !!raw.lyricCameraLock,
    lyricColorMode: raw.lyricColorMode === 'custom' ? 'custom' : 'auto',
    lyricColor: normalizeHexColor(raw.lyricColor || fxDefaults.lyricColor),
    lyricHighlightMode: raw.lyricHighlightMode === 'custom' ? 'custom' : 'auto',
    lyricHighlightColor: normalizeHexColor(raw.lyricHighlightColor || fxDefaults.lyricHighlightColor),
    lyricGlowLinked: raw.lyricGlowLinked !== false,
    lyricGlowColor: normalizeHexColor(raw.lyricGlowColor || fxDefaults.lyricGlowColor),
    lyricDisplayMode: normalizeLyricDisplayMode(raw.lyricDisplayMode || fxDefaults.lyricDisplayMode),
    lyricTranslationMode: normalizeLyricTranslationMode(raw.lyricTranslationMode || fxDefaults.lyricTranslationMode),
    lyricMotionStyle: normalizeLyricMotionStyle(raw.lyricMotionStyle || fxDefaults.lyricMotionStyle),
    lyricCustomLineCount: archiveNumber(raw, 'lyricCustomLineCount', fxDefaults.lyricCustomLineCount, 1, 10),
    lyricGlitchCameraBind: !!raw.lyricGlitchCameraBind,
    lyricGlitchIntensity: archiveNumber(raw, 'lyricGlitchIntensity', fxDefaults.lyricGlitchIntensity, 0, 1.5),
    lyricGlitchSlice: archiveNumber(raw, 'lyricGlitchSlice', fxDefaults.lyricGlitchSlice, 0, 1.4),
    lyricGlitchChroma: archiveNumber(raw, 'lyricGlitchChroma', fxDefaults.lyricGlitchChroma, 0, 1.6),
    lyricGlitchRate: archiveNumber(raw, 'lyricGlitchRate', fxDefaults.lyricGlitchRate, 0.45, 2.2),
    lyricGlitchJitter: archiveNumber(raw, 'lyricGlitchJitter', fxDefaults.lyricGlitchJitter, 0, 1.8),
    lyricContextOpacity: archiveNumber(raw, 'lyricContextOpacity', fxDefaults.lyricContextOpacity, 0.25, 1),
    lyricContextSpread: archiveNumber(raw, 'lyricContextSpread', fxDefaults.lyricContextSpread, 0.60, 2.40),
    lyricTranslationGap: archiveNumber(raw, 'lyricTranslationGap', fxDefaults.lyricTranslationGap, 0.28, 2.20),
    lyricTranslationScale: archiveNumber(raw, 'lyricTranslationScale', fxDefaults.lyricTranslationScale, 0.46, 1.12),
    lyricTranslationOpacity: archiveNumber(raw, 'lyricTranslationOpacity', fxDefaults.lyricTranslationOpacity, 0.20, 1),
    lyricEdgeFade: archiveNumber(raw, 'lyricEdgeFade', fxDefaults.lyricEdgeFade, 0, 1),
    lyricMotionSoftness: archiveNumber(raw, 'lyricMotionSoftness', fxDefaults.lyricMotionSoftness, 0.15, 1.2),
    lyricFont: normalizeLyricFontKey(raw.lyricFont),
    lyricLetterSpacing: archiveNumber(raw, 'lyricLetterSpacing', fxDefaults.lyricLetterSpacing, -0.04, 0.18),
    lyricLineHeight: archiveNumber(raw, 'lyricLineHeight', fxDefaults.lyricLineHeight, 0.72, 1.80),
    lyricWeight: archiveNumber(raw, 'lyricWeight', fxDefaults.lyricWeight, 500, 900),
    lyricTextureClarity: normalizeLyricTextureClarity(raw.lyricTextureClarity),
    lyricLiveViewportFit: raw.lyricLiveViewportFit !== false,
    lyricContextHighQuality: raw.lyricContextHighQuality !== false,
    lyricBackdropAdapt: raw.lyricBackdropAdapt !== false,
    coverBackdropAdapt: raw.coverBackdropAdapt !== false,
    visualTintMode: raw.visualTintMode === 'custom' ? 'custom' : 'auto',
    visualTintColor: normalizeHexColor(raw.visualTintColor || fxDefaults.visualTintColor),
    uiAccentColor: normalizeHexColor(raw.uiAccentColor || fxDefaults.uiAccentColor, fxDefaults.uiAccentColor),
    homeAccentColor: normalizeHexColor(raw.homeAccentColor || fxDefaults.homeAccentColor, fxDefaults.homeAccentColor),
    homeIconColor: normalizeHexColor(raw.homeIconColor || fxDefaults.homeIconColor, fxDefaults.homeIconColor),
    visualIconColor: normalizeHexColor(raw.visualIconColor || fxDefaults.visualIconColor, fxDefaults.visualIconColor),
    backgroundColorMode: raw.backgroundColorMode === 'custom' || raw.backgroundColorCustom ? 'custom' : 'cover',
    backgroundColor: normalizeHexColor(raw.backgroundColor || fxDefaults.backgroundColor, fxDefaults.backgroundColor),
    backgroundOpacity: archiveNumber(raw, 'backgroundOpacity', fxDefaults.backgroundOpacity, 0, 1),
    backgroundAlbumCover: raw.backgroundAlbumCover === true,
    backgroundMediaCropX: archiveNumber(raw, 'backgroundMediaCropX', fxDefaults.backgroundMediaCropX, 0, 100),
    backgroundMediaCropY: archiveNumber(raw, 'backgroundMediaCropY', fxDefaults.backgroundMediaCropY, 0, 100),
    backgroundMediaZoom: archiveNumber(raw, 'backgroundMediaZoom', fxDefaults.backgroundMediaZoom, 1, 2.8),
    windowBackgroundOpacity: archiveNumber(raw, 'windowBackgroundOpacity', fxDefaults.windowBackgroundOpacity, 0, 1),
    backgroundGlassOpacity: archiveNumber(raw, 'backgroundGlassOpacity', fxDefaults.backgroundGlassOpacity, 0, 1),
    controlGlassChromaticOffset: archiveNumber(raw, 'controlGlassChromaticOffset', fxDefaults.controlGlassChromaticOffset, 30, 140),
    playlistPanelGlassBlur: archiveNumber(raw, 'playlistPanelGlassBlur', fxDefaults.playlistPanelGlassBlur, 14, 60),
    playlistPanelGlassDensity: archiveNumber(raw, 'playlistPanelGlassDensity', fxDefaults.playlistPanelGlassDensity, 0.55, 1),
    playlistPanelOpenDuration: archiveNumber(raw, 'playlistPanelOpenDuration', fxDefaults.playlistPanelOpenDuration, 0.08, 0.72),
    playlistPanelCloseDuration: archiveNumber(raw, 'playlistPanelCloseDuration', fxDefaults.playlistPanelCloseDuration, 0.06, 0.48),
    backgroundColorCustom: raw.backgroundColorMode === 'custom' || !!raw.backgroundColorCustom,
    floatLayer: !!raw.floatLayer,
    cinema: raw.cinema !== false,
    edge: !!raw.edge,
    aiDepth: !!raw.aiDepth,
    bloom: !!raw.bloom,
    lyricGlow: raw.lyricGlow !== false,
    lyricGlowBeat: raw.lyricGlowBeat !== false,
    lyricGlowParticles: !!raw.lyricGlowParticles,
    lyricVerticalFloat: raw.lyricVerticalFloat !== false,
    backgroundStarRiver: raw.backgroundStarRiver !== false,
    lyricPauseHold: raw.lyricPauseHold !== false,
    desktopLyrics: !!raw.desktopLyrics,
    desktopLyricsSize: archiveNumber(raw, 'desktopLyricsSize', fxDefaults.desktopLyricsSize, 0.72, 1.55),
    desktopLyricsOpacity: archiveNumber(raw, 'desktopLyricsOpacity', fxDefaults.desktopLyricsOpacity, 0.28, 1),
    desktopLyricsY: archiveNumber(raw, 'desktopLyricsY', fxDefaults.desktopLyricsY, 0.08, 0.92),
    desktopLyricsClickThrough: raw.desktopLyricsClickThrough === true,
    desktopLyricsCinema: raw.desktopLyricsCinema !== false,
    desktopLyricsHighlight: raw.desktopLyricsHighlight === true,
    desktopLyricsFps: normalizeDesktopLyricsFps(Object.prototype.hasOwnProperty.call(raw, 'desktopLyricsFps') ? raw.desktopLyricsFps : fxDefaults.desktopLyricsFps),
    performanceBackground: normalizePerformanceBackgroundMode(raw.performanceBackground, raw.liveBackgroundKeep === true),
    performanceQuality: normalizePerformanceQuality(raw.performanceQuality),
    foregroundFpsMode: normalizeForegroundFpsMode(raw.foregroundFpsMode === 'adaptive' ? 'vsync' : raw.foregroundFpsMode),
    memoryAutoTrimApp: raw.memoryAutoTrimApp !== false,
    memoryAutoTrimOnBackground: raw.memoryAutoTrimOnBackground !== false,
    memoryAutoSystemTrim: raw.memoryAutoSystemTrim === true,
    memorySystemAutoElevate: raw.memorySystemAutoElevate === true,
    memorySystemIntervalMin: archiveNumber(raw, 'memorySystemIntervalMin', fxDefaults.memorySystemIntervalMin, 5, 180),
    memorySystemThresholdPercent: archiveNumber(raw, 'memorySystemThresholdPercent', fxDefaults.memorySystemThresholdPercent, 50, 98),
    memorySystemMask: archiveNumber(raw, 'memorySystemMask', fxDefaults.memorySystemMask, 1, 29),
    memorySafetyRevision: fxDefaults.memorySafetyRevision,
    liveBackgroundKeep: normalizePerformanceBackgroundMode(raw.performanceBackground, raw.liveBackgroundKeep === true) === 'keep',
    sonicGroundAmplitude: archiveNumber(raw, 'sonicGroundAmplitude', fxDefaults.sonicGroundAmplitude, 0, 100),
    sonicGroundMotionSpeed: archiveNumber(raw, 'sonicGroundMotionSpeed', fxDefaults.sonicGroundMotionSpeed, 0, 100),
    sonicGroundDensity: archiveNumber(raw, 'sonicGroundDensity', fxDefaults.sonicGroundDensity, 0, 100),
    sonicGroundRange: archiveNumber(raw, 'sonicGroundRange', fxDefaults.sonicGroundRange, 0, 100),
    sonicGroundLower: archiveNumber(raw, 'sonicGroundLower', fxDefaults.sonicGroundLower, 0, 100),
    sonicGroundDepth: archiveNumber(raw, 'sonicGroundDepth', fxDefaults.sonicGroundDepth, 0, 100),
    sonicGroundAutoRotate: archiveNumber(raw, 'sonicGroundAutoRotate', fxDefaults.sonicGroundAutoRotate, 0, 100),
    sonicGroundColorMode: raw.sonicGroundColorMode === 'custom' ? 'custom' : 'cover',
    sonicGroundBaseColor: normalizeHexColor(raw.sonicGroundBaseColor || fxDefaults.sonicGroundBaseColor, fxDefaults.sonicGroundBaseColor),
    sonicGroundCoolColor: normalizeHexColor(raw.sonicGroundCoolColor || fxDefaults.sonicGroundCoolColor, fxDefaults.sonicGroundCoolColor),
    sonicGroundWarmColor: normalizeHexColor(raw.sonicGroundWarmColor || fxDefaults.sonicGroundWarmColor, fxDefaults.sonicGroundWarmColor),
    sonicGroundAccentColor: normalizeHexColor(raw.sonicGroundAccentColor || fxDefaults.sonicGroundAccentColor, fxDefaults.sonicGroundAccentColor),
    sonicGroundGlow: archiveNumber(raw, 'sonicGroundGlow', fxDefaults.sonicGroundGlow, 0, 100),
    sonicGroundSubBass: archiveNumber(raw, 'sonicGroundSubBass', fxDefaults.sonicGroundSubBass, 0, 100),
    sonicGroundBass: archiveNumber(raw, 'sonicGroundBass', fxDefaults.sonicGroundBass, 0, 100),
    sonicGroundLowMid: archiveNumber(raw, 'sonicGroundLowMid', fxDefaults.sonicGroundLowMid, 0, 100),
    sonicGroundMid: archiveNumber(raw, 'sonicGroundMid', fxDefaults.sonicGroundMid, 0, 100),
    sonicGroundHighMid: archiveNumber(raw, 'sonicGroundHighMid', fxDefaults.sonicGroundHighMid, 0, 100),
    sonicGroundPresence: archiveNumber(raw, 'sonicGroundPresence', fxDefaults.sonicGroundPresence, 0, 100),
    sonicGroundBrilliance: archiveNumber(raw, 'sonicGroundBrilliance', fxDefaults.sonicGroundBrilliance, 0, 100),
    sonicGroundAir: archiveNumber(raw, 'sonicGroundAir', fxDefaults.sonicGroundAir, 0, 100),
    sonicGroundFloatingEnabled: raw.sonicGroundFloatingEnabled !== false,
    sonicGroundFloatingIntensity: archiveNumber(raw, 'sonicGroundFloatingIntensity', fxDefaults.sonicGroundFloatingIntensity, 0, 100),
    sonicGroundFloatingMinSize: archiveNumber(raw, 'sonicGroundFloatingMinSize', fxDefaults.sonicGroundFloatingMinSize, 0, 100),
    sonicGroundFloatingMaxSize: archiveNumber(raw, 'sonicGroundFloatingMaxSize', fxDefaults.sonicGroundFloatingMaxSize, 0, 100),
    sonicGroundFloatingSpeed: archiveNumber(raw, 'sonicGroundFloatingSpeed', fxDefaults.sonicGroundFloatingSpeed, 0, 100),
    sonicGroundFloatingCount: archiveNumber(raw, 'sonicGroundFloatingCount', fxDefaults.sonicGroundFloatingCount, 0, 100),
    sonicAudioMonitorEnabled: raw.sonicAudioMonitorEnabled !== false,
    sonicAudioAutoTrack: raw.sonicAudioAutoTrack !== false,
    sonicAudioSensitivity: archiveNumber(raw, 'sonicAudioSensitivity', fxDefaults.sonicAudioSensitivity, 0, 100),
    sonicAudioBandStart: archiveNumber(raw, 'sonicAudioBandStart', fxDefaults.sonicAudioBandStart, 0, 510),
    sonicAudioBandEnd: archiveNumber(raw, 'sonicAudioBandEnd', fxDefaults.sonicAudioBandEnd, 2, 512),
    sonicAudioThreshold: archiveNumber(raw, 'sonicAudioThreshold', fxDefaults.sonicAudioThreshold, 0, 100),
    sonicAudioPulseStrength: archiveNumber(raw, 'sonicAudioPulseStrength', fxDefaults.sonicAudioPulseStrength, 0, 100),
    sonicWorkshopInputGain: archiveNumber(raw, 'sonicWorkshopInputGain', fxDefaults.sonicWorkshopInputGain, 40, 100),
    sonicWorkshopAudioIntensity: archiveNumber(raw, 'sonicWorkshopAudioIntensity', fxDefaults.sonicWorkshopAudioIntensity, 0.3, 2.5),
    sonicWorkshopResponseRange: archiveNumber(raw, 'sonicWorkshopResponseRange', fxDefaults.sonicWorkshopResponseRange, 0.3, 2),
    sonicWorkshopPeakIntensity: archiveNumber(raw, 'sonicWorkshopPeakIntensity', fxDefaults.sonicWorkshopPeakIntensity, 0, 1.4),
    sonicWorkshopColorMode: raw.sonicWorkshopColorMode === 'custom' ? 'custom' : 'cover',
    sonicWorkshopTheme: archiveMode(raw, 'sonicWorkshopTheme', /^(coral-mirage|ocean-deep|arctic-blue|arctic-aurora|emerald-forest|cyber-forest|minimal-mono|minimal-monochrome|neon-tokyo|golden-hour|ember-fire|crimson|crimson-sunset|aurora|violet-dream)$/, fxDefaults.sonicWorkshopTheme),
    sonicWorkshopCustomColor: normalizeHexColor(raw.sonicWorkshopCustomColor || fxDefaults.sonicWorkshopCustomColor || '#cb6c89', fxDefaults.sonicWorkshopCustomColor || '#cb6c89'),
    sonicWorkshopBaseColorMode: raw.sonicWorkshopBaseColorMode === 'custom' ? 'custom' : 'cover',
    sonicWorkshopBaseColor: normalizeHexColor(raw.sonicWorkshopBaseColor || fxDefaults.sonicWorkshopBaseColor || '#16060f', fxDefaults.sonicWorkshopBaseColor || '#16060f'),
    sonicWorkshopWarmColorMode: raw.sonicWorkshopWarmColorMode === 'custom' ? 'custom' : 'cover',
    sonicWorkshopWarmColor: normalizeHexColor(raw.sonicWorkshopWarmColor || fxDefaults.sonicWorkshopWarmColor || '#cb6c89', fxDefaults.sonicWorkshopWarmColor || '#cb6c89'),
    sonicWorkshopCoolColorMode: raw.sonicWorkshopCoolColorMode === 'custom' ? 'custom' : 'cover',
    sonicWorkshopCoolColor: normalizeHexColor(raw.sonicWorkshopCoolColor || fxDefaults.sonicWorkshopCoolColor || '#99c4ff', fxDefaults.sonicWorkshopCoolColor || '#99c4ff'),
    sonicWorkshopRippleColorMode: raw.sonicWorkshopRippleColorMode === 'custom' ? 'custom' : 'cover',
    sonicWorkshopRippleColor: normalizeHexColor(raw.sonicWorkshopRippleColor || fxDefaults.sonicWorkshopRippleColor || '#f8d8ff', fxDefaults.sonicWorkshopRippleColor || '#f8d8ff'),
    sonicWorkshopPeakColorMode: raw.sonicWorkshopPeakColorMode === 'custom' ? 'custom' : 'cover',
    sonicWorkshopPeakColor: normalizeHexColor(raw.sonicWorkshopPeakColor || fxDefaults.sonicWorkshopPeakColor || '#99c4ff', fxDefaults.sonicWorkshopPeakColor || '#99c4ff'),
    particleLyrics: raw.particleLyrics !== false,
    backCover: !!raw.backCover,
    shelf: archiveShelfMode,
    shelfPinnedOpen: archiveShelfPinnedOpen,
    shelfCameraMode: archiveMode(raw, 'shelfCameraMode', /^(dynamic|static)$/, fxDefaults.shelfCameraMode),
    shelfPresence: archiveShelfPresence,
    shelfShowPodcasts: raw.shelfShowPodcasts !== false,
    shelfMergeCollections: raw.shelfMergeCollections === true,
    shelfSize: archiveNumber(raw, 'shelfSize', fxDefaults.shelfSize, 0.65, 1.45),
    shelfOffsetX: archiveNumber(raw, 'shelfOffsetX', fxDefaults.shelfOffsetX, -1.2, 1.2),
    shelfOffsetY: archiveNumber(raw, 'shelfOffsetY', fxDefaults.shelfOffsetY, -0.9, 0.9),
    shelfOffsetZ: archiveNumber(raw, 'shelfOffsetZ', fxDefaults.shelfOffsetZ, -0.9, 0.9),
    shelfAngleY: archiveNumber(raw, 'shelfAngleY', fxDefaults.shelfAngleY, -30, 30),
    shelfAngleYManual: raw.shelfAngleYManual === true,
    shelfOpacity: archiveNumber(raw, 'shelfOpacity', fxDefaults.shelfOpacity, 0.25, 1),
    shelfBgOpacity: archiveNumber(raw, 'shelfBgOpacity', fxDefaults.shelfBgOpacity, 0.25, 0.98),
    shelfAccentColor: normalizeHexColor(raw.shelfAccentColor || fxDefaults.shelfAccentColor, fxDefaults.shelfAccentColor),
    shelfDetailOffsetX: archiveNumber(raw, 'shelfDetailOffsetX', fxDefaults.shelfDetailOffsetX, -4.8, 4.8),
    shelfDetailOffsetY: archiveNumber(raw, 'shelfDetailOffsetY', fxDefaults.shelfDetailOffsetY, -3.6, 3.6),
    shelfDetailOffsetZ: archiveNumber(raw, 'shelfDetailOffsetZ', fxDefaults.shelfDetailOffsetZ, -3.6, 3.6),
    shelfDetailScale: archiveNumber(raw, 'shelfDetailScale', fxDefaults.shelfDetailScale, 0.72, 1.35),
    shelfDetailAngleX: archiveNumber(raw, 'shelfDetailAngleX', fxDefaults.shelfDetailAngleX, -24, 24),
    shelfDetailAngleY: archiveNumber(raw, 'shelfDetailAngleY', fxDefaults.shelfDetailAngleY, -28, 28),
    shelfDetailRowGap: archiveNumber(raw, 'shelfDetailRowGap', fxDefaults.shelfDetailRowGap, 0.72, 1.32),
    shelfDetailOpenDuration: archiveNumber(raw, 'shelfDetailOpenDuration', fxDefaults.shelfDetailOpenDuration, 0.12, 1.2),
    shelfDetailCloseDuration: archiveNumber(raw, 'shelfDetailCloseDuration', fxDefaults.shelfDetailCloseDuration, 0.08, 0.8),
    shelfDetailRowDuration: archiveNumber(raw, 'shelfDetailRowDuration', fxDefaults.shelfDetailRowDuration, 0.16, 1.6),
    shelfDetailIntroStrength: archiveNumber(raw, 'shelfDetailIntroStrength', fxDefaults.shelfDetailIntroStrength, 0, 1.8),
    shelfDetailParallax: archiveNumber(raw, 'shelfDetailParallax', fxDefaults.shelfDetailParallax, 0, 1.8),
    shelfSummonOpenDuration: archiveNumber(raw, 'shelfSummonOpenDuration', fxDefaults.shelfSummonOpenDuration, 0.08, 2),
    shelfSummonCloseDuration: archiveNumber(raw, 'shelfSummonCloseDuration', fxDefaults.shelfSummonCloseDuration, 0.08, 1.6),
    shelfSummonSlide: archiveNumber(raw, 'shelfSummonSlide', fxDefaults.shelfSummonSlide, 0, 4),
    shelfSummonStagger: archiveNumber(raw, 'shelfSummonStagger', fxDefaults.shelfSummonStagger, 0, 3),
    shelfSummonScale: archiveNumber(raw, 'shelfSummonScale', fxDefaults.shelfSummonScale, 0, 3),
    shelfSummonParallax: archiveNumber(raw, 'shelfSummonParallax', fxDefaults.shelfSummonParallax, 0, 2.5),
    shelfCameraEnterSpeed: archiveNumber(raw, 'shelfCameraEnterSpeed', fxDefaults.shelfCameraEnterSpeed, 0.2, 1.5),
    shelfCameraExitSpeed: archiveNumber(raw, 'shelfCameraExitSpeed', fxDefaults.shelfCameraExitSpeed, 0.2, 1.5),
    cam: archiveMode(raw, 'cam', /^(off|gesture)$/, fxDefaults.cam),
    gesturePlayerActions: raw.gesturePlayerActions !== false,
    gestureHandOverlay: raw.gestureHandOverlay !== false,
    gestureSensitivity: archiveMode(raw, 'gestureSensitivity', /^(steady|balanced|quick)$/, fxDefaults.gestureSensitivity),
    cameraViewSaved: archiveCameraSaved,
    cameraViewMode: archiveMode(raw, 'cameraViewMode', /^(orbit|free)$/, 'orbit'),
    cameraOrbitTheta: archiveNumber(raw, 'cameraOrbitTheta', 0, -Math.PI * 8, Math.PI * 8),
    cameraOrbitPhi: archiveNumber(raw, 'cameraOrbitPhi', 0.08, -Math.PI * 0.45, Math.PI * 0.45),
    cameraOrbitRadius: archiveNumber(raw, 'cameraOrbitRadius', 6.6, 2.4, 14.0),
    cameraFreePositionX: archiveNumber(raw, 'cameraFreePositionX', 0, -80, 80),
    cameraFreePositionY: archiveNumber(raw, 'cameraFreePositionY', 0, -80, 80),
    cameraFreePositionZ: archiveNumber(raw, 'cameraFreePositionZ', 6.6, -80, 80),
    cameraFreeYaw: archiveNumber(raw, 'cameraFreeYaw', 0, -Math.PI * 8, Math.PI * 8),
    cameraFreePitch: archiveNumber(raw, 'cameraFreePitch', 0, -Math.PI * 0.49, Math.PI * 0.49),
    cameraFreeRoll: archiveNumber(raw, 'cameraFreeRoll', 0, -Math.PI, Math.PI),
    cameraFreeFov: archiveNumber(raw, 'cameraFreeFov', BASE_FOV, 26, 72),
    visualRotationSaved: archiveVisualRotationSaved,
    visualRotationX: archiveNumber(raw, 'visualRotationX', 0, -Math.PI * 8, Math.PI * 8),
    visualRotationY: archiveNumber(raw, 'visualRotationY', 0, -Math.PI * 8, Math.PI * 8)
  };
}

function readUserFxArchives() {
  var raw = [];
  try {
    raw = JSON.parse(localStorage.getItem(USER_FX_ARCHIVE_STORE_KEY) || '[]') || [];
  } catch (e) {
    raw = [];
  }
  if (!Array.isArray(raw)) raw = [];
  return raw.map(function (slot, index) {
    slot = slot && typeof slot === 'object' ? slot : {};
    var snapshot = normalizeFxArchiveSnapshot(slot.snapshot);
    return {
      name: normalizeUserFxArchiveName(slot.name, index),
      createdAt: Number(slot.createdAt) || (snapshot ? (Number(slot.savedAt) || Date.now()) : 0),
      savedAt: snapshot ? (Number(slot.savedAt) || Date.now()) : 0,
      snapshot: snapshot
    };
  }).filter(function (slot) {
    return !!(slot.snapshot || slot.savedAt || slot.createdAt);
  });
}

function saveUserFxArchives() {
  try {
    localStorage.setItem(USER_FX_ARCHIVE_STORE_KEY, JSON.stringify(userFxArchives));
  } catch (e) {
    showToast('用户存档保存失败，本地存储空间可能不足');
  }
}

function hasStoredUserFxArchives() {
  try {
    return localStorage.getItem(USER_FX_ARCHIVE_STORE_KEY) != null;
  } catch (e) {
    return true;
  }
}

function createPackagedDefaultUserFxArchiveSlot() {
  return {
    name: normalizeUserFxArchiveName(PACKAGED_DEFAULT_USER_FX_ARCHIVE_NAME, 0),
    createdAt: PACKAGED_DEFAULT_USER_FX_ARCHIVE_EXPORTED_AT,
    savedAt: PACKAGED_DEFAULT_USER_FX_ARCHIVE_SAVED_AT,
    snapshot: normalizeFxArchiveSnapshot(clonePackagedDefaultFxSnapshot())
  };
}

function formatUserArchiveTime(ts) {
  ts = Number(ts) || 0;
  if (!ts) return '空槽位';
  var diff = Date.now() - ts;
  if (diff < 60000) return '刚刚保存';
  if (diff < 3600000) return Math.max(1, Math.round(diff / 60000)) + ' 分钟前';
  var d = new Date(ts);
  function pad(v) { return String(v).padStart(2, '0'); }
  return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function captureCameraArchiveState() {
  var useFree = !!(typeof freeCamera !== 'undefined' && freeCamera && (freeCamera.active || freeCamera.locked));
  var visualRotX = typeof particles !== 'undefined' && particles && particles.rotation ? Number(particles.rotation.x) || 0 : (typeof gestureRotation !== 'undefined' && gestureRotation ? Number(gestureRotation.x) || 0 : 0);
  var visualRotY = typeof particles !== 'undefined' && particles && particles.rotation ? Number(particles.rotation.y) || 0 : (typeof gestureRotation !== 'undefined' && gestureRotation ? Number(gestureRotation.y) || 0 : 0);
  var out = {
    cameraViewSaved: true,
    cameraViewMode: useFree ? 'free' : 'orbit',
    cameraOrbitTheta: orbit && isFinite(orbit.userTheta) ? orbit.userTheta : 0,
    cameraOrbitPhi: orbit && isFinite(orbit.userPhi) ? orbit.userPhi : 0.08,
    cameraOrbitRadius: orbit && isFinite(orbit.userRadius) ? orbit.userRadius : 6.6,
    cameraFreePositionX: 0,
    cameraFreePositionY: 0,
    cameraFreePositionZ: 6.6,
    cameraFreeYaw: 0,
    cameraFreePitch: 0,
    cameraFreeRoll: 0,
    cameraFreeFov: typeof BASE_FOV === 'number' ? BASE_FOV : 45,
    visualRotationSaved: true,
    visualRotationX: visualRotX,
    visualRotationY: visualRotY
  };
  if (typeof freeCamera !== 'undefined' && freeCamera) {
    if (freeCamera.position) {
      out.cameraFreePositionX = Number(freeCamera.position.x) || 0;
      out.cameraFreePositionY = Number(freeCamera.position.y) || 0;
      out.cameraFreePositionZ = Number(freeCamera.position.z) || 6.6;
    }
    out.cameraFreeYaw = Number(freeCamera.yaw) || 0;
    out.cameraFreePitch = Number(freeCamera.pitch) || 0;
    out.cameraFreeRoll = Number(freeCamera.roll) || 0;
    out.cameraFreeFov = Number(freeCamera.fov) || out.cameraFreeFov;
  }
  return out;
}
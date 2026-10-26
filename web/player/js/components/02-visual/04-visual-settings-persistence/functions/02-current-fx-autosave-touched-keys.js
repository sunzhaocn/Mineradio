'use strict';


function currentFxAutosaveTouchedKeys(reason, payload) {
  reason = String(reason || '').trim();
  payload = plainCurrentFxAutosavePayload(payload) || {};
  var map = {
    archiveApply: null,
    resetFx: null,
    preset: ['preset'],
    lyricFont: ['lyricFont'],
    lyricFontRemove: ['lyricFont'],
    lyricColorAuto: ['lyricColorMode', 'lyricColor'],
    lyricColorCustom: ['lyricColorMode', 'lyricColor'],
    lyricHighlightAuto: ['lyricHighlightMode', 'lyricHighlightColor'],
    lyricHighlightCustom: ['lyricHighlightMode', 'lyricHighlightColor'],
    lyricGlowLinked: ['lyricGlowLinked', 'lyricGlowColor'],
    lyricGlowColor: ['lyricGlowLinked', 'lyricGlowColor'],
    lyricDisplayMode: ['lyricDisplayMode'],
    lyricTranslationMode: ['lyricTranslationMode'],
    lyricMotionStyle: ['lyricMotionStyle'],
    lyricVerticalFloat: ['lyricVerticalFloat'],
    lyricGlitchCameraBind: ['lyricGlitchCameraBind'],
    backgroundColor: ['backgroundColorMode', 'backgroundColor', 'backgroundColorCustom'],
    backgroundColorCover: ['backgroundColorMode', 'backgroundColor', 'backgroundColorCustom'],
    backgroundOpacity: ['backgroundOpacity', 'backgroundColorMode', 'backgroundColorCustom'],
    windowBackgroundOpacity: ['windowBackgroundOpacity'],
    backgroundGlassOpacity: ['backgroundGlassOpacity'],
    backgroundImage: ['backgroundImage', 'backgroundMedia', 'backgroundAlbumCover'],
    backgroundMedia: ['backgroundImage', 'backgroundMedia', 'backgroundAlbumCover'],
    backgroundAlbumCover: ['backgroundAlbumCover', 'backgroundImage', 'backgroundMedia'],
    backgroundMediaCrop: ['backgroundMediaCropX', 'backgroundMediaCropY', 'backgroundMediaZoom'],
    visualTintAuto: ['visualTintMode', 'visualTintColor'],
    visualTintReset: ['visualTintMode', 'visualTintColor'],
    visualTintColor: ['visualTintMode', 'visualTintColor'],
    uiAccentColor: ['uiAccentColor'],
    homeAccentColor: ['homeAccentColor'],
    homeIconColor: ['homeIconColor'],
    visualIconColor: ['visualIconColor'],
    sonicGroundColorAuto: ['sonicGroundColorMode', 'sonicGroundBaseColor', 'sonicGroundCoolColor', 'sonicGroundWarmColor', 'sonicGroundAccentColor'],
    sonicGroundBaseColor: ['sonicGroundColorMode', 'sonicGroundBaseColor'],
    sonicGroundCoolColor: ['sonicGroundColorMode', 'sonicGroundCoolColor'],
    sonicGroundWarmColor: ['sonicGroundColorMode', 'sonicGroundWarmColor'],
    sonicGroundAccentColor: ['sonicGroundColorMode', 'sonicGroundAccentColor'],
    sonicWorkshopColorMode: ['sonicWorkshopColorMode', 'sonicWorkshopTheme', 'sonicWorkshopCustomColor'],
    sonicWorkshopTheme: ['sonicWorkshopColorMode', 'sonicWorkshopTheme', 'sonicWorkshopCustomColor'],
    sonicWorkshopCustomColor: ['sonicWorkshopColorMode', 'sonicWorkshopTheme', 'sonicWorkshopCustomColor'],
    sonicWorkshopRegionColors: ['sonicWorkshopColorMode', 'sonicWorkshopTheme', 'sonicWorkshopCustomColor', 'sonicWorkshopBaseColorMode', 'sonicWorkshopBaseColor', 'sonicWorkshopWarmColorMode', 'sonicWorkshopWarmColor', 'sonicWorkshopCoolColorMode', 'sonicWorkshopCoolColor', 'sonicWorkshopRippleColorMode', 'sonicWorkshopRippleColor', 'sonicWorkshopPeakColorMode', 'sonicWorkshopPeakColor'],
    sonicWorkshopBaseColor: ['sonicWorkshopBaseColorMode', 'sonicWorkshopBaseColor'],
    sonicWorkshopWarmColor: ['sonicWorkshopWarmColorMode', 'sonicWorkshopWarmColor'],
    sonicWorkshopCoolColor: ['sonicWorkshopCoolColorMode', 'sonicWorkshopCoolColor'],
    sonicWorkshopRippleColor: ['sonicWorkshopRippleColorMode', 'sonicWorkshopRippleColor'],
    sonicWorkshopPeakColor: ['sonicWorkshopPeakColorMode', 'sonicWorkshopPeakColor'],
    shelfMode: ['shelf', 'shelfPinnedOpen', 'shelfPresence'],
    shelfPinnedOpen: ['shelfPinnedOpen', 'shelfPresence'],
    shelfCameraMode: ['shelfCameraMode', 'shelfAngleY', 'shelfAngleYManual'],
    shelfPresence: ['shelfPresence', 'shelfPinnedOpen'],
    shelfAccentColor: ['shelfAccentColor'],
    desktopLyrics: ['desktopLyrics'],
    desktopLyricsClickThrough: ['desktopLyricsClickThrough'],
    desktopLyricsFps: ['desktopLyricsFps'],
    performanceBackground: ['performanceBackground', 'liveBackgroundKeep'],
    performanceQuality: ['performanceQuality'],
    liveBackgroundKeep: ['performanceBackground', 'liveBackgroundKeep'],
    memorySystemMask: ['memorySystemMask'],
    memorySystemIntervalMin: ['memorySystemIntervalMin'],
    memorySystemThresholdPercent: ['memorySystemThresholdPercent']
  };
  if (Object.prototype.hasOwnProperty.call(map, reason)) return map[reason];
  if (reason.indexOf('reset:') === 0) {
    var resetKey = reason.slice(6);
    if (resetKey === 'shelfAngleY') return ['shelfAngleY', 'shelfAngleYManual'];
    return Object.prototype.hasOwnProperty.call(payload, resetKey) ? [resetKey] : null;
  }
  if (Object.prototype.hasOwnProperty.call(payload, reason)) {
    if (reason === 'lyricCustomLineCount') return ['lyricCustomLineCount', 'lyricDisplayMode'];
    if (reason === 'backgroundOpacity') return map.backgroundOpacity;
    if (reason === 'controlGlassChromaticOffset') return ['controlGlassChromaticOffset'];
    return [reason];
  }
  return null;
}

function scopeCurrentFxAutosavePayload(payload, opts) {
  opts = opts || {};
  payload = plainCurrentFxAutosavePayload(payload);
  if (!payload || opts.user !== true || opts.force === true) return payload;
  var keys = currentFxAutosaveTouchedKeys(currentFxAutosaveSaveReason(opts, ''), payload);
  if (!keys || !keys.length) return payload;
  var base = plainCurrentFxAutosavePayload(readCurrentFxAutosaveStorageRaw()) || {};
  var scoped = Object.assign({}, base, {
    currentAutosaveSchema: CURRENT_FX_AUTOSAVE_SCHEMA,
    autosavedAt: payload.autosavedAt || Date.now(),
    autosaveUser: true,
    autosaveReason: payload.autosaveReason || currentFxAutosaveSaveReason(opts, 'scoped'),
    visualPresetSchema: payload.visualPresetSchema || base.visualPresetSchema || VISUAL_PRESET_SCHEMA,
    desktopLyricsSchema: payload.desktopLyricsSchema || base.desktopLyricsSchema || 'desktop-lyrics-v3'
  });
  keys.forEach(function (key) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) scoped[key] = payload[key];
  });
  return scoped;
}

function currentFxAutosaveHasUserVisualState(raw) {
  raw = plainCurrentFxAutosavePayload(raw);
  if (!raw) return false;
  if (raw.autosaveUser === true) return true;
  if (raw.lyricColorMode === 'custom' || raw.lyricHighlightMode === 'custom') return true;
  if (raw.lyricGlowLinked === false) return true;
  if (normalizeHexColor(raw.lyricColor || fxDefaults.lyricColor, fxDefaults.lyricColor) !== normalizeHexColor(fxDefaults.lyricColor, '#a9b8c8')) return true;
  if (normalizeHexColor(raw.lyricHighlightColor || fxDefaults.lyricHighlightColor, fxDefaults.lyricHighlightColor) !== normalizeHexColor(fxDefaults.lyricHighlightColor, '#fac900')) return true;
  if (normalizeHexColor(raw.lyricGlowColor || fxDefaults.lyricGlowColor, fxDefaults.lyricGlowColor) !== normalizeHexColor(fxDefaults.lyricGlowColor, '#008aff')) return true;
  if (layoutNumber(raw.controlGlassChromaticOffset, fxDefaults.controlGlassChromaticOffset, 30, 140) !== layoutNumber(fxDefaults.controlGlassChromaticOffset, 90, 30, 140)) return true;
  return false;
}

function currentFxAutosavePayloadLooksDefaultCritical(payload) {
  payload = plainCurrentFxAutosavePayload(payload);
  if (!payload) return true;
  return (payload.lyricColorMode !== 'custom')
    && (payload.lyricHighlightMode !== 'custom')
    && payload.lyricGlowLinked !== false
    && normalizeHexColor(payload.lyricColor || fxDefaults.lyricColor, fxDefaults.lyricColor) === normalizeHexColor(fxDefaults.lyricColor, '#a9b8c8')
    && normalizeHexColor(payload.lyricHighlightColor || fxDefaults.lyricHighlightColor, fxDefaults.lyricHighlightColor) === normalizeHexColor(fxDefaults.lyricHighlightColor, '#fac900')
    && normalizeHexColor(payload.lyricGlowColor || fxDefaults.lyricGlowColor, fxDefaults.lyricGlowColor) === normalizeHexColor(fxDefaults.lyricGlowColor, '#008aff')
    && layoutNumber(payload.controlGlassChromaticOffset, fxDefaults.controlGlassChromaticOffset, 30, 140) === layoutNumber(fxDefaults.controlGlassChromaticOffset, 90, 30, 140);
}

function shouldSkipCurrentFxAutosaveWrite(payload, opts) {
  opts = opts || {};
  if (opts.force === true || opts.user === true) return false;
  var storedRaw = readCurrentFxAutosaveStorageRaw();
  if (currentFxAutosaveHasUserVisualState(storedRaw) && currentFxAutosavePayloadLooksDefaultCritical(payload)) return true;
  if (currentFxAutosaveUserDirty) return false;
  return Date.now() - currentFxAutosaveBootAt < 7000;
}

function saveCurrentFxAutosavePatch(patch, opts) {
  opts = opts || {};
  patch = plainCurrentFxAutosavePayload(patch);
  if (!patch) return false;
  if (opts.user === true) markCurrentFxAutosaveUserDirty(opts.reason || 'patch');
  var base = readCurrentFxAutosaveRaw();
  var payload = Object.assign({}, plainCurrentFxAutosavePayload(base) || {}, patch, {
    currentAutosaveSchema: CURRENT_FX_AUTOSAVE_SCHEMA,
    autosavedAt: Date.now(),
    autosaveUser: opts.user === true,
    autosaveReason: currentFxAutosaveSaveReason(opts, 'patch')
  });
  if (!payload.visualPresetSchema) payload.visualPresetSchema = VISUAL_PRESET_SCHEMA;
  if (!payload.desktopLyricsSchema) payload.desktopLyricsSchema = 'desktop-lyrics-v3';
  payload = scopeCurrentFxAutosavePayload(payload, opts);
  if (shouldSkipCurrentFxAutosaveWrite(payload, opts)) return false;
  return writeCurrentFxAutosavePayload(payload, opts);
}

function currentFxAutosaveCriticalPatch() {
  if (!fx) return {};
  return {
    lyricColorMode: fx.lyricColorMode === 'custom' ? 'custom' : 'auto',
    lyricColor: normalizeHexColor(fx.lyricColor || '#a9b8c8'),
    lyricHighlightMode: fx.lyricHighlightMode === 'custom' ? 'custom' : 'auto',
    lyricHighlightColor: normalizeHexColor(fx.lyricHighlightColor || '#fff0b8'),
    lyricGlowLinked: fx.lyricGlowLinked !== false,
    lyricGlowColor: normalizeHexColor(fx.lyricGlowColor || '#9db8cf'),
    lyricDisplayMode: normalizeSavedLyricDisplayMode(fx.lyricDisplayMode || fxDefaults.lyricDisplayMode),
    lyricTranslationMode: normalizeSavedLyricTranslationMode(fx.lyricTranslationMode || fxDefaults.lyricTranslationMode),
    lyricMotionStyle: normalizeSavedLyricMotionStyle(fx.lyricMotionStyle || fxDefaults.lyricMotionStyle),
    lyricCustomLineCount: layoutInteger(fx.lyricCustomLineCount, fxDefaults.lyricCustomLineCount, 1, 10),
    lyricGlitchCameraBind: !!fx.lyricGlitchCameraBind,
    lyricGlitchIntensity: layoutNumber(fx.lyricGlitchIntensity, fxDefaults.lyricGlitchIntensity, 0, 1.5),
    lyricGlitchSlice: layoutNumber(fx.lyricGlitchSlice, fxDefaults.lyricGlitchSlice, 0, 1.4),
    lyricGlitchChroma: layoutNumber(fx.lyricGlitchChroma, fxDefaults.lyricGlitchChroma, 0, 1.6),
    lyricGlitchRate: layoutNumber(fx.lyricGlitchRate, fxDefaults.lyricGlitchRate, 0.45, 2.2),
    lyricGlitchJitter: layoutNumber(fx.lyricGlitchJitter, fxDefaults.lyricGlitchJitter, 0, 1.8),
    lyricContextOpacity: layoutNumber(fx.lyricContextOpacity, fxDefaults.lyricContextOpacity, 0.25, 1),
    lyricContextSpread: layoutNumber(fx.lyricContextSpread, fxDefaults.lyricContextSpread, 0.60, 2.40),
    lyricTranslationGap: layoutNumber(fx.lyricTranslationGap, fxDefaults.lyricTranslationGap, 0.28, 2.20),
    lyricTranslationScale: layoutNumber(fx.lyricTranslationScale, fxDefaults.lyricTranslationScale, 0.46, 1.12),
    lyricTranslationOpacity: layoutNumber(fx.lyricTranslationOpacity, fxDefaults.lyricTranslationOpacity, 0.20, 1),
    lyricEdgeFade: layoutNumber(fx.lyricEdgeFade, fxDefaults.lyricEdgeFade, 0, 1),
    lyricMotionSoftness: layoutNumber(fx.lyricMotionSoftness, fxDefaults.lyricMotionSoftness, 0.15, 1.2),
    lyricFont: normalizeLyricFontKey(fx.lyricFont),
    lyricLetterSpacing: layoutNumber(fx.lyricLetterSpacing, 0, -0.04, 0.18),
    lyricLineHeight: layoutNumber(fx.lyricLineHeight, 1, 0.72, 1.80),
    lyricWeight: layoutInteger(fx.lyricWeight, 900, 500, 900),
    lyricTextureClarity: normalizeLyricTextureClarity(fx.lyricTextureClarity),
    foregroundFpsMode: normalizeForegroundFpsMode(fx.foregroundFpsMode),
    lyricGlow: !!fx.lyricGlow,
    lyricGlowBeat: !!fx.lyricGlowBeat,
    lyricGlowParticles: !!fx.lyricGlowParticles,
    lyricVerticalFloat: fx.lyricVerticalFloat !== false,
    lyricPauseHold: fx.lyricPauseHold !== false,
    controlGlassChromaticOffset: layoutNumber(fx.controlGlassChromaticOffset, fxDefaults.controlGlassChromaticOffset, 30, 140),
    shelf: /^(off|side|stage)$/.test(String(fx.shelf || '')) ? fx.shelf : fxDefaults.shelf,
    shelfPinnedOpen: fx.shelf === 'side' && normalizeShelfPresence(fx.shelfPresence || fxDefaults.shelfPresence) === 'always' && fx.shelfPinnedOpen === true,
    shelfCameraMode: normalizeShelfCameraMode(fx.shelfCameraMode || fxDefaults.shelfCameraMode),
    shelfPresence: fx.shelf === 'off' ? 'auto' : normalizeShelfPresence(fx.shelfPresence || fxDefaults.shelfPresence),
    shelfShowPodcasts: fx.shelfShowPodcasts !== false,
    shelfMergeCollections: fx.shelfMergeCollections === true,
    shelfSize: clampRange(fx.shelfSize == null ? fxDefaults.shelfSize : Number(fx.shelfSize), 0.65, 1.45),
    shelfOffsetX: clampRange(fx.shelfOffsetX == null ? fxDefaults.shelfOffsetX : Number(fx.shelfOffsetX), -1.2, 1.2),
    shelfOffsetY: clampRange(fx.shelfOffsetY == null ? fxDefaults.shelfOffsetY : Number(fx.shelfOffsetY), -0.9, 0.9),
    shelfOffsetZ: clampRange(fx.shelfOffsetZ == null ? fxDefaults.shelfOffsetZ : Number(fx.shelfOffsetZ), -0.9, 0.9),
    shelfAngleY: clampRange(fx.shelfAngleY == null ? fxDefaults.shelfAngleY : Number(fx.shelfAngleY), -30, 30),
    shelfAngleYManual: fx.shelfAngleYManual === true,
    shelfOpacity: clampRange(fx.shelfOpacity == null ? fxDefaults.shelfOpacity : Number(fx.shelfOpacity), 0.25, 1),
    shelfBgOpacity: clampRange(fx.shelfBgOpacity == null ? fxDefaults.shelfBgOpacity : Number(fx.shelfBgOpacity), 0.25, 0.98),
    shelfAccentColor: normalizeHexColor(fx.shelfAccentColor || fxDefaults.shelfAccentColor, fxDefaults.shelfAccentColor)
  };
}
'use strict';


function readSavedLyricLayout() {
  var raw = null;
  try {
    raw = readCurrentFxAutosaveRaw();
    var savedPreset = clampRange(Number(raw.preset) || 0, 0, MAX_VISUAL_PRESET_INDEX);
    if (savedPreset === 3 && raw.visualPresetSchema !== VISUAL_PRESET_SCHEMA) {
      savedPreset = 5;
    }
    var savedBgColor = normalizeHexColor(raw.backgroundColor || '#000000', '#000000');
    var savedBgOpacity = clampRange(raw.backgroundOpacity == null ? fxDefaults.backgroundOpacity : Number(raw.backgroundOpacity), 0, 1);
    var savedWindowBgOpacity = clampRange(raw.windowBackgroundOpacity == null ? fxDefaults.windowBackgroundOpacity : Number(raw.windowBackgroundOpacity), 0, 1);
    var savedBgGlassOpacity = clampRange(raw.backgroundGlassOpacity == null ? fxDefaults.backgroundGlassOpacity : Number(raw.backgroundGlassOpacity), 0, 1);
    var savedBgCropX = layoutNumber(raw.backgroundMediaCropX, fxDefaults.backgroundMediaCropX, 0, 100);
    var savedBgCropY = layoutNumber(raw.backgroundMediaCropY, fxDefaults.backgroundMediaCropY, 0, 100);
    var savedBgZoom = layoutNumber(raw.backgroundMediaZoom, fxDefaults.backgroundMediaZoom, 1, 2.8);
    var savedGlassOffset = layoutNumber(raw.controlGlassChromaticOffset, fxDefaults.controlGlassChromaticOffset, 30, 140);
    var savedPlaylistPanelGlassBlur = clampRange(raw.playlistPanelGlassBlur == null ? fxDefaults.playlistPanelGlassBlur : Number(raw.playlistPanelGlassBlur), 14, 60);
    var savedPlaylistPanelGlassDensity = clampRange(raw.playlistPanelGlassDensity == null ? fxDefaults.playlistPanelGlassDensity : Number(raw.playlistPanelGlassDensity), 0.55, 1);
    var savedPlaylistPanelOpenDuration = clampRange(raw.playlistPanelOpenDuration == null ? fxDefaults.playlistPanelOpenDuration : Number(raw.playlistPanelOpenDuration), 0.08, 0.72);
    var savedPlaylistPanelCloseDuration = clampRange(raw.playlistPanelCloseDuration == null ? fxDefaults.playlistPanelCloseDuration : Number(raw.playlistPanelCloseDuration), 0.06, 0.48);
    var savedBgMode = /^(cover|custom)$/.test(String(raw.backgroundColorMode || '')) ? String(raw.backgroundColorMode) : '';
    var savedBgCustom = savedBgMode
      ? savedBgMode === 'custom'
      : (raw.backgroundColorCustom === true || (raw.backgroundColorCustom !== false && savedBgColor !== '#000000') || savedBgOpacity < 1);
    var savedBgMedia = normalizeCustomBackgroundMedia(raw.backgroundMedia || raw.backgroundImage);
    var savedBgAlbumCover = raw.backgroundAlbumCover === true || !!(savedBgMedia && savedBgMedia.type === 'album');
    var desktopLyricsSchemaReady = raw.desktopLyricsSchema === 'desktop-lyrics-v3';
    var savedShelfCameraMode = normalizeShelfCameraMode(raw.shelfCameraMode || fxDefaults.shelfCameraMode);
    var savedShelfAngleManual = raw.shelfAngleYManual === true;
    var savedShelfAngle = savedShelfAngleManual
      ? clampRange(raw.shelfAngleY == null ? shelfDefaultAngleForCameraMode(savedShelfCameraMode) : Number(raw.shelfAngleY), -30, 30)
      : shelfDefaultAngleForCameraMode(savedShelfCameraMode);
    var savedShelfMode = /^(off|side|stage)$/.test(String(raw.shelf || '')) ? raw.shelf : fxDefaults.shelf;
    var savedShelfPresence = savedShelfMode === 'off' ? 'auto' : normalizeShelfPresence(raw.shelfPresence || fxDefaults.shelfPresence);
    var savedShelfPinnedOpen = savedShelfMode === 'side' && savedShelfPresence === 'always' && raw.shelfPinnedOpen === true;
    return {
      preset: savedPreset,
      intensity: layoutNumber(raw.intensity, fxDefaults.intensity, 0.2, 1.6),
      cinemaShake: layoutNumber(raw.cinemaShake, fxDefaults.cinemaShake, 0, 1.8),
      depth: layoutNumber(raw.depth, fxDefaults.depth, 0.2, 1.8),
      point: layoutNumber(raw.point, fxDefaults.point, 0.5, 2.2),
      speed: layoutNumber(raw.speed, fxDefaults.speed, 0.2, 2.5),
      twist: layoutNumber(raw.twist, fxDefaults.twist, 0, 0.6),
      color: layoutNumber(raw.color, fxDefaults.color, 0.5, 2.0),
      scatter: layoutNumber(raw.scatter, fxDefaults.scatter, 0, 0.5),
      bgFade: layoutNumber(raw.bgFade, fxDefaults.bgFade, 0, 1.2),
      bloomStrength: layoutNumber(raw.bloomStrength, fxDefaults.bloomStrength, 0, 1.6),
      lyricGlowStrength: layoutNumber(raw.lyricGlowStrength, fxDefaults.lyricGlowStrength, 0, 0.85),
      lyricBackgroundAdapt: layoutNumber(raw.lyricBackgroundAdapt, fxDefaults.lyricBackgroundAdapt, 0, 1),
      lyricScale: layoutNumber(raw.lyricScale, 1, 0.35, 1.65),
      lyricOffsetX: layoutNumber(raw.lyricOffsetX, 0, -4.0, 4.0),
      lyricOffsetY: layoutNumber(raw.lyricOffsetY, 0, -2.4, 2.7),
      lyricOffsetZ: layoutNumber(raw.lyricOffsetZ, 0, -3.2, 3.2),
      lyricTiltX: layoutNumber(raw.lyricTiltX, 0, -84, 84),
      lyricTiltY: layoutNumber(raw.lyricTiltY, 0, -84, 84),
      lyricCameraLock: !!raw.lyricCameraLock,
      lyricColorMode: raw.lyricColorMode === 'custom' ? 'custom' : 'auto',
      lyricColor: normalizeHexColor(raw.lyricColor || '#a9b8c8'),
      lyricHighlightMode: raw.lyricHighlightMode === 'custom' ? 'custom' : 'auto',
      lyricHighlightColor: normalizeHexColor(raw.lyricHighlightColor || '#fff0b8'),
      lyricGlowLinked: raw.lyricGlowLinked !== false,
      lyricGlowColor: normalizeHexColor(raw.lyricGlowColor || '#9db8cf'),
      lyricDisplayMode: normalizeSavedLyricDisplayMode(raw.lyricDisplayMode || fxDefaults.lyricDisplayMode),
      lyricTranslationMode: normalizeSavedLyricTranslationMode(raw.lyricTranslationMode || fxDefaults.lyricTranslationMode),
      lyricMotionStyle: normalizeSavedLyricMotionStyle(raw.lyricMotionStyle || fxDefaults.lyricMotionStyle),
      lyricVerticalFloat: raw.lyricVerticalFloat !== false,
      lyricCustomLineCount: layoutInteger(raw.lyricCustomLineCount, fxDefaults.lyricCustomLineCount, 1, 10),
      lyricGlitchCameraBind: !!raw.lyricGlitchCameraBind,
      lyricGlitchIntensity: layoutNumber(raw.lyricGlitchIntensity, fxDefaults.lyricGlitchIntensity, 0, 1.5),
      lyricGlitchSlice: layoutNumber(raw.lyricGlitchSlice, fxDefaults.lyricGlitchSlice, 0, 1.4),
      lyricGlitchChroma: layoutNumber(raw.lyricGlitchChroma, fxDefaults.lyricGlitchChroma, 0, 1.6),
      lyricGlitchRate: layoutNumber(raw.lyricGlitchRate, fxDefaults.lyricGlitchRate, 0.45, 2.2),
      lyricGlitchJitter: layoutNumber(raw.lyricGlitchJitter, fxDefaults.lyricGlitchJitter, 0, 1.8),
      lyricContextOpacity: layoutNumber(raw.lyricContextOpacity, fxDefaults.lyricContextOpacity, 0.25, 1),
      lyricContextSpread: layoutNumber(raw.lyricContextSpread, fxDefaults.lyricContextSpread, 0.60, 2.40),
      lyricTranslationGap: layoutNumber(raw.lyricTranslationGap, fxDefaults.lyricTranslationGap, 0.28, 2.20),
      lyricTranslationScale: layoutNumber(raw.lyricTranslationScale, fxDefaults.lyricTranslationScale, 0.46, 1.12),
      lyricTranslationOpacity: layoutNumber(raw.lyricTranslationOpacity, fxDefaults.lyricTranslationOpacity, 0.20, 1),
      lyricEdgeFade: layoutNumber(raw.lyricEdgeFade, fxDefaults.lyricEdgeFade, 0, 1),
      lyricMotionSoftness: layoutNumber(raw.lyricMotionSoftness, fxDefaults.lyricMotionSoftness, 0.15, 1.2),
      lyricFont: normalizeLyricFontKey(raw.lyricFont),
      lyricLetterSpacing: layoutNumber(raw.lyricLetterSpacing, 0, -0.04, 0.18),
      lyricLineHeight: layoutNumber(raw.lyricLineHeight, 1, 0.72, 1.80),
      lyricWeight: layoutInteger(raw.lyricWeight, 900, 500, 900),
      lyricTextureClarity: normalizeLyricTextureClarity(raw.lyricTextureClarity),
      lyricGlow: raw.lyricGlow !== false,
      lyricGlowBeat: raw.lyricGlowBeat !== false,
      lyricGlowParticles: !!raw.lyricGlowParticles,
      lyricVerticalFloat: raw.lyricVerticalFloat !== false,
      backgroundStarRiver: raw.backgroundStarRiver !== false,
      lyricPauseHold: raw.lyricPauseHold !== false,
      floatLayer: raw.floatLayer === true,
      cinema: raw.cinema !== false,
      bloom: raw.bloom === true,
      edge: raw.edge === true,
      aiDepth: raw.aiDepth === true,
      particleLyrics: raw.particleLyrics !== false,
      backCover: raw.backCover === true,
      visualTintMode: raw.visualTintMode === 'custom' ? 'custom' : 'auto',
      visualTintColor: normalizeHexColor(raw.visualTintColor || '#9db8cf'),
      uiAccentColor: normalizeHexColor(
        raw.uiAccentColor || fxDefaults.uiAccentColor || '#ffffff',
        fxDefaults.uiAccentColor || '#ffffff'
      ),
      homeAccentColor: normalizeHexColor(raw.homeAccentColor || '#00f5d4'),
      homeIconColor: normalizeHexColor(raw.homeIconColor || fxDefaults.homeIconColor || '#f4d28a', '#f4d28a'),
      visualIconColor: normalizeHexColor(raw.visualIconColor || fxDefaults.visualIconColor || '#7fd8ff', '#7fd8ff'),
      backgroundColorMode: savedBgCustom ? 'custom' : 'cover',
      backgroundColor: savedBgColor,
      backgroundOpacity: savedBgOpacity,
      windowBackgroundOpacity: savedWindowBgOpacity,
      backgroundGlassOpacity: savedBgGlassOpacity,
      controlGlassChromaticOffset: savedGlassOffset,
      playlistPanelGlassBlur: savedPlaylistPanelGlassBlur,
      playlistPanelGlassDensity: savedPlaylistPanelGlassDensity,
      playlistPanelOpenDuration: savedPlaylistPanelOpenDuration,
      playlistPanelCloseDuration: savedPlaylistPanelCloseDuration,
      backgroundColorCustom: savedBgCustom,
      backgroundImage: savedBgAlbumCover ? '' : normalizeCustomBackgroundImage(raw.backgroundImage),
      backgroundMedia: savedBgAlbumCover ? null : savedBgMedia,
      backgroundAlbumCover: savedBgAlbumCover,
      backgroundMediaCropX: savedBgCropX,
      backgroundMediaCropY: savedBgCropY,
      backgroundMediaZoom: savedBgZoom,
      desktopLyrics: raw.desktopLyrics === true,
      desktopLyricsSize: clampRange(Number(raw.desktopLyricsSize) || fxDefaults.desktopLyricsSize, 0.72, 1.55),
      desktopLyricsOpacity: clampRange(raw.desktopLyricsOpacity == null ? fxDefaults.desktopLyricsOpacity : Number(raw.desktopLyricsOpacity), 0.28, 1),
      desktopLyricsY: clampRange(raw.desktopLyricsY == null ? fxDefaults.desktopLyricsY : Number(raw.desktopLyricsY), 0.08, 0.92),
      desktopLyricsClickThrough: desktopLyricsSchemaReady ? raw.desktopLyricsClickThrough === true : fxDefaults.desktopLyricsClickThrough,
      desktopLyricsCinema: desktopLyricsSchemaReady ? raw.desktopLyricsCinema !== false : fxDefaults.desktopLyricsCinema,
      desktopLyricsHighlight: desktopLyricsSchemaReady ? raw.desktopLyricsHighlight === true : fxDefaults.desktopLyricsHighlight,
      desktopLyricsFps: desktopLyricsSchemaReady ? normalizeDesktopLyricsFps(raw.desktopLyricsFps) : fxDefaults.desktopLyricsFps,
      performanceBackground: normalizePerformanceBackgroundMode(raw.performanceBackground, raw.liveBackgroundKeep === true),
      performanceQuality: normalizePerformanceQuality(raw.performanceQuality),
      foregroundFpsMode: normalizeForegroundFpsMode(raw.foregroundFpsMode === 'adaptive' ? 'vsync' : raw.foregroundFpsMode),
      memoryAutoTrimApp: raw.memoryAutoTrimApp !== false,
      memoryAutoTrimOnBackground: raw.memoryAutoTrimOnBackground !== false,
      memoryAutoSystemTrim: raw.memoryAutoSystemTrim === true,
      memorySystemAutoElevate: raw.memorySystemAutoElevate === true,
      memorySystemIntervalMin: clampRange(Math.round(raw.memorySystemIntervalMin == null ? fxDefaults.memorySystemIntervalMin : Number(raw.memorySystemIntervalMin)), 5, 180),
      memorySystemThresholdPercent: clampRange(Math.round(raw.memorySystemThresholdPercent == null ? fxDefaults.memorySystemThresholdPercent : Number(raw.memorySystemThresholdPercent)), 50, 98),
      memorySystemMask: clampRange(Math.round(raw.memorySystemMask == null ? fxDefaults.memorySystemMask : Number(raw.memorySystemMask)), 1, 29),
      memorySafetyRevision: fxDefaults.memorySafetyRevision,
      liveBackgroundKeep: normalizePerformanceBackgroundMode(raw.performanceBackground, raw.liveBackgroundKeep === true) === 'keep',
      sonicGroundAmplitude: clampRange(raw.sonicGroundAmplitude == null ? fxDefaults.sonicGroundAmplitude : Number(raw.sonicGroundAmplitude), 0, 100),
      sonicGroundMotionSpeed: clampRange(raw.sonicGroundMotionSpeed == null ? fxDefaults.sonicGroundMotionSpeed : Number(raw.sonicGroundMotionSpeed), 0, 100),
      sonicGroundDensity: clampRange(raw.sonicGroundDensity == null ? fxDefaults.sonicGroundDensity : Number(raw.sonicGroundDensity), 0, 100),
      sonicGroundRange: clampRange(raw.sonicGroundRange == null ? fxDefaults.sonicGroundRange : Number(raw.sonicGroundRange), 0, 100),
      sonicGroundLower: clampRange(raw.sonicGroundLower == null ? fxDefaults.sonicGroundLower : Number(raw.sonicGroundLower), 0, 100),
      sonicGroundDepth: clampRange(raw.sonicGroundDepth == null ? fxDefaults.sonicGroundDepth : Number(raw.sonicGroundDepth), 0, 100),
      sonicGroundAutoRotate: clampRange(raw.sonicGroundAutoRotate == null ? fxDefaults.sonicGroundAutoRotate : Number(raw.sonicGroundAutoRotate), 0, 100),
      sonicGroundColorMode: raw.sonicGroundColorMode === 'custom' ? 'custom' : 'cover',
      sonicGroundBaseColor: normalizeHexColor(raw.sonicGroundBaseColor || fxDefaults.sonicGroundBaseColor, fxDefaults.sonicGroundBaseColor),
      sonicGroundCoolColor: normalizeHexColor(raw.sonicGroundCoolColor || fxDefaults.sonicGroundCoolColor, fxDefaults.sonicGroundCoolColor),
      sonicGroundWarmColor: normalizeHexColor(raw.sonicGroundWarmColor || fxDefaults.sonicGroundWarmColor, fxDefaults.sonicGroundWarmColor),
      sonicGroundAccentColor: normalizeHexColor(raw.sonicGroundAccentColor || fxDefaults.sonicGroundAccentColor, fxDefaults.sonicGroundAccentColor),
      sonicGroundGlow: clampRange(raw.sonicGroundGlow == null ? fxDefaults.sonicGroundGlow : Number(raw.sonicGroundGlow), 0, 100),
      sonicGroundSubBass: clampRange(raw.sonicGroundSubBass == null ? fxDefaults.sonicGroundSubBass : Number(raw.sonicGroundSubBass), 0, 100),
      sonicGroundBass: clampRange(raw.sonicGroundBass == null ? fxDefaults.sonicGroundBass : Number(raw.sonicGroundBass), 0, 100),
      sonicGroundLowMid: clampRange(raw.sonicGroundLowMid == null ? fxDefaults.sonicGroundLowMid : Number(raw.sonicGroundLowMid), 0, 100),
      sonicGroundMid: clampRange(raw.sonicGroundMid == null ? fxDefaults.sonicGroundMid : Number(raw.sonicGroundMid), 0, 100),
      sonicGroundHighMid: clampRange(raw.sonicGroundHighMid == null ? fxDefaults.sonicGroundHighMid : Number(raw.sonicGroundHighMid), 0, 100),
      sonicGroundPresence: clampRange(raw.sonicGroundPresence == null ? fxDefaults.sonicGroundPresence : Number(raw.sonicGroundPresence), 0, 100),
      sonicGroundBrilliance: clampRange(raw.sonicGroundBrilliance == null ? fxDefaults.sonicGroundBrilliance : Number(raw.sonicGroundBrilliance), 0, 100),
      sonicGroundAir: clampRange(raw.sonicGroundAir == null ? fxDefaults.sonicGroundAir : Number(raw.sonicGroundAir), 0, 100),
      sonicGroundFloatingEnabled: raw.sonicGroundFloatingEnabled !== false,
      sonicGroundFloatingIntensity: clampRange(raw.sonicGroundFloatingIntensity == null ? fxDefaults.sonicGroundFloatingIntensity : Number(raw.sonicGroundFloatingIntensity), 0, 100),
      sonicGroundFloatingMinSize: clampRange(raw.sonicGroundFloatingMinSize == null ? fxDefaults.sonicGroundFloatingMinSize : Number(raw.sonicGroundFloatingMinSize), 0, 100),
      sonicGroundFloatingMaxSize: clampRange(raw.sonicGroundFloatingMaxSize == null ? fxDefaults.sonicGroundFloatingMaxSize : Number(raw.sonicGroundFloatingMaxSize), 0, 100),
      sonicGroundFloatingSpeed: clampRange(raw.sonicGroundFloatingSpeed == null ? fxDefaults.sonicGroundFloatingSpeed : Number(raw.sonicGroundFloatingSpeed), 0, 100),
      sonicGroundFloatingCount: clampRange(raw.sonicGroundFloatingCount == null ? fxDefaults.sonicGroundFloatingCount : Number(raw.sonicGroundFloatingCount), 0, 100),
      sonicAudioMonitorEnabled: raw.sonicAudioMonitorEnabled !== false,
      sonicAudioAutoTrack: raw.sonicAudioAutoTrack !== false,
      sonicAudioSensitivity: clampRange(raw.sonicAudioSensitivity == null ? fxDefaults.sonicAudioSensitivity : Number(raw.sonicAudioSensitivity), 0, 100),
      sonicAudioBandStart: clampRange(raw.sonicAudioBandStart == null ? fxDefaults.sonicAudioBandStart : Number(raw.sonicAudioBandStart), 0, 510),
      sonicAudioBandEnd: clampRange(raw.sonicAudioBandEnd == null ? fxDefaults.sonicAudioBandEnd : Number(raw.sonicAudioBandEnd), 2, 512),
      sonicAudioThreshold: clampRange(raw.sonicAudioThreshold == null ? fxDefaults.sonicAudioThreshold : Number(raw.sonicAudioThreshold), 0, 100),
      sonicAudioPulseStrength: clampRange(raw.sonicAudioPulseStrength == null ? fxDefaults.sonicAudioPulseStrength : Number(raw.sonicAudioPulseStrength), 0, 100),
      sonicWorkshopInputGain: clampRange(raw.sonicWorkshopInputGain == null ? fxDefaults.sonicWorkshopInputGain : Number(raw.sonicWorkshopInputGain), 40, 100),
      sonicWorkshopAudioIntensity: clampRange(raw.sonicWorkshopAudioIntensity == null ? fxDefaults.sonicWorkshopAudioIntensity : Number(raw.sonicWorkshopAudioIntensity), 0.3, 2.5),
      sonicWorkshopResponseRange: clampRange(raw.sonicWorkshopResponseRange == null ? fxDefaults.sonicWorkshopResponseRange : Number(raw.sonicWorkshopResponseRange), 0.3, 2),
      sonicWorkshopPeakIntensity: clampRange(raw.sonicWorkshopPeakIntensity == null ? fxDefaults.sonicWorkshopPeakIntensity : Number(raw.sonicWorkshopPeakIntensity), 0, 1.4),
      sonicWorkshopColorMode: raw.sonicWorkshopColorMode === 'custom' ? 'custom' : 'cover',
      sonicWorkshopTheme: /^(coral-mirage|ocean-deep|arctic-blue|arctic-aurora|emerald-forest|cyber-forest|minimal-mono|minimal-monochrome|neon-tokyo|golden-hour|ember-fire|crimson|crimson-sunset|aurora|violet-dream)$/.test(String(raw.sonicWorkshopTheme || '')) ? raw.sonicWorkshopTheme : fxDefaults.sonicWorkshopTheme,
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
      wallpaperMode: false,
      wallpaperOpacity: clampRange(raw.wallpaperOpacity == null ? fxDefaults.wallpaperOpacity : Number(raw.wallpaperOpacity), 0.35, 1),
      wallpaperFps: normalizeWallpaperFps(raw.wallpaperFps),
      coverResolution: normalizeCoverResolution(raw.coverResolution),
      shelf: savedShelfMode,
      shelfPinnedOpen: savedShelfPinnedOpen,
      shelfCameraMode: savedShelfCameraMode,
      shelfPresence: savedShelfPresence,
      shelfShowPodcasts: raw.shelfShowPodcasts !== false,
      shelfMergeCollections: raw.shelfMergeCollections === true,
      shelfSize: clampRange(raw.shelfSize == null ? fxDefaults.shelfSize : Number(raw.shelfSize), 0.65, 1.45),
      shelfOffsetX: clampRange(raw.shelfOffsetX == null ? fxDefaults.shelfOffsetX : Number(raw.shelfOffsetX), -1.2, 1.2),
      shelfOffsetY: clampRange(raw.shelfOffsetY == null ? fxDefaults.shelfOffsetY : Number(raw.shelfOffsetY), -0.9, 0.9),
      shelfOffsetZ: clampRange(raw.shelfOffsetZ == null ? fxDefaults.shelfOffsetZ : Number(raw.shelfOffsetZ), -0.9, 0.9),
      shelfAngleY: savedShelfAngle,
      shelfAngleYManual: savedShelfAngleManual,
      shelfOpacity: clampRange(raw.shelfOpacity == null ? fxDefaults.shelfOpacity : Number(raw.shelfOpacity), 0.25, 1),
      shelfBgOpacity: clampRange(raw.shelfBgOpacity == null ? fxDefaults.shelfBgOpacity : Number(raw.shelfBgOpacity), 0.25, 0.98),
      shelfAccentColor: normalizeHexColor(raw.shelfAccentColor || fxDefaults.shelfAccentColor, fxDefaults.shelfAccentColor),
      shelfDetailOffsetX: clampRange(raw.shelfDetailOffsetX == null ? fxDefaults.shelfDetailOffsetX : Number(raw.shelfDetailOffsetX), -4.8, 4.8),
      shelfDetailOffsetY: clampRange(raw.shelfDetailOffsetY == null ? fxDefaults.shelfDetailOffsetY : Number(raw.shelfDetailOffsetY), -3.6, 3.6),
      shelfDetailOffsetZ: clampRange(raw.shelfDetailOffsetZ == null ? fxDefaults.shelfDetailOffsetZ : Number(raw.shelfDetailOffsetZ), -3.6, 3.6),
      shelfDetailScale: clampRange(raw.shelfDetailScale == null ? fxDefaults.shelfDetailScale : Number(raw.shelfDetailScale), 0.72, 1.35),
      shelfDetailAngleX: clampRange(raw.shelfDetailAngleX == null ? fxDefaults.shelfDetailAngleX : Number(raw.shelfDetailAngleX), -24, 24),
      shelfDetailAngleY: clampRange(raw.shelfDetailAngleY == null ? fxDefaults.shelfDetailAngleY : Number(raw.shelfDetailAngleY), -28, 28),
      shelfDetailRowGap: clampRange(raw.shelfDetailRowGap == null ? fxDefaults.shelfDetailRowGap : Number(raw.shelfDetailRowGap), 0.72, 1.32),
      shelfDetailOpenDuration: clampRange(raw.shelfDetailOpenDuration == null ? fxDefaults.shelfDetailOpenDuration : Number(raw.shelfDetailOpenDuration), 0.12, 1.2),
      shelfDetailCloseDuration: clampRange(raw.shelfDetailCloseDuration == null ? fxDefaults.shelfDetailCloseDuration : Number(raw.shelfDetailCloseDuration), 0.08, 0.8),
      shelfDetailRowDuration: clampRange(raw.shelfDetailRowDuration == null ? fxDefaults.shelfDetailRowDuration : Number(raw.shelfDetailRowDuration), 0.16, 1.6),
      shelfDetailIntroStrength: clampRange(raw.shelfDetailIntroStrength == null ? fxDefaults.shelfDetailIntroStrength : Number(raw.shelfDetailIntroStrength), 0, 1.8),
      shelfDetailParallax: clampRange(raw.shelfDetailParallax == null ? fxDefaults.shelfDetailParallax : Number(raw.shelfDetailParallax), 0, 1.8),
      shelfSummonOpenDuration: clampRange(raw.shelfSummonOpenDuration == null ? fxDefaults.shelfSummonOpenDuration : Number(raw.shelfSummonOpenDuration), 0.08, 2),
      shelfSummonCloseDuration: clampRange(raw.shelfSummonCloseDuration == null ? fxDefaults.shelfSummonCloseDuration : Number(raw.shelfSummonCloseDuration), 0.08, 1.6),
      shelfSummonSlide: clampRange(raw.shelfSummonSlide == null ? fxDefaults.shelfSummonSlide : Number(raw.shelfSummonSlide), 0, 4),
      shelfSummonStagger: clampRange(raw.shelfSummonStagger == null ? fxDefaults.shelfSummonStagger : Number(raw.shelfSummonStagger), 0, 3),
      shelfSummonScale: clampRange(raw.shelfSummonScale == null ? fxDefaults.shelfSummonScale : Number(raw.shelfSummonScale), 0, 3),
      shelfSummonParallax: clampRange(raw.shelfSummonParallax == null ? fxDefaults.shelfSummonParallax : Number(raw.shelfSummonParallax), 0, 2.5),
      shelfCameraEnterSpeed: clampRange(raw.shelfCameraEnterSpeed == null ? fxDefaults.shelfCameraEnterSpeed : Number(raw.shelfCameraEnterSpeed), 0.2, 1.5),
      shelfCameraExitSpeed: clampRange(raw.shelfCameraExitSpeed == null ? fxDefaults.shelfCameraExitSpeed : Number(raw.shelfCameraExitSpeed), 0.2, 1.5),
      cam: /^(off|gesture)$/.test(String(raw.cam || '')) ? raw.cam : fxDefaults.cam,
      gesturePlayerActions: raw.gesturePlayerActions !== false,
      gestureHandOverlay: raw.gestureHandOverlay !== false,
      gestureSensitivity: /^(steady|balanced|quick)$/.test(String(raw.gestureSensitivity || '')) ? raw.gestureSensitivity : fxDefaults.gestureSensitivity
    };
  } catch (e) {
    return readSavedLyricLayoutCriticalFallback(raw, e);
  }
}

function persistCurrentFxAutosaveDisk(payload, syncDisk) {
  try {
    var bridge = window.desktopWindow;
    if (!bridge) return;
    if (syncDisk && typeof bridge.saveCurrentFxAutosaveSync === 'function') {
      bridge.saveCurrentFxAutosaveSync(payload);
      return;
    }
    if (typeof bridge.saveCurrentFxAutosave === 'function') {
      bridge.saveCurrentFxAutosave(payload).catch(function (e) {
        console.warn('[FxAutosave] async disk write failed:', e);
      });
    }
  } catch (e) {
    console.warn('[FxAutosave] disk write failed:', e);
  }
}

function queueCurrentFxAutosaveDiskWrite(payload) {
  currentFxAutosaveDiskPayload = payload;
  if (currentFxAutosaveDiskTimer) clearTimeout(currentFxAutosaveDiskTimer);
  currentFxAutosaveDiskTimer = setTimeout(function () {
    currentFxAutosaveDiskTimer = null;
    var next = currentFxAutosaveDiskPayload;
    currentFxAutosaveDiskPayload = null;
    if (next) persistCurrentFxAutosaveDisk(next, false);
  }, 220);
}

function writeCurrentFxAutosavePayload(payload, opts) {
  opts = opts || {};
  payload = plainCurrentFxAutosavePayload(payload);
  if (!payload) return false;
  var localOk = true;
  try {
    localStorage.setItem(CURRENT_FX_AUTOSAVE_STORE_KEY, JSON.stringify(payload));
    try { localStorage.removeItem(LYRIC_LAYOUT_STORE_KEY); } catch (cleanupError) { }
  } catch (localError) {
    localOk = false;
    console.warn('[FxAutosave] localStorage write failed, disk mirror will be used:', localError);
  }
  if (opts.syncDisk) {
    if (currentFxAutosaveDiskTimer) {
      clearTimeout(currentFxAutosaveDiskTimer);
      currentFxAutosaveDiskTimer = null;
    }
    currentFxAutosaveDiskPayload = null;
    persistCurrentFxAutosaveDisk(payload, true);
  } else {
    queueCurrentFxAutosaveDiskWrite(payload);
  }
  return localOk;
}

function markCurrentFxAutosaveUserDirty(reason) {
  currentFxAutosaveUserDirty = true;
  currentFxAutosaveLastUserReason = String(reason || currentFxAutosaveLastUserReason || 'user');
}

function currentFxAutosaveSaveReason(opts, fallback) {
  opts = opts || {};
  if (opts.reason) return String(opts.reason).slice(0, 80);
  if (opts.user === true && currentFxAutosaveLastUserReason) return String(currentFxAutosaveLastUserReason).slice(0, 80);
  return String(fallback || 'save').slice(0, 80);
}
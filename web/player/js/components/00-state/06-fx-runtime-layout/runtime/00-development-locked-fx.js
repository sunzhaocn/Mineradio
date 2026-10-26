'use strict';

var DEVELOPMENT_LOCKED_FX = {};

var playbackVisualPreset = readSavedPlaybackVisualPreset();

var startupVisualPreviewActive = false;

var fx = Object.assign({}, fxDefaults, readSavedLyricLayout());

normalizeDevelopmentLockedFxState();

applyPlaylistPanelFxSettings();

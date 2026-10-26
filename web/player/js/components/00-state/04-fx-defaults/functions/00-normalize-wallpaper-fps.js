'use strict';

function normalizeWallpaperFps(value) {
  var n = Number(value);
  if (!isFinite(n) || n <= 0) return 30;
  if (n <= 26) return 24;
  if (n <= 45) return 30;
  return 60;
}

function normalizeForegroundFpsMode(value) {
  var mode = String(value || '').trim().toLowerCase();
  if (mode === 'vsync' || mode === 'adaptive') return mode;
  if (/^(45|60|75|90|120)$/.test(mode)) return mode;
  return fxDefaults.foregroundFpsMode || 'vsync';
}

function foregroundFixedFpsForMode(mode) {
  mode = normalizeForegroundFpsMode(mode);
  if (mode === 'vsync') return 0;
  if (mode === 'adaptive') return null;
  return Math.max(1, Number(mode) || 60);
}
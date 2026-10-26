'use strict';


function applyVisualRotationArchiveState(data) {
  if (!data || data.visualRotationSaved !== true) return false;
  var rx = Number(data.visualRotationX) || 0;
  var ry = Number(data.visualRotationY) || 0;
  if (typeof gestureRotation !== 'undefined' && gestureRotation) {
    gestureRotation.x = rx;
    gestureRotation.y = ry;
  }
  if (typeof particleSpin !== 'undefined' && particleSpin) {
    particleSpin.vx = 0;
    particleSpin.vy = 0;
  }
  if (typeof particles !== 'undefined' && particles && particles.rotation) particles.rotation.set(rx, ry, 0);
  if (typeof bloomParticles !== 'undefined' && bloomParticles && bloomParticles.rotation) bloomParticles.rotation.set(rx, ry, 0);
  if (typeof floatGroup !== 'undefined' && floatGroup && floatGroup.rotation) floatGroup.rotation.set(rx, ry, 0);
  if (typeof backCoverGroup !== 'undefined' && backCoverGroup && backCoverGroup.rotation) backCoverGroup.rotation.set(rx, ry, 0);
  if (typeof orbit !== 'undefined' && orbit && (Math.abs(rx) > 0.0001 || Math.abs(ry) > 0.0001)) {
    orbit.centerLocked = false;
    orbit.recentering = false;
  }
  return true;
}

function applyCameraArchiveState(data) {
  if (!data || data.cameraViewSaved !== true) return false;
  if (typeof freeCamera !== 'undefined' && freeCamera) {
    freeCamera.active = false;
    freeCamera.resetTween = null;
    freeCamera.keys = {};
    if (freeCamera.velocity) freeCamera.velocity.set(0, 0, 0);
    if (typeof releaseFreeCameraPointerLock === 'function') releaseFreeCameraPointerLock();
  }
  if (data.cameraViewMode === 'free' && typeof freeCamera !== 'undefined' && freeCamera) {
    if (!freeCamera.position) freeCamera.position = new THREE.Vector3();
    freeCamera.position.set(data.cameraFreePositionX, data.cameraFreePositionY, data.cameraFreePositionZ);
    freeCamera.yaw = data.cameraFreeYaw;
    freeCamera.pitch = data.cameraFreePitch;
    freeCamera.roll = data.cameraFreeRoll;
    freeCamera.fov = data.cameraFreeFov;
    freeCamera.locked = true;
    if (typeof saveFreeCameraState === 'function') saveFreeCameraState();
    if (typeof updateFreeCameraHint === 'function') updateFreeCameraHint();
    return true;
  }
  if (typeof freeCamera !== 'undefined' && freeCamera) {
    freeCamera.locked = false;
    if (typeof saveFreeCameraState === 'function') saveFreeCameraState();
    if (typeof updateFreeCameraHint === 'function') updateFreeCameraHint();
  }
  if (typeof orbit !== 'undefined' && orbit) {
    orbit.userTheta = data.cameraOrbitTheta;
    orbit.userPhi = clampRange(data.cameraOrbitPhi, orbit.minPhi, orbit.maxPhi);
    orbit.userRadius = clampRange(data.cameraOrbitRadius, orbit.minRadius, orbit.maxRadius);
    orbit.baselineTheta = orbit.userTheta;
    orbit.baselinePhi = orbit.userPhi;
    orbit.baselineRadius = orbit.userRadius;
    orbit.theta = orbit.userTheta;
    orbit.phi = orbit.userPhi;
    orbit.radius = orbit.userRadius;
    orbit.centerLocked = true;
    orbit.recentering = false;
    if (orbit.lookAt) orbit.lookAt.set(0, 0, 0);
    if (orbit.focus) {
      orbit.focus.active = false;
      orbit.focus.type = null;
    }
    if (typeof clearCenteredViewOffsets === 'function') clearCenteredViewOffsets();
    if (typeof requestStageLyricCameraSnap === 'function') requestStageLyricCameraSnap(12);
    return true;
  }
  return false;
}

function captureFxArchiveSnapshot() {
  return normalizeFxArchiveSnapshot(Object.assign({ visualPresetSchema: VISUAL_PRESET_SCHEMA }, fx, captureCameraArchiveState()));
}

function applySavedLyricPaletteState() {
  if (!stageLyrics) return;
  setStageLyricPalette(fx.lyricColorMode === 'custom'
    ? lyricPaletteFromHex(fx.lyricColor)
    : (stageLyrics.coverPalette || stageLyrics.palette));
  updateLyricColorControls();
  updateLyricHighlightControls();
  updateLyricGlowControls();
}

function applyFxArchiveSnapshot(snapshot) {
  var data = normalizeFxArchiveSnapshot(snapshot);
  if (!data) return false;
  var targetPreset = data.preset;
  Object.keys(data).forEach(function (key) {
    if (key === 'visualPresetSchema' || key === 'preset' || key === 'wallpaperMode' || key === 'desktopLyrics') return;
    if (isCameraArchiveKey(key)) return;
    fx[key] = data[key];
  });
  if (fx.backgroundAlbumCover === true) {
    fx.backgroundMedia = null;
    fx.backgroundImage = '';
  }
  normalizeDevelopmentLockedFxState();
  setPreset(targetPreset, { silent: true, preserveCamera: false, skipTransition: false, noSave: true, commitPlaybackPreset: true });
  applyCameraArchiveState(data);
  applyVisualRotationArchiveState(data);
  applyCoverParticleResolution(fx.coverResolution, { reload: true });
  if (fx.floatLayer) createFloatLayer(); else destroyFloatLayer();
  setParticleLyricsSilently(fx.particleLyrics);
  if (fx.backCover) createBackCoverLayer(); else destroyBackCoverLayer();
  if (fx.aiDepth) {
    aiDepthFailUntil = 0;
    queueAIDepthForCurrentCover(true);
  }
  setShelfMode(fx.shelf);
  if (fx.shelf === 'side') setShelfPinnedOpen(!!fx.shelfPinnedOpen, true, false);
  if (shelfManager && shelfManager.rebuild) shelfManager.rebuild(true);
  if (shelfManager && shelfManager.refreshTheme) shelfManager.refreshTheme();
  setCamMode(fx.cam);
  updateFxInputs();
  applySavedLyricPaletteState();
  refreshCurrentLyricStyle();
  applyDesktopLyricsState(true);
  applyWallpaperModeState(true);
  updateRenderPowerClasses();
  applyRendererPowerMode();
  saveLyricLayout({ user: true, reason: 'archiveApply' });
  return true;
}

function renderUserFxArchives() {
  var grid = document.getElementById('user-archive-grid');
  if (!grid) return;
  grid.innerHTML = userFxArchives.map(function (slot, index) {
    var hasSave = !!slot.snapshot;
    var editing = userFxArchiveEditing === index;
    var nameHtml = editing
      ? '<input class="user-archive-input" id="user-archive-input-' + index + '" type="text" maxlength="18" value="' + escHtml(slot.name) + '" onkeydown="handleUserFxArchiveRenameKey(event,' + index + ')">'
      : '<div class="user-archive-name" title="' + escHtml(slot.name) + '">' + escHtml(slot.name) + '</div>';
    var actionsHtml = editing
      ? '<button type="button" onclick="commitUserFxArchiveRename(' + index + ')">确定</button>' +
      '<button type="button" onclick="cancelUserFxArchiveRename()">取消</button>'
      : '<button type="button" onclick="applyUserFxArchive(' + index + ')"' + (hasSave ? '' : ' disabled') + '>应用</button>' +
      '<button type="button" onclick="saveUserFxArchive(' + index + ')">保存</button>' +
      '<button type="button" onclick="renameUserFxArchive(' + index + ')">命名</button>';
    return '<div class="user-archive-slot' + (hasSave ? ' has-save' : '') + '" data-slot="' + index + '">' +
      nameHtml +
      '<div class="user-archive-meta">' + formatUserArchiveTime(slot.savedAt) + '</div>' +
      '<div class="user-archive-actions">' +
      actionsHtml +
      '</div>' +
      '</div>';
  }).join('');
  if (userFxArchiveEditing >= 0) {
    setTimeout(function () {
      var input = document.getElementById('user-archive-input-' + userFxArchiveEditing);
      if (input) {
        input.focus();
        input.select();
      }
    }, 0);
  }
}

function saveUserFxArchive(index) {
  index = clampRange(Number(index) || 0, 0, Math.max(0, userFxArchives.length - 1));
  userFxArchives[index].snapshot = captureFxArchiveSnapshot();
  userFxArchives[index].savedAt = Date.now();
  userFxArchives[index].name = normalizeUserFxArchiveName(userFxArchives[index].name, index);
  saveUserFxArchives();
  renderUserFxArchives();
  showToast('已保存到 ' + userFxArchives[index].name);
}

function applyUserFxArchive(index) {
  index = clampRange(Number(index) || 0, 0, Math.max(0, userFxArchives.length - 1));
  var slot = userFxArchives[index];
  if (!slot || !slot.snapshot) {
    showToast('这个用户存档还是空的');
    return;
  }
  if (applyFxArchiveSnapshot(slot.snapshot)) {
    showToast('已应用 ' + slot.name);
  }
}

function renameUserFxArchive(index) {
  index = clampRange(Number(index) || 0, 0, Math.max(0, userFxArchives.length - 1));
  userFxArchiveEditing = index;
  renderUserFxArchives();
}

function commitUserFxArchiveRename(index) {
  index = clampRange(Number(index) || 0, 0, Math.max(0, userFxArchives.length - 1));
  var input = document.getElementById('user-archive-input-' + index);
  userFxArchives[index].name = normalizeUserFxArchiveName(input && input.value, index);
  userFxArchiveEditing = -1;
  saveUserFxArchives();
  renderUserFxArchives();
  showToast('已命名为 ' + userFxArchives[index].name);
}

function cancelUserFxArchiveRename() {
  userFxArchiveEditing = -1;
  renderUserFxArchives();
}

function handleUserFxArchiveRenameKey(e, index) {
  if (e.key === 'Enter') {
    e.preventDefault();
    commitUserFxArchiveRename(index);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    cancelUserFxArchiveRename();
  }
}


function defaultUserFxArchiveName(index) {
  return '用户存档 ' + (Number(index) + 1);
}

function normalizeUserFxArchiveName(name, index) {
  name = String(name || '').replace(/\s+/g, ' ').trim();
  if (!name) name = defaultUserFxArchiveName(index);
  return name.slice(0, 28);
}

function userFxArchiveAt(index) {
  index = Number(index);
  if (!isFinite(index)) return null;
  index = Math.floor(index);
  return index >= 0 && index < userFxArchives.length ? userFxArchives[index] : null;
}

function userFxShareChecksum(text) {
  text = String(text || '');
  var hash = 2166136261;
  for (var i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(7, '0');
}

function bytesToBase64Url(bytes) {
  var binary = '';
  for (var i = 0; i < bytes.length; i += 0x8000) {
    var chunk = bytes.subarray(i, Math.min(i + 0x8000, bytes.length));
    for (var j = 0; j < chunk.length; j++) binary += String.fromCharCode(chunk[j]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(text) {
  text = String(text || '').replace(/-/g, '+').replace(/_/g, '/');
  while (text.length % 4) text += '=';
  var binary = atob(text);
  var bytes = new Uint8Array(binary.length);
  for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function gzipUserFxShareText(text) {
  if (typeof CompressionStream !== 'function') return null;
  var stream = new Blob([String(text || '')]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzipUserFxShareText(bytes) {
  if (typeof DecompressionStream !== 'function') throw new Error('NO_DECOMPRESSION_STREAM');
  var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}

function userFxShareBaselineSnapshot() {
  var raw = null;
  try {
    raw = typeof clonePackagedDefaultFxSnapshot === 'function'
      ? clonePackagedDefaultFxSnapshot()
      : Object.assign({ visualPresetSchema: VISUAL_PRESET_SCHEMA }, fxDefaults || {});
  } catch (e) {
    raw = Object.assign({ visualPresetSchema: VISUAL_PRESET_SCHEMA }, fxDefaults || {});
  }
  return normalizeFxArchiveSnapshot(raw) || {};
}

function userFxShareValueEqual(a, b) {
  if (typeof a === 'number' || typeof b === 'number') {
    var na = Number(a);
    var nb = Number(b);
    return isFinite(na) && isFinite(nb) && Math.abs(na - nb) < 0.000001;
  }
  return a === b;
}

function compactUserFxArchiveSnapshot(snapshot) {
  var data = normalizeFxArchiveSnapshot(snapshot);
  if (!data) return null;
  var full = USER_FX_SHARE_KEYS.map(function (key) { return data[key]; });
  var base = userFxShareBaselineSnapshot();
  var delta = [];
  USER_FX_SHARE_KEYS.forEach(function (key, index) {
    if (!userFxShareValueEqual(data[key], base[key])) delta.push(index, data[key]);
  });
  var compactDelta = [USER_FX_SHARE_COMPACT_DELTA, delta];
  var compactFull = [USER_FX_SHARE_COMPACT_FULL, full];
  return JSON.stringify(compactDelta).length <= JSON.stringify(compactFull).length ? compactDelta : compactFull;
}

function expandUserFxArchiveSnapshot(compact) {
  if (!Array.isArray(compact)) return null;
  var mode = typeof compact[0] === 'string' ? compact[0] : USER_FX_SHARE_COMPACT_FULL;
  var values = typeof compact[0] === 'string' ? compact[1] : compact;
  if (!Array.isArray(values)) return null;
  var raw = mode === USER_FX_SHARE_COMPACT_DELTA ? userFxShareBaselineSnapshot() : {};
  if (mode === USER_FX_SHARE_COMPACT_DELTA) {
    for (var i = 0; i < values.length - 1; i += 2) {
      var deltaIndex = Math.floor(Number(values[i]));
      if (deltaIndex >= 0 && deltaIndex < USER_FX_SHARE_KEYS.length) raw[USER_FX_SHARE_KEYS[deltaIndex]] = values[i + 1];
    }
  } else {
    USER_FX_SHARE_KEYS.forEach(function (key, index) {
      if (index < values.length) raw[key] = values[index];
    });
  }
  return normalizeFxArchiveSnapshot(raw);
}

async function encodeUserFxArchiveShareCode(slot) {
  if (!slot || !slot.snapshot) throw new Error('EMPTY_ARCHIVE');
  var compact = compactUserFxArchiveSnapshot(slot.snapshot);
  if (!compact) throw new Error('INVALID_ARCHIVE');
  var payload = [USER_FX_ARCHIVE_SCHEMA, compact];
  var json = JSON.stringify(payload);
  var rawBytes = new TextEncoder().encode(json);
  var body = USER_FX_SHARE_CODEC_JSON + bytesToBase64Url(rawBytes);
  try {
    var zipped = await gzipUserFxShareText(json);
    if (zipped) {
      var zippedBody = USER_FX_SHARE_CODEC_GZIP + bytesToBase64Url(zipped);
      if (zippedBody.length < body.length) body = zippedBody;
    }
  } catch (e) {
  }
  var version = String(USER_FX_SHARE_VERSION);
  return USER_FX_SHARE_PREFIX + ':' + version + '.' + body + '.' + userFxShareChecksum(version + '.' + body);
}

function extractUserFxShareCode(text) {
  text = String(text || '').trim();
  var direct = text.replace(/\s+/g, '');
  if (/^MR2:[0-9]+\.[A-Za-z][A-Za-z0-9_-]+\.[A-Za-z0-9]+$/.test(direct)) return direct;
  var match = text.match(/MR2:[0-9]+\.[A-Za-z][A-Za-z0-9_-]+\.[A-Za-z0-9]+/);
  return match ? match[0] : '';
}

function looksLikeUserFxShareCode(text) {
  return !!extractUserFxShareCode(text);
}

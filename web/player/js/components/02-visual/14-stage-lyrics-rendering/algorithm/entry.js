'use strict';

function updateStageLyrics3D(dt) {
  const _invocationState = {dt: dt};
  _invocationState.tickMesh = updateStageLyrics3DTickMesh.bind(undefined, _invocationState);

  if (!stageLyrics.group) return;
  var playbackLyricsLoading = typeof playbackLyricsAreLoading === 'function' && playbackLyricsAreLoading();
  stageLyrics.group.visible = !playbackLyricsLoading;
  if (!fx.particleLyrics && !stageLyrics.current && (!stageLyrics.outgoing || !stageLyrics.outgoing.length)) {
    if (playbackLyricsLoading && typeof syncPlaybackLoadingLyricPosition === 'function') syncPlaybackLoadingLyricPosition();
    return;
  }
  resetLyricRenderUploadFrameBudget(true);
  if (!isFinite(stageLyrics.highBloom)) stageLyrics.highBloom = 0;
  if (!isFinite(stageLyrics.beatGlow)) stageLyrics.beatGlow = 0;
  if (!isFinite(stageLyrics.glowFollowX)) stageLyrics.glowFollowX = 0;
  if (!isFinite(stageLyrics.glowFollowY)) stageLyrics.glowFollowY = 0;
  if (!isFinite(stageLyrics.glowFollowRoll)) stageLyrics.glowFollowRoll = 0;
  _invocationState.t = uniforms.uTime.value;
  _invocationState.lyricMotion = lyricMotionProfile();
  _invocationState.previewMotionLock = stageLyricProgressPreviewActive();
  _invocationState.verticalFloatOn = !_invocationState.previewMotionLock && lyricVerticalFloatEnabled();
  _invocationState.lyricFloatAmp = _invocationState.verticalFloatOn ? (_invocationState.lyricMotion.floatAmp || 1) : 0;
  _invocationState.lyricGlowStrength = fx.lyricGlow ? Math.min(0.85, Math.max(0, fx.lyricGlowStrength)) : 0;
  _invocationState.glowDrive = Math.min(1.7, Math.max(0, _invocationState.lyricGlowStrength / 0.50));
  _invocationState.glowBreath = _invocationState.lyricGlowStrength > 0 ? (0.5 + 0.5 * Math.sin(_invocationState.t * 1.05)) : 0;
  _invocationState.musicBloom = Math.max(lyricSunEnergy, beatPulse * 0.10);
  _invocationState.beatGlowRaw = fx.lyricGlowBeat && _invocationState.lyricGlowStrength > 0
    ? Math.max(beatPulse * 1.22, beatCam.punch * 0.86 + beatCam.radiusKick * 1.85)
    : 0;
  stageLyrics.beatGlow += (_invocationState.beatGlowRaw - stageLyrics.beatGlow) * (_invocationState.beatGlowRaw > stageLyrics.beatGlow ? 0.32 : 0.10);
  if (!isFinite(stageLyrics.beatGlow)) stageLyrics.beatGlow = 0;
  _invocationState.skullLyricPreset = !!(fx && fx.preset === SKULL_PRESET_INDEX);
  _invocationState.sonicLyricPreset = !!(typeof SONIC_PRESET_INDEX !== 'undefined' && fx && fx.preset === SONIC_PRESET_INDEX);
  _invocationState.solarBloom = _invocationState.lyricGlowStrength > 0 ? (0.18 + _invocationState.glowBreath * 0.16 + _invocationState.musicBloom * 0.90 + stageLyrics.beatGlow * 1.18 + Math.sin(_invocationState.t * 0.37 + 1.2) * 0.035) * _invocationState.glowDrive : 0;
  if (_invocationState.skullLyricPreset && _invocationState.lyricGlowStrength > 0) {
    _invocationState.solarBloom = (0.035 + _invocationState.glowBreath * 0.030 + _invocationState.musicBloom * 0.11 + Math.pow(Math.max(0, stageLyrics.beatGlow), 1.26) * 1.45 + Math.pow(Math.max(0, skullBeatFlash || 0), 1.08) * 1.18) * _invocationState.glowDrive;
  }
  _invocationState.solarBloom = Math.max(0, Math.min(1.45, _invocationState.solarBloom));
  stageLyrics.highBloom += (_invocationState.solarBloom - stageLyrics.highBloom) * (_invocationState.solarBloom > stageLyrics.highBloom ? (_invocationState.skullLyricPreset ? 0.22 : 0.075) : (_invocationState.skullLyricPreset ? 0.070 : 0.050));
  if (!isFinite(stageLyrics.highBloom)) stageLyrics.highBloom = 0;
  updateLyricStarRiver(_invocationState.dt);
  _invocationState.followDrive = fx.lyricGlowBeat && _invocationState.lyricGlowStrength > 0 ? Math.min(1.35, stageLyrics.beatGlow) : 0;
  _invocationState.followXTarget = _invocationState.followDrive * (beatCam.thetaKick * 34 + beatCam.rollKick * 8);
  _invocationState.followYTarget = _invocationState.followDrive * (beatCam.phiKick * 42 - beatCam.radiusKick * 0.48);
  _invocationState.followRollTarget = _invocationState.followDrive * (beatCam.rollKick * 22 + beatCam.thetaKick * 10);
  stageLyrics.glowFollowX += (_invocationState.followXTarget - stageLyrics.glowFollowX) * 0.26;
  stageLyrics.glowFollowY += (_invocationState.followYTarget - stageLyrics.glowFollowY) * 0.24;
  stageLyrics.glowFollowRoll += (_invocationState.followRollTarget - stageLyrics.glowFollowRoll) * 0.22;
  stageLyrics.glowFollowX *= 0.92;
  stageLyrics.glowFollowY *= 0.92;
  stageLyrics.glowFollowRoll *= 0.90;
  _invocationState.layoutScale = clampRange(Number(fx.lyricScale) || 1, 0.35, 1.65);
  _invocationState.layoutX = clampRange(Number(fx.lyricOffsetX) || 0, -4.0, 4.0);
  _invocationState.layoutY = clampRange(Number(fx.lyricOffsetY) || 0, -2.4, 2.7);
  _invocationState.layoutZ = clampRange(Number(fx.lyricOffsetZ) || 0, -3.2, 3.2);
  _invocationState.layoutTiltX = clampRange(Number(fx.lyricTiltX) || 0, -84, 84);
  _invocationState.layoutTiltY = clampRange(Number(fx.lyricTiltY) || 0, -84, 84);
  _invocationState.skullMouthLyrics = !!(camera && fx && fx.preset === SKULL_PRESET_INDEX && skullParticleGroup && skullParticleGroup.visible);
  _invocationState.shelfDetailOpen = !!(shelfManager && shelfManager.hasOpenContent && shelfManager.hasOpenContent());
  _invocationState.skullShelfDetailOpen = !!(fx && fx.preset === SKULL_PRESET_INDEX && _invocationState.shelfDetailOpen);
  _invocationState.normalShelfDetailOpen = !!(_invocationState.shelfDetailOpen && !_invocationState.skullShelfDetailOpen);
  _invocationState.multiLayerLyricsActive = normalizeLyricDisplayMode(fx && fx.lyricDisplayMode) !== 'single' || normalizeLyricTranslationMode(fx && fx.lyricTranslationMode) !== 'off';
  _invocationState.stageLyricRenderBase = _invocationState.shelfDetailOpen ? 24 : 260;
  stageLyrics.group.renderOrder = _invocationState.stageLyricRenderBase;
  _invocationState.shelfDetailLyricProfile = _invocationState.shelfDetailOpen ? {
    opacity: _invocationState.skullShelfDetailOpen ? 0.30 : 0.38,
    readability: _invocationState.skullShelfDetailOpen ? 0.20 : 0.26,
    bloom: _invocationState.skullShelfDetailOpen ? 0.20 : 0.24,
    glowCap: _invocationState.skullShelfDetailOpen ? 0.050 : 0.070,
    outgoing: _invocationState.skullShelfDetailOpen ? 0.34 : 0.42,
    easeDown: 0.34
  } : {
    opacity: 0.96,
    readability: 0.86,
    bloom: 1,
    glowCap: 1.0,
    outgoing: 1,
    easeDown: 0.16
  };
  _invocationState.shelfLyricAvoid = shouldAvoidStageLyricsForShelf();
  _invocationState.wallpaperLyricLock = shouldUseWallpaperLyricCameraLock();
  _invocationState.wallpaperShelfLyrics = _invocationState.wallpaperLyricLock && shouldDimWallpaperForShelf();
  if (_invocationState.wallpaperLyricLock) {
    _invocationState.layoutScale *= _invocationState.wallpaperShelfLyrics ? 0.60 : 0.84;
    _invocationState.layoutX = clampRange(_invocationState.layoutX + (_invocationState.wallpaperShelfLyrics ? -1.34 : 0), -4.0, 4.0);
    _invocationState.layoutY = clampRange(_invocationState.layoutY + (_invocationState.wallpaperShelfLyrics ? -0.04 : 0.08), -2.4, 2.7);
    _invocationState.layoutZ = clampRange(_invocationState.layoutZ + (_invocationState.wallpaperShelfLyrics ? 1.02 : 1.15), -3.2, 3.2);
  } else if (!_invocationState.skullMouthLyrics && _invocationState.shelfLyricAvoid && fx.lyricCameraLock) {
    _invocationState.layoutScale *= 0.72;
    _invocationState.layoutX = clampRange(_invocationState.layoutX - 1.36, -4.0, 4.0);
    _invocationState.layoutY = clampRange(_invocationState.layoutY + 0.06, -2.4, 2.7);
    _invocationState.layoutZ = clampRange(_invocationState.layoutZ + 0.72, -3.2, 3.2);
  } else if (!_invocationState.skullMouthLyrics && shouldOffsetLyricsForShelfDetail()) {
    _invocationState.layoutScale *= _invocationState.normalShelfDetailOpen ? 0.56 : 0.70;
    _invocationState.layoutX = clampRange(_invocationState.layoutX - (_invocationState.normalShelfDetailOpen ? 1.78 : 1.58), -4.0, 4.0);
    _invocationState.layoutY = clampRange(_invocationState.layoutY + (_invocationState.normalShelfDetailOpen ? 0.18 : 0.08), -2.4, 2.7);
    _invocationState.layoutZ = clampRange(_invocationState.layoutZ + 0.84, -3.2, 3.2);
  }
  if (_invocationState.skullMouthLyrics) {
    _invocationState.layoutScale *= _invocationState.skullShelfDetailOpen ? 0.52 : (_invocationState.shelfLyricAvoid ? 0.58 : 0.66);
    if (_invocationState.shelfLyricAvoid && !_invocationState.skullShelfDetailOpen) {
      _invocationState.layoutX = clampRange(_invocationState.layoutX - 0.36, -4.0, 4.0);
      _invocationState.layoutY = clampRange(_invocationState.layoutY + 0.02, -2.4, 2.7);
      _invocationState.layoutZ = clampRange(_invocationState.layoutZ + 0.18, -3.2, 3.2);
    }
  }
  if (_invocationState.sonicLyricPreset && !fx.lyricCameraLock && !_invocationState.wallpaperLyricLock && !_invocationState.skullMouthLyrics) {
    _invocationState.layoutY = clampRange(_invocationState.layoutY - 0.34, -2.4, 2.7);
    _invocationState.layoutZ = clampRange(_invocationState.layoutZ + 0.16, -3.2, 3.2);
  }
  _invocationState.lockBaseDistance = _invocationState.wallpaperShelfLyrics ? 5.58 : 4.85;
  _invocationState.lockDistance = _invocationState.lockBaseDistance + _invocationState.layoutZ;
  _invocationState.cameraLockedLyrics = (fx.lyricCameraLock || _invocationState.wallpaperLyricLock) && camera;
  _invocationState.skullLyricEdgeGuard = !!(fx && fx.preset === SKULL_PRESET_INDEX && (orbit.centerLocked || orbit.recentering));
  _invocationState.lockFit = (_invocationState.cameraLockedLyrics || _invocationState.skullLyricEdgeGuard || _invocationState.skullMouthLyrics) ? lyricCameraLockFit(_invocationState.layoutScale, _invocationState.layoutX, _invocationState.layoutY, _invocationState.skullMouthLyrics ? Math.max(2.2, 4.4 + _invocationState.layoutZ) : _invocationState.lockDistance) : 1;
  if (_invocationState.skullMouthLyrics) _invocationState.lockFit = Math.min(_invocationState.lockFit, 1.12);
  if (!isFinite(stageLyrics.lockFitScale)) stageLyrics.lockFitScale = 1;
  stageLyrics.lockFitScale += (_invocationState.lockFit - stageLyrics.lockFitScale) * (_invocationState.lockFit < stageLyrics.lockFitScale ? 0.18 : 0.10);
  stageLyrics.group.scale.setScalar(_invocationState.layoutScale * stageLyrics.lockFitScale);
  if (_invocationState.skullMouthLyrics) {
    stageLyrics.snapCameraLockFrames = 0;
    skullParticleGroup.updateMatrixWorld(true);
    skullLyricMouthTarget.copy(skullLyricMouthLocal).applyMatrix4(skullParticleGroup.matrixWorld);
    skullParticleGroup.getWorldQuaternion(skullLyricMouthQuat);
    skullLyricMouthForward.set(0, 0, 1).applyQuaternion(skullLyricMouthQuat);
    skullLyricMouthTarget.addScaledVector(skullLyricMouthForward, 0.020);
    skullLyricReadableQuat.copy(skullLyricMouthQuat);
    setStageLyricViewBasisFromCameraOrQuaternion(skullLyricMouthQuat);
    lyricLayoutTarget.copy(skullLyricMouthTarget);
    applyStageLyricLayoutOffset(lyricLayoutTarget, _invocationState.layoutX, _invocationState.layoutY, _invocationState.layoutZ);
    stageLyricTargetQuaternion(skullLyricReadableQuat, _invocationState.layoutTiltX, _invocationState.layoutTiltY);
    stageLyrics.group.userData = stageLyrics.group.userData || {};
    if (!stageLyrics.group.userData.skullMouthLocked) {
      stageLyrics.group.position.copy(lyricLayoutTarget);
      stageLyrics.group.quaternion.copy(lyricTargetQuat);
      stageLyrics.group.userData.skullMouthLocked = true;
    } else {
      stageLyrics.group.position.lerp(lyricLayoutTarget, 0.26);
      stageLyrics.group.quaternion.slerp(lyricTargetQuat, 0.30);
    }
  } else if (_invocationState.cameraLockedLyrics) {
    if (stageLyrics.group.userData) stageLyrics.group.userData.skullMouthLocked = false;
    setStageLyricViewBasisFromCameraOrQuaternion(null);
    lyricLayoutBase.copy(camera.position).addScaledVector(lyricCameraDir, _invocationState.lockBaseDistance);
    lyricCameraTarget.copy(lyricLayoutBase);
    applyStageLyricLayoutOffset(lyricCameraTarget, _invocationState.layoutX, _invocationState.layoutY, _invocationState.layoutZ);
    stageLyricTargetQuaternion(camera.quaternion, _invocationState.layoutTiltX, _invocationState.layoutTiltY);
    if (stageLyrics.snapCameraLockFrames > 0) {
      stageLyrics.group.position.copy(lyricCameraTarget);
      stageLyrics.group.quaternion.copy(lyricTargetQuat);
      if (stageLyrics.snapCameraLockFrames > 0) stageLyrics.snapCameraLockFrames -= 1;
    } else {
      _invocationState.lockPosEase = _invocationState.wallpaperLyricLock ? (_invocationState.wallpaperShelfLyrics ? 0.42 : 0.34) : 0.24;
      _invocationState.lockQuatEase = _invocationState.wallpaperLyricLock ? (_invocationState.wallpaperShelfLyrics ? 0.44 : 0.36) : 0.22;
      stageLyrics.group.position.lerp(lyricCameraTarget, _invocationState.lockPosEase);
      stageLyrics.group.quaternion.slerp(lyricTargetQuat, _invocationState.lockQuatEase);
    }
  } else {
    if (stageLyrics.group.userData) stageLyrics.group.userData.skullMouthLocked = false;
    stageLyrics.snapCameraLockFrames = 0;
    if (particles) {
      particles.updateMatrixWorld(true);
      particles.getWorldPosition(lyricCoverWorldPos);
      particles.getWorldQuaternion(lyricCoverWorldQuat);
    } else {
      lyricCoverWorldPos.set(0, 0, 0);
      lyricCoverWorldQuat.identity();
    }
    setStageLyricViewBasisFromCameraOrQuaternion(lyricCoverWorldQuat);
    lyricLayoutBase.copy(lyricCoverWorldPos);
    lyricLayoutTarget.copy(lyricLayoutBase);
    applyStageLyricLayoutOffset(lyricLayoutTarget, _invocationState.layoutX, _invocationState.layoutY, _invocationState.layoutZ);
    stageLyrics.group.position.copy(lyricLayoutTarget);
    stageLyricTargetQuaternion(lyricCoverWorldQuat, _invocationState.layoutTiltX, _invocationState.layoutTiltY);
    stageLyrics.group.quaternion.copy(lyricTargetQuat);
  }
  
  _invocationState.tickMesh(stageLyrics.current, true);
  for ((_invocationState.i = stageLyrics.outgoing.length - 1); _invocationState.i >= 0; _invocationState.i--) {
    if (!_invocationState.tickMesh(stageLyrics.outgoing[_invocationState.i], false)) {
      disposeLyricMesh(stageLyrics.outgoing[_invocationState.i]);
      stageLyrics.outgoing.splice(_invocationState.i, 1);
    }
  }
  // Loading shares the lyric layout and anchor; keep their transforms current
  // while the real lyric meshes stay hidden until the media is ready.
  if (typeof updatePlaybackLoadingLyricMesh === 'function') updatePlaybackLoadingLyricMesh(_invocationState);
  if (playbackLyricsLoading && typeof syncPlaybackLoadingLyricPosition === 'function') syncPlaybackLoadingLyricPosition();
  if (typeof finalizeLyricQualitySelectionFrame === 'function') finalizeLyricQualitySelectionFrame();
}

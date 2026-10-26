'use strict';

function updateStageLyrics3DTickMesh(_invocationState, mesh, isCurrent) {
    if (!mesh) return false;
    var holdingForLyricReveal = false;
    if (!isCurrent && mesh.userData && mesh.userData.lyricRevealSuccessor) {
      var revealSuccessor = mesh.userData.lyricRevealSuccessor;
      if (stageLyrics.current !== revealSuccessor || !revealSuccessor.parent || stageLyricTrackRevealReady(revealSuccessor)) {
        mesh.userData.lyricRevealSuccessor = null;
        mesh.userData.age = 0;
      } else {
        holdingForLyricReveal = true;
        mesh.userData.age = 0;
      }
    }
    if (!holdingForLyricReveal) mesh.userData.age += _invocationState.dt;
    var a = Math.min(1, mesh.userData.age / (isCurrent ? _invocationState.lyricMotion.enter : _invocationState.lyricMotion.exit));
    a = a * a * (3 - 2 * a);
    var data = mesh.userData.lyric || {};
    var loadingReveal = mesh.userData.playbackLoading && typeof playbackLoadingLyricRevealProgress === 'function'
      ? playbackLoadingLyricRevealProgress() : 1;
    if (_invocationState.previewMotionLock) {
      if (!mesh.userData.progressPreviewMotionLocked) {
        mesh.userData.progressPreviewHoldX = Number(mesh.position.x) || 0;
        mesh.userData.progressPreviewHoldY = Number(mesh.position.y) || 0;
        mesh.userData.progressPreviewHoldZ = Number(mesh.position.z) || 0;
        mesh.userData.progressPreviewHoldScale = Number(mesh.scale.x) || 1;
        mesh.userData.progressPreviewHoldRotationZ = Number(mesh.rotation.z) || 0;
        mesh.userData.progressPreviewMotionLocked = true;
      }
      mesh.userData.progressPreviewMotionBlend = 0;
    } else {
      if (mesh.userData.progressPreviewMotionLocked) {
        mesh.userData.progressPreviewMotionLocked = false;
        mesh.userData.progressPreviewMotionBlend = 0;
      }
      if (isFinite(Number(mesh.userData.progressPreviewMotionBlend)) && Number(mesh.userData.progressPreviewMotionBlend) < 1) {
        mesh.userData.progressPreviewMotionBlend = Math.min(1, Number(mesh.userData.progressPreviewMotionBlend) + _invocationState.dt / 0.32);
      } else {
        mesh.userData.progressPreviewMotionBlend = 1;
      }
    }
    var previewMotionBlend = _invocationState.previewMotionLock ? 0 : clampRange(Number(mesh.userData.progressPreviewMotionBlend), 0, 1);
    if (isCurrent && data.trackPersistent && data.trackPendingPayload && stageLyricPersistentTargetRowsReady(mesh, data.trackPendingPayload.trackIndex)) {
      commitStageLyricPersistentPendingTarget(mesh);
    }
    var lineStepWorld = clampRange(Number(data.lineWorldStep) || _invocationState.lyricMotion.slide, 0.20, 0.94);
    var singleLineSwap = stageLyricUsesSingleLineSwap(mesh);
    var style = mesh.userData.motionStyle || _invocationState.lyricMotion.style;
    var seed = mesh.userData.floatSeed || 0;
    var glitchAmount = !_invocationState.previewMotionLock && style === 'glitch' ? clampRange(Number(_invocationState.lyricMotion.glitch) || 0, 0, 1.5) : 0;
    var glitchSlice = style === 'glitch' ? clampRange(Number(_invocationState.lyricMotion.glitchSlice) || 0, 0, 1.4) : 0;
    var glitchRate = style === 'glitch' ? clampRange(Number(_invocationState.lyricMotion.glitchRate) || 1, 0.45, 2.2) : 1;
    var glitchJitter = style === 'glitch' ? clampRange(Number(_invocationState.lyricMotion.glitchJitter) || 0, 0, 1.8) : 0;
    var glitchCameraDrive = 0;
    var glitchPulse = 0;
    if (glitchAmount > 0) {
      var beatShake = clampRange(Math.abs(beatCam.rollKick) * 1.5 + Math.abs(beatCam.thetaKick) * 0.8 + Math.abs(beatCam.radiusKick) * 1.25 + beatCam.punch * 1.05, 0, 1.35);
      var rawBeatDrive = clampRange(Math.max(beatPulse * 1.12, stageLyrics.beatGlow * 0.86, beatShake) * (0.86 + clampRange(Number(fx && fx.cinemaShake) || 0, 0, 1.8) * 0.10), 0, 1.55);
      var beatFollowDrive = _invocationState.lyricMotion.glitchCameraBind ? rawBeatDrive : 0;
      var rhythmGate = _invocationState.lyricMotion.glitchCameraBind ? clampRange((beatFollowDrive - 0.14) / 0.58, 0, 1) : 1;
      glitchCameraDrive = beatFollowDrive;
      if (!isFinite(mesh.userData.glitchNextAt) || mesh.userData.glitchNextAt <= 0) {
        mesh.userData.glitchNextAt = _invocationState.t + (0.09 + Math.random() * 0.34) / (0.62 + glitchRate * 0.42);
      }
      if (_invocationState.lyricMotion.glitchCameraBind && beatFollowDrive > 0.22 && _invocationState.t - (mesh.userData.glitchLastBeatAt || -10) > 0.055) {
        mesh.userData.glitchBurst = Math.max(mesh.userData.glitchBurst || 0, beatFollowDrive * rhythmGate * (0.52 + glitchJitter * 0.18 + Math.random() * 0.58));
        mesh.userData.glitchHold = Math.max(mesh.userData.glitchHold || 0, (0.014 + Math.random() * 0.060) * (0.75 + glitchJitter * 0.20));
        mesh.userData.glitchSeed = Math.random() * 997;
        mesh.userData.glitchLastBeatAt = _invocationState.t;
        mesh.userData.glitchNextAt = Math.min(mesh.userData.glitchNextAt, _invocationState.t + (0.055 + Math.random() * 0.16));
      }
      if (_invocationState.t >= mesh.userData.glitchNextAt) {
        if (!_invocationState.lyricMotion.glitchCameraBind || beatFollowDrive > 0.30) {
          var randomBurst = 0.12 + Math.pow(Math.random(), 0.52) * (_invocationState.lyricMotion.glitchCameraBind ? 0.48 : 0.66);
          randomBurst *= _invocationState.lyricMotion.glitchCameraBind ? rhythmGate : 1;
          mesh.userData.glitchBurst = Math.max(mesh.userData.glitchBurst || 0, randomBurst);
          mesh.userData.glitchHold = Math.max(mesh.userData.glitchHold || 0, (0.010 + Math.random() * 0.076) * (0.80 + glitchJitter * 0.18));
          mesh.userData.glitchSeed = Math.random() * 997;
        }
        mesh.userData.glitchNextAt = _invocationState.t + (_invocationState.lyricMotion.glitchCameraBind ? (0.14 + Math.random() * 0.55) : (0.075 + Math.random() * 0.52)) / (0.58 + glitchRate * 0.46);
      }
      mesh.userData.glitchHold = Math.max(0, (mesh.userData.glitchHold || 0) - _invocationState.dt);
      var decay = mesh.userData.glitchHold > 0 ? Math.pow(0.22, _invocationState.dt) : Math.pow(0.018, _invocationState.dt);
      mesh.userData.glitchBurst = Math.max(0, (mesh.userData.glitchBurst || 0) * decay);
      glitchPulse = clampRange(((mesh.userData.glitchBurst || 0) * rhythmGate + beatFollowDrive * (0.16 + glitchJitter * 0.045)) * glitchAmount, 0, 1.95);
    }
    if (data.textMat && data.textMat.uniforms) {
      if (data.textMat.uniforms.uGlitchBurst) data.textMat.uniforms.uGlitchBurst.value = glitchPulse;
      if (data.textMat.uniforms.uGlitchSeed) data.textMat.uniforms.uGlitchSeed.value = mesh.userData.glitchSeed || seed || 0;
    }
    var glitchJitterSeed = mesh.userData.glitchSeed || seed;
    var jitterScale = 0.50 + glitchJitter * 0.62;
    var textJitterX = glitchPulse ? Math.sin(_invocationState.t * (61.0 + glitchRate * 26.0) + glitchJitterSeed) * (0.011 + glitchSlice * 0.023) * (0.65 + glitchPulse * 0.55) * jitterScale : 0;
    var textJitterY = glitchPulse ? Math.cos(_invocationState.t * (37.0 + glitchRate * 15.0) + glitchJitterSeed * 1.7) * (0.003 + glitchSlice * 0.005) * (0.55 + glitchPulse * 0.45) * jitterScale : 0;
    var shownProgress = mesh.userData.shownLyricProgress || 0;
    if (isCurrent && data.textMat && data.textMat.uniforms && data.textMat.uniforms.uProgress) {
      var targetProgress = clampRange(Number(mesh.userData.targetLyricProgress) || 0, 0, 1);
      shownProgress = clampRange(Number(data.textMat.uniforms.uProgress.value) || 0, 0, 1);
      if (mesh.userData.nativeKaraokeProgress) {
        shownProgress = targetProgress;
      } else {
        var progressDiff = targetProgress - shownProgress;
        var progressEase = Math.abs(progressDiff) > 0.42 ? Math.max(0.52, _invocationState.lyricMotion.progressEase * 1.55) : _invocationState.lyricMotion.progressEase;
        if (mesh.userData.age < 0.16) progressEase = Math.max(progressEase, 0.28);
        shownProgress = clampRange(shownProgress + progressDiff * progressEase, 0, 1);
      }
      data.textMat.uniforms.uProgress.value = shownProgress;
      mesh.userData.shownLyricProgress = shownProgress;
    }
    var followMix = isCurrent ? 1.0 : 0.64;
    var glowX = stageLyrics.glowFollowX * followMix;
    var glowY = stageLyrics.glowFollowY * followMix;
    var glowRoll = stageLyrics.glowFollowRoll * followMix;
    if (data.textMesh) {
      data.textMesh.position.x += (textJitterX - data.textMesh.position.x) * (glitchPulse ? 0.74 : 0.22);
      data.textMesh.position.y += (textJitterY - data.textMesh.position.y) * (glitchPulse ? 0.74 : 0.22);
    }
    if (data.readability) {
      data.readability.position.x += (textJitterX * 0.46 - data.readability.position.x) * (glitchPulse ? 0.58 : 0.18);
      data.readability.position.y += (textJitterY * 0.40 - data.readability.position.y) * (glitchPulse ? 0.58 : 0.18);
    }
    if (data.context) {
      data.context.position.x += (textJitterX * 0.28 - data.context.position.x) * (glitchPulse ? 0.44 : 0.12);
    }
    if (data.glow) {
      var glowFollowX = data.glowFrameLocked ? 0.045 : 0.14;
      var glowFollowY = data.glowFrameLocked ? 0.040 : 0.12;
      data.glow.visible = !data.suppressStaticGlow;
      if (!data.suppressStaticGlow) {
        data.glow.position.set(glowX * glowFollowX + textJitterX * 0.32, glowY * glowFollowY + textJitterY * 0.36, -0.006);
        data.glow.rotation.z = glowRoll * 0.30;
      }
    }
    if (data.sun) {
      data.sun.visible = !data.suppressStaticGlow;
      if (!data.suppressStaticGlow) {
        data.sun.position.set(glowX * 0.42, 0.02 + glowY * 0.34, -0.035);
        data.sun.rotation.z = glowRoll * 0.36;
      }
    }
    if (data.sparks) {
      data.sparks.position.set(glowX * 0.24, glowY * 0.22, 0.010);
      data.sparks.rotation.z = glowRoll * 0.22;
    }
    var opacity = 0;
    if (isCurrent) {
      var shelfDetailLyricDim = _invocationState.shelfDetailLyricProfile.bloom;
      var lyricOpacityTarget = _invocationState.shelfDetailLyricProfile.opacity;
      lyricOpacityTarget *= loadingReveal;
      if (!isFinite(Number(data.globalOpacity))) data.globalOpacity = data.textMat && data.textMat.uniforms && data.textMat.uniforms.uOpacity ? Number(data.textMat.uniforms.uOpacity.value) || 0 : 0;
      var currentOpacity = data.globalOpacity;
      var opacityEase = _invocationState.shelfDetailOpen && currentOpacity > lyricOpacityTarget ? _invocationState.shelfDetailLyricProfile.easeDown : 0.16;
      opacity = clampRange(currentOpacity + (lyricOpacityTarget - currentOpacity) * opacityEase, 0, 1);
      data.globalOpacity = opacity;
      if (data.textMat) data.textMat.uniforms.uOpacity.value = opacity;
      if (data.readabilityMat) {
        var readabilityTarget = opacity * _invocationState.shelfDetailLyricProfile.readability;
        var readabilityEase = _invocationState.shelfDetailOpen && data.readabilityMat.opacity > readabilityTarget ? 0.28 : 0.16;
        data.readabilityMat.opacity += (readabilityTarget - data.readabilityMat.opacity) * readabilityEase;
      }
      var contextIntro = clampRange((mesh.userData.age - 0.04) / 0.48, 0, 1);
      contextIntro = contextIntro * contextIntro * (3 - 2 * contextIntro);
      if (data.contextMat) {
        var contextTarget = opacity * _invocationState.shelfDetailLyricProfile.readability * clampRange(0.74 + lyricContextOpacityValue() * 0.24, 0.78, 0.98) * contextIntro;
        data.contextMat.opacity += (contextTarget - data.contextMat.opacity) * (contextTarget > data.contextMat.opacity ? 0.11 : 0.075);
        if (data.context) {
          data.context.userData = data.context.userData || {};
          if (_invocationState.previewMotionLock) {
            if (!data.context.userData.progressPreviewMotionLocked) {
              data.context.userData.progressPreviewHoldY = Number(data.context.position.y) || 0;
              data.context.userData.progressPreviewHoldScale = Number(data.context.scale.x) || 1;
              data.context.userData.progressPreviewMotionLocked = true;
            }
            data.context.position.y = data.context.userData.progressPreviewHoldY;
            data.context.scale.setScalar(data.context.userData.progressPreviewHoldScale);
          } else {
            data.context.userData.progressPreviewMotionLocked = false;
            var contextY = ((0.5 - shownProgress) * _invocationState.lyricMotion.contextDrift + (style === 'float' && _invocationState.verticalFloatOn ? Math.sin(_invocationState.t * 0.84 + seed) * 0.016 : 0)) * previewMotionBlend + (mesh.userData.enterDirection || 0) * (1 - a) * lineStepWorld * 0.12;
            var contextScale = 1.0 + (_invocationState.verticalFloatOn ? Math.sin(_invocationState.t * 0.72 + seed) * (style === 'float' ? 0.014 : (style === 'smooth' ? 0.002 : 0.005)) * previewMotionBlend : 0);
            data.context.position.y += (contextY - data.context.position.y) * 0.11;
            data.context.scale.setScalar(previewMotionBlend < 1 ? data.context.scale.x + (contextScale - data.context.scale.x) * 0.06 : contextScale);
          }
        }
      }
      var solar = stageLyrics.highBloom * shelfDetailLyricDim;
      var lyricBeatGlow = fx.lyricGlowBeat ? stageLyrics.beatGlow : 0;
      var currentLineGlow = _invocationState.lyricGlowStrength > 0
        ? Math.min(_invocationState.shelfDetailLyricProfile.glowCap * 1.05, (0.10 + solar * 0.40 + lyricBeatGlow * 0.24 * shelfDetailLyricDim + beatPulse * 0.08) * Math.min(2.4, _invocationState.glowDrive) * (_invocationState.lyricMotion.glowLift || 1))
        : 0;
      currentLineGlow *= loadingReveal;
      updateLyricRowLayers(data, {
        opacity: opacity,
        readability: _invocationState.shelfDetailLyricProfile.readability,
        contextIntro: contextIntro,
        shownProgress: shownProgress,
        contextDrift: _invocationState.lyricMotion.contextDrift + Math.abs(lineStepWorld) * 0.030,
        style: style,
        time: _invocationState.t,
        seed: seed,
        jitterX: textJitterX,
        jitterY: textJitterY,
        glitchPulse: glitchPulse,
        targetIndex: data.trackTargetIndex,
        targetLineIndex: data.trackTargetLineIndex,
        targetVirtualIndex: data.trackTargetVirtualIndex,
        rowGlow: currentLineGlow,
        rowGlowBeat: lyricBeatGlow,
        renderBase: _invocationState.stageLyricRenderBase,
        qualityRootPriority: isCurrent ? 0 : 1000,
        deltaTime: _invocationState.dt,
        previewMotionLock: _invocationState.previewMotionLock,
        motionBlend: previewMotionBlend,
        ease: contextIntro < 0.98 ? 0.19 : 0.135
      });
      if (data.textMat && data.textMat.uniforms.uSolar) {
        var solarTarget = stageLyrics.highBloom * shelfDetailLyricDim;
        var solarEase = _invocationState.shelfDetailOpen && data.textMat.uniforms.uSolar.value > solarTarget ? 0.26 : 0.12;
        data.textMat.uniforms.uSolar.value += (solarTarget - data.textMat.uniforms.uSolar.value) * solarEase;
      }
      solar = stageLyrics.highBloom * shelfDetailLyricDim;
      var warmth = Math.max(0, Math.min(1, solar * 1.10));
      if (data.glowMat) {
        var glowTarget = _invocationState.lyricGlowStrength > 0 ? Math.min(_invocationState.shelfDetailLyricProfile.glowCap, (0.075 + solar * 0.34 + stageLyrics.beatGlow * 0.16 * shelfDetailLyricDim) * Math.min(3.0, _invocationState.glowDrive) * (_invocationState.lyricMotion.glowLift || 1)) : 0;
        if (data.suppressStaticGlow) glowTarget = 0;
        glowTarget *= loadingReveal;
        data.glowMat.opacity += (glowTarget - data.glowMat.opacity) * (glowTarget > data.glowMat.opacity ? 0.095 : (_invocationState.shelfDetailOpen ? 0.20 : 0.055));
        data.glowMat.color.copy(lyricStageGlowThreeColor(stageLyrics.palette, '#9cffdf', 0.36)).lerp(lyricSunHotColor, warmth);
      }
      if (data.sparkMat) {
        var sparkTarget = _invocationState.lyricGlowStrength > 0 && fx.lyricGlowParticles && !_invocationState.shelfDetailOpen ? Math.min(0.42, (0.10 + solar * 0.14 + stageLyrics.beatGlow * 0.10) * Math.min(1.6, _invocationState.glowDrive)) : 0;
        sparkTarget *= loadingReveal;
        var sparkOpacity = getLyricSparkOpacity(data);
        sparkOpacity += (sparkTarget - sparkOpacity) * (sparkTarget > sparkOpacity ? 0.13 : (_invocationState.shelfDetailOpen ? 0.22 : 0.075));
        setLyricSparkOpacity(data, sparkOpacity);
        var sparkSizeTarget = fx.lyricGlowParticles && !_invocationState.shelfDetailOpen ? (0.050 + solar * 0.016 + stageLyrics.beatGlow * 0.026 + bass * 0.008) : 0.035;
        setLyricSparkSize(data, getLyricSparkSize(data) + (sparkSizeTarget - getLyricSparkSize(data)) * 0.12);
        var sparkColor = lyricSunHotColor.clone().lerp(lyricSunColor, 0.22 + solar * 0.18);
        setLyricSparkColor(data, sparkColor);
      }
      if (data.sunMat) {
        var sunTarget = _invocationState.lyricGlowStrength > 0 && !_invocationState.shelfDetailOpen ? Math.min(0.88, (Math.pow(Math.min(1.35, solar), 1.08) * 0.28 + stageLyrics.beatGlow * 0.20) * Math.min(2.4, _invocationState.glowDrive) * (style === 'shine' ? 1.18 : 1)) : 0;
        if (data.suppressStaticGlow) sunTarget = 0;
        sunTarget *= loadingReveal;
        data.sunMat.opacity += (sunTarget - data.sunMat.opacity) * (_invocationState.shelfDetailOpen ? 0.18 : 0.055);
        data.sunMat.color.copy(lyricSunColor).lerp(lyricSunHotColor, solar * 0.55);
      }
      if (data.sun) {
        var sunPulse = solar;
        var beatScale = fx.lyricGlowBeat ? stageLyrics.beatGlow * 0.24 : 0;
        data.sun.scale.set(0.82 + sunPulse * 0.36 + beatScale + Math.sin(_invocationState.t * 1.6) * sunPulse * 0.018, 0.60 + sunPulse * 0.34 + beatScale * 0.72 + Math.cos(_invocationState.t * 1.25) * sunPulse * 0.020, 1);
        data.sun.rotation.z += Math.sin(_invocationState.t * 0.32 + seed) * 0.010 * sunPulse;
      }
      var breathe = (Math.sin(_invocationState.t * 0.92 + seed) * 0.050 + Math.sin(_invocationState.t * 0.41 + seed * 0.7) * 0.028) * _invocationState.lyricFloatAmp * previewMotionBlend;
      if (_invocationState.previewMotionLock) {
        mesh.position.set(
          Number(mesh.userData.progressPreviewHoldX) || 0,
          Number(mesh.userData.progressPreviewHoldY) || 0,
          Number(mesh.userData.progressPreviewHoldZ) || 0
        );
        mesh.scale.setScalar(Number(mesh.userData.progressPreviewHoldScale) || 1);
        mesh.rotation.z = Number(mesh.userData.progressPreviewHoldRotationZ) || 0;
      } else if (_invocationState.skullMouthLyrics) {
        var mouthMeshY = -0.070 + (Math.sin(_invocationState.t * 0.50 + seed) * 0.018 + Math.sin(_invocationState.t * 1.12 + seed) * 0.006) * previewMotionBlend;
        var mouthMeshZ = 0.018 + Math.cos(_invocationState.t * 0.46 + seed) * 0.007 * previewMotionBlend;
        var mouthMeshScale = 1.08 + a * 0.040 + breathe * 0.12 + bass * 0.024 + beatPulse * 0.014;
        if (!mesh.userData.skullMouthMeshLocked) {
          mesh.position.set(0, mouthMeshY, mouthMeshZ);
          mesh.userData.skullMouthMeshLocked = true;
        } else {
          mesh.position.x += (0 - mesh.position.x) * 0.18;
          mesh.position.y += (mouthMeshY - mesh.position.y) * 0.16;
          mesh.position.z += (mouthMeshZ - mesh.position.z) * 0.18;
        }
        mesh.scale.setScalar(previewMotionBlend < 1 ? mesh.scale.x + (mouthMeshScale - mesh.scale.x) * 0.06 : mouthMeshScale);
        var mouthRotationTarget = (Math.sin(_invocationState.t * 0.30 + seed) * 0.010 + textJitterX * 0.20 + glitchCameraDrive * glitchAmount * 0.012) * previewMotionBlend;
        mesh.rotation.z = previewMotionBlend < 1 ? mesh.rotation.z + (mouthRotationTarget - mesh.rotation.z) * 0.18 : mouthRotationTarget;
      } else {
        mesh.userData.skullMouthMeshLocked = false;
        var rootScaleTarget = 0.96 + a * 0.055 + breathe + bass * 0.038 + beatPulse * 0.014;
        mesh.scale.setScalar(previewMotionBlend < 1 ? mesh.scale.x + (rootScaleTarget - mesh.scale.x) * 0.06 : rootScaleTarget);
        if (singleLineSwap) {
          mesh.position.y += ((0.18 + (_invocationState.verticalFloatOn ? (Math.sin(_invocationState.t * 0.55 + seed) * 0.055 + Math.sin(_invocationState.t * 1.35 + seed) * 0.014) * previewMotionBlend : 0)) - mesh.position.y) * 0.075;
          mesh.position.z += ((1.48 + (_invocationState.verticalFloatOn ? Math.cos(_invocationState.t * 0.48 + seed) * 0.080 * previewMotionBlend : 0)) - mesh.position.z) * 0.080;
        } else {
          var enterDir = mesh.userData.enterDirection || 0;
          var enterOffsetY = enterDir * lineStepWorld * (1 - a);
          var progressLift = -shownProgress * 0.026;
          mesh.position.y += ((0.20 + enterOffsetY + progressLift + (_invocationState.verticalFloatOn ? (Math.sin(_invocationState.t * 0.55 + seed) * 0.046 + Math.sin(_invocationState.t * 1.35 + seed) * 0.012) * previewMotionBlend : 0)) - mesh.position.y) * (enterDir ? 0.115 : 0.080);
          mesh.position.z += ((1.48 - Math.abs(enterDir) * 0.045 * (1 - a) + (_invocationState.verticalFloatOn ? Math.cos(_invocationState.t * 0.48 + seed) * 0.070 * previewMotionBlend : 0)) - mesh.position.z) * 0.090;
        }
        var rootRotationTarget = (Math.sin(_invocationState.t * 0.34 + seed) * (style === 'smooth' ? 0.006 : (style === 'float' ? 0.026 : 0.018)) + textJitterX * 0.18 + glitchCameraDrive * glitchAmount * 0.014) * previewMotionBlend;
        mesh.rotation.z = previewMotionBlend < 1 ? mesh.rotation.z + (rootRotationTarget - mesh.rotation.z) * 0.18 : rootRotationTarget;
      }
      if (data.sparks && data.sparkMat) data.sparks.visible = fx.lyricGlowParticles || getLyricSparkOpacity(data) > 0.015;
      if (data.sparks && data.basePositions) {
        var pos = data.sparks.geometry.attributes.position;
        var arr = pos.array, base = data.basePositions;
        data.sparks.rotation.z += ((fx.lyricGlowParticles ? 0.0009 : 0.00025) + stageLyrics.beatGlow * 0.0007) * (_invocationState.dt * 60);
        data.sparks.rotation.x = Math.sin(_invocationState.t * 0.12 + seed) * 0.012;
        for (var si = 0; si < arr.length / 3; si++) {
          var s = si * 12.989 + seed;
          var particleBeat = fx.lyricGlowParticles ? stageLyrics.beatGlow : 0;
          var dustBreath = fx.lyricGlowParticles ? (0.62 + 0.38 * Math.sin(_invocationState.t * (0.32 + (si % 7) * 0.025) + s)) : 0.18;
          var drift = fx.lyricGlowParticles ? 1 : 0.30;
          arr[si * 3] = base[si * 3] + Math.sin(_invocationState.t * (0.18 + (si % 5) * 0.025) + s) * (0.045 + bass * 0.030 + particleBeat * 0.052) * drift + Math.cos(_invocationState.t * 0.11 + s) * 0.018 * dustBreath;
          arr[si * 3 + 1] = base[si * 3 + 1] + Math.cos(_invocationState.t * (0.16 + (si % 6) * 0.024) + s) * (0.042 + mid * 0.026 + particleBeat * 0.046) * drift + Math.sin(_invocationState.t * 0.13 + s) * 0.016 * dustBreath;
          arr[si * 3 + 2] = base[si * 3 + 2] + Math.sin(_invocationState.t * (0.24 + (si % 4) * 0.035) + s) * (0.036 + particleBeat * 0.028) * drift;
        }
        pos.needsUpdate = true;
      }
      return true;
    }
    opacity = holdingForLyricReveal
      ? clampRange(Number(data.globalOpacity) || _invocationState.shelfDetailLyricProfile.opacity, 0, 1)
      : (1 - a) * 0.72 * _invocationState.shelfDetailLyricProfile.outgoing;
    if (data.textMat) data.textMat.uniforms.uOpacity.value = opacity;
    if (data.readabilityMat) data.readabilityMat.opacity = opacity * (_invocationState.shelfDetailOpen ? _invocationState.shelfDetailLyricProfile.readability : 0.58);
    if (data.contextMat) data.contextMat.opacity = opacity * (_invocationState.shelfDetailOpen ? _invocationState.shelfDetailLyricProfile.readability * 0.72 : clampRange(0.46 + lyricContextOpacityValue() * 0.26, 0.54, 0.76));
    updateLyricRowLayers(data, {
      opacity: opacity,
      readability: _invocationState.shelfDetailOpen ? _invocationState.shelfDetailLyricProfile.readability : 0.58,
      contextIntro: 1,
      shownProgress: shownProgress,
      contextDrift: _invocationState.lyricMotion.contextDrift * 0.42,
      style: style,
      time: _invocationState.t,
      seed: seed,
      jitterX: textJitterX,
      jitterY: textJitterY,
      glitchPulse: glitchPulse,
      targetIndex: data.trackTargetIndex,
      renderBase: _invocationState.stageLyricRenderBase,
      qualityRootPriority: isCurrent ? 0 : 1000,
      deltaTime: _invocationState.dt,
      previewMotionLock: _invocationState.previewMotionLock,
      motionBlend: previewMotionBlend,
      ease: 0.22
    });
    if (data.textMat && data.textMat.uniforms.uSolar) data.textMat.uniforms.uSolar.value *= _invocationState.shelfDetailOpen ? 0.72 : 0.86;
    if (data.glowMat) data.glowMat.opacity = (!data.suppressStaticGlow && _invocationState.lyricGlowStrength > 0) ? (_invocationState.shelfDetailOpen ? Math.min(_invocationState.shelfDetailLyricProfile.glowCap * 0.40, opacity * 0.05 * _invocationState.lyricGlowStrength) : opacity * 0.08 * _invocationState.lyricGlowStrength) : 0;
    if (data.sparkMat) {
      var outgoingSpark = _invocationState.lyricGlowStrength > 0 && fx.lyricGlowParticles && !_invocationState.shelfDetailOpen ? Math.max(opacity * 0.24 * _invocationState.lyricGlowStrength, (1 - a) * 0.18 * _invocationState.lyricGlowStrength) : 0;
      setLyricSparkOpacity(data, outgoingSpark);
      setLyricSparkSize(data, 0.046 + (1 - a) * 0.020);
    }
    if (data.sunMat) data.sunMat.opacity = (!data.suppressStaticGlow && _invocationState.lyricGlowStrength > 0 && !_invocationState.shelfDetailOpen) ? opacity * 0.08 * _invocationState.lyricGlowStrength : 0;
    if (_invocationState.previewMotionLock) {
      mesh.position.set(
        Number(mesh.userData.progressPreviewHoldX) || 0,
        Number(mesh.userData.progressPreviewHoldY) || 0,
        Number(mesh.userData.progressPreviewHoldZ) || 0
      );
      mesh.scale.setScalar(Number(mesh.userData.progressPreviewHoldScale) || 1);
      mesh.rotation.z = Number(mesh.userData.progressPreviewHoldRotationZ) || 0;
      return true;
    }
    if (holdingForLyricReveal) return true;
    if (singleLineSwap) {
      mesh.position.z -= _invocationState.dt * 0.26;
      mesh.position.y += _invocationState.dt * 0.08;
      mesh.scale.setScalar(0.98 - a * 0.06);
      return a < 1;
    }
    if (!isFinite(mesh.userData.exitStartY)) mesh.userData.exitStartY = mesh.position.y;
    if (!isFinite(mesh.userData.exitStartZ)) mesh.userData.exitStartZ = mesh.position.z;
    var exitDir = mesh.userData.exitDirection || 0;
    mesh.position.y += ((mesh.userData.exitStartY + exitDir * lineStepWorld * 1.02 * a + 0.050 * a) - mesh.position.y) * (_invocationState.lyricMotion.style === 'quick' ? 0.24 : 0.18);
    mesh.position.z += ((mesh.userData.exitStartZ - 0.24 * a) - mesh.position.z) * 0.16;
    mesh.scale.setScalar(0.98 - a * 0.06);
    return a < 1;
  }

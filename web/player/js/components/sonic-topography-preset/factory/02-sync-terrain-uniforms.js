'use strict';

function installSonicTopographyPresetSyncTerrainUniforms(_moduleState, fx, audio, dt, time) {
    if (!_moduleState.state.terrainMat) return;
    var bands = _moduleState.readBands(fx);
    var kickLow = _moduleState.deriveKickFollowLowBands(audio, bands);
    var target = {
      subBass: kickLow.subBass,
      bass: kickLow.bass,
      lowMid: _moduleState.applyGroundEqBandValue(audio.lowMid, bands, 2, 1),
      mid: _moduleState.applyGroundEqBandValue(audio.mid, bands, 3, 1),
      highMid: _moduleState.applyGroundEqBandValue(audio.highMid, bands, 4, 1),
      presence: _moduleState.applyGroundEqBandValue(audio.presence, bands, 5, 1),
      brilliance: _moduleState.applyGroundEqBandValue(audio.brilliance, bands, 6, 1),
      air: _moduleState.applyGroundEqBandValue(audio.air, bands, 7, 1)
    };
    var smoothed = _moduleState.smoothGroundAudio(target, fx, dt);
    var u = _moduleState.state.terrainMat.uniforms;
    var eqAverage = bands.reduce(function (sum, value) { return sum + value; }, 0) / Math.max(1, bands.length);
    var eqEnergy = _moduleState.clamp(audio.energy * (0.25 + (eqAverage / 50) * 0.75), 0, 1);
    var amplitude = _moduleState.sonicNumber(fx, 'sonicGroundAmplitude', _moduleState.DEFAULT_GROUND_AMPLITUDE, 0, 100);
    var ampMul = amplitude <= 50 ? amplitude / 50 : 1 + Math.pow((amplitude - 50) / 50, 2) * 14;
    u.uTime.value = time;
    u.uSubBass.value = smoothed.subBass;
    u.uBass.value = smoothed.bass;
    u.uLowMid.value = smoothed.lowMid;
    u.uMid.value = smoothed.mid;
    u.uHighMid.value = smoothed.highMid;
    u.uPresence.value = smoothed.presence;
    u.uBrilliance.value = smoothed.brilliance;
    u.uAir.value = smoothed.air;
    u.uEnergy.value = eqEnergy;
    u.uAmplitude.value = ampMul;
    _moduleState.syncTheme(_moduleState.state.terrainMat, fx, {
      subBass: smoothed.subBass,
      bass: smoothed.bass,
      lowMid: smoothed.lowMid,
      mid: smoothed.mid,
      presence: smoothed.presence,
      brilliance: smoothed.brilliance,
      air: smoothed.air,
      sharpness: audio.sharpness,
      smoothness: audio.smoothness,
      density: audio.density
    }, dt);
    _moduleState.syncRippleUniforms(time);
    if (_moduleState.state.floatingMat) {
      _moduleState.syncTheme(_moduleState.state.floatingMat, fx, {
        subBass: smoothed.subBass,
        bass: smoothed.bass,
        lowMid: smoothed.lowMid,
        mid: smoothed.mid,
        presence: smoothed.presence,
        brilliance: smoothed.brilliance,
        air: smoothed.air,
        sharpness: audio.sharpness,
        smoothness: audio.smoothness,
        density: audio.density
      }, dt);
      _moduleState.state.floatingMat.uniforms.uTime.value = time;
      _moduleState.state.floatingMat.uniforms.uPulse.value = _moduleState.state.floatingPulse;
    }
  }

function installSonicTopographyPresetSyncRippleUniforms(_moduleState, time) {
    if (!_moduleState.state.terrainMat) return;
    var arr = _moduleState.state.terrainMat.uniforms.uRipples.value;
    for (var i = 0; i < _moduleState.RIPPLE_MAX; i++) {
      var r = _moduleState.state.ripples[i];
      var age = time - r.start;
      var active = r.strength > 0.001 && age >= 0 && age < _moduleState.RIPPLE_LIFETIME;
      if (!active) {
        arr[i].set(0, 0, -100, 0);
        if (r.strength > 0) r.strength = 0;
        continue;
      }
      var fade = 1 - _moduleState.smoothstep01((age - _moduleState.RIPPLE_SOFT_FADE_START) / (_moduleState.RIPPLE_LIFETIME - _moduleState.RIPPLE_SOFT_FADE_START));
      var strength = r.strength * fade;
      arr[i].set(r.x, r.z, r.start, r.white ? -strength : strength);
    }
  }

function installSonicTopographyPresetAddRipple(_moduleState, x, z, strength, white) {
    var idx = _moduleState.state.rippleIdx;
    var r = _moduleState.state.ripples[idx];
    // Pointer input can arrive before this optional preset has initialized,
    // or after its terrain has been disposed during a preset switch.
    if (!r) return;
    r.x = x;
    r.z = z;
    r.start = _moduleState.state.sonicTime;
    r.strength = _moduleState.clamp(strength, 0.1, 3.0);
    r.white = !!white;
    _moduleState.state.rippleIdx = (idx + 1) % _moduleState.RIPPLE_MAX;
  }

function installSonicTopographyPresetAddMeteor(_moduleState, strength) {
    var now = _moduleState.state.sonicTime;
    if (now - _moduleState.state.lastMeteorAt < 0.55) return;
    _moduleState.state.lastMeteorAt = now;
    var idx = _moduleState.state.meteorIdx;
    var angle = Math.random() * Math.PI * 2;
    var dist = Math.random() * 25;
    var m = _moduleState.state.meteorsData[idx];
    m.active = true;
    m.x = Math.cos(angle) * dist;
    m.z = Math.sin(angle) * dist;
    m.y = 30 + Math.random() * 10;
    m.speed = 1.0 + Math.random() * 0.5 + strength * 1.5;
    m.strength = strength;
    _moduleState.state.meteorIdx = (idx + 1) % _moduleState.METEOR_MAX;
  }

function installSonicTopographyPresetSpawnTrail(_moduleState, x, y, z, speedMul) {
    var idx = _moduleState.state.trailIdx;
    var p = _moduleState.state.trailsData[idx];
    p.active = true;
    p.x = x + (Math.random() - 0.5) * 1.5;
    p.y = y + (Math.random() - 0.5) * 1.5;
    p.z = z + (Math.random() - 0.5) * 1.5;
    p.vx = (Math.random() - 0.5) * 2.0;
    p.vy = Math.random() * 2.0 + speedMul * 10.0;
    p.vz = (Math.random() - 0.5) * 2.0;
    p.life = 0;
    p.maxLife = 0.5 + Math.random() * 0.5;
    p.scale = Math.random() * 0.6 + 0.2;
    _moduleState.state.trailIdx = (idx + 1) % _moduleState.TRAIL_MAX;
  }

function installSonicTopographyPresetUpdateAudioTriggers(_moduleState, audio) {
    var kickActive = audio.kickEnvelope > 0.58;
    if (kickActive && !_moduleState.state.lastKickActive) {
      var angle = Math.random() * Math.PI * 2;
      var dist = Math.random() * 20;
      _moduleState.addRipple(Math.cos(angle) * dist, Math.sin(angle) * dist, Math.min(audio.kickEnvelope * 2.0, 3.0), false);
    }
    _moduleState.state.lastKickActive = audio.kickEnvelope > 0.32;
    var snareActive = audio.presence > 0.52 || audio.brilliance > 0.56;
    if (snareActive && !_moduleState.state.lastSnareActive && Math.random() < 0.55) {
      var angle2 = Math.random() * Math.PI * 2;
      var dist2 = 10 + Math.random() * 35;
      _moduleState.addRipple(Math.cos(angle2) * dist2, Math.sin(angle2) * dist2, Math.min((audio.presence + audio.brilliance) * 1.2, 3.0), true);
    }
    _moduleState.state.lastSnareActive = audio.presence > 0.38 || audio.brilliance > 0.42;
    if (audio.kickEnvelope > 0.62 && Math.random() < 0.045) _moduleState.addMeteor(_moduleState.clamp(audio.kickEnvelope, 0.28, 0.9));
  }

function installSonicTopographyPresetUpdateFloatingBlocks(_moduleState, fx, audio, dt, time) {
    if (!_moduleState.state.floatingBlocks) return;
    var enabledScale = fx && fx.sonicGroundFloatingEnabled === false ? 0 : 1;
    var intensity = _moduleState.sonicNumber(fx, 'sonicGroundFloatingIntensity', _moduleState.DEFAULT_FLOATING_BLOCK_INTENSITY, 0, 100) / 100;
    var minSize = _moduleState.sonicNumber(fx, 'sonicGroundFloatingMinSize', _moduleState.DEFAULT_FLOATING_BLOCK_MIN_SIZE, 0, 100);
    var maxSize = Math.max(minSize, _moduleState.sonicNumber(fx, 'sonicGroundFloatingMaxSize', _moduleState.DEFAULT_FLOATING_BLOCK_MAX_SIZE, 0, 100));
    var speed = _moduleState.sonicNumber(fx, 'sonicGroundFloatingSpeed', _moduleState.DEFAULT_FLOATING_BLOCK_SPEED, 0, 100);
    var speedRate = _moduleState.lerp(3.0, 36.0, speed / 100);
    var pulseBlend = _moduleState.blend01(1 - Math.exp(-speedRate * Math.max(0.001, dt || 1 / 60)));
    _moduleState.state.floatingPulse += (_moduleState.clamp01(audio.kickEnvelope) - _moduleState.state.floatingPulse) * pulseBlend;
    var pulse = _moduleState.state.floatingPulse;
    var minVisualScale = _moduleState.lerp(0.12, 0.75, minSize / 100);
    var maxVisualScale = Math.max(minVisualScale + 0.05, _moduleState.lerp(0.45, 3.2, maxSize / 100));
    var sizeMix = _moduleState.clamp(pulse * (0.5 + intensity * 1.7), 0, 1);
    var pulseScale = _moduleState.lerp(minVisualScale, maxVisualScale, sizeMix);
    for (var i = 0; i < _moduleState.state.floatingData.length; i++) {
      var b = _moduleState.state.floatingData[i];
      var bob = Math.sin(time * (0.55 + b.rotationSpeed) + b.phase) * 0.45;
      _moduleState.state.dummyPos.set(b.x, b.y + bob + pulse * intensity * 1.4, b.z);
      _moduleState.state.dummyEuler.set(
        time * b.rotationSpeed + b.phase,
        time * b.rotationSpeed * 0.7 + b.phase,
        time * b.rotationSpeed * 0.45
      );
      _moduleState.state.dummyQuat.setFromEuler(_moduleState.state.dummyEuler);
      var scale = b.baseScale * pulseScale * enabledScale;
      _moduleState.state.dummyScale.set(scale, scale, scale);
      _moduleState.state.dummyMat4.compose(_moduleState.state.dummyPos, _moduleState.state.dummyQuat, _moduleState.state.dummyScale);
      _moduleState.state.floatingBlocks.setMatrixAt(i, _moduleState.state.dummyMat4);
    }
    _moduleState.state.floatingBlocks.instanceMatrix.needsUpdate = true;
  }

function installSonicTopographyPresetUpdateMeteorsAndTrails(_moduleState, dt) {
    if (!_moduleState.state.meteors || !_moduleState.state.trails) return;
    var i;
    for (i = 0; i < _moduleState.METEOR_MAX; i++) {
      var m = _moduleState.state.meteorsData[i];
      if (!m.active) {
        _moduleState.state.dummyPos.set(0, -1000, 0);
        _moduleState.state.dummyScale.set(0, 0, 0);
      } else {
        m.y -= m.speed * 60 * dt;
        if (m.y <= 0) {
          m.active = false;
          _moduleState.addRipple(m.x, m.z, Math.min(m.strength, 1.2), true);
          for (var t = 0; t < 10; t++) _moduleState.spawnTrail(m.x, 0.5, m.z, m.speed * 1.5);
          _moduleState.state.dummyPos.set(0, -1000, 0);
          _moduleState.state.dummyScale.set(0, 0, 0);
        } else {
          if (Math.random() > 0.3) _moduleState.spawnTrail(m.x, m.y, m.z, m.speed * 0.2);
          _moduleState.state.dummyPos.set(m.x, Math.max(0, m.y), m.z);
          _moduleState.state.dummyScale.set(1.5, 1.5, 1.5);
        }
      }
      _moduleState.state.dummyQuat.identity();
      _moduleState.state.dummyMat4.compose(_moduleState.state.dummyPos, _moduleState.state.dummyQuat, _moduleState.state.dummyScale);
      _moduleState.state.meteors.setMatrixAt(i, _moduleState.state.dummyMat4);
    }
    _moduleState.state.meteors.instanceMatrix.needsUpdate = true;
    for (i = 0; i < _moduleState.TRAIL_MAX; i++) {
      var p = _moduleState.state.trailsData[i];
      if (!p.active) {
        _moduleState.state.dummyPos.set(0, -1000, 0);
        _moduleState.state.dummyScale.set(0, 0, 0);
      } else {
        p.life += dt;
        if (p.life >= p.maxLife) {
          p.active = false;
          _moduleState.state.dummyScale.set(0, 0, 0);
        } else {
          p.x += p.vx * dt * 10;
          p.y += p.vy * dt * 10;
          p.z += p.vz * dt * 10;
          var s = p.scale * (1.0 - p.life / p.maxLife);
          _moduleState.state.dummyPos.set(p.x, p.y, p.z);
          _moduleState.state.dummyScale.set(s, s, s);
        }
      }
      _moduleState.state.dummyQuat.identity();
      _moduleState.state.dummyMat4.compose(_moduleState.state.dummyPos, _moduleState.state.dummyQuat, _moduleState.state.dummyScale);
      _moduleState.state.trails.setMatrixAt(i, _moduleState.state.dummyMat4);
    }
    _moduleState.state.trails.instanceMatrix.needsUpdate = true;
  }

function installSonicTopographyPresetClearLayer(_moduleState) {
    if (_moduleState.state.root && _moduleState.state.scene) _moduleState.state.scene.remove(_moduleState.state.root);
    if (_moduleState.state.terrain) {
      _moduleState.state.terrain.geometry.dispose();
      _moduleState.state.terrain.material.dispose();
    }
    if (_moduleState.state.floatingBlocks) {
      _moduleState.state.floatingBlocks.geometry.dispose();
      _moduleState.state.floatingBlocks.material.dispose();
    }
    if (_moduleState.state.meteors) {
      _moduleState.state.meteors.geometry.dispose();
      _moduleState.state.meteors.material.dispose();
    }
    if (_moduleState.state.trails) {
      _moduleState.state.trails.geometry.dispose();
      _moduleState.state.trails.material.dispose();
    }
    _moduleState.state.root = null;
    _moduleState.state.terrain = null;
    _moduleState.state.terrainMat = null;
    _moduleState.state.floatingBlocks = null;
    _moduleState.state.floatingMat = null;
    _moduleState.state.meteors = null;
    _moduleState.state.trails = null;
    _moduleState.state.initialized = false;
    _moduleState.state.orbitThetaReady = false;
    _moduleState.state.opacity = 0;
    _moduleState.state.floatingCount = _moduleState.DEFAULT_FLOATING_BLOCK_COUNT;
  }

function installSonicTopographyPresetIsActive(_moduleState, fx) {
    return !!(fx && Number(fx.preset) === _moduleState.INDEX);
  }

function installSonicTopographyPresetPointerRipple(_moduleState, worldX, worldZ, strength) {
    _moduleState.addRipple(worldX, worldZ, strength || 1.2, false);
  }

function installSonicTopographyPresetUpdate(_moduleState, dt, ctx) {
    ctx = ctx || {};
    var fx = ctx.fx || {};
    var scene = ctx.scene;
    var active = _moduleState.isActive(fx);
    var target = active ? 1 : 0;
    _moduleState.state.opacity += (target - _moduleState.state.opacity) * Math.min(1, dt * (active ? 3.0 : 2.2));
    if (!active && _moduleState.state.opacity < 0.01) {
      if (_moduleState.state.root) _moduleState.state.root.visible = false;
      return;
    }
    _moduleState.ensureLayer(scene, fx);
    if (!_moduleState.state.root) return;
    _moduleState.updateSonicRotation(fx, dt, ctx);
    _moduleState.applyLayout(fx);
    _moduleState.state.root.visible = true;
    _moduleState.state.sonicTime += dt * (0.45 + _moduleState.sonicNumber(fx, 'sonicGroundMotionSpeed', _moduleState.DEFAULT_GROUND_MOTION_SPEED, 0, 100) * 0.017);
    var time = _moduleState.state.sonicTime || (ctx.time != null ? ctx.time : 0);
    var audio = _moduleState.readMineradioAudio(ctx.audio || {});
    _moduleState.syncTerrainUniforms(fx, audio, dt, time);
    if (active) _moduleState.updateAudioTriggers(audio);
    _moduleState.updateFloatingBlocks(fx, audio, dt, time);
    _moduleState.updateMeteorsAndTrails(dt);
    _moduleState.state.root.visible = _moduleState.state.opacity > 0.02;
  }

function installSonicTopographyPresetOnPresetChange(_moduleState, prev, next, ctx) {
    if (prev === _moduleState.INDEX && next !== _moduleState.INDEX) _moduleState.clearLayer();
    if (next === _moduleState.INDEX && ctx && ctx.scene) {
      if (_moduleState.state.initialized) _moduleState.clearLayer();
      _moduleState.ensureLayer(ctx.scene, ctx.fx || {});
      _moduleState.applyLayout(ctx.fx || {});
    }
  }

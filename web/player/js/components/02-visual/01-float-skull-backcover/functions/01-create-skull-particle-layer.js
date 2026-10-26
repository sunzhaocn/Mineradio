'use strict';


function createSkullParticleLayer() {
  if (window.mineradioSimplePlayer && window.mineradioSimplePlayer.active()) return null;
  if (skullParticleGroup) return skullParticleGroup;
  var asset = skullParticleAsset.data;
  if (!asset) return null;
  var pos = [];
  var seed = [];
  var kind = [];
  if (!asset) {

    function rotate2(x, y, a) {
      var c = Math.cos(a), s = Math.sin(a);
      return { x: x * c - y * s, y: x * s + y * c };
    }
    function eyeCut(x, y, z, side) {
      if (z < 0.16) return false;
      var p = rotate2(x - side * 0.38, y - 0.02, side * 0.10);
      var almond = Math.pow(Math.abs(p.x) / 0.34, 1.70) + Math.pow(Math.abs(p.y) / 0.215, 1.34);
      var slantGate = p.y < 0.22 - Math.abs(p.x) * 0.12 && p.y > -0.24 + Math.abs(p.x) * 0.10;
      return almond < 1.0 && slantGate;
    }
    function noseCut(x, y, z) {
      if (z < 0.20 || y > -0.12 || y < -0.62) return false;
      var t = clampRange((-0.12 - y) / 0.50, 0, 1);
      var half = 0.050 + t * 0.185;
      return Math.abs(x) < half && z > 0.38 + t * 0.18;
    }
    function mouthGap(x, y, z) {
      return z > 0.18 && y < -0.66 && y > -1.03 && Math.abs(x) < 0.30;
    }
    function addEllipsoidSurface(count, cx, cy, cz, rx, ry, rz, yMin, yMax, k, frontBias) {
      var made = 0, guard = 0;
      while (made < count && guard < count * 8) {
        guard++;
        var theta = frontBias
          ? (-Math.PI * 0.07 + Math.random() * Math.PI * 1.14)
          : (Math.random() * Math.PI * 2);
        var phi = Math.acos(1 - Math.random() * 2);
        var sx = Math.sin(phi) * Math.cos(theta);
        var sy = Math.cos(phi);
        var sz = Math.sin(phi) * Math.sin(theta);
        var x = cx + sx * rx * (0.96 + Math.max(0, -sy) * 0.12);
        var y = cy + sy * ry;
        var z = cz + sz * rz;
        if (y < yMin || y > yMax) continue;
        if (eyeCut(x, y, z, -1) || eyeCut(x, y, z, 1) || noseCut(x, y, z) || mouthGap(x, y, z)) continue;
        var cheekCarve = z > 0.18 && y < -0.18 && y > -0.66 && Math.abs(x) > 0.26 && Math.abs(x) < 0.58 && Math.random() < 0.36;
        if (cheekCarve) continue;
        skullPushPoint(pos, seed, kind, x, y, z, k + Math.random() * 0.08);
        made++;
      }
    }

    addEllipsoidSurface(3150, 0, 0.46, 0.00, 0.93, 0.88, 0.58, -0.16, 1.35, 0.055, true);
    addEllipsoidSurface(2100, 0, -0.34, 0.10, 0.70, 0.66, 0.46, -0.95, 0.14, 0.10, true);
    for (var j = 0; j < 1450; j++) {
      var a = Math.random() * Math.PI * 2;
      var v = Math.random();
      var y = -1.16 + v * 0.48;
      var taper = clampRange((y + 1.16) / 0.48, 0, 1);
      var rx = 0.32 + taper * 0.31;
      var rz = 0.22 + taper * 0.18;
      var x = Math.cos(a) * rx;
      var z = 0.22 + Math.sin(a) * rz;
      if (mouthGap(x, y, z)) continue;
      if (y > -0.94 && Math.abs(x) < 0.22 && z > 0.18) continue;
      skullPushPoint(pos, seed, kind, x, y, z, 0.15 + Math.random() * 0.10);
    }

    [-1, 1].forEach(function (side) {
      var cx = side * 0.38;
      skullPushCurve(pos, seed, kind, 520, function (t) {
        var a = t * Math.PI * 2;
        var px = Math.cos(a) * (0.345 + Math.sin(a * 2.0) * 0.012);
        var py = Math.sin(a) * (0.205 + Math.cos(a * 2.0) * 0.010);
        var r = rotate2(px, py, -side * 0.10);
        return {
          x: cx + r.x,
          y: 0.02 + r.y - Math.max(0, Math.cos(a)) * 0.018,
          z: 0.72 + Math.sin(a * 2.0) * 0.030
        };
      }, 0.96, 0.010);
      skullPushCurve(pos, seed, kind, 330, function (t) {
        var x = side * (0.13 + t * 0.58);
        var y = 0.245 - t * 0.085 + Math.sin(t * Math.PI) * 0.055;
        return { x: x, y: y, z: 0.66 + Math.sin(t * Math.PI) * 0.055 };
      }, 0.98, 0.010);
      skullPushCurve(pos, seed, kind, 300, function (t) {
        return {
          x: side * (0.30 + t * 0.47),
          y: -0.18 - t * 0.25 + Math.sin(t * Math.PI) * 0.070,
          z: 0.69 - t * 0.095
        };
      }, 0.84, 0.012);
      skullPushCurve(pos, seed, kind, 330, function (t) {
        return {
          x: side * (0.62 - t * 0.20),
          y: -0.28 - t * 0.55 + Math.sin(t * Math.PI) * 0.065,
          z: 0.50 + Math.sin(t * Math.PI) * 0.070
        };
      }, 0.72, 0.014);
    });

    skullPushCurve(pos, seed, kind, 360, function (t) {
      var x = -0.72 + t * 1.44;
      return { x: x, y: 0.235 - Math.abs(x) * 0.055 + Math.sin(t * Math.PI) * 0.035, z: 0.62 + Math.sin(t * Math.PI) * 0.040 };
    }, 0.86, 0.012);
    [-1, 1].forEach(function (side) {
      skullPushCurve(pos, seed, kind, 260, function (t) {
        return { x: side * (0.035 + t * 0.205), y: -0.15 - t * 0.43, z: 0.79 - t * 0.035 };
      }, 0.98, 0.007);
    });
    skullPushCurve(pos, seed, kind, 240, function (t) {
      var x = -0.25 + t * 0.50;
      return { x: x, y: -0.62 + Math.sin(t * Math.PI) * 0.030, z: 0.70 };
    }, 0.86, 0.008);
    skullPushCurve(pos, seed, kind, 420, function (t) {
      var a = Math.PI + t * Math.PI;
      return { x: Math.cos(a) * 0.50, y: -0.98 + Math.sin(a) * 0.205, z: 0.46 + Math.sin(t * Math.PI) * 0.075 };
    }, 0.82, 0.014);
    skullPushCurve(pos, seed, kind, 360, function (t) {
      var x = -0.39 + t * 0.78;
      return { x: x, y: -0.70 + Math.sin(t * Math.PI) * 0.018, z: 0.73 };
    }, 0.96, 0.006);
    skullPushCurve(pos, seed, kind, 320, function (t) {
      var x = -0.36 + t * 0.72;
      return { x: x, y: -1.005 - Math.sin(t * Math.PI) * 0.018, z: 0.70 };
    }, 0.78, 0.008);
    for (var tooth = -4; tooth <= 4; tooth++) {
      var tx = tooth * 0.082;
      var height = tooth === 0 ? 0.30 : (0.25 + (4 - Math.abs(tooth)) * 0.012);
      skullPushCurve(pos, seed, kind, 58, function (t) {
        return { x: tx + Math.sin(t * Math.PI) * 0.006, y: -0.715 - t * height, z: 0.735 - t * 0.020 };
      }, 0.94, 0.004);
    }
    skullPushCurve(pos, seed, kind, 520, function (t) {
      var a = Math.PI * 0.12 + t * Math.PI * 0.76;
      return { x: Math.cos(a) * 0.98, y: 0.42 + Math.sin(a) * 0.92, z: 0.48 + Math.sin(t * Math.PI) * 0.10 };
    }, 0.70, 0.012);
    skullPushCurve(pos, seed, kind, 360, function (t) {
      var a = t * Math.PI * 2;
      return { x: Math.cos(a) * 0.52, y: -1.19 + Math.sin(a) * 0.082, z: 0.24 + Math.sin(a * 2.0) * 0.028 };
    }, 0.72, 0.010);
  }

  var geo = asset ? buildSkullParticleGeometryFromAsset(asset) : new THREE.BufferGeometry();
  if (!asset) {
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(new Float32Array(seed), 1));
    geo.setAttribute('kind', new THREE.BufferAttribute(new Float32Array(kind), 1));
  }
  var mat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: dotTexture },
      uTime: uniforms.uTime,
      uPixel: uniforms.uPixel,
      uBass: uniforms.uBass,
      uMid: uniforms.uMid,
      uTreble: uniforms.uTreble,
      uBeat: uniforms.uBeat,
      uJawOpen: { value: 0 },
      uSkullFlash: { value: 0 },
      uPointScale: uniforms.uPointScale,
      uBloomStrength: uniforms.uBloomStrength,
      uColorBoost: uniforms.uColorBoost,
      uOpacity: { value: 0 },
      uColorA: { value: new THREE.Color('#b8ae98') },
      uColorB: { value: new THREE.Color('#fff4d8') },
      uShadow: { value: new THREE.Color('#100d0d') },
      uLight: { value: new THREE.Color('#ffe3a0') }
    },
    vertexShader: [
      'precision highp float;',
      'attribute float seed,kind;',
      'uniform float uTime,uPixel,uPointScale,uBloomStrength,uColorBoost;',
      'uniform float uBass,uMid,uTreble,uBeat,uJawOpen,uSkullFlash;',
      'varying float vKind,vLight,vRim,vAmp,vDensity,vFlash;',
      'void main(){',
      '  vec3 pos = position;',
      '  float jawGroup = step(1.0, kind);',
      '  float boneKind = fract(kind);',
      '  vKind = boneKind;',
      '  vec3 n = normalize(vec3(position.x * 0.82, position.y * 0.68, position.z * 1.22 + 0.16));',
      '  float toothBand = smoothstep(0.48, 0.70, position.z) * (1.0 - smoothstep(0.27, 0.48, abs(position.x))) * (1.0 - smoothstep(0.18, 0.46, abs(position.y + 0.72)));',
      '  float toothNoise = fract(sin(seed * 21.731 + floor((position.x + 0.52) * 21.0) * 5.137) * 43758.5453);',
      '  pos.y += toothBand * (toothNoise - 0.5) * 0.020;',
      '  pos.z += toothBand * (fract(sin(seed * 17.923 + position.y * 31.0) * 24634.6345) - 0.5) * 0.012;',
      '  float jawSidePull = jawGroup * smoothstep(-0.42, -1.06, position.y) * smoothstep(0.24, 0.62, abs(position.x)) * (1.0 - smoothstep(0.78, 1.04, abs(position.x))) * smoothstep(0.16, 0.70, position.z);',
      '  pos.x *= 1.0 - jawSidePull * 0.10;',
      '  float fallbackJaw = smoothstep(-0.48, -0.90, position.y) * smoothstep(0.08, 0.52, position.z) * (1.0 - smoothstep(0.62, 0.96, abs(position.x)));',
      '  float jawMask = jawGroup;',
      '  float jawSideAnchor = smoothstep(0.36, 0.66, abs(position.x)) * (1.0 - smoothstep(0.78, 0.98, abs(position.x))) * smoothstep(-0.34, -0.74, position.y) * (1.0 - smoothstep(0.62, 0.86, position.z));',
      '  float jawMotion = jawMask * (1.0 - jawSideAnchor * 0.32);',
      '  vec2 jawHinge = vec2(-0.45, 0.18);',
      '  float jawAngle = uJawOpen * 0.52 * jawMotion;',
      '  float jc = cos(jawAngle);',
      '  float js = sin(jawAngle);',
      '  vec2 jr = pos.yz - jawHinge;',
      '  vec2 openedJaw = vec2(jr.x * jc - jr.y * js, jr.x * js + jr.y * jc) + jawHinge;',
      '  pos.yz = mix(pos.yz, openedJaw, jawMotion);',
      '  float jawDrop = jawMotion * smoothstep(-0.32, -0.88, position.y) * (0.58 + smoothstep(0.18, 0.62, abs(position.x)) * 0.04);',
      '  float openDrive = clamp(uJawOpen, 0.0, 1.25);',
      '  pos.y -= jawDrop * (0.038 + openDrive * 0.100);',
      '  pos.z += jawDrop * (0.003 + openDrive * 0.014);',
      '  float ampDrive = smoothstep(0.20, 0.82, uBass * 0.44 + uMid * 0.22 + uBeat * 0.72);',
      '  float ampPhase = 0.50 + 0.50 * sin(uTime * (1.05 + uMid * 0.30) + seed * 6.2831);',
      '  vFlash = clamp(uSkullFlash * (0.68 + ampPhase * 0.32), 0.0, 1.0);',
      '  vAmp = clamp(ampDrive * 0.045 + vFlash * 0.92 + uTreble * 0.012, 0.0, 1.0);',
      '  vec4 mv = modelViewMatrix * vec4(pos, 1.0);',
      '  float dist = max(0.55, -mv.z);',
      '  vec3 vn = normalize(normalMatrix * n);',
      '  vec3 keyDir = normalize(vec3(-0.48, 0.64, 0.60));',
      '  vec3 lowDir = normalize(vec3(-0.10, -0.78, 0.34));',
      '  vec3 fillDir = normalize(vec3(0.36, -0.04, 0.64));',
      '  vec3 rimDir = normalize(vec3(0.88, 0.18, -0.44));',
      '  float key = pow(max(dot(vn, keyDir), 0.0), 1.18);',
      '  float low = pow(max(dot(vn, lowDir), 0.0), 1.34) * 0.10;',
      '  float fill = max(dot(vn, fillDir), 0.0) * 0.055;',
      '  float gothicShadow = smoothstep(-0.10, 0.36, dot(vn, normalize(vec3(0.44, -0.06, -0.58))));',
      '  float dentalLift = smoothstep(0.48, 0.72, position.z) * (1.0 - smoothstep(0.30, 0.54, abs(position.x))) * (1.0 - smoothstep(0.18, 0.48, abs(position.y + 0.70))) * (0.62 + toothNoise * 0.20);',
      '  vRim = pow(max(dot(vn, rimDir), 0.0), 2.50) * (0.24 + uBloomStrength * 0.08 + vFlash * 0.62);',
      '  float dust = fract(sin(seed * 13.871 + position.x * 19.7 + position.y * 7.1) * 43758.5453);',
      '  vDensity = clamp(0.30 + key * 0.70 + vRim * 0.24 - gothicShadow * 0.24 + dust * 0.025 + vFlash * 0.08, 0.16, 1.20);',
      '  vLight = clamp(0.115 + key * 1.02 + low + fill + dentalLift * 0.20 + boneKind * 0.070 + vAmp * 0.56 - gothicShadow * 0.08, 0.035, 1.72);',
      '  float scaleCtl = clamp(uPointScale, 0.48, 2.35);',
      '  float size = (0.035 + boneKind * 0.026) * (0.84 + vDensity * 0.22 + vLight * 0.13 + uBloomStrength * 0.030 + vFlash * 0.18);',
      '  gl_PointSize = clamp(size * uPixel * scaleCtl * 128.0 / dist, 0.95, 7.60);',
      '  gl_Position = projectionMatrix * mv;',
      '}'
    ].join('\n'),
    fragmentShader: [
      'precision highp float;',
      'uniform sampler2D uMap;',
      'uniform vec3 uColorA,uColorB,uShadow,uLight;',
      'uniform float uOpacity,uBloomStrength,uColorBoost;',
      'varying float vKind,vLight,vRim,vAmp,vDensity,vFlash;',
      'void main(){',
      '  vec4 tex = texture2D(uMap, gl_PointCoord);',
      '  if(tex.a < 0.070) discard;',
      '  float contrast = clamp(uColorBoost, 0.50, 2.00);',
      '  float lit = clamp(pow(vLight, mix(1.18, 0.74, (contrast - 0.50) / 1.50)), 0.0, 1.28);',
      '  vec3 bone = mix(uColorA, uColorB, clamp((vKind - 0.34) * 2.0 + lit * 0.18, 0.0, 1.0));',
      '  vec3 col = mix(uShadow, bone, clamp(lit, 0.0, 1.0));',
      '  col = mix(col, uLight, clamp(vRim * (0.14 + uBloomStrength * 0.035 + vFlash * 0.40), 0.0, 0.54));',
      '  col = mix(col, uLight, clamp(vAmp * (0.09 + uBloomStrength * 0.025) + vFlash * 0.56, 0.0, 0.68));',
      '  float alpha = tex.a * uOpacity * clamp(0.20 + lit * 0.44 + vDensity * 0.40 + vRim * 0.10 + vFlash * 0.46, 0.12, 1.56);',
      '  gl_FragColor = vec4(col, alpha);',
      '}'
    ].join('\n'),
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending
  });
  skullParticleGroup = new THREE.Points(geo, mat);
  skullParticleGroup.frustumCulled = false;
  skullParticleGroup.visible = false;
  skullParticleGroup.userData.source = asset ? 'asset' : 'fallback';
  skullParticleGroup.position.set(SKULL_MODEL_BASE_POSITION.x, SKULL_MODEL_BASE_POSITION.y, SKULL_MODEL_BASE_POSITION.z);
  skullParticleGroup.scale.setScalar(SKULL_MODEL_SCALE);
  skullParticleGroup.rotation.x = SKULL_MODEL_BASE_ROTATION_X;
  skullParticleGroup.rotation.y = SKULL_MODEL_BASE_ROTATION_Y;
  skullParticleGroup.renderOrder = 32;
  syncSkullParticleColors();
  scene.add(skullParticleGroup);
  return skullParticleGroup;
}

function isSkullShelfCompositionActive() {
  if (!(fx && fx.preset === SKULL_PRESET_INDEX)) return false;
  if (!shelfManager || !shelfManager.getMode || shelfManager.getMode() !== 'side') return false;
  if (shelfPinnedOpen || shelfVisibility > 0.18) return true;
  return !!(shelfManager.hasOpenContent && shelfManager.hasOpenContent());
}

function clearSkullPresetResidue() {
  skullParticleOpacity = 0;
  skullAmpPulse = 0;
  skullBeatFlash = 0;
  skullJawOpen = 0;
  skullCameraBlend = 0;
  if (!skullParticleGroup) return;
  skullParticleGroup.visible = false;
  if (skullParticleGroup.material && skullParticleGroup.material.uniforms) {
    if (skullParticleGroup.material.uniforms.uOpacity) skullParticleGroup.material.uniforms.uOpacity.value = 0;
    if (skullParticleGroup.material.uniforms.uJawOpen) skullParticleGroup.material.uniforms.uJawOpen.value = 0;
    if (skullParticleGroup.material.uniforms.uSkullFlash) skullParticleGroup.material.uniforms.uSkullFlash.value = 0;
  }
}

function resetSkullPresetView(immediate, opts) {
  opts = opts || {};
  if (!(fx && fx.preset === SKULL_PRESET_INDEX)) return;
  skullWheelZoomTarget = 0;
  if (!opts.smooth) skullWheelZoom = 0;
  skullCameraBlend = Math.max(skullCameraBlend, 1);
  if (!opts.keepLyricLock && typeof stageLyrics !== 'undefined' && stageLyrics && stageLyrics.group && stageLyrics.group.userData) stageLyrics.group.userData.skullMouthLocked = false;
  if (!opts.keepLyricLock && typeof requestStageLyricCameraSnap === 'function') requestStageLyricCameraSnap(10);
  if (!immediate || !skullParticleGroup) return;
  var shelfComposition = isSkullShelfCompositionActive();
  skullShelfCameraMix = shelfComposition ? 1 : 0;
  skullParticleGroup.position.set(shelfComposition ? -1.18 : SKULL_MODEL_BASE_POSITION.x, shelfComposition ? 0.32 : SKULL_MODEL_BASE_POSITION.y, SKULL_MODEL_BASE_POSITION.z);
  skullParticleGroup.scale.setScalar(shelfComposition ? 3.02 : SKULL_MODEL_SCALE);
  skullParticleGroup.rotation.set(SKULL_MODEL_BASE_ROTATION_X, SKULL_MODEL_BASE_ROTATION_Y, 0);
  skullParticleGroup.updateMatrixWorld(true);
  if (camera && typeof setSkullCameraTargetVectors === 'function') {
    var portrait = innerHeight > innerWidth * 1.08;
    setSkullCameraTargetVectors(skullCameraTargetPos, skullCameraTargetLook, portrait, shelfComposition, 0);
    camera.position.copy(skullCameraTargetPos);
    skullCameraMixedLook.copy(skullCameraTargetLook);
    camera.lookAt(skullCameraMixedLook);
    camera.updateProjectionMatrix();
  }
}

function skullBreathOffset(t, shelfComposition) {
  var strength = shelfComposition ? 0.70 : 1.0;
  return {
    x: strength * (Math.sin(t * 0.33 + 1.7) * 0.028 + Math.sin(t * 0.61 + 0.4) * 0.010),
    y: strength * (Math.sin(t * 0.38 + 0.2) * 0.036 + Math.sin(t * 0.83 + 2.1) * 0.012),
    z: strength * (Math.sin(t * 0.24 + 2.6) * 0.026)
  };
}

function setSkullCameraTargetVectors(pos, look, portrait, shelfComposition, zoom) {
  zoom = Number(zoom) || 0;
  if (shelfComposition) {
    pos.set(portrait ? -0.06 : 0.00, portrait ? -2.36 : -2.50, (portrait ? 4.88 : 4.96) + zoom * 0.78);
    look.set(portrait ? -0.04 : 0.00, portrait ? -0.26 : -0.20, 0.03);
    return;
  }
  pos.set(0.00, portrait ? -2.38 : -2.52, (portrait ? 4.92 : 4.98) + zoom);
  look.set(0.00, portrait ? -0.28 : -0.20, 0.02);
}

function applySkullCameraCinemaMotion(portrait, shelfComposition) {
  if (!camera || !fx || !fx.cinema) return;
  var shake = clampRange(Number(fx.cinemaShake) || 0, 0, 1.8);
  if (shake <= 0.001) return;
  var shelfDamp = shelfComposition ? 0.52 : 1.0;
  var idleDamp = (orbit && orbit.rotating ? 0.24 : 1.0) * shelfDamp * shake;
  var beatDamp = shelfDamp * shake;
  skullCameraCinemaRight.set(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
  skullCameraCinemaUp.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
  camera.getWorldDirection(skullCameraCinemaForward).normalize();
  var lateral = Math.sin(cinemaT * 0.08) * 0.030 * idleDamp + beatCam.thetaKick * 0.78 * beatDamp;
  var vertical = Math.sin(cinemaT * 0.06 + 1.0) * 0.024 * idleDamp + beatCam.phiKick * 0.68 * beatDamp;
  var depth = Math.sin(cinemaT * 0.04 + 2.0) * 0.075 * idleDamp - beatCam.radiusKick * 0.58 * beatDamp;
  if (portrait) {
    lateral *= 0.72;
    vertical *= 0.88;
  }
  camera.position.addScaledVector(skullCameraCinemaRight, lateral);
  camera.position.addScaledVector(skullCameraCinemaUp, vertical);
  camera.position.addScaledVector(skullCameraCinemaForward, depth);
  camera.lookAt(skullCameraMixedLook);
  camera.rotation.z += beatCam.rollKick * beatDamp * (shelfComposition ? 0.42 : 0.70);
}

function applySkullCameraPose(dt) {
  if (freeCamera && (freeCamera.active || freeCamera.locked || freeCamera.resetTween)) return;
  var active = fx && fx.preset === SKULL_PRESET_INDEX;
  skullCameraBlend += ((active ? 1 : 0) - skullCameraBlend) * Math.min(1, dt * (active ? 4.8 : 7.2));
  if (skullCameraBlend < 0.002) return;
  skullWheelZoom += (skullWheelZoomTarget - skullWheelZoom) * Math.min(1, dt * 8.0);
  var portrait = innerHeight > innerWidth * 1.08;
  var shelfComposition = isSkullShelfCompositionActive();
  var shelfMixTarget = shelfComposition ? 1 : 0;
  skullShelfCameraMix += (shelfMixTarget - skullShelfCameraMix) * Math.min(1, dt * (shelfMixTarget > skullShelfCameraMix ? 4.6 : 5.8));
  if (Math.abs(skullShelfCameraMix - shelfMixTarget) < 0.002) skullShelfCameraMix = shelfMixTarget;
  setSkullCameraTargetVectors(skullCameraBasePos, skullCameraBaseLook, portrait, false, skullWheelZoom);
  setSkullCameraTargetVectors(skullCameraShelfPos, skullCameraShelfLook, portrait, true, skullWheelZoom);
  skullCameraTargetPos.copy(skullCameraBasePos).lerp(skullCameraShelfPos, skullShelfCameraMix);
  skullCameraTargetLook.copy(skullCameraBaseLook).lerp(skullCameraShelfLook, skullShelfCameraMix);
  camera.position.lerp(skullCameraTargetPos, skullCameraBlend);
  skullCameraMixedLook.set(orbit.lookAt.x, orbit.lookAt.y, orbit.lookAt.z).lerp(skullCameraTargetLook, skullCameraBlend);
  camera.lookAt(skullCameraMixedLook);
  applySkullCameraCinemaMotion(portrait, shelfComposition);
  camera.updateProjectionMatrix();
}

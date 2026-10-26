'use strict';


function updateSkullParticleLayer(dt) {
  var active = fx && fx.preset === SKULL_PRESET_INDEX;
  if (active && !skullParticleAsset.data && !skullParticleAsset.failed) {
    loadSkullParticleAsset();
    return;
  }
  if (active && !skullParticleAsset.data) return;
  if (active) createSkullParticleLayer();
  if (!skullParticleGroup) return;
  var target = active ? 1 : 0;
  skullParticleOpacity += (target - skullParticleOpacity) * Math.min(1, dt * (active ? 3.2 : 2.4));
  if (skullParticleOpacity < 0.006 && !active) {
    skullParticleGroup.visible = false;
    return;
  }
  skullParticleGroup.visible = true;
  skullParticleGroup.material.uniforms.uOpacity.value = skullParticleOpacity * clampRange(0.78 + (fx.intensity || 0.85) * 0.18, 0.56, 1.0);
  var beatTransient = clampRange(Math.max(0, beatPulse - 0.16) / 0.84, 0, 1.35);
  var flashTarget = clampRange(Math.pow(beatTransient, 1.34) * 1.08 + Math.max(0, bass - 0.60) * 0.18 * beatTransient, 0, 1);
  skullBeatFlash += (flashTarget - skullBeatFlash) * Math.min(1, dt * (flashTarget > skullBeatFlash ? 24.0 : 6.2));
  if (skullParticleGroup.material.uniforms.uSkullFlash) skullParticleGroup.material.uniforms.uSkullFlash.value = skullBeatFlash;
  var jawTarget = clampRange(0.60 + (0.5 + 0.5 * Math.sin(uniforms.uTime.value * 0.50)) * 0.050 + bass * 0.060 + skullBeatFlash * 0.090, 0.52, 0.88);
  skullJawOpen += (jawTarget - skullJawOpen) * Math.min(1, dt * (jawTarget > skullJawOpen ? 7.8 : 3.4));
  if (skullParticleGroup.material.uniforms.uJawOpen) skullParticleGroup.material.uniforms.uJawOpen.value = skullJawOpen;
  var shelfComposition = isSkullShelfCompositionActive();
  var shelfMix = clampRange(skullShelfCameraMix || (shelfComposition ? 1 : 0), 0, 1);
  var drift = skullBreathOffset(uniforms.uTime.value, shelfComposition);
  var ampTarget = clampRange(bass * 0.006 + mid * 0.004 + skullBeatFlash * 0.070, 0, 0.090);
  skullAmpPulse += (ampTarget - skullAmpPulse) * Math.min(1, dt * (ampTarget > skullAmpPulse ? 11.0 : 4.0));
  var shelfScale = 3.02;
  var targetScale = (SKULL_MODEL_SCALE + (shelfScale - SKULL_MODEL_SCALE) * shelfMix) * (1 + skullAmpPulse) * clampRange(1 - skullWheelZoom * 0.055, 0.92, 1.08);
  var shelfX = -1.18;
  var shelfY = 0.32;
  var targetX = (SKULL_MODEL_BASE_POSITION.x + (shelfX - SKULL_MODEL_BASE_POSITION.x) * shelfMix) + drift.x;
  var targetY = (SKULL_MODEL_BASE_POSITION.y + (shelfY - SKULL_MODEL_BASE_POSITION.y) * shelfMix) + drift.y;
  var targetZ = SKULL_MODEL_BASE_POSITION.z + drift.z;
  skullParticleGroup.position.x += (targetX - skullParticleGroup.position.x) * Math.min(1, dt * 4.2);
  skullParticleGroup.position.y += (targetY - skullParticleGroup.position.y) * Math.min(1, dt * 4.8);
  skullParticleGroup.position.z += (targetZ - skullParticleGroup.position.z) * Math.min(1, dt * 4.2);
  skullParticleGroup.scale.x += (targetScale - skullParticleGroup.scale.x) * Math.min(1, dt * 4.6);
  skullParticleGroup.scale.y = skullParticleGroup.scale.x;
  skullParticleGroup.scale.z = skullParticleGroup.scale.x;
  var targetRotY = SKULL_MODEL_BASE_ROTATION_Y + (orbit.centerLocked ? 0 : (headParallax.active ? headParallax.x * 0.5 : 0) + gestureRotation.y);
  var targetRotX = SKULL_MODEL_BASE_ROTATION_X + (orbit.centerLocked ? 0 : (headParallax.active ? -headParallax.y * 0.35 : 0) + gestureRotation.x);
  var rotEase = Math.min(1, dt * 7.4);
  skullParticleGroup.rotation.y += (targetRotY - skullParticleGroup.rotation.y) * rotEase;
  skullParticleGroup.rotation.x += (targetRotX - skullParticleGroup.rotation.x) * rotEase;
  skullParticleGroup.rotation.z += (0 - skullParticleGroup.rotation.z) * Math.min(1, dt * 6.0);
}


function createBackCoverLayer() {
  if (window.mineradioSimplePlayer && window.mineradioSimplePlayer.active()) return;
  if (backCoverGroup) return;
  var bg = new THREE.BufferGeometry();
  var bp = new Float32Array(BACK_COVER_COUNT * 3);
  var bc = new Float32Array(BACK_COVER_COUNT * 3);
  var br = new Float32Array(BACK_COVER_COUNT);
  var bu = new Float32Array(BACK_COVER_COUNT * 2);  // 镜像 UV 用于采样封面
  for (var i = 0; i < BACK_COVER_COUNT; i++) {
    var u = Math.random();
    var v = Math.random();
    // 在 PLANE_SIZE 范围内分布
    bp[i * 3] = (u - 0.5) * PLANE_SIZE;
    bp[i * 3 + 1] = (v - 0.5) * PLANE_SIZE;
    bp[i * 3 + 2] = -1.5 - Math.random() * 0.4;  // 在主平面后方
    bu[i * 2] = 1.0 - u;  // 镜像 X
    bu[i * 2 + 1] = v;
    br[i] = Math.random();
    bc[i * 3] = 0.7; bc[i * 3 + 1] = 0.6; bc[i * 3 + 2] = 0.8;  // 占位
  }
  bg.setAttribute('position', new THREE.BufferAttribute(bp, 3));
  bg.setAttribute('aColor', new THREE.BufferAttribute(bc, 3));
  bg.setAttribute('aRand', new THREE.BufferAttribute(br, 1));
  bg.setAttribute('aUv', new THREE.BufferAttribute(bu, 2));

  var vs = `
precision highp float;
uniform float uTime, uBass, uPixel, uAlpha;
attribute vec3 aColor;
attribute vec2 aUv;
attribute float aRand;
varying vec3 vC;
varying float vA;
void main(){
  vec3 pos = position;
  // 缓慢呼吸
  pos.x += sin(uTime * 0.20 + aRand * 8.0) * 0.20;
  pos.y += cos(uTime * 0.18 + aRand * 6.0) * 0.22;
  pos.z += sin(uTime * 0.12 + aRand * 5.0) * 0.18 + uBass * 0.12 * sin(aRand * 11.0);
  vC = aColor;
  vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
  float dist = -mvPos.z;
  vA = clamp(0.30 + 0.4 * sin(uTime * 0.6 + aRand * 5.0), 0.10, 0.65);
  float sz = clamp(46.0 / max(0.5, dist), 1.4, 4.5);
  gl_PointSize = sz * uPixel;
  gl_Position = projectionMatrix * mvPos;
}
  `;
  var fs = `
precision highp float;
uniform sampler2D uDotTex;
uniform float uAlpha;
varying vec3 vC;
varying float vA;
void main(){
  vec4 tex = texture2D(uDotTex, gl_PointCoord);
  if (tex.a < 0.02) discard;
  gl_FragColor = vec4(vC, tex.a * vA * uAlpha);
}
  `;
  var mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: uniforms.uTime,
      uBass: uniforms.uBass,
      uPixel: uniforms.uPixel,
      uDotTex: uniforms.uDotTex,
      uAlpha: uniforms.uAlpha,
    },
    vertexShader: vs, fragmentShader: fs,
    transparent: true, depthWrite: false, blending: THREE.NormalBlending,
  });
  backCoverGroup = new THREE.Points(bg, mat);
  backCoverGroup.frustumCulled = false;
  backCoverColorArr = bc;
  scene.add(backCoverGroup);
}


function destroyBackCoverLayer() {
  if (!backCoverGroup) return;
  scene.remove(backCoverGroup);
  backCoverGroup.geometry.dispose(); backCoverGroup.material.dispose();
  backCoverGroup = null; backCoverColorArr = null;
}


function refreshBackCoverColorsFromCanvas(coverCanvas) {
  if (!backCoverGroup || !coverCanvas || !backCoverColorArr) return;
  var ctx = coverCanvas.getContext('2d');
  var img = ctx.getImageData(0, 0, coverCanvas.width, coverCanvas.height).data;
  var w = coverCanvas.width, h = coverCanvas.height;
  var attr = backCoverGroup.geometry.attributes;
  var uvA = attr.aUv.array;
  for (var i = 0; i < BACK_COVER_COUNT; i++) {
    var u = uvA[i * 2], v = uvA[i * 2 + 1];
    var sx = Math.floor(u * w);
    var sy = Math.floor(v * h);
    var di = (sy * w + sx) * 4;
    backCoverColorArr[i * 3] = img[di] / 255 * 0.85;
    backCoverColorArr[i * 3 + 1] = img[di + 1] / 255 * 0.85;
    backCoverColorArr[i * 3 + 2] = img[di + 2] / 255 * 0.85;
  }
  attr.aColor.needsUpdate = true;
}

function updateFloatLayer(dt) {
  // 漂移已在 shader 中完成, JS 不需要每帧改 buffer
}

function refreshFloatColorsFromCover(coverCanvas) {
  if (!floatGroup || !coverCanvas) return;
  var ctx = coverCanvas.getContext('2d');
  var img = ctx.getImageData(0, 0, coverCanvas.width, coverCanvas.height).data;
  var w = coverCanvas.width, h = coverCanvas.height;
  for (var i = 0; i < FLOAT_COUNT; i++) {
    var sx = Math.floor(Math.random() * w);
    var sy = Math.floor(Math.random() * h);
    var di = (sy * w + sx) * 4;
    floatColorArr[i * 3] = img[di] / 255 * 0.95;
    floatColorArr[i * 3 + 1] = img[di + 1] / 255 * 0.95;
    floatColorArr[i * 3 + 2] = img[di + 2] / 255 * 0.95;
  }
  floatGroup.geometry.attributes.aColor.needsUpdate = true;
}

function resetFloatColorsToIdle() {
  if (!floatGroup || !floatColorArr) return;
  for (var i = 0; i < FLOAT_COUNT; i++) {
    var white = 0.88 + (i % 17) / 17 * 0.12;
    floatColorArr[i * 3] = white;
    floatColorArr[i * 3 + 1] = white;
    floatColorArr[i * 3 + 2] = white;
  }
  floatGroup.geometry.attributes.aColor.needsUpdate = true;
}

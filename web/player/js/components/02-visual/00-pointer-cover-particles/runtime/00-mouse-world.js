'use strict';

// ============================================================
var mouseWorld = new THREE.Vector3(-999, -999, 0);

var mouseActive = false;

var mouseDownAt = { x: 0, y: 0, t: 0, hadDrag: false };

var particlePointerSpin = { active: false, lastX: 0, lastY: 0, lastT: 0 };

var particlePointerRay = new THREE.Raycaster();

var particlePointerNdc = new THREE.Vector2();

var particlePointerPlane = new THREE.Plane();

var particlePointerPlanePoint = new THREE.Vector3();

var particlePointerPlaneNormal = new THREE.Vector3();

var particlePointerWorldHit = new THREE.Vector3();

var particlePointerLocalHit = new THREE.Vector3();

var particlePointerQuat = new THREE.Quaternion();

var particlePointerFrame = { dirty: false, ndcX: 0, ndcY: 0 };

var CLICK_THRESHOLD = 6;
  // 像素, 拖动 > 6px 视为 drag
var UI_HIT_SELECTOR = '#search-area,#upload-panel,#top-right,#fullscreen-diy-zone,#fx-panel,#fx-fab,#fx-fab-hide-btn,#playlist-panel,#bottom-bar,#thumb-wrap,#empty-home,#visual-guide,#trial-banner,#source-fallback-notice,.modal-mask,#toast,#ai-depth-chip,#beat-chip,#drop-overlay';

renderer.domElement.addEventListener('mousedown', function (e) {
  if (freeCamera && freeCamera.active) {
    if (e.button === 0 && typeof requestFreeCameraPointerLock === 'function') requestFreeCameraPointerLock('canvas-mousedown');
    e.preventDefault();
    return;
  }
  beginParticlePointerDrag(e);
});

window.addEventListener('mousedown', function (e) {
  if (!(fx && fx.preset === SKULL_PRESET_INDEX)) return;
  if (orbit.rotating || e.target === renderer.domElement) return;
  beginParticlePointerDrag(e);
}, true);

window.addEventListener('mousemove', function (e) {
  updateControlsAutoHideFromPointer(e.clientX, e.clientY);
  idleGuidePointerMove(e);
  if (freeCamera && freeCamera.active) {
    markRenderInteraction('free-camera', 900);
    var pointerLocked = typeof freeCameraPointerLockActive === 'function' && freeCameraPointerLockActive();
    if (!pointerLocked && typeof requestFreeCameraPointerLock === 'function') requestFreeCameraPointerLock('mousemove');
    var mdx = e.movementX || 0;
    var mdy = e.movementY || 0;
    if (!pointerLocked && (!mdx && !mdy) && freeCameraPointer.seen) {
      mdx = e.clientX - freeCameraPointer.x;
      mdy = e.clientY - freeCameraPointer.y;
    }
    freeCameraPointer.x = e.clientX;
    freeCameraPointer.y = e.clientY;
    freeCameraPointer.seen = true;
    freeCamera.yaw -= mdx * 0.00125;
    freeCamera.pitch = clampRange(freeCamera.pitch - mdy * 0.00125, -Math.PI * 0.49, Math.PI * 0.49);
    return;
  }
  if (isPointerOverUi(e) && !orbit.rotating) { mouseActive = false; return; }
  if (orbit.rotating) {
    markRenderInteraction('canvas-drag', 900);
    unlockCenteredView();
    var dx = e.clientX - orbit.last.x, dy = e.clientY - orbit.last.y;
    if (particlePointerSpin.active) {
      var nowSpin = performance.now();
      var spinDt = Math.max(1 / 120, Math.min(0.08, (nowSpin - particlePointerSpin.lastT) / 1000 || 1 / 60));
      applyParticleSpinDrag(dx, dy, spinDt);
      particlePointerSpin.lastX = e.clientX;
      particlePointerSpin.lastY = e.clientY;
      particlePointerSpin.lastT = nowSpin;
    }
    orbit.last.x = e.clientX; orbit.last.y = e.clientY;
    // drag 距离判断
    var totalDx = e.clientX - mouseDownAt.x, totalDy = e.clientY - mouseDownAt.y;
    if (Math.sqrt(totalDx * totalDx + totalDy * totalDy) > CLICK_THRESHOLD) mouseDownAt.hadDrag = true;
    if (orbit.recentering) orbit.recentering = false;
  }
  queueParticlePointerFrame(e.clientX, e.clientY);
});

window.addEventListener('mouseup', function (e) {
  orbit.rotating = false;
  particlePointerSpin.active = false;
  idleGuidePointerUp();
  if (window.MineradioSonicTopography && MineradioSonicTopography.isActive(fx) && !mouseDownAt.hadDrag && !isPointerOverUi(e)) {
    var pressMs = Math.max(0, performance.now() - (mouseDownAt.t || 0));
    var strength = Math.min(0.25 + (pressMs / 1000) * 2.6, 3.0);
    var nx = (e.clientX / Math.max(1, innerWidth) - 0.5) * 34;
    var nz = (0.5 - e.clientY / Math.max(1, innerHeight)) * 34;
    MineradioSonicTopography.pointerRipple(nx, nz, strength);
  }
});

renderer.domElement.addEventListener('mouseleave', function () {
  particlePointerFrame.dirty = false;
  mouseWorld.set(-999, -999, 0);
  mouseActive = false;
  idleGuidePointerLeave();
});

renderer.domElement.addEventListener('wheel', function (e) {
  if (isPointerOverUi(e)) return;
  e.preventDefault();
  markRenderInteraction('canvas-wheel', 900);
  if (freeCamera && freeCamera.active) {
    freeCamera.fov = clampRange((freeCamera.fov || BASE_FOV) + e.deltaY * 0.018, 26, 72);
    saveFreeCameraState();
    return;
  }
  if (fx && fx.preset === SKULL_PRESET_INDEX && typeof skullWheelZoomTarget !== 'undefined') {
    skullWheelZoomTarget = clampRange(skullWheelZoomTarget + e.deltaY * 0.00155, -0.95, 1.28);
    return;
  }
  idleGuideWheel(e);
  unlockCenteredView();
  orbit.userRadius = Math.max(orbit.minRadius, Math.min(orbit.maxRadius, orbit.userRadius + e.deltaY * 0.005));
  if (orbit.recentering) orbit.recentering = false;
}, { passive: false });


// 双击屏幕回正 — 不命中卡片时
renderer.domElement.addEventListener('dblclick', function (e) {
  if (isPointerOverUi(e)) return;
  if (freeCamera && freeCamera.locked) {
    resetFreeCameraToDefault();
    resetSkullPresetView(false, { smooth: true, keepLyricLock: true });
    return;
  }
  if (shelfManager && shelfManager.getMode() !== 'off') {
    var mx = (e.clientX / innerWidth) * 2 - 1;
    var my = -(e.clientY / innerHeight) * 2 + 1;
    var rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(mx, my), camera);
    if (shelfManager.raycastCards(rc)) return;
  }
  recenterCamera();
});

var dotTexture = makeDotTexture();


// ============================================================
//  主粒子系统
//   - 5 个 preset, 每个预设走完全不同的 pos 计算
//   - 共享: 封面色采样, 鼠标交互, 粒子大小限制
// ============================================================
var PLANE_SIZE = 4.8;

var RIPPLE_MAX = 12;


var GRID_X = window.mineradioSimplePlayer && window.mineradioSimplePlayer.atStartup ? 2 : coverParticleGridForResolution(fx.coverResolution), GRID_Y = GRID_X;

var PCOUNT = window.mineradioSimplePlayer && window.mineradioSimplePlayer.atStartup ? 0 : GRID_X * GRID_Y;

var positions = null, uvs = null, aRand = null;

var coverResolutionReloadTimer = null;

var currentCoverSource = null;

var coverPickerCanvas = null;


var geo = buildCoverParticleGeometry(GRID_X);


// 涟漪数据纹理 (1×N, RGBA: x, y, age, str)
var rippleData = new Float32Array(RIPPLE_MAX * 4);

var rippleTex = new THREE.DataTexture(rippleData, 1, RIPPLE_MAX, THREE.RGBAFormat, THREE.FloatType);

rippleTex.magFilter = THREE.NearestFilter;
 rippleTex.minFilter = THREE.NearestFilter;

var ripples = [];

for (var ri = 0; ri < RIPPLE_MAX; ri++) ripples.push({ x: 0, y: 0, age: -10, str: 0 });


// 封面纹理 + 边缘/深度纹理
var coverTex = new THREE.Texture();

coverTex.minFilter = THREE.LinearFilter;
 coverTex.magFilter = THREE.LinearFilter;

coverTex.wrapS = THREE.ClampToEdgeWrapping;
 coverTex.wrapT = THREE.ClampToEdgeWrapping;


var coverEdgeTex = new THREE.Texture();
  // R=depth, G=edge, B=fg-mask, A=lum
coverEdgeTex.minFilter = THREE.LinearFilter;
 coverEdgeTex.magFilter = THREE.LinearFilter;


// 初始 1×1 像素
(function () {
  var c = document.createElement('canvas'); c.width = c.height = 4;
  var x = c.getContext('2d'); x.fillStyle = '#1c1c28'; x.fillRect(0, 0, 4, 4);
  coverTex.image = c; coverTex.needsUpdate = true;
  var d = document.createElement('canvas'); d.width = d.height = 4;
  var dx = d.getContext('2d'); dx.fillStyle = 'rgba(128,0,0,255)'; dx.fillRect(0, 0, 4, 4);
  coverEdgeTex.image = d; coverEdgeTex.needsUpdate = true;
})();


// 前一首封面纹理 (用于切歌渐变)
var prevCoverTex = new THREE.Texture();

prevCoverTex.minFilter = THREE.LinearFilter;
 prevCoverTex.magFilter = THREE.LinearFilter;

(function () {
  var c = document.createElement('canvas'); c.width = c.height = 4;
  var x = c.getContext('2d'); x.fillStyle = '#1c1c28'; x.fillRect(0, 0, 4, 4);
  prevCoverTex.image = c; prevCoverTex.needsUpdate = true;
})();


var uniforms = {
  uTime: { value: 0 },
  uBass: { value: 0 },
  uMid: { value: 0 },
  uTreble: { value: 0 },
  uBeat: { value: 0 },
  uEnergy: { value: 0 },
  uBurstAmt: { value: 0 },          // 通用预设切换脉冲 0..1
  uVinylSpin: { value: 0 },
  uPreset: { value: 0 },
  uIntensity: { value: 0.85 },
  uDepth: { value: 1.0 },
  uPointScale: { value: 1.0 },
  uSpeed: { value: 1.0 },
  uTwist: { value: 0 },
  uColorBoost: { value: 1.1 },
  uScatter: { value: 0 },
  uCoverRes: { value: 1.0 },
  uBgFade: { value: 0.20 },
  uBloomStrength: { value: 0.62 },
  uBloomSize: { value: 2.65 },
  uTintColor: { value: new THREE.Color('#9db8cf') },
  uTintStrength: { value: 0 },
  uCoverTex: { value: coverTex },
  uPrevCoverTex: { value: prevCoverTex },
  uColorMixT: { value: 1.0 },        // 0=显示旧封面 → 1=显示新封面
  uEdgeTex: { value: coverEdgeTex },
  uRippleTex: { value: rippleTex },
  uRippleCount: { value: 0 },
  uDotTex: { value: dotTexture },
  uHasCover: { value: 0 },
  uHasDepth: { value: 0 },
  uEdgeEnabled: { value: 1 },
  uAiBoost: { value: 0 },          // AI 深度增益, 当 AI 接管时升至 1
  uMouseXY: { value: new THREE.Vector2(-999, -999) },
  uMouseActive: { value: 0 },
  uHandXY: { value: new THREE.Vector2(-999, -999) },
  uHandActive: { value: 0 },
  uGestureGrip: { value: 0 },
  uPixel: { value: renderer.getPixelRatio() },
  uAlpha: { value: 0 },          // 整体粒子透明度 (启动 fade-in)
  uParticleDim: { value: 1 },          // 覆盖层打开时只压低粒子背景, 不影响 3D 卡片
  uBackdropAdapt: { value: 0.72 },     // 与歌词共用亮底避光强度
  uFloatAlpha: { value: 0 },          // 空场/浮空粒子透明度
  uLoading: { value: 0 },          // 加载动画混合度 0..1 (1 = 完全聚成圆环)
};

installRenderPowerHooks();

applyRendererPowerMode();

var vs = window.MINERADIO_SHADERS["js-modules-02-visual-00-pointer-cover-particles-js-vs"];



// ----- 片元 Shader -----
var fs = `
precision highp float;
uniform sampler2D uDotTex;
uniform float uAlpha, uPreset, uParticleDim, uBackdropAdapt;
varying vec3 vColor;
varying float vBright, vRipple, vEdgeBoost, vAlpha, vSourceLum;

void main(){
  vec4 tex = texture2D(uDotTex, gl_PointCoord);
  if (tex.a < 0.02) discard;
  vec3 col = vColor * vBright;
  col = mix(col, col * 1.3 + vec3(0.05), vEdgeBoost * 0.35);
  col = mix(col, col * 1.2, vRipple * 0.4);
  float keepBlack = 1.0 - smoothstep(0.025, 0.115, vSourceLum);
  float nonBlack = 1.0 - keepBlack;
  float dotDist = length(gl_PointCoord - vec2(0.5)) * 2.0;
  float readableRim = smoothstep(0.44, 0.94, dotDist) * (1.0 - smoothstep(0.94, 1.08, dotDist)) * tex.a;
  float outLum = dot(col, vec3(0.299, 0.587, 0.114));
  float lightParticle = smoothstep(0.50, 0.82, outLum) * nonBlack;
  float darkParticle = (1.0 - smoothstep(0.20, 0.50, outLum)) * nonBlack;
  float backdropAdapt = clamp(uBackdropAdapt, 0.0, 1.0);
  if (backdropAdapt > 0.001) {
    col = mix(col, vec3(0.0), readableRim * lightParticle * (0.38 + backdropAdapt * 0.30));
    col = mix(col, vec3(1.0), readableRim * darkParticle * (0.20 + backdropAdapt * 0.12));
  }
  col = clamp(col, vec3(0.0), vec3(1.6));
  gl_FragColor = vec4(col, tex.a * uAlpha * uParticleDim * vAlpha);
}
`;


var material = new THREE.ShaderMaterial({
  uniforms: uniforms, vertexShader: vs, fragmentShader: fs,
  transparent: true, depthWrite: false, blending: THREE.NormalBlending,
});


var bloomVs = vs
  .replace('uniform float uMouseActive, uPixel, uColorMixT, uLoading;', 'uniform float uMouseActive, uPixel, uColorMixT, uLoading, uBloomSize;')
  .replace('gl_PointSize = sz * uPixel * uPointScale;', 'gl_PointSize = sz * uPixel * uPointScale * uBloomSize;');

var bloomFs = `
precision highp float;
uniform sampler2D uDotTex;
uniform float uAlpha, uBloomStrength, uPreset, uParticleDim, uBackdropAdapt;
varying vec3 vColor;
varying float vBright, vRipple, vEdgeBoost, vAlpha, vSourceLum;

void main(){
  vec4 tex = texture2D(uDotTex, gl_PointCoord);
  if (tex.a < 0.01) discard;
  float soft = tex.a * tex.a;
  vec3 col = vColor * (0.55 + vBright * 0.62);
  col = mix(col, col + vec3(0.22, 0.18, 0.10), vEdgeBoost * 0.35);
  col = clamp(col, vec3(0.0), vec3(1.8));
  float pulse = 1.0 + vRipple * 0.65;
  float keepBlack = 1.0 - smoothstep(0.025, 0.115, vSourceLum);
  float bloomKeep = 1.0 - keepBlack * 0.92;
  float outLum = dot(col, vec3(0.299, 0.587, 0.114));
  float backdropAdapt = clamp(uBackdropAdapt, 0.0, 1.0);
  if (backdropAdapt > 0.001) {
    float brightAvoid = smoothstep(0.48, 0.84, outLum) * backdropAdapt;
    bloomKeep *= 1.0 - brightAvoid * 0.34;
  }
  gl_FragColor = vec4(col, soft * uAlpha * uBloomStrength * uParticleDim * pulse * 0.55 * vAlpha * bloomKeep);
}
`;

var bloomMaterial = new THREE.ShaderMaterial({
  uniforms: uniforms, vertexShader: bloomVs, fragmentShader: bloomFs,
  transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
});

var bloomParticles = new THREE.Points(geo, bloomMaterial);

bloomParticles.frustumCulled = false;

bloomParticles.renderOrder = 0;

scene.add(bloomParticles);

var particles = new THREE.Points(geo, material);

particles.frustumCulled = false;

particles.renderOrder = 1;

scene.add(particles);


var BACKGROUND_STAR_RIVER_COUNT = 1400;

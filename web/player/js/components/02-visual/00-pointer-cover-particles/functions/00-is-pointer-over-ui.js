'use strict';



function isPointerOverUi(e) {
  if (!e) return false;
  var el = document.elementFromPoint(e.clientX, e.clientY);
  return !!(el && el.closest && el.closest(UI_HIT_SELECTOR));
}


function particleLocalPointFromNdc(ndcX, ndcY, out) {
  particlePointerNdc.set(ndcX, ndcY);
  particlePointerRay.setFromCamera(particlePointerNdc, camera);
  if (particles) {
    particles.updateMatrixWorld(true);
    particles.getWorldPosition(particlePointerPlanePoint);
    particles.getWorldQuaternion(particlePointerQuat);
    particlePointerPlaneNormal.set(0, 0, 1).applyQuaternion(particlePointerQuat).normalize();
    if (Math.abs(particlePointerPlaneNormal.dot(particlePointerRay.ray.direction)) < 0.16) return false;
    particlePointerPlane.setFromNormalAndCoplanarPoint(particlePointerPlaneNormal, particlePointerPlanePoint);
    if (particlePointerRay.ray.intersectPlane(particlePointerPlane, particlePointerWorldHit)) {
      out.copy(particlePointerWorldHit);
      particles.worldToLocal(out);
      return isFinite(out.x) && isFinite(out.y) && Math.abs(out.x) < 8.5 && Math.abs(out.y) < 8.5;
    }
  }
  particlePointerPlaneNormal.set(0, 0, 1);
  particlePointerPlane.set(particlePointerPlaneNormal, 0);
  if (particlePointerRay.ray.intersectPlane(particlePointerPlane, particlePointerWorldHit)) {
    out.copy(particlePointerWorldHit);
    return isFinite(out.x) && isFinite(out.y) && Math.abs(out.x) < 8.5 && Math.abs(out.y) < 8.5;
  }
  return false;
}


function queueParticlePointerFrame(clientX, clientY) {
  var mx = (clientX / innerWidth) * 2 - 1;
  var my = -(clientY / innerHeight) * 2 + 1;
  pointerTarget.x = mx; pointerTarget.y = my;
  particlePointerFrame.ndcX = mx;
  particlePointerFrame.ndcY = my;
  particlePointerFrame.dirty = true;
}


function updateParticlePointerFrame() {
  if (!particlePointerFrame.dirty) return;
  particlePointerFrame.dirty = false;
  if (particleLocalPointFromNdc(particlePointerFrame.ndcX, particlePointerFrame.ndcY, particlePointerLocalHit)) {
    mouseWorld.x = particlePointerLocalHit.x;
    mouseWorld.y = particlePointerLocalHit.y;
    mouseActive = true;
  } else {
    mouseWorld.set(-999, -999, 0);
    mouseActive = false;
  }
}


function beginParticlePointerDrag(e) {
  if (e.button === 2) return;
  if (isPointerOverUi(e)) return;
  markRenderInteraction('canvas-drag', 1200);
  idleGuidePointerDown(e);
  orbit.rotating = true; orbit.last.x = e.clientX; orbit.last.y = e.clientY;
  particlePointerSpin.active = true;
  particlePointerSpin.lastX = e.clientX;
  particlePointerSpin.lastY = e.clientY;
  particlePointerSpin.lastT = performance.now();
  if (typeof particleSpin !== 'undefined') particleSpin.vx = particleSpin.vy = 0;
  mouseDownAt.x = e.clientX; mouseDownAt.y = e.clientY;
  mouseDownAt.t = performance.now(); mouseDownAt.hadDrag = false;
}


// ============================================================
//  粒子点纹理 (干净圆点, 无 glow)
// ============================================================
function makeDotTexture() {
  var cv = document.createElement('canvas'); cv.width = cv.height = 64;
  var ctx = cv.getContext('2d');
  var g = ctx.createRadialGradient(32, 32, 0, 32, 32, 31);
  g.addColorStop(0.00, 'rgba(255,255,255,0.96)');
  g.addColorStop(0.42, 'rgba(255,255,255,0.78)');
  g.addColorStop(0.72, 'rgba(255,255,255,0.22)');
  g.addColorStop(1.00, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  var tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
  return tex;
}


function buildCoverParticleGeometry(grid) {
  var simple = window.mineradioSimplePlayer && window.mineradioSimplePlayer.active();
  grid = simple ? 2 : coverParticleGridForResolution(grid / 118);
  var count = simple ? 0 : grid * grid;
  var nextGeo = new THREE.BufferGeometry();
  var nextPositions = new Float32Array(count * 3);
  var nextUvs = new Float32Array(count * 2);
  var nextRand = new Float32Array(count);
  var texelStep = 1 / grid;
  for (var i = 0; i < count; i++) {
    var gx = i % grid, gy = Math.floor(i / grid);
    var u = (gx + 0.5) * texelStep, v = (gy + 0.5) * texelStep;
    var px = gx / (grid - 1), py = gy / (grid - 1);
    nextPositions[i * 3] = (px - 0.5) * PLANE_SIZE;
    nextPositions[i * 3 + 1] = (py - 0.5) * PLANE_SIZE;
    nextPositions[i * 3 + 2] = 0;
    nextUvs[i * 2] = u;
    nextUvs[i * 2 + 1] = v;
    nextRand[i] = Math.random();
  }
  nextGeo.setAttribute('position', new THREE.BufferAttribute(nextPositions, 3));
  nextGeo.setAttribute('aUv', new THREE.BufferAttribute(nextUvs, 2));
  nextGeo.setAttribute('aRand', new THREE.BufferAttribute(nextRand, 1));
  nextGeo.userData.grid = grid;
  nextGeo.userData.count = count;
  positions = nextPositions;
  uvs = nextUvs;
  aRand = nextRand;
  return nextGeo;
}


function applyCoverParticleResolution(value, opts) {
  if (window.mineradioSimplePlayer && window.mineradioSimplePlayer.active()) return;
  opts = opts || {};
  fx.coverResolution = normalizeCoverResolution(value);
  var grid = coverParticleGridForResolution(fx.coverResolution);
  if (grid === GRID_X && geo && geo.userData && geo.userData.grid === grid) return;
  var oldGeo = geo;
  var nextGeo = buildCoverParticleGeometry(grid);
  geo = nextGeo;
  GRID_X = GRID_Y = grid;
  PCOUNT = grid * grid;
  if (particles) particles.geometry = nextGeo;
  if (bloomParticles) bloomParticles.geometry = nextGeo;
  if (oldGeo && oldGeo !== nextGeo) oldGeo.dispose();
  uniforms.uBurstAmt.value = Math.max(uniforms.uBurstAmt.value, 0.18);
  if (opts.reload !== false) scheduleCoverResolutionReload();
}


function scheduleCoverResolutionReload() {
  if (!currentCoverSource || !currentCoverSource.src) return;
  if (coverResolutionReloadTimer) clearTimeout(coverResolutionReloadTimer);
  coverResolutionReloadTimer = setTimeout(function () {
    coverResolutionReloadTimer = null;
    if (!currentCoverSource || !currentCoverSource.src) return;
    if (currentCoverSource.kind === 'url') {
      loadCoverFromUrl(currentCoverSource.src, { trackToken: trackSwitchToken, fromResolutionChange: true });
    } else if (currentCoverSource.kind === 'data') {
      applyCoverDataUrl(currentCoverSource.src, { trackToken: trackSwitchToken, fromResolutionChange: true });
    }
  }, 260);
}


function buildBackgroundStarRiverGeometry(count) {
  if (window.mineradioSimplePlayer && window.mineradioSimplePlayer.active()) count = 0;
  var bgGeo = new THREE.BufferGeometry();
  var seeds = new Float32Array(count);
  var lanes = new Float32Array(count);
  var depths = new Float32Array(count);
  for (var i = 0; i < count; i++) {
    seeds[i] = Math.random() * 1000 + i * 0.37;
    lanes[i] = Math.random();
    depths[i] = Math.random();
  }
  bgGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  bgGeo.setAttribute('aLane', new THREE.BufferAttribute(lanes, 1));
  bgGeo.setAttribute('aDepthSeed', new THREE.BufferAttribute(depths, 1));
  return bgGeo;
}


function backgroundStarRiverTargetAlpha() {
  if (!fx || fx.backgroundStarRiver === false) return 0;
  if (Number(fx.preset) === 5) return 0;
  if (typeof SONIC_PRESET_INDEX !== 'undefined' && Number(fx.preset) === SONIC_PRESET_INDEX) return 0;
  if (typeof SONIC_WORKSHOP_PRESET_INDEX !== 'undefined' && Number(fx.preset) === SONIC_WORKSHOP_PRESET_INDEX) return 0.28;
  if (typeof SKULL_PRESET_INDEX !== 'undefined' && Number(fx.preset) === SKULL_PRESET_INDEX) return 0.38;
  if (Number(fx.preset) === 9) return 0.12;
  if (Number(fx.preset) === 10) return 0.18;
  if (Number(fx.preset) === 11) return 0.10;
  if (Number(fx.preset) === 12) return 0.16;
  return 0.34;
}


function updateBackgroundStarRiverState(dt, immediate) {
  if (!backgroundStarRiverParticles || !backgroundStarRiverUniforms) return;
  var target = backgroundStarRiverTargetAlpha();
  if (immediate) {
    backgroundStarRiverUniforms.uAlpha.value = target;
  } else {
    var ease = target > backgroundStarRiverUniforms.uAlpha.value ? 0.085 : 0.16;
    backgroundStarRiverUniforms.uAlpha.value += (target - backgroundStarRiverUniforms.uAlpha.value) * Math.min(1, ease * Math.max(1, (dt || 0.016) * 60));
  }
  backgroundStarRiverParticles.visible = backgroundStarRiverUniforms.uAlpha.value > 0.006;
}

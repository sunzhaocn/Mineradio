'use strict';


function setIdleGuideVisible(show, interactive) {
  document.body.classList.toggle('idle-guide-on', show);
  document.body.classList.toggle('idle-guide-interactive', !!interactive);
  if (!interactive) document.body.classList.remove('idle-guide-dragging');
  if (idleGuideVisible === show) return;
  idleGuideVisible = show;
}

function shouldShowIdleGuide() {
  if (!IDLE_GUIDE_BACKGROUND_ENABLED) return false;
  if (document.body.classList.contains('splash-active')) return false;
  if (immersiveMode) return false;
  if (playing) return false;
  if (loginGuideAnimating) return false;
  if (document.querySelector('.modal-mask.show')) return false;
  if (uniforms && uniforms.uHasCover && uniforms.uHasCover.value > 0.5) return false;
  return true;
}

function shouldShowShelfHoverCue(value) {
  if (document.body.classList.contains('splash-active')) return false;
  if (!shelfHoverCue.guide && document.querySelector('.modal-mask.show')) return false;
  if (!shelfHoverCue.guide) {
    if (shelfPinnedOpen) return false;
    if (!shelfManager || !shelfManager.canInteract || !shelfManager.canInteract()) return false;
    if (shelfManager.hasOpenContent && shelfManager.hasOpenContent()) return false;
    if (!shelfManager.getMode || shelfManager.getMode() !== 'side') return false;
  }
  return shelfHoverCue.guide || shelfHoverCue.target > 0 || (value || shelfHoverCue.value) > 0.015;
}

function shouldHandleIdleGuidePointer(e) {
  if (!idleGuideCanvas || !shouldShowIdleGuide()) return false;
  if (isPointerOverUi(e)) return false;
  return true;
}

function clampIdleGuideSpin(v) {
  if (!isFinite(v)) return 0;
  return Math.max(-4.8, Math.min(4.8, v));
}

function idleGuidePointerDown(e) {
  if (!shouldHandleIdleGuidePointer(e)) return;
  idleGuideInteraction.dragging = true;
  idleGuideInteraction.pointerActive = true;
  idleGuideInteraction.lastX = e.clientX;
  idleGuideInteraction.lastY = e.clientY;
  idleGuideInteraction.lastT = performance.now();
  idleGuideInteraction.pointerX = e.clientX / Math.max(1, idleGuideW || innerWidth);
  idleGuideInteraction.pointerY = e.clientY / Math.max(1, idleGuideH || innerHeight);
  document.body.classList.add('idle-guide-dragging');
}

function idleGuidePointerMove(e) {
  if (!idleGuideCanvas) return;
  var canReact = shouldHandleIdleGuidePointer(e) || idleGuideInteraction.dragging;
  idleGuideInteraction.pointerActive = canReact;
  if (canReact) {
    idleGuideInteraction.pointerX = e.clientX / Math.max(1, idleGuideW || innerWidth);
    idleGuideInteraction.pointerY = e.clientY / Math.max(1, idleGuideH || innerHeight);
  }
  if (!idleGuideInteraction.dragging) return;
  var now = performance.now();
  var dt = Math.max(1 / 120, Math.min(0.08, (now - idleGuideInteraction.lastT) / 1000 || 1 / 60));
  var dx = e.clientX - idleGuideInteraction.lastX;
  var dy = e.clientY - idleGuideInteraction.lastY;
  var rx = -dy * 0.0032;
  var ry = dx * 0.0034;
  idleGuideInteraction.rotX += rx;
  idleGuideInteraction.rotY += ry;
  idleGuideInteraction.angle += ry * 0.22;
  idleGuideInteraction.spinX = clampIdleGuideSpin(rx / dt * 0.46);
  idleGuideInteraction.spinY = clampIdleGuideSpin(ry / dt * 0.46);
  idleGuideInteraction.velocity = Math.sqrt(idleGuideInteraction.spinX * idleGuideInteraction.spinX + idleGuideInteraction.spinY * idleGuideInteraction.spinY);
  idleGuideInteraction.lastX = e.clientX;
  idleGuideInteraction.lastY = e.clientY;
  idleGuideInteraction.lastT = now;
}

function idleGuidePointerUp() {
  if (!idleGuideInteraction.dragging) return;
  idleGuideInteraction.dragging = false;
  document.body.classList.remove('idle-guide-dragging');
}

function idleGuidePointerLeave() {
  if (!idleGuideInteraction.dragging) idleGuideInteraction.pointerActive = false;
}

function idleGuideWheel(e) {
  if (!shouldHandleIdleGuidePointer(e)) return false;
  var guide = idleGuideInteraction;
  guide.pointerActive = true;
  guide.pointerX = e.clientX / Math.max(1, idleGuideW || innerWidth);
  guide.pointerY = e.clientY / Math.max(1, idleGuideH || innerHeight);
  var nextZoom = guide.zoomTarget * Math.exp(-e.deltaY * 0.0012);
  guide.zoomTarget = Math.max(0.58, Math.min(1.82, nextZoom));
  guide.zoomPulse = Math.min(1, guide.zoomPulse + Math.min(0.28, Math.abs(e.deltaY) * 0.0014));
  return true;
}

function resizeIdleGuideCanvas() {
  if (!idleGuideCanvas) return;
  idleGuideDpr = Math.min(window.devicePixelRatio || 1, 1.6);
  idleGuideW = window.innerWidth;
  idleGuideH = window.innerHeight;
  idleGuideCanvas.width = Math.max(1, Math.floor(idleGuideW * idleGuideDpr));
  idleGuideCanvas.height = Math.max(1, Math.floor(idleGuideH * idleGuideDpr));
  idleGuideCanvas.style.width = idleGuideW + 'px';
  idleGuideCanvas.style.height = idleGuideH + 'px';
  idleGuideCtx.setTransform(idleGuideDpr, 0, 0, idleGuideDpr, 0, 0);
  idleGuideParticles = [];
  resetIdleGuideTrails();
  if (!IDLE_GUIDE_BACKGROUND_ENABLED) return;
  var minDim = Math.min(idleGuideW, idleGuideH);
  var maxDim = Math.max(idleGuideW, idleGuideH);
  var count = idleGuideW < 800 ? 150 : 240;
  for (var i = 0; i < count; i++) {
    var ring = i < count * 0.76;
    var a = Math.random() * Math.PI * 2;
    var r = ring
      ? (minDim * 0.035 + Math.pow(Math.random(), 0.58) * minDim * 0.335)
      : (Math.pow(Math.random(), 0.82) * maxDim * 0.58);
    var wobbleAmp = minDim * (ring ? (0.012 + Math.random() * 0.035) : (0.010 + Math.random() * 0.055));
    idleGuideParticles.push({
      a: a,
      r: r,
      cx: ring ? 0.5 : Math.random(),
      cy: ring ? 0.5 : Math.random(),
      size: ring ? (0.30 + Math.random() * 0.62) : (0.18 + Math.random() * 0.44),
      speed: ((ring ? 0.018 : 0.010) + Math.random() * (ring ? 0.045 : 0.030)) * (Math.random() < 0.5 ? -1 : 1),
      phase: Math.random() * Math.PI * 2,
      wobbleAmp: wobbleAmp,
      wobbleSpeed: 0.18 + Math.random() * 0.76,
      oval: 0.56 + Math.random() * 0.36,
      zAmp: 0.34 + Math.random() * 0.82,
      driftX: (Math.random() * 2 - 1) * wobbleAmp * 0.75,
      driftY: (Math.random() * 2 - 1) * wobbleAmp * 0.75,
      layer: Math.random(),
      z: (Math.random() * 2 - 1) * (ring ? minDim * 0.28 : maxDim * 0.42),
      ring: ring
    });
  }
}

function projectIdleGuidePoint(x, y, z, rot, cx, cy, depth) {
  var x1 = x * rot.cy + z * rot.sy;
  var z1 = -x * rot.sy + z * rot.cy;
  var y1 = y * rot.cx - z1 * rot.sx;
  var z2 = y * rot.sx + z1 * rot.cx;
  var scale = depth / (depth - z2 * 0.72);
  scale = Math.max(0.52, Math.min(1.74, scale));
  return {
    x: cx + x1 * scale,
    y: cy + y1 * scale,
    z: z2,
    scale: scale
  };
}

function resetIdleGuideTrails() {
  idleGuideTrails = [[], [], [], []];
}

function pushIdleGuideTrail(index, pt, alpha, now) {
  var trail = idleGuideTrails[index];
  if (!trail) trail = idleGuideTrails[index] = [];
  var last = trail[trail.length - 1];
  var dx = last ? pt.x - last.x : 999;
  var dy = last ? pt.y - last.y : 999;
  if (!last || Math.sqrt(dx * dx + dy * dy) > 1.4 || now - last.t > 42) {
    trail.push({ x: pt.x, y: pt.y, scale: pt.scale || 1, alpha: alpha || 1, t: now });
  }
  while (trail.length > 26) trail.shift();
}

function drawIdleGuideTrail(ctx, trail, now, alpha, energy) {
  if (!trail || trail.length < 2) return;
  while (trail.length && now - trail[0].t > 680) trail.shift();
  if (trail.length < 2) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (var i = 1; i < trail.length; i++) {
    var prev = trail[i - 1];
    var cur = trail[i];
    var age = (now - cur.t) / 680;
    var order = i / Math.max(1, trail.length - 1);
    var fade = Math.max(0, 1 - age) * order;
    if (fade <= 0) continue;
    ctx.strokeStyle = 'rgba(255,255,255,' + (alpha * fade * (0.18 + energy * 0.24)).toFixed(3) + ')';
    ctx.lineWidth = (0.7 + cur.scale * 0.9 + energy * 1.2) * fade;
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    var mx = (prev.x + cur.x) * 0.5;
    var my = (prev.y + cur.y) * 0.5;
    ctx.quadraticCurveTo(mx, my, cur.x, cur.y);
    ctx.stroke();
  }
  ctx.restore();
}

function scheduleIdleGuideFrame(delay) {
  if (idleGuideDelayTimer) {
    clearTimeout(idleGuideDelayTimer);
    idleGuideDelayTimer = null;
  }
  if (delay && delay > 0) {
    idleGuideDelayTimer = setTimeout(function () {
      idleGuideDelayTimer = null;
      requestAnimationFrame(drawIdleGuideFrame);
    }, delay);
  } else {
    requestAnimationFrame(drawIdleGuideFrame);
  }
}
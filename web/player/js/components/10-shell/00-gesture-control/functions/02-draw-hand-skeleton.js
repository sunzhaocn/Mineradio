'use strict';


function drawHandSkeleton(lm, isPinch, openness, isFist) {
  if (!handCanvasCtx) return;
  var ctx = handCanvasCtx;
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  var W = innerWidth, H = innerHeight;
  openness = clampRange(openness == null ? 1 : openness, 0, 1);
  var palm = palmCenter(lm);
  var px = palm.x * W, py = palm.y * H;
  var primary = isFist ? 'rgba(244,210,138,0.92)' : (isPinch ? 'rgba(156,255,223,0.95)' : 'rgba(226,247,255,0.92)');
  var soft = isFist ? 'rgba(244,210,138,0.18)' : (isPinch ? 'rgba(156,255,223,0.20)' : 'rgba(143,233,255,0.18)');
  var coreR = 26 + openness * 34;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  var aura = ctx.createRadialGradient(px, py, 0, px, py, coreR * 2.15);
  aura.addColorStop(0, isFist ? 'rgba(244,210,138,0.26)' : 'rgba(255,255,255,0.22)');
  aura.addColorStop(0.28, soft);
  aura.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = aura;
  ctx.beginPath();
  ctx.arc(px, py, coreR * 2.15, 0, Math.PI * 2);
  ctx.fill();

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  var ringR = 34 + openness * 48;
  for (var r = 0; r < 3; r++) {
    var alpha = (0.18 - r * 0.045) + (isFist ? 0.08 : 0);
    ctx.strokeStyle = primary.replace(/0\.\d+\)/, alpha.toFixed(3) + ')');
    ctx.lineWidth = 1.2 + r * 0.55;
    ctx.beginPath();
    ctx.arc(px, py, ringR + r * 13 + Math.sin(uniforms.uTime.value * 1.5 + r) * 2, 0, Math.PI * 2);
    ctx.stroke();
  }

  var tips = [4, 8, 12, 16, 20];
  for (var i = 0; i < tips.length; i++) {
    var p = lm[tips[i]];
    var tx = p.x * W, ty = p.y * H;
    var dx = tx - px, dy = ty - py;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var beamAlpha = clampRange(0.26 - dist / 720, 0.045, 0.18) * (0.55 + openness * 0.45);
    var grad = ctx.createLinearGradient(px, py, tx, ty);
    grad.addColorStop(0, 'rgba(255,255,255,' + (beamAlpha * 0.20).toFixed(3) + ')');
    grad.addColorStop(0.65, 'rgba(255,255,255,' + (beamAlpha * 0.42).toFixed(3) + ')');
    grad.addColorStop(1, primary.replace(/0\.\d+\)/, Math.min(0.72, beamAlpha + 0.14).toFixed(3) + ')'));
    ctx.strokeStyle = grad;
    ctx.lineWidth = tips[i] === 8 || tips[i] === 4 ? 1.7 : 1.05;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.quadraticCurveTo(px + dx * 0.42 - dy * 0.05, py + dy * 0.42 + dx * 0.05, tx, ty);
    ctx.stroke();
    var dotR = (tips[i] === 8 || tips[i] === 4 ? 4.2 : 3.0) + (isFist ? 0.8 : 0);
    var dot = ctx.createRadialGradient(tx, ty, 0, tx, ty, dotR * 4.2);
    dot.addColorStop(0, 'rgba(255,255,255,0.92)');
    dot.addColorStop(0.32, primary);
    dot.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = dot;
    ctx.beginPath();
    ctx.arc(tx, ty, dotR * 4.2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.beginPath();
  ctx.arc(px, py, isFist ? 7.2 : 5.4, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,' + (isFist ? 0.82 : 0.62).toFixed(3) + ')';
  ctx.fill();

  if (isPinch) {
    var t1 = lm[4], t2 = lm[8];
    ctx.strokeStyle = 'rgba(220,255,241,0.88)';
    ctx.lineWidth = 2.0;
    ctx.shadowColor = 'rgba(126,226,168,0.82)';
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.moveTo(t1.x * W, t1.y * H);
    ctx.lineTo(t2.x * W, t2.y * H);
    ctx.stroke();
  }
  ctx.restore();
}


// 每帧调用 — 应用惯性旋转 + handActive 衰减
function tickGestureRotation(dt) {
  if (Math.abs(particleSpin.vx) > 0.0001 || Math.abs(particleSpin.vy) > 0.0001) {
    var rx = particleSpin.vx * dt;
    var ry = particleSpin.vy * dt;
    gestureRotation.x += rx;
    gestureRotation.y += ry;
    rebaseParticleRotationIfNeeded();
  }
  particleSpin.vx *= Math.pow(particleSpin.damping, dt * 60);
  particleSpin.vy *= Math.pow(particleSpin.damping, dt * 60);
  if (Math.abs(particleSpin.vx) < 0.01) particleSpin.vx = 0;
  if (Math.abs(particleSpin.vy) < 0.01) particleSpin.vy = 0;
  gestureGrip.value += (gestureGrip.target - gestureGrip.value) * (gestureGrip.target > gestureGrip.value ? 0.18 : 0.10);
  gestureGrip.pulse *= Math.pow(0.84, dt * 60);
  if (uniforms.uGestureGrip) uniforms.uGestureGrip.value = clampRange(gestureGrip.value + gestureGrip.pulse * 0.16, 0, 1);
  // hand active 自然衰减 (无手时)
  if (gestureActive && handLmSmooth && performance.now() - handLmLastSeen > 200) {
    uniforms.uHandActive.value *= 0.94;
    gestureGrip.target *= 0.92;
    if (uniforms.uHandActive.value < 0.02) uniforms.uHandActive.value = 0;
  }
}


function showGestureHUD(label, progress, detail) {
  var hud = document.getElementById('gesture-hud');
  if (!hud) return;
  var safeLabel = label || '待命';
  var safeDetail = detail || '将手放进摄像头视野';
  var safeProgress = Math.max(0, Math.min(100, (progress || 0) * 100));
  var signature = safeLabel + '|' + safeDetail + '|' + Math.round(safeProgress / 2);
  var now = performance.now();
  if (signature === gestureLastHudSignature && now - gestureLastHudAt < 100) return;
  gestureLastHudSignature = signature;
  gestureLastHudAt = now;
  document.getElementById('gesture-label').textContent = safeLabel;
  document.getElementById('gesture-confirm').textContent = safeDetail;
  var fill = document.getElementById('gesture-fill');
  if (fill) fill.style.width = safeProgress + '%';
  hud.classList.add('show');
}

function showGestureCursor() { }
  // stub: 兼容旧调用
function hideGestureCursor() { }
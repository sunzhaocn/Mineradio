'use strict';



function drawMineradioSplash() {
  if (!splashAnimating || (!splashCtx && !splashGl)) return;
  requestAnimationFrame(drawMineradioSplash);
  var elapsed = splashTimelineElapsed((performance.now() - splashStartedAt) / 1000);
  if (splashGl && splashGlProgram) {
    drawMineradioSplashWebgl(elapsed);
    return;
  }
  splashCtx.clearRect(0, 0, splashW, splashH);

  var base = splashCtx.createLinearGradient(0, 0, splashW, splashH);
  base.addColorStop(0, 'rgba(1,6,7,0.68)');
  base.addColorStop(0.45, 'rgba(10,9,12,0.74)');
  base.addColorStop(1, 'rgba(0,0,0,0.84)');
  splashCtx.fillStyle = base;
  splashCtx.fillRect(0, 0, splashW, splashH);

  splashCtx.save();
  splashCtx.globalAlpha = 0.22;
  splashCtx.fillStyle = 'rgba(255,255,255,0.035)';
  var scanOffset = (elapsed * 28) % 36;
  for (var sy = -scanOffset; sy < splashH; sy += 36) splashCtx.fillRect(0, sy, splashW, 1);
  splashCtx.restore();

  for (var i = 0; i < splashDust.length; i++) {
    var d = splashDust[i];
    d.x += d.vx;
    d.y += d.vy;
    d.p += 0.018;
    if (d.x < -10) d.x = splashW + 10;
    if (d.x > splashW + 10) d.x = -10;
    if (d.y < -10) d.y = splashH + 10;
    if (d.y > splashH + 10) d.y = -10;
    var alpha = d.a * (0.58 + Math.sin(d.p + elapsed * 0.8) * 0.34);
    splashCtx.beginPath();
    splashCtx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    splashCtx.fillStyle = 'rgba(255,255,255,' + Math.max(0, alpha) + ')';
    splashCtx.fill();
  }

  splashCtx.save();
  splashCtx.globalCompositeOperation = 'lighter';
  for (var k = 0; k < splashStreaks.length; k++) {
    var st = splashStreaks[k];
    var travel = (elapsed * st.speed * 240 + st.x + Math.sin(elapsed * 0.8 + st.phase) * 28) % (splashW + st.len + 180);
    var px = travel - st.len - 90;
    var py = st.y + Math.sin(elapsed * 0.75 + st.phase) * 18;
    var fade = splashSmoothstep(st.delay * 0.55, st.delay * 0.55 + 0.52, elapsed) * (1 - splashSmoothstep(3.52, 4.12, elapsed));
    if (fade <= 0) continue;
    splashCtx.save();
    splashCtx.translate(px, py);
    splashCtx.rotate(st.angle);
    var sg = splashCtx.createLinearGradient(-st.len * 0.5, 0, st.len * 0.5, 0);
    sg.addColorStop(0, st.color + '0)');
    sg.addColorStop(0.52, st.color + (st.alpha * fade).toFixed(3) + ')');
    sg.addColorStop(1, 'rgba(255,255,255,0)');
    splashCtx.strokeStyle = sg;
    splashCtx.lineWidth = st.width;
    splashCtx.shadowColor = st.color + (0.34 * fade).toFixed(3) + ')';
    splashCtx.shadowBlur = 18;
    splashCtx.beginPath();
    splashCtx.moveTo(-st.len * 0.5, 0);
    splashCtx.lineTo(st.len * 0.5, 0);
    splashCtx.stroke();
    splashCtx.restore();
  }

  var lineT = splashEaseOutCubic((elapsed - 0.12) / 1.18);
  var exitFade = 1 - splashSmoothstep(3.58, 4.12, elapsed);
  if (lineT > 0 && exitFade > 0) {
    var centerY = splashH * 0.5 + Math.sin(elapsed * 1.4) * 1.6;
    var slitW = splashW * (0.16 + lineT * 0.72);
    var left = splashW * 0.5 - slitW * 0.5;
    var right = splashW * 0.5 + slitW * 0.5;
    var coreAlpha = (0.34 + lineT * 0.58) * exitFade;
    var slitGrad = splashCtx.createLinearGradient(left, centerY, right, centerY);
    slitGrad.addColorStop(0, 'rgba(255,83,103,0)');
    slitGrad.addColorStop(0.18, 'rgba(255,83,103,' + (0.18 * exitFade).toFixed(3) + ')');
    slitGrad.addColorStop(0.50, 'rgba(255,255,255,' + coreAlpha.toFixed(3) + ')');
    slitGrad.addColorStop(0.68, 'rgba(244,210,138,' + (0.38 * exitFade).toFixed(3) + ')');
    slitGrad.addColorStop(0.84, 'rgba(122,215,194,' + (0.20 * exitFade).toFixed(3) + ')');
    slitGrad.addColorStop(1, 'rgba(122,215,194,0)');
    splashCtx.shadowColor = 'rgba(244,210,138,' + (0.48 * exitFade).toFixed(3) + ')';
    splashCtx.shadowBlur = 42 + lineT * 42;
    splashCtx.lineCap = 'round';
    splashCtx.strokeStyle = slitGrad;
    splashCtx.lineWidth = 1.4 + lineT * 2.2;
    splashCtx.beginPath();
    splashCtx.moveTo(left, centerY);
    splashCtx.lineTo(right, centerY);
    splashCtx.stroke();

    var ignition = Math.exp(-Math.pow((elapsed - 0.72) / 0.26, 2));
    if (ignition > 0.018) {
      var ig = splashCtx.createLinearGradient(0, centerY, splashW, centerY);
      ig.addColorStop(0, 'rgba(122,215,194,0)');
      ig.addColorStop(0.46, 'rgba(122,215,194,' + (0.07 * ignition).toFixed(3) + ')');
      ig.addColorStop(0.50, 'rgba(255,255,255,' + (0.16 * ignition).toFixed(3) + ')');
      ig.addColorStop(0.54, 'rgba(255,83,103,' + (0.08 * ignition).toFixed(3) + ')');
      ig.addColorStop(1, 'rgba(244,210,138,0)');
      splashCtx.fillStyle = ig;
      splashCtx.fillRect(0, centerY - 48 * ignition, splashW, 96 * ignition);
    }

    var waveAlpha = splashSmoothstep(0.72, 1.95, elapsed) * exitFade;
    if (waveAlpha > 0) {
      splashCtx.shadowBlur = 20;
      splashCtx.strokeStyle = 'rgba(244,210,138,' + (0.22 * waveAlpha).toFixed(3) + ')';
      splashCtx.lineWidth = 1;
      splashCtx.beginPath();
      var steps = 82;
      for (var wi = 0; wi <= steps; wi++) {
        var u = wi / steps;
        var x = left + slitW * u;
        var edge = 1 - Math.abs(u - 0.5) * 2;
        var amp = (4 + 18 * lineT) * Math.pow(Math.max(0, edge), 1.4) * waveAlpha;
        var y = centerY + Math.sin(u * 34 + elapsed * 8.2) * amp + Math.sin(u * 87 - elapsed * 5.1) * amp * 0.18;
        if (wi === 0) splashCtx.moveTo(x, y);
        else splashCtx.lineTo(x, y);
      }
      splashCtx.stroke();
    }

    var shardT = splashSmoothstep(0.72, 2.45, elapsed) * exitFade;
    for (var si = 0; si < splashShards.length; si++) {
      var sh = splashShards[si];
      var drift = Math.sin(elapsed * 1.7 + sh.phase) * 22;
      var sx = splashW * 0.5 + sh.ox * (0.18 + shardT * 0.82) + drift;
      var sy2 = centerY + sh.oy * (0.20 + shardT * 0.92);
      var localAlpha = sh.alpha * shardT * (0.62 + Math.sin(elapsed * 5 + sh.phase) * 0.38);
      if (localAlpha <= 0) continue;
      splashCtx.save();
      splashCtx.translate(sx, sy2);
      splashCtx.rotate((-6 + sh.skew * 0.10) * Math.PI / 180);
      splashCtx.fillStyle = sh.color + Math.max(0, localAlpha).toFixed(3) + ')';
      splashCtx.shadowColor = sh.color + Math.min(0.38, localAlpha * 1.2).toFixed(3) + ')';
      splashCtx.shadowBlur = 14;
      splashCtx.beginPath();
      splashCtx.moveTo(-sh.w * 0.5, -sh.h * 0.5);
      splashCtx.lineTo(sh.w * 0.5, -sh.h * 0.5);
      splashCtx.lineTo(sh.w * 0.5 + sh.skew, sh.h * 0.5);
      splashCtx.lineTo(-sh.w * 0.5 + sh.skew, sh.h * 0.5);
      splashCtx.closePath();
      splashCtx.fill();
      splashCtx.restore();
    }

    var flash = Math.exp(-Math.pow((elapsed - 2.52) / 0.38, 2));
    if (flash > 0.015) {
      var fg = splashCtx.createLinearGradient(0, centerY, splashW, centerY);
      fg.addColorStop(0, 'rgba(255,83,103,0)');
      fg.addColorStop(0.48, 'rgba(255,255,255,' + (0.20 * flash).toFixed(3) + ')');
      fg.addColorStop(0.52, 'rgba(244,210,138,' + (0.24 * flash).toFixed(3) + ')');
      fg.addColorStop(1, 'rgba(122,215,194,0)');
      splashCtx.fillStyle = fg;
      splashCtx.fillRect(0, centerY - 46 * flash, splashW, 92 * flash);
    }
  }
  splashCtx.restore();
}


function playMineradioIntroSound() {
  if (splashSoundPlayed) return;
  try {
    var AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return;
    var ctx = splashAudioCtx || new AudioContextCtor();
    splashAudioCtx = ctx;
    if (ctx.state === 'suspended' && ctx.resume) {
      ctx.resume().then(function () {
        if (!splashSoundPlayed) playMineradioIntroSound();
      }).catch(function () { });
      if (ctx.state === 'suspended') return;
    }
    splashSoundPlayed = true;

    var now = ctx.currentTime + 0.02;
    var master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.052, now + 0.16);
    master.gain.exponentialRampToValueAtTime(0.034, now + 3.35);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 5.28);
    master.connect(ctx.destination);

    var noiseBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2.45), ctx.sampleRate);
    var data = noiseBuffer.getChannelData(0);
    for (var i = 0; i < data.length; i++) {
      var tail = 1 - i / data.length;
      data[i] = (Math.random() * 2 - 1) * Math.pow(tail, 1.35);
    }
    var noise = ctx.createBufferSource();
    var noiseGain = ctx.createGain();
    var noiseFilter = ctx.createBiquadFilter();
    noise.buffer = noiseBuffer;
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(720, now);
    noiseFilter.frequency.exponentialRampToValueAtTime(2400, now + 2.2);
    noiseFilter.Q.setValueAtTime(0.72, now);
    noiseGain.gain.setValueAtTime(0.0001, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.020, now + 0.12);
    noiseGain.gain.exponentialRampToValueAtTime(0.010, now + 1.60);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 2.42);
    noise.connect(noiseFilter); noiseFilter.connect(noiseGain); noiseGain.connect(master);
    noise.start(now); noise.stop(now + 2.46);

    var low = ctx.createOscillator();
    var lowGain = ctx.createGain();
    low.type = 'sine';
    low.frequency.setValueAtTime(86, now + 0.18);
    low.frequency.exponentialRampToValueAtTime(43, now + 1.18);
    lowGain.gain.setValueAtTime(0.0001, now + 0.12);
    lowGain.gain.exponentialRampToValueAtTime(0.032, now + 0.30);
    lowGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.34);
    low.connect(lowGain); lowGain.connect(master);
    low.start(now + 0.12); low.stop(now + 1.40);

    function retroChord(frequencies, startAt, dur, peak) {
      frequencies.forEach(function (frequency, index) {
        var start = now + startAt + index * 0.036;
        var end = now + startAt + dur + index * 0.018;
        var body = ctx.createOscillator();
        var edge = ctx.createOscillator();
        var filter = ctx.createBiquadFilter();
        var gain = ctx.createGain();
        var edgeGain = ctx.createGain();
        body.type = 'triangle';
        edge.type = 'square';
        body.frequency.setValueAtTime(frequency, start);
        edge.frequency.setValueAtTime(frequency * 2, start);
        body.detune.setValueAtTime(index % 2 ? 2.5 : -2.5, start);
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(2350, start);
        filter.frequency.exponentialRampToValueAtTime(1450, end);
        filter.Q.setValueAtTime(0.72, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.linearRampToValueAtTime(peak, start + 0.026);
        gain.gain.exponentialRampToValueAtTime(0.0001, end);
        edgeGain.gain.setValueAtTime(0.0001, start);
        edgeGain.gain.linearRampToValueAtTime(peak * 0.11, start + 0.012);
        edgeGain.gain.exponentialRampToValueAtTime(0.0001, Math.min(end, start + 0.34));
        body.connect(filter); filter.connect(gain); gain.connect(master);
        edge.connect(edgeGain); edgeGain.connect(master);
        body.start(start); edge.start(start);
        body.stop(end + 0.04); edge.stop(end + 0.04);
      });
    }
    // Soft four-voice console chords: Am7 -> Fmaj7 -> Cmaj7 -> G6.
    retroChord([220.00, 261.63, 329.63, 392.00], 0.48, 0.92, 0.013);
    retroChord([174.61, 220.00, 261.63, 329.63], 1.48, 0.96, 0.012);
    retroChord([261.63, 329.63, 392.00, 493.88], 2.50, 0.98, 0.0115);
    retroChord([196.00, 246.94, 293.66, 329.63], 3.54, 1.12, 0.0125);
  } catch (e) { }
}

function armSplashSoundFallback() {
  if (splashSoundFallbackArmed) return;
  splashSoundFallbackArmed = true;
  function unlock() {
    if (!splashSoundPlayed) playMineradioIntroSound();
    document.removeEventListener('pointerdown', unlock, true);
    document.removeEventListener('keydown', unlock, true);
  }
  document.addEventListener('pointerdown', unlock, true);
  document.addEventListener('keydown', unlock, true);
}


function finishSplashReveal(forceLoad, opts) {
  opts = opts || {};
  markAppPerf('home-revealed');
  if (!(window.mineradioSimplePlayer && window.mineradioSimplePlayer.active()) && typeof resumeSavedGestureControl === 'function') {
    setTimeout(function () { resumeSavedGestureControl(opts.reason || 'splash-reveal'); }, opts.fastSkip ? 120 : 260);
  }
  // Never make the renderer's visibility depend on the next animation frame.
  // The desktop HWND may already be in its native handoff at this point.
  releaseStartupFastSkipPreload();
  requestAnimationFrame(function () {
    var homeShown = updateEmptyHomeVisibility({ forceLoad: forceLoad !== false });
    if (!homeShown && shouldForceEmptyHomeAfterSplash()) {
      homeSuppressed = false;
      homeForcedOpen = true;
      homeShown = updateEmptyHomeVisibility({ forceLoad: forceLoad !== false });
    }
    requestAnimationFrame(function () {
      markStartupHomeReadyForAutoplay(opts.reason || 'splash', opts.fastSkip ? 240 : 100);
      var simple = window.mineradioSimplePlayer && window.mineradioSimplePlayer.active();
      var guideStarted = simple || maybeRunStartupVisualGuide('splash');
      if (!guideStarted && !hasAnyPlatformLogin()) maybeRunStartupLoginGuide('splash');
      else if (!guideStarted && !homeShown) maybeRunStartupLoginGuide('splash');
      setTimeout(maybeShowUploadTipOnce, 5200);
    });
  });
}


function dismissSplash(opts) {
  opts = opts || {};
  var s = document.getElementById('splash');
  if (!s || s.classList.contains('hide') || s.classList.contains('exiting')) return;
  var instant = !!opts.instant;
  markAppPerf(instant ? 'splash-skip' : 'splash-dismiss');
  if (splashTimer) { clearTimeout(splashTimer); splashTimer = null; }
  splashReadyToEnter = false;
  s.classList.remove('ready');
  setTimeout(stopSplashIntroSound, instant ? 0 : 240);
  if (instant) {
    s.classList.add('hide');
    s.style.display = 'none';
    splashAnimating = false;
    document.body.classList.remove('splash-active');
    document.body.classList.remove('splash-revealing');
    if (!(window.mineradioSimplePlayer && window.mineradioSimplePlayer.active())) revealIdleParticles(0, 520);
    finishSplashReveal(true, { fastSkip: true, reason: 'fast-skip' });
    return;
  }
  if (typeof shouldUseIdleWallpaperPreview === 'function'
    ? shouldUseIdleWallpaperPreview(true)
    : (typeof shouldShowEmptyHomeAfterSplash === 'function' && shouldShowEmptyHomeAfterSplash())) {
    activateHomeWallpaperPreview();
  }
  revealIdleParticles(0, reduceSplashMotion ? 520 : 920);
  document.body.classList.add('splash-revealing');
  s.classList.add('exiting');

  var content = s.querySelector('.splash-content');
  if (content) {
    content.style.transition = 'opacity 360ms cubic-bezier(.22,1,.36,1), transform 520ms cubic-bezier(.22,1,.36,1)';
    content.style.opacity = '0';
    content.style.transform = 'translateY(-10px) scale(.992)';
  }

  setTimeout(function () {
    s.classList.add('hide');
    splashAnimating = false;
    document.body.classList.remove('splash-active');
    document.body.classList.remove('splash-revealing');
    if (s && s.parentNode) s.style.display = 'none';
    finishSplashReveal(true, { reason: 'splash-dismiss' });
  }, 620);
}


function markSplashReadyToEnter() {
  var s = document.getElementById('splash');
  if (!s || s.classList.contains('hide') || s.classList.contains('exiting')) return;
  markAppPerf('splash-ready');
  splashReadyToEnter = true;
  splashTimer = null;
  s.classList.add('ready');
  s.setAttribute('role', 'button');
  s.setAttribute('tabindex', '0');
  s.setAttribute('aria-label', '点击进入 Mineradio');
}

'use strict';



function playShelfSelectTick(direction, variant) {
  var nowMs = performance.now();
  var minGap = variant === 'row' ? 36 : 42;
  if (nowMs - lastShelfSelectSfxAt < minGap) return;
  var ctx = ensureUiSfxContext();
  if (!ctx) return;
  lastShelfSelectSfxAt = nowMs;
  var dir = direction < 0 ? -1 : 1;
  var pitch = dir > 0 ? 1.035 : 0.965;
  var rowScale = variant === 'row' ? 0.74 : 1.0;
  var volumeScale = 0.38 + Math.max(0, Math.min(1, targetVolume == null ? 0.65 : targetVolume)) * 0.62;
  var t = ctx.currentTime + 0.002;
  var out = ctx.createGain();
  out.gain.setValueAtTime(0.0001, t);
  out.gain.linearRampToValueAtTime(0.058 * rowScale * volumeScale, t + 0.002);
  out.gain.exponentialRampToValueAtTime(0.0001, t + 0.082);
  out.connect(ctx.destination);

  var sampleRate = ctx.sampleRate || 44100;
  var len = Math.max(1, Math.floor(sampleRate * 0.034));
  var buf = ctx.createBuffer(1, len, sampleRate);
  var data = buf.getChannelData(0);
  for (var i = 0; i < len; i++) {
    var e = Math.pow(1 - i / len, 4.2);
    data[i] = (Math.random() * 2 - 1) * e;
  }
  var noise = ctx.createBufferSource();
  noise.buffer = buf;
  var hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.setValueAtTime(4200 * pitch, t);
  var bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(8400 * pitch, t);
  bp.Q.setValueAtTime(7.2, t);
  var ng = ctx.createGain();
  ng.gain.setValueAtTime(0.56, t);
  noise.connect(hp);
  hp.connect(bp);
  bp.connect(ng);
  ng.connect(out);
  noise.start(t);
  noise.stop(t + 0.040);

  function clickOsc(type, freq, delay, dur, gainValue, bend) {
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    var start = t + delay;
    var end = start + dur;
    osc.type = type;
    osc.frequency.setValueAtTime(freq * pitch, start);
    osc.frequency.exponentialRampToValueAtTime(freq * pitch * (bend || 0.72), end);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(gainValue, start + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(g);
    g.connect(out);
    osc.start(start);
    osc.stop(end + 0.004);
  }

  clickOsc('triangle', 720, 0.000, 0.030, 0.18, 0.70);
  clickOsc('square', 2180, 0.004, 0.022, 0.30, 0.86);
  clickOsc('triangle', 4200, 0.011, 0.018, 0.18, 0.94);
  clickOsc('square', 7100, 0.018, 0.012, 0.070, 0.98);
  setTimeout(function () {
    try { out.disconnect(); } catch (_) { }
  }, 160);
}


function clearAudioFadeTimers() {
  if (audioFadeTimer) {
    clearTimeout(audioFadeTimer);
    audioFadeTimer = null;
  }
  var pendingPause = fadeOutAndPauseAudio.pending;
  if (pendingPause) {
    fadeOutAndPauseAudio.pending = null;
    pendingPause.resolve(false);
  }
  cancelAudioElementFadeFrame();
  clearAudioAudibilityRecoveryTimers();
}

function cancelAudioElementFadeFrame() {
  if (audioElementFadeFrame) {
    cancelAnimationFrame(audioElementFadeFrame);
    audioElementFadeFrame = 0;
  }
}

function clearAudioAudibilityRecoveryTimers() {
  if (!audioAudibilityRecoveryTimers || !audioAudibilityRecoveryTimers.length) return;
  audioAudibilityRecoveryTimers.forEach(function (timer) { clearTimeout(timer); });
  audioAudibilityRecoveryTimers = [];
}

function currentAudioOutputGain() {
  if (isFinite(audioFadeEnvelope)) return clampRange(targetVolume * audioFadeEnvelope, 0, 1);
  if (audio && isFinite(audio.volume)) return clampRange(Number(audio.volume), 0, 1);
  if (gainNode && gainNode.gain && isFinite(gainNode.gain.value)) return clampRange(Number(gainNode.gain.value), 0, 1);
  return clampRange(targetVolume, 0, 1);
}

function audioSilentFloor() {
  return targetVolume > 0.001 ? AUDIO_SILENCE_GAIN : 0;
}

function normalizeAudioFadeTarget(value) {
  value = clampRange(Number(value) || 0, 0, 1);
  return value <= 0.001 ? audioSilentFloor() : value;
}

function writeAudioOutputGain(value) {
  value = normalizeAudioFadeTarget(value);
  audioFadeEnvelope = targetVolume > 0.001 ? clampRange(value / targetVolume, 0, 1) : (value > 0.001 ? 1 : 0);
  var branchValue = (gainNode && audioCtx) ? Math.sqrt(value) : value;
  if (audio) {
    audio.muted = false;
    audio.volume = branchValue;
  }
  if (gainNode && audioCtx) {
    try {
      var now = audioCtx.currentTime || 0;
      gainNode.gain.cancelScheduledValues(now);
      gainNode.gain.setValueAtTime(branchValue, now);
    } catch (e) { }
  }
}

function holdAudioOutputGain(now) {
  var current = currentAudioOutputGain();
  if (!gainNode || !audioCtx || !gainNode.gain) return current;
  var param = gainNode.gain;
  try {
    if (typeof param.cancelAndHoldAtTime === 'function') {
      param.cancelAndHoldAtTime(now);
      return currentAudioOutputGain();
    }
    param.cancelScheduledValues(now);
    param.setValueAtTime(current, now);
  } catch (e) {
    try {
      param.cancelScheduledValues(now);
      param.setValueAtTime(current, now);
    } catch (_) { }
  }
  return current;
}

function setAudioOutputGainImmediate(value) {
  value = normalizeAudioFadeTarget(value);
  clearAudioFadeTimers();
  writeAudioOutputGain(value);
}

function rampAudioOutputGain(value, durationMs) {
  value = normalizeAudioFadeTarget(value);
  durationMs = Math.max(0, Number(durationMs) || 0);
  clearAudioFadeTimers();
  var serial = audioFadeSerial;
  if (gainNode && audioCtx) holdAudioOutputGain(audioCtx.currentTime || 0);
  if (durationMs <= 0) {
    writeAudioOutputGain(value);
    return;
  }
  var from = currentAudioOutputGain();
  var started = performance.now();
  function tickAudioFade(nowMs) {
    if (serial !== audioFadeSerial) return;
    var t = durationMs ? clampRange((nowMs - started) / durationMs, 0, 1) : 1;
    var eased = 1 - Math.pow(1 - t, 3);
    writeAudioOutputGain(from + (value - from) * eased);
    if (t < 1) audioElementFadeFrame = requestAnimationFrame(tickAudioFade);
    else audioElementFadeFrame = 0;
  }
  audioElementFadeFrame = requestAnimationFrame(tickAudioFade);
}

function isBackgroundAudioFadeConstrained() {
  try {
    if (typeof isDeepBackgroundMode === 'function' && isDeepBackgroundMode()) return true;
  } catch (e) { }
  try {
    if (document && document.hidden) return true;
  } catch (e2) { }
  try {
    if (typeof desktopRuntimeState !== 'undefined' && (desktopRuntimeState.minimized || desktopRuntimeState.visible === false)) return true;
  } catch (e3) { }
  return false;
}

function ensureAudiblePlaybackGain(reason) {
  if (!audio || audio.paused || audio.ended || !audio.src) return false;
  if (targetVolume <= 0.001) return false;
  if (typeof cuefieldAutoMixExecuting !== 'undefined' && cuefieldAutoMixExecuting) return false;
  if (
    typeof albumGaplessState !== 'undefined'
    && albumGaplessState
    && albumGaplessState.preload
    && (albumGaplessState.preload.mixPending || albumGaplessState.preload.mixStarted)
  ) return false;
  if (
    typeof progressDragState !== 'undefined'
    && progressDragState
    && (progressDragState.active || progressDragState.previewHoldUntil > performance.now())
  ) return false;
  var current = currentAudioOutputGain();
  var floor = Math.max(0.004, targetVolume * 0.10);
  if (current > floor) return false;
  setAudioOutputGainImmediate(targetVolume);
  console.warn('[AudioFade] restored silent playback gain:', reason || 'playback');
  return true;
}

function scheduleAudioAudibilityRecovery(reason) {
  clearAudioAudibilityRecoveryTimers();
  if (targetVolume <= 0.001) return;
  var serial = audioFadeSerial;
  var token = trackSwitchToken;
  [520, 1400, 3200].forEach(function (delay) {
    var timer = setTimeout(function () {
      if (serial !== audioFadeSerial || token !== trackSwitchToken) return;
      ensureAudiblePlaybackGain(reason || 'track-switch');
    }, delay);
    audioAudibilityRecoveryTimers.push(timer);
  });
}

function preparePlaybackFadeIn() {
  audioFadeSerial++;
  setAudioOutputGainImmediate(0);
}

function startPlaybackFadeIn() {
  audioFadeSerial++;
  if (targetVolume <= 0.001) {
    setAudioOutputGainImmediate(0);
    return;
  }
  if (isBackgroundAudioFadeConstrained()) {
    setAudioOutputGainImmediate(targetVolume);
    return;
  }
  rampAudioOutputGain(targetVolume, AUDIO_FADE_IN_MS);
  scheduleAudioAudibilityRecovery('fade-in-watchdog');
}

function restorePlaybackGain() {
  audioFadeSerial++;
  setAudioOutputGainImmediate(targetVolume);
}

function fadeOutAndPauseAudio() {
  if (!audio || audio.paused) return Promise.resolve(false);
  var serial = ++audioFadeSerial;
  rampAudioOutputGain(0, AUDIO_FADE_OUT_MS);
  return new Promise(function (resolve) {
    var pending = { media: audio, token: trackSwitchToken, resolve: resolve };
    fadeOutAndPauseAudio.pending = pending;
    audioFadeTimer = setTimeout(function () {
      audioFadeTimer = null;
      if (fadeOutAndPauseAudio.pending === pending) fadeOutAndPauseAudio.pending = null;
      if (serial !== audioFadeSerial || pending.media !== audio || pending.token !== trackSwitchToken) {
        resolve(false);
        return;
      }
      try { pending.media.pause(); } catch (pauseErr) { console.warn('[TogglePlayPause]', pauseErr); }
      setAudioOutputGainImmediate(0);
      resolve(true);
    }, AUDIO_FADE_OUT_MS + 80);
  });
}


function applyVolumeToAudio(opts) {
  opts = opts || {};
  if (opts.restoreEnvelope && targetVolume > 0.001) audioFadeEnvelope = 1;
  writeAudioOutputGain(targetVolume * clampRange(audioFadeEnvelope, 0, 1));
}


function updateVolumeUi() {
  var slider = document.getElementById('volume-slider');
  var value = document.getElementById('volume-value');
  var icon = document.getElementById('volume-icon');
  var wrap = document.getElementById('volume-control');
  var pct = Math.round(targetVolume * 100);
  if (slider && Math.abs(parseFloat(slider.value) - targetVolume) > 0.001) slider.value = targetVolume;
  if (value) value.textContent = pct + '%';
  if (wrap) wrap.classList.toggle('muted', targetVolume <= 0.01);
  if (icon) {
    icon.innerHTML = targetVolume <= 0.01
      ? '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="17" y1="9" x2="22" y2="14"/><line x1="22" y1="9" x2="17" y2="14"/>'
      : targetVolume < 0.45
        ? '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15 10.5a2 2 0 0 1 0 3"/>'
        : '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15 9.5a4 4 0 0 1 0 5"/><path d="M18 7a7 7 0 0 1 0 10"/>';
  }
  updateAudioFadeUi();
}

function audioFadeSecondsLabel(ms) {
  ms = normalizeAudioFadeMs(ms, 0);
  return (ms / 1000).toFixed(ms % 1000 ? 2 : 1).replace(/0$/, '') + 's';
}

function updateAudioFadeUi() {
  var fadeInSlider = document.getElementById('fade-in-slider');
  var fadeOutSlider = document.getElementById('fade-out-slider');
  var fadeInValue = document.getElementById('fade-in-value');
  var fadeOutValue = document.getElementById('fade-out-value');
  var inSeconds = (AUDIO_FADE_IN_MS / 1000).toFixed(2);
  var outSeconds = (AUDIO_FADE_OUT_MS / 1000).toFixed(2);
  if (fadeInSlider && Math.abs(Number(fadeInSlider.value) - Number(inSeconds)) > 0.001) fadeInSlider.value = inSeconds;
  if (fadeOutSlider && Math.abs(Number(fadeOutSlider.value) - Number(outSeconds)) > 0.001) fadeOutSlider.value = outSeconds;
  if (fadeInValue) fadeInValue.textContent = audioFadeSecondsLabel(AUDIO_FADE_IN_MS);
  if (fadeOutValue) fadeOutValue.textContent = audioFadeSecondsLabel(AUDIO_FADE_OUT_MS);
}

function setAudioFadeSetting(kind, seconds, silent) {
  var ms = normalizeAudioFadeMs(Number(seconds) * 1000, kind === 'in' ? 460 : 420);
  if (kind === 'in') AUDIO_FADE_IN_MS = ms;
  else AUDIO_FADE_OUT_MS = ms;
  saveAudioFadePreference();
  updateAudioFadeUi();
  if (!silent) showToast((kind === 'in' ? '淡入 ' : '淡出 ') + audioFadeSecondsLabel(ms));
}


function setVolume(value, silent) {
  var next = Math.max(0, Math.min(1, Number(value) || 0));
  var previous = targetVolume;
  var shouldRestoreAudibleEnvelope = next > 0.001 && !audioFadeTimer && (previous <= 0.001 || clampRange(audioFadeEnvelope, 0, 1) <= 0.0015);
  targetVolume = next;
  if (next > 0.01) lastNonZeroVolume = next;
  try { localStorage.setItem('apex-player-volume', String(next)); } catch (e) { }
  if (shouldRestoreAudibleEnvelope) cancelAudioElementFadeFrame();
  applyVolumeToAudio({ restoreEnvelope: shouldRestoreAudibleEnvelope });
  updateVolumeUi();
  if (!silent) showToast('音量 ' + Math.round(next * 100) + '%');
}

function adjustVolumeByKeyboard(delta) {
  var step = Number(delta) || 0;
  if (!step) return;
  setVolume(clampRange(targetVolume + step, 0, 1), false);
}

function adjustVolumeByWheel(e) {
  if (!e) return;
  e.preventDefault();
  e.stopPropagation();
  var step = 0.01;
  var direction = e.deltaY < 0 ? 1 : -1;
  var wrap = document.getElementById('volume-control');
  if (wrap) {
    wrap.classList.add('open');
    if (volumeCloseTimer) clearTimeout(volumeCloseTimer);
    volumeCloseTimer = setTimeout(function () {
      volumeCloseTimer = null;
      if (wrap && !wrap.matches(':hover')) wrap.classList.remove('open');
    }, 1200);
  }
  setVolume(clampRange(targetVolume + direction * step, 0, 1), false);
}


function toggleVolumePanel(e) {
  if (e) e.stopPropagation();
  var wrap = document.getElementById('volume-control');
  if (volumeCloseTimer) { clearTimeout(volumeCloseTimer); volumeCloseTimer = null; }
  if (wrap) wrap.classList.toggle('open');
}


function releaseVolumePanelFocus(wrap) {
  wrap = wrap || document.getElementById('volume-control');
  var active = document.activeElement;
  if (!wrap || !active || !wrap.contains(active) || typeof active.blur !== 'function') return;
  try { active.blur(); } catch (e) { }
}

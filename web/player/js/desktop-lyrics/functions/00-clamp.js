'use strict';


    function clamp(value, min, max, fallback) {
      var n = Number(value);
      if (!isFinite(n)) n = fallback;
      return Math.max(min, Math.min(max, n));
    }

    function rand(seed){ return Math.abs(Math.sin(seed * 9283.173) * 43758.5453) % 1; }

    function isLocked(){ return state.clickThrough !== false; }

    function setRootVar(name, value){ document.documentElement.style.setProperty(name, value); }

    function parseCssColor(color, fallback) {
      fallback = fallback || '#ffffff';
      try {
        colorCtx.fillStyle = fallback;
        var safe = colorCtx.fillStyle;
        colorCtx.fillStyle = String(color || fallback);
        var css = colorCtx.fillStyle || safe;
        var hex = css.match(/^#([0-9a-f]{6})$/i);
        if (hex) {
          var n = parseInt(hex[1], 16);
          return { r:(n >> 16) & 255, g:(n >> 8) & 255, b:n & 255, a:1 };
        }
        var rgb = css.match(/^rgba?\(\s*([.\d]+)\s*,\s*([.\d]+)\s*,\s*([.\d]+)(?:\s*,\s*([.\d]+))?/i);
        if (rgb) return { r:Math.round(rgb[1]), g:Math.round(rgb[2]), b:Math.round(rgb[3]), a:rgb[4] == null ? 1 : clamp(rgb[4], 0, 1, 1) };
      } catch (e) {}
      return { r:255, g:255, b:255, a:1 };
    }

    function liftedLyricColor(color, fallback, minLum) {
      var c = parseCssColor(color, fallback);
      var lum = (c.r * 0.299 + c.g * 0.587 + c.b * 0.114) / 255;
      var floor = minLum == null ? .34 : minLum;
      if (lum < floor) {
        var lift = Math.round((floor - lum) * 255);
        c.r = Math.min(255, c.r + lift);
        c.g = Math.min(255, c.g + lift);
        c.b = Math.min(255, c.b + lift);
      }
      return 'rgb(' + c.r + ',' + c.g + ',' + c.b + ')';
    }

    function normalizeLyricColor(color, fallback) {
      var c = parseCssColor(color, fallback);
      return 'rgb(' + c.r + ',' + c.g + ',' + c.b + ')';
    }

    function colorWithAlpha(color, alpha) {
      var c = parseCssColor(color, '#ffffff');
      return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + clamp(alpha, 0, 1, 1) + ')';
    }

    function unpackDesktopBeatEvent(row) {
      if (typeof row === 'number') {
        return { time:row, strength:.42, confidence:.72, impact:.42, low:.62, body:.22, snap:.16, primary:true, camera:true, pulse:true, mass:.62, sharpness:.12 };
      }
      if (!Array.isArray(row)) {
        row = row || {};
        return {
          time:Number(row.time) || 0,
          strength:row.strength == null ? .42 : Number(row.strength),
          confidence:row.confidence == null ? .72 : Number(row.confidence),
          impact:row.impact == null ? (row.strength == null ? .42 : Number(row.strength)) : Number(row.impact),
          low:row.low == null ? .62 : Number(row.low),
          body:row.body == null ? .22 : Number(row.body),
          snap:row.snap == null ? .16 : Number(row.snap),
          combo:row.combo || undefined,
          primary:row.primary !== false,
          camera:row.camera !== false,
          pulse:row.pulse !== false,
          dj:!!row.dj,
          grid:!!row.grid,
          kickOnly:!!row.kickOnly,
          mass:row.mass == null ? .62 : Number(row.mass),
          sharpness:row.sharpness == null ? .12 : Number(row.sharpness),
          step:row.step || 0
        };
      }
      var flags = row[8] || 0;
      return {
        time:row[0] || 0,
        strength:row[1] == null ? .42 : row[1],
        confidence:row[2] == null ? .72 : row[2],
        impact:row[3] == null ? (row[1] || .42) : row[3],
        low:row[4] == null ? .62 : row[4],
        body:row[5] == null ? .22 : row[5],
        snap:row[6] == null ? .16 : row[6],
        combo:DESKTOP_BEAT_COMBOS[row[7] || 0] || undefined,
        primary:!!(flags & 1),
        camera:!!(flags & 2),
        pulse:!!(flags & 4),
        dj:!!(flags & 8),
        grid:!!(flags & 16),
        kickOnly:!!(flags & 32),
        mass:row[9] == null ? .62 : row[9],
        sharpness:row[10] == null ? .12 : row[10],
        step:row[11] || 0
      };
    }

    function desktopBeatEventTime(ev) {
      return ev && isFinite(ev.time) ? Number(ev.time) : 0;
    }

    function sortDesktopBeatEvents(list) {
      return (list || [])
        .map(unpackDesktopBeatEvent)
        .filter(function(ev){ return ev && isFinite(ev.time) && ev.time >= 0; })
        .sort(function(a,b){ return desktopBeatEventTime(a) - desktopBeatEventTime(b); });
    }

    function clearDesktopBeatMap(key) {
      desktopBeat.key = key || '';
      desktopBeat.map = null;
      desktopBeat.camera = [];
      desktopBeat.pulse = [];
      desktopBeat.events = [];
      desktopBeat.cameraIdx = 0;
      desktopBeat.pulseIdx = 0;
      desktopBeat.prevTime = -1;
      desktopBeat.lastTriggerAt = -10;
      desktopBeat.pulseDrive = 0;
      desktopBeat.glowDrive = 0;
      desktopBeat.bassDrive = 0;
    }

    function normalizeDesktopBeatMapPayload(packed) {
      if (!packed) return null;
      var camera = sortDesktopBeatEvents(packed.cameraBeats || packed.beats || packed.kicks || []);
      var pulse = sortDesktopBeatEvents(packed.pulseBeats || packed.kicks || []);
      return {
        cameraBeats:camera,
        pulseBeats:pulse,
        duration:Number(packed.duration) || 0,
        partialUntilSec:Number(packed.partialUntilSec) || 0,
        visualBeatCount:Number(packed.visualBeatCount) || camera.length,
        tempoSource:packed.tempoSource || 'local'
      };
    }

    function syncDesktopBeatCursor(t, preserve) {
      t = isFinite(t) ? Math.max(0, t) : 0;
      desktopBeat.cameraIdx = 0;
      desktopBeat.pulseIdx = 0;
      while (desktopBeat.cameraIdx < desktopBeat.camera.length && desktopBeatEventTime(desktopBeat.camera[desktopBeat.cameraIdx]) < t - .040) desktopBeat.cameraIdx++;
      while (desktopBeat.pulseIdx < desktopBeat.pulse.length && desktopBeatEventTime(desktopBeat.pulse[desktopBeat.pulseIdx]) < t - .026) desktopBeat.pulseIdx++;
      desktopBeat.events = [];
      desktopBeat.prevTime = t;
      desktopBeat.lastTriggerAt = t - .42;
      if (!preserve) {
        desktopBeat.pulseDrive = 0;
        desktopBeat.glowDrive = 0;
        desktopBeat.bassDrive = 0;
      }
    }

    function applyDesktopPlayback(payload) {
      if (!payload) return;
      state.playbackTime = Math.max(0, Number(payload.time) || 0);
      state.playbackDuration = Math.max(0, Number(payload.duration) || 0);
      state.playbackRate = clamp(Number(payload.rate) || 1, .25, 4, 1);
      state.playbackReceivedAt = performance.now();
    }

    function currentDesktopPlaybackTime(nowMs) {
      var t = Math.max(0, Number(state.playbackTime) || 0);
      if (state.playing) t += Math.max(0, nowMs - (state.playbackReceivedAt || nowMs)) * .001 * clamp(state.playbackRate, .25, 4, 1);
      if (state.playbackDuration > 0) t = Math.min(state.playbackDuration + .12, t);
      return t;
    }

    function applyDesktopBeatMapPayload(next) {
      next = next || {};
      var key = next.beatMapKey == null ? desktopBeat.key : String(next.beatMapKey || '');
      var hasMapPayload = Object.prototype.hasOwnProperty.call(next, 'beatMap');
      if (!hasMapPayload && key === desktopBeat.key) return;
      if (!hasMapPayload) {
        clearDesktopBeatMap(key);
        return;
      }
      var map = normalizeDesktopBeatMapPayload(next.beatMap);
      if (!map || (!map.cameraBeats.length && !map.pulseBeats.length)) {
        clearDesktopBeatMap(key);
        return;
      }
      desktopBeat.key = key;
      desktopBeat.map = map;
      desktopBeat.camera = map.cameraBeats;
      desktopBeat.pulse = map.pulseBeats.length ? map.pulseBeats : map.cameraBeats;
      syncDesktopBeatCursor(currentDesktopPlaybackTime(performance.now()), false);
    }

    function beatEaseInOut(t) {
      t = clamp(t, 0, 1, 0);
      return t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    }

    function scheduleDesktopBeatCamera(ev) {
      var time = desktopBeatEventTime(ev);
      if (!isFinite(time)) return;
      var strength = clamp(ev.strength == null ? .72 : ev.strength, 0, 1, .72);
      var confidence = clamp(ev.confidence == null ? .72 : ev.confidence, 0, 1, .72);
      var impact = clamp(ev.impact == null ? strength : ev.impact, 0, 1, strength);
      if (ev.primary === false && impact < .64) return;
      if (impact < .16 && strength < .52) return;
      if (confidence < .25 && strength < .66) return;
      var low = clamp(ev.low == null ? .62 : ev.low, 0, 1.4, .62);
      var body = clamp(ev.body == null ? .22 : ev.body, 0, 1.2, .22);
      var snap = clamp(ev.snap == null ? .16 : ev.snap, 0, 1.2, .16);
      var mass = clamp(ev.mass == null ? (low * .72 + body * .34 + strength * .18) : ev.mass, 0, 1, .62);
      var sharpness = clamp(ev.sharpness == null ? snap : ev.sharpness, 0, 1, snap);
      var combo = ev.combo || (Math.floor(time * 2.7) % 4 === 0 ? 'downbeat' : undefined);
      var minGap = ev.dj ? Math.max(.245, Math.min(.430, ev.step ? ev.step * .54 : .315)) : .385;
      if (time - desktopBeat.lastTriggerAt < minGap && strength < .88) return;
      desktopBeat.lastTriggerAt = time;
      var amp = Math.max(.08, Math.min(ev.dj ? .88 : .72, .13 + strength * .34 + confidence * .06 + mass * .15 + snap * .04));
      amp *= .72 + impact * .48;
      if (combo === 'downbeat') amp *= 1.12;
      else if (combo === 'push') amp *= .84;
      else if (combo === 'drop') amp *= .98;
      else if (combo === 'rebound') amp *= .74;
      else if (combo === 'accent') amp *= 1.14;
      var attack = Math.max(.014, Math.min(.038, .028 * (1.18 - sharpness * .55)));
      var hold = Math.max(.014, Math.min(.052, .030 * (.62 + low * .55 + body * .25)));
      var release = Math.max(.110, Math.min(.255, .185 * (.76 + mass * .56 + body * .18 - sharpness * .18)));
      if (ev.dj) {
        attack = Math.max(.010, attack * .72);
        hold = Math.max(.016, hold * .82);
        release = Math.max(.116, release * 1.04);
        amp *= 1.10;
      }
      desktopBeat.events.push({
        start:time - attack,
        hit:time,
        amp:Math.min(1, amp),
        attack:attack,
        hold:hold,
        release:release,
        low:low,
        body:body,
        snap:snap,
        mass:mass,
        combo:combo
      });
      if (desktopBeat.events.length > 10) desktopBeat.events.splice(0, desktopBeat.events.length - 10);
    }

    function triggerDesktopBeatPulse(ev) {
      var strength = clamp(ev.strength == null ? .42 : ev.strength, 0, 1, .42);
      var impact = clamp(ev.impact == null ? strength : ev.impact, 0, 1, strength);
      var low = clamp(ev.low == null ? .62 : ev.low, 0, 1.4, .62);
      var body = clamp(ev.body == null ? .22 : ev.body, 0, 1.2, .22);
      var combo = ev.combo;
      var lift = combo === 'downbeat' ? .08 : (combo === 'drop' ? .04 : 0);
      var pulse = .14 + strength * .46 + impact * .18 + body * .08 + lift;
      if (ev.dj) pulse = .12 + strength * .50 + impact * .28 + lift * .70;
      desktopBeat.pulseDrive = Math.max(desktopBeat.pulseDrive, Math.min(ev.dj ? .98 : .82, pulse));
      desktopBeat.glowDrive = Math.max(desktopBeat.glowDrive, Math.min(1.16, .18 + impact * .52 + strength * .28));
      desktopBeat.bassDrive = Math.max(desktopBeat.bassDrive, Math.min(1.08, low * (.40 + impact * .42) + body * .12));
    }

    function tickDesktopBeatMap(t, dt) {
      var hasMap = !!(desktopBeat.map && (desktopBeat.camera.length || desktopBeat.pulse.length));
      dt = clamp(dt, .001, .12, 1 / 60);
      if (!hasMap || !state.playing || state.cinema === false) {
        desktopBeat.pulseDrive *= Math.pow(.08, dt);
        desktopBeat.glowDrive *= Math.pow(.10, dt);
        desktopBeat.bassDrive *= Math.pow(.14, dt);
        desktopBeat.events = [];
        return { active:hasMap, beat:desktopBeat.pulseDrive, glow:desktopBeat.glowDrive, bass:desktopBeat.bassDrive };
      }
      if (desktopBeat.prevTime >= 0 && Math.abs(t - desktopBeat.prevTime) > .55) syncDesktopBeatCursor(t, false);
      desktopBeat.prevTime = t;
      if (desktopBeat.map.partialUntilSec && t > desktopBeat.map.partialUntilSec + desktopBeat.lookahead + .12) {
        desktopBeat.pulseDrive *= Math.pow(.10, dt);
        desktopBeat.glowDrive *= Math.pow(.12, dt);
        desktopBeat.bassDrive *= Math.pow(.16, dt);
        return { active:true, beat:desktopBeat.pulseDrive, glow:desktopBeat.glowDrive, bass:desktopBeat.bassDrive };
      }
      while (desktopBeat.cameraIdx < desktopBeat.camera.length) {
        var cam = desktopBeat.camera[desktopBeat.cameraIdx];
        if (desktopBeatEventTime(cam) > t + desktopBeat.lookahead) break;
        scheduleDesktopBeatCamera(cam);
        desktopBeat.cameraIdx++;
      }
      while (desktopBeat.pulseIdx < desktopBeat.pulse.length) {
        var pulse = desktopBeat.pulse[desktopBeat.pulseIdx];
        if (desktopBeatEventTime(pulse) > t + .018) break;
        triggerDesktopBeatPulse(pulse);
        desktopBeat.pulseIdx++;
      }
      var beat = desktopBeat.pulseDrive;
      var glow = desktopBeat.glowDrive;
      var bass = desktopBeat.bassDrive;
      var keep = [];
      for (var i = 0; i < desktopBeat.events.length; i++) {
        var ev = desktopBeat.events[i];
        var local = t - ev.start;
        var end = ev.attack + ev.hold + ev.release;
        if (local < -desktopBeat.lookahead || local > end + .060) continue;
        keep.push(ev);
        if (local < 0) continue;
        var val = 0;
        if (local < ev.attack) val = beatEaseInOut(local / ev.attack);
        else if (local < ev.attack + ev.hold) val = 1;
        else val = Math.pow(1 - clamp((local - ev.attack - ev.hold) / ev.release, 0, 1, 1), 1.72);
        beat = Math.max(beat, ev.amp * val * 1.38);
        glow = Math.max(glow, (.18 + ev.amp * .92 + ev.mass * .12) * val);
        bass = Math.max(bass, (ev.low * .62 + ev.body * .18 + ev.amp * .18) * val);
      }
      desktopBeat.events = keep;
      desktopBeat.pulseDrive *= Math.pow(.08, dt);
      desktopBeat.glowDrive *= Math.pow(.10, dt);
      desktopBeat.bassDrive *= Math.pow(.14, dt);
      return {
        active:true,
        beat:clamp(beat, 0, 1.35, 0),
        glow:clamp(glow, 0, 1.45, 0),
        bass:clamp(bass, 0, 1.2, 0)
      };
    }

    function ensureParticles(){
      var count = 220;
      while (particles.length < count) {
        var i = particles.length + 1;
        particles.push({ seed:i * 17.17, lane:rand(i), phase:rand(i * 3.1), depth:rand(i * 7.7), size:.65 + rand(i * 2.3) * 1.55 });
      }
    }

    function resize(){
      dpr = Math.min(1.5, Math.max(1, window.devicePixelRatio || 1));
      canvas.width = Math.max(1, Math.floor(innerWidth * dpr));
      canvas.height = Math.max(1, Math.floor(innerHeight * dpr));
      canvas.style.width = innerWidth + 'px';
      canvas.style.height = innerHeight + 'px';
      ctx.setTransform(dpr,0,0,dpr,0,0);
      fitLyricText(true);
    }

    function measureLineWidth(fontSize) {
      ctx.save();
      ctx.font = state.fontWeight + ' ' + fontSize + 'px ' + state.fontFamily;
      var text = line.textContent || 'Mineradio';
      var width = ctx.measureText(text).width;
      ctx.restore();
      width += Math.max(0, Array.from(text).length - 1) * fontSize * state.letterSpacing;
      return Math.max(1, width);
    }

    function lyricScrollInitialHoldMs() {
      return Math.round(clamp(state.progressSpan * 130, 140, 520, 320));
    }

    function lyricScrollEase(t) {
      t = clamp(t, 0, 1, 0);
      return t * t * t * (t * (t * 6 - 15) + 10);
    }

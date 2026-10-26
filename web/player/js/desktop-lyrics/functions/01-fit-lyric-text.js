'use strict';


    function fitLyricText(force) {
      var safeWidth = Math.max(300, innerWidth - 8);
      var edgeWidth = Math.round(clamp(safeWidth * .085, 54, 116, 92));
      var viewportWidth = Math.round(Math.max(280, Math.min(safeWidth - 12, innerWidth - Math.min(240, Math.max(88, innerWidth * .13)))));
      var clearWidth = Math.max(160, viewportWidth - edgeWidth * 2);
      var readableWidth = clearWidth;
      var maxHeight = Math.max(64, innerHeight - 188);
      var nextLayoutKey = [
        line.textContent || '',
        baseFontSize,
        state.fontFamily,
        state.fontWeight,
        state.letterSpacing,
        state.lineHeight,
        innerWidth,
        innerHeight
      ].join('|');
      if (!force && nextLayoutKey === layoutKey) return;
      layoutKey = nextLayoutKey;
      stage.style.width = safeWidth + 'px';
      stage.style.maxWidth = safeWidth + 'px';
      lyricViewport.style.width = viewportWidth + 'px';
      lyricViewport.style.maxWidth = Math.max(280, safeWidth - 12) + 'px';
      setRootVar('--lyric-edge-width', edgeWidth + 'px');
      var size = baseFontSize;
      fitScaleX = 1;
      var minSize = Math.max(24, Math.min(32, baseFontSize * .55));
      var maxScrollableWidth = readableWidth * 1.76;
      for (var i = 0; i < 24; i++) {
        var width = measureLineWidth(size);
        var height = size * state.lineHeight;
        if ((width <= maxScrollableWidth && height <= maxHeight) || size <= minSize) break;
        size = Math.max(minSize, size - Math.max(1.25, size * .062));
      }
      var measuredWidth = measureLineWidth(size);
      var maxRenderedWidth = readableWidth * 1.82;
      if (measuredWidth > maxRenderedWidth) {
        fitScaleX = clamp(maxRenderedWidth / measuredWidth, .72, 1, 1);
      }
      var scaledWidth = measuredWidth * fitScaleX;
      var travelWidth = Math.max(0, scaledWidth - clearWidth);
      var clearTailMargin = Math.max(58, Math.min(edgeWidth * 1.18, size * 1.08));
      var centeredTailLimit = scaledWidth > clearWidth * 1.28 ? Math.max(0, scaledWidth / 2 - clearWidth * .18) : 0;
      scrollState.limit = travelWidth > 0 ? Math.max(travelWidth / 2 + clearTailMargin, centeredTailLimit) : 0;
      scrollState.overflow = scrollState.limit * 2;
      scrollState.needed = travelWidth > Math.max(16, size * .18);
      var maskEdgeWidth = scrollState.needed ? Math.round(clamp(edgeWidth * .44, 26, 58, 42)) : edgeWidth;
      if (!scrollState.needed) {
        scrollState.offset = 0;
        scrollState.dir = -1;
        scrollState.holdUntil = 0;
        scrollState.lastAt = 0;
      } else {
        var limit = scrollState.limit || scrollState.overflow / 2;
        if (!isFinite(scrollState.offset) || Math.abs(scrollState.offset) > limit + 8) {
          scrollState.offset = 0;
          scrollState.dir = -1;
          scrollState.holdUntil = performance.now() + lyricScrollInitialHoldMs();
        }
      }
      renderedFontSize = Math.round(size);
      setRootVar('--lyric-size', renderedFontSize + 'px');
      setRootVar('--lyric-vertical-feather', Math.round(clamp(renderedFontSize * .92, 38, 72, 46)) + 'px');
      setRootVar('--lyric-letter-spacing', (renderedFontSize * state.letterSpacing).toFixed(2) + 'px');
      setRootVar('--lyric-fit-x', fitScaleX.toFixed(4));
      setRootVar('--lyric-mask-edge-width', maskEdgeWidth + 'px');
      setRootVar('--lyric-scroll-x', scrollState.offset.toFixed(2) + 'px');
      sendHotBounds();
    }

    function updateLyricScroll(nowMs, progress) {
      if (!scrollState.needed) {
        if (scrollState.offset !== 0) {
          scrollState.offset = 0;
          setRootVar('--lyric-scroll-x', '0px');
        }
        return;
      }
      var limit = Math.max(0, scrollState.limit || scrollState.overflow / 2);
      scrollState.lastAt = nowMs;
      if (limit > 0) {
        var p = clamp(progress == null ? state.progress : progress, 0, 1, 0);
        var rawP = currentRawProgress();
        var finalCatch = clamp((rawP - .88) / .12, 0, 1, 0);
        p = Math.max(p, rawP - .10 * finalCatch);
        var spanMs = Math.max(450, state.progressSpan * 1000);
        var startGate = clamp(lyricScrollInitialHoldMs() / spanMs, .035, .18, .08);
        var longLineBias = clamp(limit / Math.max(260, innerWidth), 0, .30, .12);
        var shortLineBias = clamp((4.8 - state.progressSpan) / 8, 0, .16, 0);
        var endGate = clamp(.84 - longLineBias * .38 - shortLineBias * .50, .62, .88, .78);
        if (endGate <= startGate + .12) endGate = startGate + .12;
        var travel = lyricScrollEase((p - startGate) / (endGate - startGate));
        var targetOffset = -limit * travel;
        if (p >= endGate) targetOffset = -limit;
        if (nowMs < scrollState.holdUntil && p < startGate) targetOffset = 0;
        scrollState.offset = Math.max(-limit, Math.min(0, Math.min(scrollState.offset, targetOffset)));
      }
      setRootVar('--lyric-scroll-x', scrollState.offset.toFixed(2) + 'px');
    }

    function replayLineAnimation() {
      line.classList.remove('in');
      void line.offsetWidth;
      line.classList.add('in');
    }

    function syncLockClasses() {
      var locked = isLocked();
      document.body.classList.toggle('locked', locked);
      document.body.classList.toggle('unlocked', !locked);
      if (lockText) lockText.textContent = locked ? '\u4e2d\u952e\u89e3\u9501' : '\u4e2d\u952e\u9501\u5b9a';
    }

    function setPointerCapture(active) {
      active = !!active;
      if (active === hoverCapture) return;
      hoverCapture = active;
      if (window.desktopOverlay && window.desktopOverlay.setLyricsPointerCapture) {
        window.desktopOverlay.setLyricsPointerCapture(active).catch(function(){});
      }
    }

    function sendHotBounds() {
      if (!window.desktopOverlay || !window.desktopOverlay.setLyricsHotBounds) return;
      var rect = lyricViewport.getBoundingClientRect();
      var padX = Math.max(26, Math.min(72, innerWidth * .038));
      var padY = Math.max(24, Math.min(56, innerHeight * .052));
      window.desktopOverlay.setLyricsHotBounds({
        left:rect.left - padX,
        top:rect.top - padY,
        right:rect.right + padX,
        bottom:rect.bottom + padY
      }).catch(function(){});
    }

    function applyCustomFontPayload(font) {
      font = font || null;
      if (!font || !font.id || !font.family || !font.dataUrl || typeof FontFace !== 'function' || !document.fonts) {
        if (!font) customFontState = { id:'', family:'' };
        return;
      }
      if (customFontState.id === font.id && customFontState.family === font.family) return;
      customFontState = { id:String(font.id), family:String(font.family) };
      try {
        var face = new FontFace(String(font.family), 'url("' + String(font.dataUrl) + '")');
        face.load().then(function(loadedFace){
          document.fonts.add(loadedFace);
          if (state && state.fontFamily && state.fontFamily.indexOf(String(font.family)) !== -1) {
            fitLyricText(true);
            drawFrame(performance.now(), true);
          }
        }).catch(function(e){
          console.warn('[DesktopLyrics] custom font load failed', e);
        });
      } catch (e) {
        console.warn('[DesktopLyrics] custom font register failed', e);
      }
    }

    function applyState(next){
      next = next || {};
      state = Object.assign({}, state, next);
      state.colors = Object.assign({}, state.colors, next.colors || {});
      applyCustomFontPayload(next.customFont);
      applyDesktopPlayback(next.playback);
      applyDesktopBeatMapPayload(next);
      var motion = Object.assign({}, next.motion || {});
      if (motion.lyricGlow != null) state.lyricGlow = !!motion.lyricGlow;
      if (motion.lyricGlowBeat != null) state.lyricGlowBeat = !!motion.lyricGlowBeat;
      if (motion.lyricGlowStrength != null) state.lyricGlowStrength = motion.lyricGlowStrength;
      if (motion.highBloom != null) state.highBloom = motion.highBloom;
      if (motion.beatGlow != null) state.beatGlow = motion.beatGlow;
      if (motion.beatPulse != null) state.beatPulse = motion.beatPulse;
      if (motion.bass != null) state.bass = motion.bass;
      var text = String(state.text || 'Mineradio').replace(/\s+/g, ' ').trim() || 'Mineradio';
      baseFontSize = Math.round(58 * clamp(state.size, .72, 1.55, 1));
      state.progress = clamp(state.progress, 0, 1, 0);
      state.progressSpan = clamp(state.progressSpan, .75, 18, 4.8);
      state.progressReceivedAt = performance.now();
      state.fontWeight = Math.round(clamp(state.fontWeight, 500, 900, 900) / 50) * 50;
      state.letterSpacing = clamp(state.letterSpacing, -.04, .18, 0);
      state.lineHeight = clamp(state.lineHeight, .86, 1.35, 1);
      state.frameRate = normalizeFrameRate(state.frameRate);
      state.lyricGlowStrength = clamp(state.lyricGlowStrength, 0, .85, .35);
      state.highBloom = clamp(state.highBloom, 0, 1.45, 0);
      state.beatGlow = clamp(state.beatGlow, 0, 1.7, 0);
      state.beatPulse = clamp(state.beatPulse, 0, 1.4, 0);
      state.bass = clamp(state.bass, 0, 1.2, 0);
      state.feather = clamp(state.feather || (next && next.feather), .030, .075, .055);
      state.displayColors = {
        primary: normalizeLyricColor(state.colors.primary || '#f6fdff', '#f6fdff'),
        secondary: normalizeLyricColor(state.colors.secondary || '#a8f6ff', '#a8f6ff'),
        highlight: normalizeLyricColor(state.colors.highlight || '#fff0b8', '#fff0b8'),
        glow: normalizeLyricColor(state.colors.glow || state.colors.secondary || '#9cffdf', '#9cffdf')
      };
      setRootVar('--lyric-primary', state.displayColors.primary);
      setRootVar('--lyric-secondary', state.displayColors.secondary);
      setRootVar('--lyric-highlight', state.displayColors.highlight);
      setRootVar('--lyric-glow', state.displayColors.glow);
      setRootVar('--lyric-shadow-soft', colorWithAlpha(state.displayColors.primary, .36));
      setRootVar('--lyric-shadow-glow', colorWithAlpha(state.displayColors.primary, .28));
      setRootVar('--lyric-shadow-hot', colorWithAlpha(state.displayColors.highlight, .28));
      setRootVar('--lyric-edge', 'rgba(4,6,12,.42)');
      setRootVar('--lyric-drop', colorWithAlpha(state.displayColors.primary, .26));
      setRootVar('--lyric-drop-paused', colorWithAlpha(state.displayColors.primary, .18));
      setRootVar('--lyric-font', state.fontFamily || 'Inter,"Noto Sans SC","PingFang SC","Microsoft YaHei",Arial,sans-serif');
      setRootVar('--lyric-weight', String(state.fontWeight));
      setRootVar('--lyric-line-height', String(state.lineHeight));
      setRootVar('--lyric-feather', (state.feather * 100).toFixed(2) + '%');
      document.body.classList.toggle('show', !!state.enabled);
      document.body.classList.toggle('paused', !state.playing);
      document.body.classList.toggle('highlight', state.highlightFollow === true);
      document.body.style.opacity = state.enabled ? String(clamp(state.opacity, .28, 1, .92)) : '0';
      syncLockClasses();
      if (!state.enabled) {
        hideInteractionHint();
        setPointerCapture(false);
      }
      if (text !== lastText) {
        lastText = text;
        progressText = text;
        displayedProgress = state.progress;
        scrollState.offset = 0;
        scrollState.dir = -1;
        scrollState.holdUntil = performance.now() + lyricScrollInitialHoldMs();
        scrollState.lastAt = 0;
        line.textContent = text;
        line.setAttribute('data-text', text);
        layoutKey = '';
        replayLineAnimation();
      }
      fitLyricText(false);
    }

    function currentDisplayProgress() {
      var target = clamp(state.progress, 0, 1, 0);
      if (state.playing && state.progressSpan > 0) {
        target += Math.max(0, performance.now() - (state.progressReceivedAt || performance.now())) / (state.progressSpan * 1000);
      }
      target = clamp(target, 0, 1, target);
      if (progressText !== lastText) {
        progressText = lastText;
        displayedProgress = target;
      }
      var delta = target - displayedProgress;
      if (delta < -0.018 && target > 0.035 && displayedProgress < 0.985) {
        displayedProgress = clamp(displayedProgress + Math.max(delta * .018, -0.0028), 0, 1, displayedProgress);
        return displayedProgress;
      }
      var ease = delta >= 0 ? Math.min(.30, .074 + Math.abs(delta) * .50) : Math.min(.030, .008 + Math.abs(delta) * .045);
      displayedProgress = clamp(displayedProgress + delta * ease, 0, 1, displayedProgress);
      return displayedProgress;
    }

    function currentRawProgress() {
      var target = clamp(state.progress, 0, 1, 0);
      if (state.playing && state.progressSpan > 0) {
        target += Math.max(0, performance.now() - (state.progressReceivedAt || performance.now())) / (state.progressSpan * 1000);
      }
      return clamp(target, 0, 1, target);
    }

    function drawCanvasText(text, x, y, fontSize, spacing, stroke) {
      var chars = Array.from(text || '');
      if (!spacing || chars.length < 2) {
        if (stroke) ctx.strokeText(text, x, y);
        else ctx.fillText(text, x, y);
        return;
      }
      var width = 0;
      for (var i = 0; i < chars.length; i++) {
        width += ctx.measureText(chars[i]).width;
        if (i < chars.length - 1) width += spacing;
      }
      var cursor = x - width / 2;
      ctx.textAlign = 'left';
      for (var c = 0; c < chars.length; c++) {
        if (stroke) ctx.strokeText(chars[c], cursor, y);
        else ctx.fillText(chars[c], cursor, y);
        cursor += ctx.measureText(chars[c]).width + (c < chars.length - 1 ? spacing : 0);
      }
      ctx.textAlign = 'center';
    }

    function updateMotion(now, offline) {
      var glowStrength = state.lyricGlow ? state.lyricGlowStrength : 0;
      var glowDrive = Math.min(1.7, Math.max(0, glowStrength / .50));
      var cinemaBinding = state.cinema !== false;
      var beatSource = cinemaBinding && state.lyricGlowBeat ? Math.max(state.beatGlow, state.beatPulse * .86) : 0;
      var offlineActive = !!(offline && offline.active);
      var offlineBeat = offline && cinemaBinding ? clamp(offline.beat, 0, 1.35, 0) : 0;
      var offlineGlow = offline && cinemaBinding ? clamp(offline.glow, 0, 1.45, 0) : 0;
      var offlineBass = offline && cinemaBinding ? clamp(offline.bass, 0, 1.2, 0) : 0;
      var cameraBeat = Math.max(beatSource, offlineBeat);
      var localBeat = state.playing && cinemaBinding ? Math.pow(Math.max(0, Math.sin(now * 2.35)), 8) * (offlineActive ? .10 : .44) : 0;
      var bassDrive = Math.max(state.bass, offlineBass);
      var fallbackSolar = glowStrength > 0 ? (0.18 + (.5 + .5 * Math.sin(now * 1.05)) * .16 + Math.max(bassDrive * .32, cameraBeat * .12) + cameraBeat * 1.18 + offlineGlow * .22) * glowDrive : 0;
      var solarTarget = glowStrength > 0 ? Math.min(1.45, Math.max(state.highBloom, offlineGlow, fallbackSolar * .56 + localBeat * .18)) : localBeat * .12;
      var beatTarget = cinemaBinding ? Math.min(1.35, Math.max(state.lyricGlowBeat ? cameraBeat : offlineBeat * .72, localBeat)) : 0;
      live.solar += (solarTarget - live.solar) * (solarTarget > live.solar ? .36 : .10);
      live.beat += (beatTarget - live.beat) * (beatTarget > live.beat ? .62 : .18);
      live.bass += (bassDrive - live.bass) * .22;
      return { glowStrength:glowStrength, glowDrive:glowDrive };
    }

    function applyStageMotion(now) {
      var cinemaBinding = state.cinema !== false;
      var motionBeat = cinemaBinding ? live.beat : 0;
      var motionSolar = cinemaBinding ? live.solar : 0;
      var motionBass = cinemaBinding ? live.bass : 0;
      var targetLift = cinemaBinding ? Math.min(22, motionBeat * 18 + motionSolar * 5.2 + motionBass * 4.4) : 0;
      live.lift += (targetLift - live.lift) * (targetLift > live.lift ? .46 : .16);
      var floatY = Math.sin(now * 1.08) * -9.8 + Math.sin(now * 2.10 + .7) * 3.1;
      var floatX = Math.sin(now * .70 + .4) * 6.2 + Math.sin(now * 1.18 + 1.1) * 2.6;
      var bobY = floatY - live.lift;
      var bobX = floatX + Math.sin(now * 1.55) * motionBeat * 3.4;
      var rotX = Math.sin(now * .86 + .2) * 3.25 - motionBeat * .92;
      var rotY = Math.sin(now * .74 + 1.3) * -2.75 + motionBeat * .34;
      var scale = 1 + motionBeat * .115 + motionSolar * .034 + motionBass * .026;
      live.scale += (scale - live.scale) * (scale > live.scale ? .46 : .16);
      stage.style.transform = 'translate3d(' + bobX.toFixed(2) + 'px,' + bobY.toFixed(2) + 'px,0) rotateX(' + rotX.toFixed(3) + 'deg) rotateY(' + rotY.toFixed(3) + 'deg) scale(' + live.scale.toFixed(4) + ')';
      stage.style.filter = 'brightness(' + (1.04 + motionBeat * .12 + motionSolar * .05).toFixed(3) + ') saturate(' + (1.08 + motionBeat * .10).toFixed(3) + ')';
      setRootVar('--lyric-css-beat-glow', (state.lyricGlow ? clamp(motionBeat * 8 + motionSolar * 3, 0, 12, 0) : 0).toFixed(2) + 'px');
    }

    function drawAura(rect, motion) {
      if (!state.lyricGlow || motion.glowStrength <= 0) return;
      var cx = rect.left + rect.width / 2;
      var cy = rect.top + rect.height * .52;
      var rx = Math.max(rect.width * .58, innerWidth * .16, 260) * (1 + live.solar * .10 + live.beat * .08);
      var ry = Math.max(rect.height * 1.02, 66) * (1 + live.solar * .10 + live.beat * .08);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp(state.opacity, .28, 1, .92);
      ctx.translate(cx, cy);
      ctx.scale(rx, ry);
      var g = ctx.createRadialGradient(0,0,0,0,0,1);
      g.addColorStop(0.00, colorWithAlpha(state.displayColors.highlight, .24));
      g.addColorStop(0.28, colorWithAlpha(state.displayColors.glow, .15));
      g.addColorStop(0.64, colorWithAlpha(state.displayColors.secondary, .040));
      g.addColorStop(0.90, colorWithAlpha(state.displayColors.glow, .006));
      g.addColorStop(1.00, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0,0,1,0,Math.PI*2);
      ctx.fill();
      ctx.restore();
    }

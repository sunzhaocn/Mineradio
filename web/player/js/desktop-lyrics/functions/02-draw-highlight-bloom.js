'use strict';


    function drawHighlightBloom(rect, progress) {
      if (!state.lyricGlow || state.highlightFollow !== true) return;
      var p = clamp(progress, 0, 1, 0);
      var x = rect.left + rect.width * p;
      var y = rect.top + rect.height * .50 - live.lift * .10;
      var rx = Math.max(42, Math.min(150, renderedFontSize * (1.05 + live.beat * .32)));
      var ry = Math.max(24, Math.min(82, renderedFontSize * (.42 + live.beat * .18)));
      var alpha = clamp(.18 + live.solar * .12 + live.beat * .18, .12, .48) * clamp(state.opacity, .28, 1, .92);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = alpha;
      ctx.translate(x, y);
      ctx.scale(rx, ry);
      var g = ctx.createRadialGradient(0,0,0,0,0,1);
      g.addColorStop(0, colorWithAlpha(state.displayColors.highlight, .88));
      g.addColorStop(.36, colorWithAlpha(state.displayColors.glow, .34));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0,0,1,0,Math.PI*2);
      ctx.fill();
      ctx.restore();
    }

    function drawGlowText(rect, motion) {
      if (!state.lyricGlow || motion.glowStrength <= 0) return;
      var target = Math.min(1.08, (0.09 + live.solar * .38 + live.beat * .22) * Math.min(3, motion.glowDrive));
      live.glow += (target - live.glow) * (target > live.glow ? .11 : .06);
      if (live.glow <= .004) return;
      var text = line.textContent || 'Mineradio';
      var cx = rect.left + rect.width / 2;
      var cy = rect.top + rect.height / 2;
      var spacing = renderedFontSize * state.letterSpacing;
      var hotMix = Math.max(0, Math.min(1, live.solar * 1.05 + live.beat * .18));
      var color = hotMix > .42 ? state.displayColors.highlight : state.displayColors.glow;
      var layers = [
        { blur:10, alpha:.54, stroke:Math.max(9, renderedFontSize * .09) },
        { blur:24, alpha:.38, stroke:Math.max(15, renderedFontSize * .15) },
        { blur:48, alpha:.20, stroke:Math.max(22, renderedFontSize * .22) },
        { blur:78, alpha:.09, stroke:Math.max(30, renderedFontSize * .30) }
      ];
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = state.fontWeight + ' ' + renderedFontSize + 'px ' + state.fontFamily;
      ctx.translate(cx, cy);
      ctx.scale(fitScaleX * live.scale, live.scale);
      for (var i = 0; i < layers.length; i++) {
        ctx.save();
        ctx.filter = 'blur(' + layers[i].blur + 'px)';
        ctx.globalAlpha = live.glow * layers[i].alpha * clamp(state.opacity, .28, 1, .92);
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        ctx.lineWidth = layers[i].stroke;
        ctx.lineJoin = 'round';
        drawCanvasText(text, 0, 0, renderedFontSize, spacing, true);
        drawCanvasText(text, 0, 0, renderedFontSize, spacing, false);
        ctx.restore();
      }
      ctx.restore();
    }

    function drawParticles(rect, motion, now) {
      var target = state.lyricGlow && state.lyricGlowParticles ? Math.min(.50, (.12 + live.solar * .18 + live.beat * .16) * Math.min(1.7, motion.glowDrive)) : 0;
      live.spark += (target - live.spark) * (target > live.spark ? .14 : .08);
      if (live.spark <= .006) return;
      ensureParticles();
      var width = Math.max(300, Math.min(innerWidth - 48, rect.width * 1.16 + 140));
      var height = Math.max(74, rect.height * 1.34);
      var cx = rect.left + rect.width / 2;
      var cy = rect.top + rect.height / 2 + Math.sin(now * .55) * 3.5;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (var i=0;i<particles.length;i++) {
        var p = particles[i];
        var lane = Math.floor(p.lane * 5);
        var local = (p.lane * 5) % 1;
        var speed = .018 + rand(p.seed) * .030 + lane * .002;
        var flow = (p.phase + now * speed) % 1;
        var edge = Math.sin(Math.PI * flow);
        var x = cx + (flow - .5) * width * (1.02 + rand(p.seed * 4.1) * .18);
        var curve = Math.sin(flow * Math.PI * 2 * (.9 + rand(p.seed * 1.3) * .5) + p.seed + now * .32);
        var y = cy + (lane - 2) * height * .13 + curve * height * (.16 + rand(p.seed * 2.2) * .18) + (local - .5) * height * .13 + Math.sin(now * (.42 + rand(p.seed) * .32) + p.seed) * (4 + live.beat * 6);
        var tw = Math.pow(.5 + .5 * Math.sin(now * (.7 + rand(p.seed) * .4) + p.seed), 4);
        var r = Math.max(.7, p.size * (.75 + edge * 1.45 + tw * .85 + live.beat * .55));
        var grad = ctx.createRadialGradient(x,y,0,x,y,r*4.5);
        grad.addColorStop(0, colorWithAlpha(state.displayColors.highlight, .96));
        grad.addColorStop(.34, colorWithAlpha(state.displayColors.glow, .68));
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = live.spark * (0.16 + edge * .44 + tw * .24) * clamp(state.opacity, .28, 1, .92);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x,y,r*4.5,0,Math.PI*2);
        ctx.fill();
      }
      ctx.restore();
    }

    function draw(nowMs){
      if (state.enabled) {
        var interval = frameIntervalMs();
        if (interval > 0 && lastDrawAt && nowMs - lastDrawAt < Math.max(4, interval - 1.25)) {
          scheduleNextDraw();
          return;
        }
      }
      var dt = lastDrawAt ? Math.min(.12, Math.max(.001, (nowMs - lastDrawAt) / 1000)) : 1 / 60;
      lastDrawAt = nowMs;
      var now = nowMs * .001;
      if (state.enabled) {
        var progress = currentDisplayProgress();
        setRootVar('--lyric-progress', (progress * 100).toFixed(2) + '%');
        var offlineMotion = tickDesktopBeatMap(currentDesktopPlaybackTime(nowMs), dt);
        var motion = updateMotion(now, offlineMotion);
        applyStageMotion(now);
        updateLyricScroll(nowMs, progress);
      }
      scheduleNextDraw();
    }

    function scheduleNextDraw() {
      if (!state.enabled) {
        setTimeout(function(){ requestAnimationFrame(draw); }, 250);
        return;
      }
      requestAnimationFrame(draw);
    }

    function normalizeFrameRate(value) {
      var n = Number(value);
      if (!isFinite(n) || n <= 0) return 0;
      if (n <= 26) return 24;
      if (n <= 45) return 30;
      if (n <= 90) return 60;
      return 120;
    }

    function frameIntervalMs() {
      var fps = normalizeFrameRate(state.frameRate);
      return fps > 0 ? 1000 / fps : 0;
    }

    function pointInRect(evt, rect, padX, padY) {
      return evt.clientX >= rect.left - padX && evt.clientX <= rect.right + padX && evt.clientY >= rect.top - padY && evt.clientY <= rect.bottom + padY;
    }

    function pointInStage(evt) {
      if (!state.enabled || !evt) return false;
      if (dragging) return true;
      if (!isLocked()) {
        var stageRect = stage.getBoundingClientRect();
        return pointInRect(evt, stageRect, 0, 0);
      }
      var padX = Math.max(24, Math.min(68, innerWidth * .034));
      var padY = Math.max(22, Math.min(46, innerHeight * .045));
      var lyricRect = lyricViewport.getBoundingClientRect();
      if (pointInRect(evt, lyricRect, padX, padY)) return true;
      var hintRect = lockHint.getBoundingClientRect();
      return pointInRect(evt, hintRect, 10, 10);
    }

    function setHintVisible(visible) {
      hintVisible = !!visible;
      stage.classList.toggle('hint-visible', hintVisible);
      setPointerCapture(!isLocked() && (hintVisible || dragging) && hoverInside);
    }

    function hideInteractionHint() {
      hoverInside = false;
      lastPointerEvent = null;
      if (hintTimer) {
        clearTimeout(hintTimer);
        hintTimer = 0;
      }
      setHintVisible(false);
      stage.classList.remove('hover');
    }

    function scheduleInteractionHint() {
      if (hintVisible || hintTimer) return;
      hintTimer = setTimeout(function(){
        hintTimer = 0;
        if (!hoverInside || !lastPointerEvent || !pointInStage(lastPointerEvent)) return;
        setHintVisible(true);
      }, 1500);
    }

    function updateHover(evt) {
      var inside = !!state.enabled && pointInStage(evt);
      hoverInside = inside;
      lastPointerEvent = evt || lastPointerEvent;
      stage.classList.toggle('hover', inside || dragging);
      if (isLocked()) {
        if (inside || dragging) {
          scheduleInteractionHint();
        } else {
          hideInteractionHint();
        }
        setPointerCapture(false);
        return inside;
      }
      if (inside || dragging) {
        scheduleInteractionHint();
      } else {
        hideInteractionHint();
      }
      setPointerCapture(inside || dragging);
      return inside;
    }

    function setLocked(locked) {
      state.clickThrough = !!locked;
      syncLockClasses();
      if (window.desktopOverlay && window.desktopOverlay.setLyricsLockState) {
        window.desktopOverlay.setLyricsLockState(!!locked).catch(function(){});
      }
    }

    function moveDrag(evt) {
      if (dragging && !isLocked() && window.desktopOverlay && window.desktopOverlay.moveLyricsBy) {
        var dx = evt.screenX - dragLast.x;
        var dy = evt.screenY - dragLast.y;
        dragLast.x = evt.screenX;
        dragLast.y = evt.screenY;
        if (dx || dy) window.desktopOverlay.moveLyricsBy(dx, dy).catch(function(){});
      }
    }

    function endDrag(evt) {
      if (!dragging) return;
      if (evt && dragPointerId != null && evt.pointerId != null && evt.pointerId !== dragPointerId) return;
      try {
        if (dragPointerId != null && stage.releasePointerCapture && stage.hasPointerCapture && stage.hasPointerCapture(dragPointerId)) {
          stage.releasePointerCapture(dragPointerId);
        }
      } catch (e) {}
      dragging = false;
      dragPointerId = null;
      setPointerCapture(false);
    }

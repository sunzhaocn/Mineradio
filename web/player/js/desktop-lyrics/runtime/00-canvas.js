'use strict';


    var canvas = document.getElementById('fx');

    var ctx = canvas.getContext('2d');

    var stage = document.getElementById('stage');

    var lyricViewport = document.getElementById('lyricViewport');

    var line = document.getElementById('line');

    var lockHint = document.getElementById('lockHint');

    var lockText = document.getElementById('lockText');

    var closeLyricsBtn = document.getElementById('closeLyricsBtn');

    var dpr = 1;

    var lastText = '';

    var progressText = '';

    var displayedProgress = 0;

    var baseFontSize = 58;

    var renderedFontSize = 58;

    var fitScaleX = 1;

    var hoverCapture = false;

    var dragging = false;

    var dragPointerId = null;

    var dragLast = { x:0, y:0 };

    var lastDrawAt = 0;

    var layoutKey = '';

    var hoverInside = false;

    var hintVisible = false;

    var hintTimer = 0;

    var lastPointerEvent = null;

    var scrollState = { needed:false, overflow:0, limit:0, offset:0, dir:-1, holdUntil:0, lastAt:0 };

    var particles = [];

    var live = { solar:0, beat:0, bass:0, scale:1, glow:0, spark:0, lift:0 };

    var state = {
      enabled:false,text:'Mineradio',progress:0,progressSpan:4.8,progressReceivedAt:0,playing:false,
      playbackTime:0,playbackDuration:0,playbackRate:1,playbackReceivedAt:0,beatMapKey:'',
      size:1,opacity:.92,clickThrough:true,lyricGlowParticles:false,cinema:true,highlightFollow:false,frameRate:60,
      lyricGlow:true,lyricGlowBeat:true,lyricGlowStrength:.35,highBloom:0,beatGlow:0,beatPulse:0,bass:0,feather:.055,
      fontFamily:'Inter,"Noto Sans SC","PingFang SC","Microsoft YaHei",Arial,sans-serif',
      customFont:null,
      fontWeight:900,letterSpacing:0,lineHeight:1,lyricScale:1,
      colors:{primary:'#f6fdff',secondary:'#a8f6ff',highlight:'#fff0b8',glow:'#9cffdf'},
      displayColors:{primary:'#f6fdff',secondary:'#a8f6ff',highlight:'#fff0b8',glow:'#9cffdf'}
    };

    var desktopBeat = {
      key:'',
      map:null,
      camera:[],
      pulse:[],
      events:[],
      cameraIdx:0,
      pulseIdx:0,
      prevTime:-1,
      lastTriggerAt:-10,
      pulseDrive:0,
      glowDrive:0,
      bassDrive:0,
      lookahead:.075
    };

    var DESKTOP_BEAT_COMBOS = ['', 'downbeat', 'push', 'drop', 'rebound', 'accent'];

    var colorCtx = document.createElement('canvas').getContext('2d');

    var customFontState = { id:'', family:'' };

    window.addEventListener('pointermove', function(evt){
      if (dragging && evt.buttons != null && (evt.buttons & 1) === 0) {
        endDrag(evt);
        updateHover(evt);
        return;
      }
      updateHover(evt);
      moveDrag(evt);
    });

    window.addEventListener('mousemove', function(evt){
      if (!dragging) updateHover(evt);
    });

    window.addEventListener('pointerleave', function(){
      if (dragging) {
        setPointerCapture(true);
        return;
      }
      hideInteractionHint();
    });

    window.addEventListener('mouseleave', function(){
      if (!dragging) hideInteractionHint();
    });

    window.addEventListener('pointerdown', function(evt){
      if (!pointInStage(evt)) return;
      if (closeLyricsBtn && closeLyricsBtn.contains(evt.target)) return;
      if (evt.button === 1) {
        evt.preventDefault();
        hideInteractionHint();
        return;
      }
      if (isLocked()) {
        hideInteractionHint();
        setPointerCapture(false);
        return;
      }
      if (evt.button === 0 && !isLocked()) {
        dragging = true;
        dragPointerId = evt.pointerId;
        dragLast.x = evt.screenX;
        dragLast.y = evt.screenY;
        setPointerCapture(true);
        try {
          if (stage.setPointerCapture) stage.setPointerCapture(evt.pointerId);
        } catch (e) {}
        evt.preventDefault();
      }
    });

    window.addEventListener('pointerup', endDrag);

    window.addEventListener('pointercancel', endDrag);

    window.addEventListener('blur', function(){
      endDrag({ pointerId:dragPointerId });
      hideInteractionHint();
    });

    stage.addEventListener('lostpointercapture', endDrag);

    window.addEventListener('auxclick', function(evt){
      if (evt.button === 1 && pointInStage(evt)) evt.preventDefault();
    });

    if (closeLyricsBtn) {
      closeLyricsBtn.addEventListener('click', function(evt){
        evt.preventDefault();
        evt.stopPropagation();
        state.enabled = false;
        document.body.classList.remove('show');
        setPointerCapture(false);
        if (window.desktopOverlay && window.desktopOverlay.closeLyrics) {
          window.desktopOverlay.closeLyrics().catch(function(){});
        }
      });
    }

    window.__mineradioDesktopLyricsApplyState = applyState;

    window.addEventListener('message', function(event){
      var data = event && event.data;
      if (!data || data.type !== 'mineradio-desktop-lyrics-state') return;
      applyState(data.payload || {});
    });

    window.addEventListener('resize', resize);

    resize();

    (function applyQueryState(){
      try {
        var raw = new URLSearchParams(window.location.search).get('state');
        if (raw) applyState(JSON.parse(raw));
      } catch (e) {}
    })();

    if (window.desktopOverlay && window.desktopOverlay.onLyricsState) {
      window.desktopOverlay.onLyricsState(applyState);
    }

    requestAnimationFrame(draw);

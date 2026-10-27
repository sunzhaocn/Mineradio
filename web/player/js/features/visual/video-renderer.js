'use strict';

(function () {
  if (!window.mineradioVideoRender) return;
  Object.defineProperty(document, 'hidden', {configurable:true, get:function () { return false; }});
  Object.defineProperty(document, 'visibilityState', {configurable:true, get:function () { return 'visible'; }});
  document.hasFocus = function () { return true; };
  var pause = function (milliseconds) { return new Promise(function (resolve) { setTimeout(resolve, milliseconds); }); };
  window.addEventListener('mineradio:ready', function () {
    prepare().catch(function (error) { window.MINERADIO_VIDEO_ERROR = error.message || '预设初始化失败'; });
  }, {once:true});
  async function prepare() {
    var config = await mineradioVideoRender.getConfig();
    if (!config || !config.preset) throw new Error('导出配置丢失');
    config.preset.resources = config.preset.resources || {};
    window.mineradioMediaCache = null;
    var data = mineradioTrackExports.normalize(config.preset), preset = data.snapshot.preset;
    var style = document.createElement('style');
    style.textContent = `
      #desktop-titlebar,#web-mobile-header,#web-mobile-nav,#top-right,#bottom-bar,#bottom-handle,#thumb-wrap,
      #hint,#fx-panel,#fx-fab,#fx-fab-hide-btn,#search-area,#empty-home,#playlist-panel,#splash,.modal-mask,
      #web-library-mask,#loading-overlay,#toast,#trial-banner,#ai-depth-chip,#beat-chip,#cuefield-automix-btn,
      #sonic-audio-monitor,#slideshow-settings,#mv-cache-status,#mv-resume-btn,#slideshow-layer,
      #wallpaper-engine-glass-sampler,#idle-guide-canvas,#login-guide-canvas{display:none!important}
      html,body,#desktop-window-shell{margin:0!important;width:100%!important;height:100%!important;overflow:hidden!important}
      body{padding:0!important}#desktop-window-shell{position:fixed!important;inset:0!important}
      #canvas-container{visibility:visible!important;display:block!important;inset:0!important}
      #mineradio-export-media{position:fixed;inset:0;width:100%;height:100%;object-fit:contain;background:#000;z-index:20}
      .mineradio-export-slide{position:fixed;inset:0;width:100%;height:100%;object-fit:contain;background:#000;z-index:20}
    `;
    document.head.append(style);
    var clock = {time:0, duration:config.duration, drawing:false};
    var song = {id:'video-export', name:config.song.name, artist:config.song.artist,
      source:'local',provider:'local',localFileId:'video-export',localUrl:'',cover:config.coverUrl};
    playQueue = [song]; currentIdx = 0; currentLocalSong = song; trackSwitchToken++;
    if (!audio) audio = new Audio();
    audio.pause();
    Object.defineProperties(audio, {
      currentTime:{configurable:true,get:function () { return clock.time; },set:function () {}},
      duration:{configurable:true,get:function () { return clock.duration; }},
      paused:{configurable:true,get:function () { return false; }},
      ended:{configurable:true,get:function () { return false; }},
      readyState:{configurable:true,get:function () { return 4; }}
    });
    audio.play = function () { return Promise.resolve(); }; audio.pause = function () {};
    playing = true;
    homeForcedOpen = false; homeSuppressed = true;
    document.body.classList.remove('empty-home-active','splash-active','splash-revealing','song-mv-active');
    document.documentElement.classList.remove('simple-mode-preload');
    var spectrum = new MineradioExportSpectrum(2048, 48000);
    frequencyData = new Uint8Array(1024); timeDomainData = new Uint8Array(2048);
    analyser = {fftSize:2048,frequencyBinCount:1024,
      getByteFrequencyData:function (target) { target.set(spectrum.frequency.subarray(0,target.length)); },
      getByteTimeDomainData:function (target) { target.set(spectrum.time.subarray(0,target.length)); }};
    audioCtx = {state:'running',sampleRate:48000,get currentTime() { return clock.time; }};
    if (preset === 13) data.snapshot.preset = Math.max(0,Math.min(12,Number(config.preset.resources.mvFallback)||0));
    if (preset === 14) data.snapshot.preset = 3;
    await mineradioTrackExports.apply(Object.assign({},config.preset,{snapshot:data.snapshot,
      resources:{background:config.preset.resources.background,font:config.preset.resources.font}}));
    if (config.coverUrl) {
      loadCoverFromUrl(config.coverUrl, {trackSwitch:true});
      var deadline = performance.now() + 15000;
      while (uniforms.uHasCover.value < .5 && performance.now() < deadline) await pause(50);
      if (uniforms.uHasCover.value < .5) throw new Error('封面图像无法加载，已停止导出');
    }
    if (config.lyric) applyFetchedLyricResponse(song,trackSwitchToken,{lyric:config.lyric},{persist:false});
    var movie;
    if (preset === 13 && config.videoUrl) {
      movie = document.createElement('video'); movie.id = 'mineradio-export-media'; movie.muted = true;
      movie.preload = 'auto'; movie.playsInline = true;
      await new Promise(function (resolve,reject) {
        var timer = setTimeout(function () { reject(new Error('MV 素材加载超时')); },30000);
        movie.onloadeddata = function () { clearTimeout(timer); resolve(); };
        movie.onerror = function () { clearTimeout(timer); reject(new Error('MV 素材无法解码')); };
        movie.src = config.videoUrl; document.body.append(movie);
      });
    }
    var slides = [], lastSlide = -1;
    if (preset === 14) {
      if (!data.slides.length) throw new Error('幻灯片预设缺少图片');
      for (var i=0;i<2;i++) { var image=document.createElement('img'); image.className='mineradio-export-slide';document.body.append(image);slides.push(image); }
    }
    await pause(1600);
    firstPlayDone = true;
    uniforms.uAlpha.value = 1;
    var backgroundVideos = Array.from(document.querySelectorAll('#custom-bg video'));
    backgroundVideos.forEach(function (video) { video.pause(); video.muted=true; });
    if (typeof updateEmptyHomeVisibility === 'function') updateEmptyHomeVisibility();
    document.body.classList.remove('empty-home-active');
    var realNow = performance.now.bind(performance), start = realNow();
    clock.now = start;
    Object.defineProperty(performance,'now',{configurable:true,value:function () { return clock.now; }});
    var epoch = Date.now(); Date.now = function () { return epoch + clock.time * 1000; };
    window.mineradioExportClock = clock;
    var gsapBase = window.gsap ? gsap.globalTimeline.time() : 0;
    if (window.gsap) gsap.ticker.sleep();
    window.mineradioRenderVideoFrame = async function (time, encoded) {
      var raw = atob(encoded), bytes = new Uint8Array(raw.length);
      for(var b=0;b<raw.length;b++)bytes[b]=raw.charCodeAt(b);
      spectrum.update(new Float32Array(bytes.buffer));
      clock.time = time; clock.now = start + time * 1000; clock.drawing = true;
      prevTime = clock.now - 1000/config.fps;
      if (window.gsap) gsap.updateRoot(gsapBase + time);
      try { animate(); renderer.getContext().finish(); }
      finally { clock.drawing=false; if(window.gsap)gsap.ticker.sleep(); }
      for (var backgroundVideo of backgroundVideos) {
        if (!Number.isFinite(backgroundVideo.duration) || backgroundVideo.duration <= 0) continue;
        var targetTime = Math.min(backgroundVideo.duration-.002,time%backgroundVideo.duration);
        if (Math.abs(backgroundVideo.currentTime-targetTime)>.0001) await new Promise(function(resolve,reject){
          var timer=setTimeout(function(){reject(new Error('背景视频帧解码超时'));},15000);
          backgroundVideo.addEventListener('seeked',function done(){clearTimeout(timer);backgroundVideo.removeEventListener('seeked',done);resolve();},{once:true});
          backgroundVideo.currentTime=targetTime;
        });
      }
      if (movie) {
        var end = movie.duration;
        var loop = config.preset.resources.mvEndMode === 'loop';
        movie.hidden = !loop && time >= end;
        if (!movie.hidden) {
          var position = Math.min(Math.max(0,end-.002), loop ? time%end : time);
          if (Math.abs(movie.currentTime-position)>.0001 || movie.readyState<2) await new Promise(function(resolve,reject) {
            var timer=setTimeout(function(){reject(new Error('MV 帧解码超时'));},15000);
            movie.addEventListener('seeked',function done(){clearTimeout(timer);movie.removeEventListener('seeked',done);resolve();},{once:true});
            movie.currentTime=position;
          });
        }
      }
      if (slides.length) {
        var seconds=data.slideSeconds,index=Math.floor(time/seconds)%data.slides.length;
        if(index!==lastSlide) {
          var prior=(index+data.slides.length-1)%data.slides.length;
          slides[0].src=config.preset.resources.slides[prior].data;slides[1].src=config.preset.resources.slides[index].data;
          await Promise.all(slides.map(function(image){return image.decode();}));lastSlide=index;
        }
        slides[1].style.opacity=String(time<seconds?1:Math.min(1,(time%seconds)/.45));
      }
      return {time:time,preset:fx.preset,renderCalls:renderer.info.render.calls};
    };
    window.MINERADIO_VIDEO_READY = true;
  }
})();

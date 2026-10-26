'use strict';
(function () {
  if (!window.MineradioAndroid) return;
  window.__mineradioAndroid = true;
  var blobs = new Map();
  var createBlobUrl = URL.createObjectURL.bind(URL), revokeBlobUrl = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = function (blob) { var url=createBlobUrl(blob);blobs.set(url,blob);return url; };
  URL.revokeObjectURL = function (url) { blobs.delete(url);return revokeBlobUrl(url); };
  window.mineradioAndroidSaveBlob = async function (url,name) {
    var blob=blobs.get(url);if(!blob)return false;
    var token=MineradioAndroid.beginSave(name||blob.name||'Mineradio-export',blob.type||'application/octet-stream');
    if(!token)return false;
    try {
      for(var offset=0;offset<blob.size;offset+=49152){
        var bytes=new Uint8Array(await blob.slice(offset,offset+49152).arrayBuffer());
        var text='';for(var i=0;i<bytes.length;i++)text+=String.fromCharCode(bytes[i]);
        if(!MineradioAndroid.appendSave(token,btoa(text)))throw new Error('export failed');
      }
      MineradioAndroid.finishSave(token);return true;
    }catch(error){MineradioAndroid.cancelSave(token);if(typeof showToast==='function')showToast('文件保存失败，请重试');return false;}
  };
  var anchorClick=HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click=function(){if(this.download&&blobs.has(this.href)){mineradioAndroidSaveBlob(this.href,this.download);return;}return anchorClick.call(this);};
  var foreground = MineradioAndroid.isForeground();
  window.mineradioAndroidForeground = foreground;
  var hiddenGetter = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
  try {
    Object.defineProperty(document, 'hidden', { configurable:true, get:function () { return !foreground || !!(hiddenGetter && hiddenGetter.get.call(document)); } });
    Object.defineProperty(document, 'visibilityState', { configurable:true, get:function () { return document.hidden ? 'hidden' : 'visible'; } });
  } catch (_) {}
  window.mineradioAndroidSetForeground = function (value) {
    var entering = !foreground && !!value;
    foreground = !!value; window.mineradioAndroidForeground = foreground;
    document.dispatchEvent(new Event('visibilitychange'));
    if (entering) window.dispatchEvent(new Event('mineradio:app-enter'));
  };
  function action(name, value) {
    if (!window.audio) return;
    if (name === 'play' || name === 'pause') {
      var pending = typeof playbackResolutionRuntime === 'function' ? playbackResolutionRuntime().active : null;
      if (pending && pending.options) pending.options.startPaused = name !== 'play';
      if (name === 'pause') {
        if (typeof audioFadeSerial !== 'undefined') audioFadeSerial++;
        if (typeof clearAudioFadeTimers === 'function') clearAudioFadeTimers();
        audio.pause(); playing = false;
        if (typeof setPlayIcon === 'function') setPlayIcon(false);
        if (typeof syncPlaybackStateFromAudioEvent === 'function') syncPlaybackStateFromAudioEvent('android-pause');
      } else if ((!pending || !pending.options) && audio.paused && typeof attemptAudioPlay === 'function') {
        Promise.resolve(attemptAudioPlay({manual:true,fade:false})).catch(function () {});
      }
    }
    if (name === 'seek') audio.currentTime = Math.max(0, Number(value) || 0);
    if (name === 'next' && typeof nextTrack === 'function') nextTrack(true);
    if (name === 'previous' && typeof prevTrack === 'function') prevTrack(true);
  }
  window.mineradioAndroidAction = action;
  var oldAudio, artworkKey = '', artwork = '', artworkLoading = '';
  function coverFor(song) {
    var key = song && typeof songCoverSrc === 'function' ? songCoverSrc(song, 512) : song && song.cover || '';
    if (key === artworkKey) return;
    artworkKey = key; artwork = ''; artworkLoading = key;
    if (!key) return;
    // Blob/custom covers are only readable in the WebView. Convert once per
    // cover, at a bounded resolution, for Android's separate MediaSession.
    var image = new Image(); image.crossOrigin = 'anonymous';
    image.onload = function () {
      if (artworkKey !== key) return;
      try {
        var canvas=document.createElement('canvas'),ratio=Math.min(1,512/Math.max(image.width,image.height));
        canvas.width=Math.max(1,Math.round(image.width*ratio));canvas.height=Math.max(1,Math.round(image.height*ratio));
        canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
        artwork=canvas.toDataURL('image/jpeg',.88); report();
      } catch (_) {}
    };
    image.onerror=function(){if(artworkKey===key)artworkLoading='';};
    image.src=/^(blob:|data:|\/)/.test(key) ? key : '/api/cover?url='+encodeURIComponent(key);
  }
  function report() {
    var media = window.audio;
    var song = typeof currentIdx !== 'undefined' && window.playQueue ? playQueue[currentIdx] : null;
    if (!song && typeof currentIdx !== 'undefined' && window.playlist) song = playlist[currentIdx];
    coverFor(song);
    var data = { playing: !!(media && !media.paused && !media.ended),
      position: media && isFinite(media.currentTime) ? media.currentTime : 0,
      duration: media && isFinite(media.duration) ? media.duration : 0,
      title: song && (song.title || song.name) || 'Mineradio',
      artist: song && (song.artist || song.author) || '', artwork:artwork, profile: window.mineradioAndroidProfile };
    try { MineradioAndroid.playback(JSON.stringify(data)); } catch (_) {}
    if (media && oldAudio !== media) {
      oldAudio = media;
      ['playing','pause','ended','loadedmetadata','seeked','error'].forEach(function (event) { media.addEventListener(event, report); });
    }
  }
  setInterval(report, 1000);
  window.addEventListener('load', report);
})();

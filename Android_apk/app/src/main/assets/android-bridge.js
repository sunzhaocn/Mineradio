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
  var oldAudio, artworkKey = '', artwork = '';
  var lastSnapshot = '', lastArtwork = null;
  var mediaEvents = ['playing','pause','ended','loadedmetadata','seeked','error'];
  function coverFor(song) {
    var key = song && typeof songCoverSrc === 'function' ? songCoverSrc(song, 512) : song && song.cover || '';
    if (key === artworkKey) return;
    artworkKey = key; artwork = '';
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
    image.src=/^(blob:|data:|\/)/.test(key) ? key : '/api/cover?url='+encodeURIComponent(key);
  }
  function report(force) {
    force = force === true;
    var media = window.audio;
    if (oldAudio !== media) {
      if (oldAudio) mediaEvents.forEach(function (event) { oldAudio.removeEventListener(event, report); });
      oldAudio = media;
      if (media) mediaEvents.forEach(function (event) { media.addEventListener(event, report); });
      lastSnapshot = '';
    }
    var song = typeof currentIdx !== 'undefined' && window.playQueue ? playQueue[currentIdx] : null;
    if (!song && typeof currentIdx !== 'undefined' && window.playlist) song = playlist[currentIdx];
    coverFor(song);
    var data = { playing: !!(media && !media.paused && !media.ended),
      position: media && isFinite(media.currentTime) ? media.currentTime : 0,
      duration: media && isFinite(media.duration) ? media.duration : 0,
      title: song && (song.title || song.name) || 'Mineradio',
      artist: song && (song.artist || song.author) || '', artworkKey:artworkKey, profile: window.mineradioAndroidProfile };
    var snapshot = JSON.stringify(data);
    if (!force && snapshot === lastSnapshot && artwork === lastArtwork) return;
    // The native service extrapolates the position while playing. A heartbeat
    // only transfers small state; artwork is sent once per change or restart.
    if (force || artwork !== lastArtwork) data.artwork = artwork;
    try {
      MineradioAndroid.playback(JSON.stringify(data));
      lastSnapshot = snapshot; lastArtwork = artwork;
    } catch (_) {
      // Keep the previous marker so a later event/heartbeat can retry.
    }
  }
  // A recreated foreground service requests one complete current snapshot.
  window.mineradioAndroidReport = report;
  setInterval(report, 1000);
  window.addEventListener('load', report);
})();

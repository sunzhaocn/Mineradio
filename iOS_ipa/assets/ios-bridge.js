'use strict';
(function () {
  window.__mineradioIOS = true;
  var sequence = 0, pending = new Map(), blobs = new Map();
  var channel = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.mineradio;
  window.mineradioIOSBridgeDiagnostic={channel:!!channel, state:'initial'};
  var foreground = window.mineradioIOSForeground !== false;
  var nativeVisibilityDispatch=false;
  var hiddenGetter = Object.getOwnPropertyDescriptor(Document.prototype,'hidden');
  try {
    Object.defineProperty(document,'hidden',{configurable:true,get:function () {
      return !foreground || !!(hiddenGetter && hiddenGetter.get.call(document));
    }});
    Object.defineProperty(document,'visibilityState',{configurable:true,get:function () {
      return document.hidden ? 'hidden' : 'visible';
    }});
  } catch (_) {}
  window.mineradioIOSSetForeground=function (value) {
    var entering=!foreground && !!value;
    foreground=!!value; window.mineradioIOSForeground=foreground;
    nativeVisibilityDispatch=true;
    try { document.dispatchEvent(new Event('visibilitychange')); } finally { nativeVisibilityDispatch=false; }
    if (entering) window.dispatchEvent(new Event('mineradio:app-enter'));
  };
  function call(op, args, timeout) {
    if (!channel) return Promise.reject(new Error('iOS 本机接口尚未就绪'));
    var id = ++sequence;
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { pending.delete(id); reject(new Error('iOS 本机操作超时')); }, timeout || 30000);
      pending.set(id, { resolve:resolve, reject:reject, timer:timer });
      channel.postMessage({id:id, op:op, args:args || {}});
    });
  }
  window.mineradioIOSReply = function (id, result, error) {
    var item = pending.get(id); if (!item) return;
    pending.delete(id); clearTimeout(item.timer);
    if (error) item.reject(new Error(error)); else item.resolve(result);
  };
  var create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = function (blob) { var url=create(blob); blobs.set(url,blob); return url; };
  URL.revokeObjectURL = function (url) { blobs.delete(url); return revoke(url); };
  async function save(blob, name) {
    var token = await call('beginSave', {name:name || blob.name || 'Mineradio-export', size:blob.size});
    try {
      for (var offset=0; offset<blob.size; offset+=49152) {
        var bytes=new Uint8Array(await blob.slice(offset,offset+49152).arrayBuffer());
        var binary=''; for (var i=0;i<bytes.length;i++) binary+=String.fromCharCode(bytes[i]);
        await call('appendSave', {token:token, offset:offset, data:btoa(binary)});
      }
      await call('finishSave', {token:token});
    } catch (error) { await call('cancelSave', {token:token}).catch(function () {}); throw error; }
  }
  function failed(error) { if (typeof showToast==='function') showToast(error.message || '文件导出失败'); }
  var downloads = new Map(), maxDownloadBytes=512*1024*1024;
  function downloadName(disposition, preferred, type) {
    var name='', match=String(disposition||'').match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
    if (match) { try { name=decodeURIComponent(match[1].trim()); } catch (_) {} }
    if (!name) {
      match=String(disposition||'').match(/(?:^|;)\s*filename\s*=\s*(?:"([^"]*)"|([^;]*))/i);
      if (match) name=(match[1] || match[2] || '').trim();
    }
    if (!name) name=preferred || '';
    if (!name) {
      var extensions={'audio/mpeg':'.mp3','audio/flac':'.flac','audio/x-flac':'.flac',
        'audio/mp4':'.m4a','video/mp4':'.m4a','audio/aac':'.aac','audio/wav':'.wav',
        'audio/x-wav':'.wav','audio/ogg':'.ogg','application/ogg':'.ogg','audio/opus':'.opus'};
      name='Mineradio-audio'+(extensions[type] || '.audio');
    }
    return String(name).replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g,'_').trim().slice(0,180) || 'Mineradio-audio.audio';
  }
  function httpDownload(value, inspectionOnly) {
    var target;
    try { target=new URL(String(value),window.location.href || window.location.origin); } catch (_) { return null; }
    if (target.origin!==window.location.origin || target.pathname!=='/api/download') return null;
    var provider=target.searchParams.get('provider') || '', id=target.searchParams.get('id') || '';
    var quality=target.searchParams.get('quality') || 'auto';
    var key='http:'+target.origin+target.pathname+'?provider='+provider+'&id='+id+'&quality='+quality;
    if (!/^(http:|https:)$/.test(target.protocol) || target.username || target.password ||
        !/^(127\.0\.0\.1|localhost|\[::1\])$/.test(target.hostname) ||
        !/^(netease|qq|kugou|qishui)$/.test(provider) || !/^[A-Za-z0-9_-]{1,128}$/.test(id) ||
        quality.length>128 || target.searchParams.has('url')) {
      return {key:key,error:'下载地址不受支持，请从当前歌曲的下载菜单重试'};
    }
    target.hash='';
    if (inspectionOnly) return {key:key,url:target.href};
    var headers={};
    if (window.localMusicCredentials && typeof window.localMusicCredentials.headers==='function') {
      // The shared adapter supplies this device's current provider credentials.
      // Prefer headers over stale credentials embedded in an earlier link.
      ['credentials','cookie','session_config'].forEach(function (name) { target.searchParams.delete(name); });
      headers=window.localMusicCredentials.headers(target.pathname+target.search) || {};
    }
    return {key:key,url:target.href,headers:headers};
  }
  async function checkedAudioBlob(response) {
    var type=String(response.headers.get('content-type') || '').split(';',1)[0].trim().toLowerCase();
    if (!response.ok || /(?:^|[\/+])json$/.test(type) || type==='text/json') {
      var message='当前音源暂不可下载，请刷新平台状态后重试';
      if (/json/.test(type)) { try {
        var data=await response.json();
        if (data && typeof data.message==='string' && data.message.length<=180 &&
            !/[\x00-\x1f]|https?:\/\/|(?:cookie|credentials|sessionid)\s*=/i.test(data.message)) message=data.message;
      } catch (_) {} }
      throw new Error(message);
    }
    if (type && !/^audio\//.test(type) && !/^(application\/octet-stream|application\/ogg|video\/mp4)$/.test(type)) {
      throw new Error('下载服务未返回音频文件，请重试');
    }
    if (response.status===206 || response.headers.get('content-range')) throw new Error('音频文件不完整，请重新下载');
    var length=Number(response.headers.get('content-length'));
    if (length>maxDownloadBytes) throw new Error('文件过大，单次导出最多 512 MiB');
    var blob=await response.blob();
    if (!blob.size || blob.size>maxDownloadBytes) throw new Error('音频文件为空或超过导出大小限制');
    if (length>0 && length!==blob.size) throw new Error('音频文件不完整，请重新下载');
    var bytes=new Uint8Array(await blob.slice(0,1024).arrayBuffer());
    var text=''; for (var i=0;i<bytes.length;i++) text+=String.fromCharCode(bytes[i]);
    // Even a successful/mislabeled response must not save an API error as music.
    if (/^(?:\xef\xbb\xbf)?\s*[\[\{<]/.test(text)) throw new Error('下载服务返回了错误页面，请重试');
    var signature=text.slice(0,4), known=signature==='fLaC' || signature==='OggS' || signature==='RIFF' ||
      signature==='FORM' || signature==='caff' || text.slice(0,3)==='ID3' || text.slice(4,8)==='ftyp' ||
      bytes.length>1 && bytes[0]===255 && (bytes[1]&224)===224;
    var binary=false;
    for (var j=0;j<bytes.length;j++) if (bytes[j]===0 || bytes[j]>126 || bytes[j]<9) { binary=true; break; }
    if (!known && !binary) throw new Error('下载服务未返回有效音频，请重试');
    return {blob:blob,type:type};
  }
  async function fetchDownload(spec, preferred) {
    if (!channel) throw new Error('iOS 本机接口尚未就绪');
    if (spec.error) throw new Error(spec.error);
    var controller=new AbortController(), timer=setTimeout(function () { controller.abort(); },180000);
    var response,audio;
    try {
      response=await fetch(spec.url,{method:'GET',headers:spec.headers,credentials:'omit',cache:'no-store',
        redirect:'error',signal:controller.signal});
      var returned=response.url ? httpDownload(response.url,true) : spec;
      if (response.redirected || !returned || returned.error) throw new Error('下载发生了不受支持的跳转，请重试');
      audio=await checkedAudioBlob(response);
    } catch (error) {
      if (error.name==='AbortError') throw new Error('下载超时，请重试');
      if (error instanceof TypeError) throw new Error('下载连接失败，请检查网络后重试');
      throw error;
    } finally { clearTimeout(timer); }
    return save(audio.blob,downloadName(response.headers.get('content-disposition'),preferred,audio.type));
  }
  function startDownload(spec, name) {
    if (downloads.has(spec.key)) return downloads.get(spec.key);
    var task=Promise.resolve().then(function () {
      return spec.blob ? save(spec.blob,name) : fetchDownload(spec,name);
    }).finally(function () { downloads.delete(spec.key); });
    downloads.set(spec.key,task);return task;
  }
  function anchorDownload(anchor) {
    var explicit=typeof anchor.hasAttribute==='function' ? anchor.hasAttribute('download') : !!anchor.download;
    var spec=explicit && blobs.has(anchor.href) ? {key:anchor.href,blob:blobs.get(anchor.href)} : httpDownload(anchor.href);
    if (!spec) return false;
    if (!downloads.has(spec.key)) startDownload(spec,anchor.download).catch(failed);
    return true;
  }
  window.mineradioIOSDownload=function (url,name) {
    var spec=httpDownload(url);
    return spec ? startDownload(spec,name) : Promise.reject(new Error('只支持当前设备的音乐下载接口'));
  };
  var qishuiEnabled=false, qishuiEnabling=null;
  document.addEventListener('click',function (event) {
    var button=event.target.closest && event.target.closest('#search-mode-qishui');
    if (!button || qishuiEnabled) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (qishuiEnabling) return;
    qishuiEnabling=call('enableQishui',{},120000).then(function (enabled) {
      if (enabled) { qishuiEnabled=true; button.click(); }
    }).catch(failed).finally(function () { qishuiEnabling=null; });
  },true);
  var click=HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click=function () {
    if (anchorDownload(this)) return;
    return click.call(this);
  };
  document.addEventListener('click', function (event) {
    var anchor=event.target.closest && event.target.closest('a');
    if (anchor && anchorDownload(anchor)) {
      event.preventDefault();event.stopImmediatePropagation();
    }
  }, true);
  function action(name, value) {
    var media=window.audio; if (!media) return;
    var active=typeof playbackResolutionRuntime==='function' ? playbackResolutionRuntime().active : null;
    if ((name==='pause' || name==='play') && active && active.options) active.options.startPaused=name!=='play';
    if (name==='pause') {
      if (typeof audioFadeSerial!=='undefined') audioFadeSerial++;
      if (typeof clearAudioFadeTimers==='function') clearAudioFadeTimers();
      media.pause();
      if (typeof playing!=='undefined') playing=false;
      if (typeof setPlayIcon==='function') setPlayIcon(false);
      if (typeof syncPlaybackStateFromAudioEvent==='function') syncPlaybackStateFromAudioEvent('ios-pause');
    }
    if (name==='play' && (!active || !active.options)) {
      if (typeof attemptAudioPlay==='function') Promise.resolve(attemptAudioPlay({manual:true,fade:false})).catch(failed);
      else media.play().catch(failed);
    }
    if (name==='next' && typeof nextTrack==='function') nextTrack(true);
    if (name==='previous' && typeof prevTrack==='function') prevTrack(true);
    if (name==='seek' && isFinite(value)) media.currentTime=Math.max(0,value);
  }
  window.mineradioIOSAction=action;
  var bound, artworkKey='', artwork='';
  function coverFor(song) {
    var key=song && typeof songCoverSrc==='function' ? songCoverSrc(song,512) : song && song.cover || '';
    if (key===artworkKey) return;
    artworkKey=key; artwork='';
    if (!key) return;
    var image=new Image(); image.crossOrigin='anonymous';
    image.onload=function () {
      if (key!==artworkKey) return;
      try {
        var canvas=document.createElement('canvas'),ratio=Math.min(1,512/Math.max(image.width,image.height));
        canvas.width=Math.max(1,Math.round(image.width*ratio));canvas.height=Math.max(1,Math.round(image.height*ratio));
        canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
        artwork=canvas.toDataURL('image/jpeg',.88);report();
      } catch (_) {}
    };
    image.src=/^(blob:|data:|\/)/.test(key) ? key : '/api/cover?url='+encodeURIComponent(key);
  }
  function report() {
    var media=window.audio; if (!media) return;
    if (bound!==media) {
      bound=media;
      ['playing','pause','ended','seeked','loadedmetadata'].forEach(function (name) { media.addEventListener(name,report); });
    }
    var queue=window.playQueue || window.playlist || [];
    var song=typeof currentIdx!=='undefined' ? queue[currentIdx] : null;
    if (!song && typeof currentIdx!=='undefined' && window.playlist) song=playlist[currentIdx];
    coverFor(song);
    if (window.mineradioIOSNativeMedia) {
      call('playback',{playing:!media.paused && !media.ended,
        position:isFinite(media.currentTime) ? media.currentTime : 0,
        duration:isFinite(media.duration) ? media.duration : 0,
        rate:isFinite(media.playbackRate) ? media.playbackRate : 1,
        title:song && (song.title || song.name) || 'Mineradio', artist:song && (song.artist || song.author) || '',
        album:song && song.album || '', artwork:artwork,
        hasTrack:!!song}).catch(function () {});
    } else if (navigator.mediaSession) {
      try {
        navigator.mediaSession.metadata=new MediaMetadata({title:song && (song.title || song.name) || 'Mineradio',
          artist:song && (song.artist || song.author) || '', album:song && song.album || '',
          artwork:artwork ? [{src:artwork,sizes:'512x512',type:'image/jpeg'}] : []});
        navigator.mediaSession.playbackState=media.paused ? 'paused' : 'playing';
        if (isFinite(media.duration) && media.duration>0) navigator.mediaSession.setPositionState({
          duration:media.duration,position:Math.min(media.duration,Math.max(0,media.currentTime)),playbackRate:media.playbackRate || 1});
      } catch (_) {}
    }
  }
  if (!window.mineradioIOSNativeMedia && navigator.mediaSession) {
    [['play','play'],['pause','pause'],['nexttrack','next'],['previoustrack','previous']].forEach(function (pair) {
      try { navigator.mediaSession.setActionHandler(pair[0],function () { action(pair[1]); }); } catch (_) {}
    });
    try { navigator.mediaSession.setActionHandler('seekto',function (event) { action('seek',event.seekTime); }); } catch (_) {}
  }
  document.addEventListener('DOMContentLoaded',function () {
    window.mineradioIOSBridgeDiagnostic.state='sent';
    call('selfCheck').then(function () { window.__mineradioIOSBridgeReady=true;
      window.mineradioIOSBridgeDiagnostic.state='received'; return call('selfCheckConfirmed');
    }).catch(function (error) { window.mineradioIOSBridgeDiagnostic.state='failed';
      window.mineradioIOSBridgeDiagnostic.error=error.message; });
    ['search-mode-qishui','login-provider-qishui'].forEach(function (id) {
      var button=document.getElementById(id);
      if (button) { button.disabled=false; button.title='汽水音乐'; }
    });
    var area=document.getElementById('login-platform-tabs');
    if (area) { var note=document.createElement('p'); note.className='mineradio-ios-note';
      note.textContent='首次连接汽水音乐时，请确认设备环境信息的使用，再使用自己的账号扫码授权。'; area.after(note); }
    report();
  });
  setInterval(report,1000);
  document.addEventListener('visibilitychange',function () {
    if (!document.hidden) {
      if (!window.mineradioIOSNativeMedia && !nativeVisibilityDispatch) window.dispatchEvent(new Event('mineradio:app-enter'));
      report();
    }
  });
})();

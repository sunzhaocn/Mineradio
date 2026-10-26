'use strict';
// Disk-backed LRU. Blobs stay in IndexedDB; only the current video gets a URL.
(function () {
  var opening, writes = Promise.resolve(), covers = new Map(), videos = new Map(), coverControllers = new Set();
  var LIMIT = 10, MAX_VIDEO = 128 * 1024 * 1024, audioJobs = new Map(), audioUrls = new Map();
  function database() {
    if (!opening) opening = new Promise(function (resolve, reject) {
      var req = indexedDB.open('mineradio-playback-media-v1', 1);
      req.onupgradeneeded = function () {
        var store = req.result.createObjectStore('tracks', { keyPath: 'key' });
        store.createIndex('touched', 'touched');
      };
      req.onsuccess = function () { req.result.onversionchange = function () { req.result.close(); opening = null; }; resolve(req.result); };
      req.onerror = req.onblocked = function () { reject(req.error || new Error('缓存不可用')); };
    }).catch(function (e) { opening = null; throw e; });
    return opening;
  }
  function identity(song) {
    if (!song) return '';
    var provider = typeof songProviderKey === 'function' ? songProviderKey(song) : song.provider || song.source || 'netease';
    var id = song.mid || song.songmid || song.hash || song.providerSongId || song.localKey || song.id;
    return id ? provider + ':' + id : '';
  }
  async function scopedKey(song) {
    var key = identity(song);
    if (!key) return '';
    var provider = key.split(':')[0];
    var headers = window.localMusicCredentials ? localMusicCredentials.headers('/api/' + (provider === 'netease' ? '' : provider + '/') + 'song/url') : {};
    var raw = JSON.stringify(headers);
    var digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    return key + ':' + Array.from(new Uint8Array(digest)).map(function (v) { return v.toString(16).padStart(2, '0'); }).join('');
  }
  async function readKey(key) {
    var db = await database();
    return new Promise(function (resolve, reject) {
      var tx = db.transaction('tracks'), req = tx.objectStore('tracks').get(key), value;
      req.onsuccess = function () { value = req.result; };
      tx.oncomplete = function () { resolve(value || null); };
      tx.onerror = tx.onabort = function () { reject(tx.error); };
    });
  }
  function cleanMetadata(song) {
    var result = {};
    ['id','mid','hash','providerSongId','name','title','artist','album','albumId','albumMid','cover','provider','source','duration','genres','tags','language'].forEach(function (key) {
      var value = song && song[key];
      if (value != null && !/^(blob:|data:)/.test(String(value))) result[key] = value;
    });
    return result;
  }
  function put(song, patch) {
    var task = async function () {
      var key = await scopedKey(song); if (!key) return false;
      var db = await database();
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('tracks', 'readwrite'), store = tx.objectStore('tracks');
        var req = store.get(key);
        req.onsuccess = function () {
          var old = req.result || {}, meta = Object.assign({}, old.meta || {}, cleanMetadata(song));
          if (!meta.cover && old.meta && old.meta.cover) meta.cover = old.meta.cover;
          var row = Object.assign({}, old, patch, { key: key, meta: meta, touched: Date.now() });
          store.put(row);
          var count = store.count();
          count.onsuccess = function () {
            var excess = count.result - LIMIT;
            if (excess <= 0) return;
            var cursor = store.index('touched').openCursor();
            cursor.onsuccess = function () {
              if (!cursor.result || excess <= 0) return;
              if (cursor.result.key !== key) { cursor.result.delete(); excess--; }
              cursor.result.continue();
            };
          };
        };
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = tx.onabort = function () { reject(tx.error); };
      });
    };
    writes = writes.catch(function () {}).then(task);
    return writes.catch(function () { return false; });
  }
  async function read(song) { try { return await readKey(await scopedKey(song)); } catch (_) { return null; } }
  async function fetchBlob(url, max, type, signal, timeoutMs, progress) {
    var controller = new AbortController(), timeout = setTimeout(function () { controller.abort(); }, timeoutMs || 120000);
    var abort = function () { controller.abort(); };
    if (signal) { signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort(); }
    try {
      var headers = window.localMusicCredentials ? localMusicCredentials.headers(url) : {};
      var response = await fetch(url, { signal: controller.signal, headers: headers, credentials: 'omit' });
      if (!response.ok || response.status === 206 || Number(response.headers.get('content-length')) > max) { if (response.body) await response.body.cancel(); return null; }
      var mime = response.headers.get('content-type') || '';
      if (!type.test(mime)) { if (response.body) await response.body.cancel(); return null; }
      var reader = response.body.getReader(), chunks = [], size = 0;
      try {
        while (true) {
          var part = await reader.read(); if (part.done) break;
          size += part.value.byteLength;
          if (size > max) { await reader.cancel(); return null; }
          chunks.push(part.value);
          if (progress) progress(size, Number(response.headers.get('content-length')) || 0);
        }
        var expected = Number(response.headers.get('content-length'));
        if (!size || expected && !response.headers.get('content-encoding') && size !== expected) return null;
        return new Blob(chunks, { type: mime });
      } finally { reader.releaseLock(); }
    } finally { clearTimeout(timeout); if (signal) signal.removeEventListener('abort', abort); }
  }
  function dataUrl(blob) {
    return new Promise(function (resolve) { var reader = new FileReader(); reader.onload = function () { resolve(reader.result); }; reader.onerror = function () { resolve(''); }; reader.readAsDataURL(blob); });
  }
  async function cover(url, song) {
    var key = await scopedKey(song); if (!key) return '';
    if (covers.has(key)) return covers.get(key);
    var task = (async function () {
      var cached = await read(song);
      if (cached && cached.cover instanceof Blob) { put(song, {}); return dataUrl(cached.cover); }
      url = url || cached && cached.meta && cached.meta.cover;
      if (!url && typeof apiJson === 'function') {
        var provider = identity(song).split(':')[0], id = song.mid || song.hash || song.providerSongId || song.id;
        if (['netease','qq','kugou','qishui'].indexOf(provider) >= 0) {
          var info = await apiJson('/api/' + (provider === 'netease' ? '' : provider + '/') + 'song/detail?id=' + encodeURIComponent(id), { timeoutMs: 12000 });
          url = info.cover || info.picUrl || info.song && info.song.cover;
        }
      }
      if (!url) return '';
      var proxy = /^(data:|blob:|\/)/.test(url) ? url : '/api/cover?url=' + encodeURIComponent(url);
      var controller = new AbortController(); coverControllers.add(controller);
      var blob;
      try { blob = await fetchBlob(proxy, 6 * 1024 * 1024, /^image\//, controller.signal); }
      finally { coverControllers.delete(controller); }
      if (!blob) return '';
      await put(Object.assign({}, song, { cover: url }), { cover: blob });
      return dataUrl(blob);
    }()).catch(function () { return ''; }).finally(function () { covers.delete(key); });
    covers.set(key, task); return task;
  }
  async function video(song, url, signal, progress) {
    var key = await scopedKey(song), cached = await read(song);
    if (cached && cached.mv instanceof Blob) { put(song, {}); return cached.mv; }
    if (videos.has(key)) return videos.get(key);
    // Current plus next; an unbounded playlist never creates a video fan-out.
    if (videos.size >= 2 || !url || signal && signal.aborted) return null;
    var task = fetchBlob(url, MAX_VIDEO, /^(video\/|application\/octet-stream)/, signal, 180000, progress).then(async function (blob) {
      if (blob && !(signal && signal.aborted)) await put(song, { mv: blob });
      return blob;
    }).catch(function () { return null; }).finally(function () { videos.delete(key); });
    videos.set(key, task); return task;
  }
  async function audioSource(song, url, variant, signal) {
    // A complete current/next track is fetched once, then played from owned
    // bytes. Never persist signed URLs or credential headers in the record.
    if (!url || /^blob:/.test(url)) return url;
    var key = await scopedKey(song), jobKey = key + ':' + variant;
    if (!key || signal && signal.aborted) return url;
    if (audioUrls.has(jobKey)) return audioUrls.get(jobKey);
    var cached = await read(song), bytes = cached && cached.audioBytes;
    if (!(bytes instanceof ArrayBuffer) || cached.audioVariant !== variant) {
      if (audioJobs.has(jobKey)) return audioJobs.get(jobKey);
      var task = (async function () {
        var blob = await fetchBlob(url, 64 * 1024 * 1024, /^(audio\/|application\/octet-stream)/, signal, 20000);
        if (!blob || signal && signal.aborted) return url;
        var data = await blob.arrayBuffer();
        await put(song, {audioBytes:data, audioMime:blob.type, audioVariant:variant});
        return audioHandle(jobKey, data, blob.type);
      })().catch(function () { return url; }).finally(function () { audioJobs.delete(jobKey); });
      audioJobs.set(jobKey, task); return task;
    }
    return audioHandle(jobKey, bytes, cached.audioMime);
  }
  function audioHandle(key, bytes, mime) {
    var header = new Uint8Array(bytes,0,Math.min(16,bytes.byteLength));
    var text = String.fromCharCode.apply(null,header);
    if (text.slice(0,3)==='ID3') mime='audio/mpeg';
    else if (text.slice(0,4)==='fLaC') mime='audio/flac';
    else if (text.slice(0,4)==='OggS') mime='audio/ogg';
    else if (text.slice(0,4)==='RIFF'&&text.slice(8,12)==='WAVE') mime='audio/wav';
    else if (text.slice(4,8)==='ftyp') mime='audio/mp4';
    else if (header[0]===255&&(header[1]&224)===224) mime=(header[1]&246)===240?'audio/aac':'audio/mpeg';
    var url = URL.createObjectURL(new Blob([bytes], {type:mime || 'audio/mpeg'}));
    audioUrls.set(key,url);
    while (audioUrls.size > 4) {
      var oldest = Array.from(audioUrls.keys()).find(function (id) { return !window.audio || window.audio.src !== audioUrls.get(id); });
      if (!oldest) break;
      URL.revokeObjectURL(audioUrls.get(oldest)); audioUrls.delete(oldest);
    }
    return url;
  }
  window.mineradioMediaCache = { identity: identity, read: read, remember: function (song) { return put(song, {}); }, cover: cover, video: video, audioSource:audioSource, limit: LIMIT };
  window.addEventListener('mineradio:playback-intent', function () { coverControllers.forEach(function (controller) { controller.abort(); }); coverControllers.clear(); });
  window.addEventListener('pagehide', function () { coverControllers.forEach(function (controller) { controller.abort(); }); coverControllers.clear(); });
})();

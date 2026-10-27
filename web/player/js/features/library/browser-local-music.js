/* Browser counterpart of the authorized desktop music library. Only files the
 * user selects are stored, in this origin's IndexedDB; no server upload occurs. */
(function () {
  'use strict';
  var DATABASE = 'mineradio-browser-local-music-v1';
  var STORE = 'tracks';
  var databasePromise = null;
  var mediaUrls = new Map();
  var AUDIO = /\.(mp3|flac|wav|ogg|m4a|aac|opus)$/i;
  var MIME = { mp3:'audio/mpeg', flac:'audio/flac', wav:'audio/wav', ogg:'audio/ogg', m4a:'audio/mp4', aac:'audio/aac', opus:'audio/ogg' };
  function changed() { window.dispatchEvent(new Event('mineradio:local-library-changed')); }
  function audioMime(bytes, name, fallback) {
    var data = bytes instanceof ArrayBuffer ? new Uint8Array(bytes, 0, Math.min(16, bytes.byteLength)) : null;
    var text = data ? String.fromCharCode.apply(null, data) : '';
    if (text.slice(0,3) === 'ID3') return 'audio/mpeg';
    if (text.slice(0,4) === 'fLaC') return 'audio/flac';
    if (text.slice(0,4) === 'OggS') return 'audio/ogg';
    if (text.slice(0,4) === 'RIFF' && text.slice(8,12) === 'WAVE') return 'audio/wav';
    if (text.slice(4,8) === 'ftyp') return 'audio/mp4';
    if (data && data.length > 1 && data[0] === 255 && (data[1] & 224) === 224) {
      return (data[1] & 246) === 240 ? 'audio/aac' : 'audio/mpeg';
    }
    if (data) return ''; // Downloaded bytes must carry an actual audio header.
    var extension = String(name || '').split('.').pop().toLowerCase();
    return MIME[extension] || (/^audio\//.test(fallback || '') ? fallback : '');
  }
  function playableFile(record) {
    var bytes = record && record.bytes;
    if (bytes instanceof ArrayBuffer && bytes.byteLength) {
      var mime = audioMime(bytes, record.path, record.mime);
      return mime ? new Blob([bytes], {type:mime}) : null;
    }
    if (record && record.file instanceof Blob && record.file.size) {
      var type = audioMime(null, record.path, record.file.type);
      return record.file.slice(0, record.file.size, type || record.file.type);
    }
    return null;
  }
  async function checksum(bytes) {
    var digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map(function (v) { return v.toString(16).padStart(2,'0'); }).join('');
  }
  function checkPlayback(blob) {
    return new Promise(function (resolve,reject) {
      var media = new Audio(), url = URL.createObjectURL(blob), timer;
      function finish(error) {
        clearTimeout(timer); media.onloadedmetadata = media.onerror = null;
        media.removeAttribute('src'); media.load(); URL.revokeObjectURL(url);
        error ? reject(error) : resolve();
      }
      media.onloadedmetadata = function () {
        finish(Number.isFinite(media.duration) && media.duration > 0 ? null : new Error('音频没有有效时长，请重新下载'));
      };
      media.onerror = function () { finish(new Error('此音频无法在当前设备解码，请选择 MP3 或 AAC 音质重新下载')); };
      timer = setTimeout(function () { finish(new Error('本地音频校验超时，请重试')); },15000);
      media.preload = 'metadata'; media.src = url; media.load();
    });
  }

  function database() {
    if (!window.indexedDB) return Promise.reject(new Error('浏览器不支持本地曲库存储'));
    if (databasePromise) return databasePromise;
    databasePromise = new Promise(function (resolve, reject) {
      var request = indexedDB.open(DATABASE, 3);
      request.onupgradeneeded = function () {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath:'id' });
        if (!request.result.objectStoreNames.contains('lyrics')) request.result.createObjectStore('lyrics', { keyPath:'key' }).createIndex('cachedAt', 'cachedAt');
        if (!request.result.objectStoreNames.contains('downloadedLyrics')) request.result.createObjectStore('downloadedLyrics', { keyPath:'key' });
      };
      request.onsuccess = function () {
        var db = request.result;
        db.onversionchange = function () { db.close(); databasePromise = null; };
        resolve(db);
      };
      request.onerror = function () { reject(request.error || new Error('无法打开浏览器本地曲库')); };
      request.onblocked = function () { reject(new Error('本地曲库被其它页面占用，请关闭旧页面后重试')); };
    }).catch(function (error) { databasePromise = null; throw error; });
    return databasePromise;
  }

  async function read(id) {
    var db = await database();
    return new Promise(function (resolve, reject) {
      var transaction = db.transaction(STORE, 'readonly');
      var request = id ? transaction.objectStore(STORE).get(id) : transaction.objectStore(STORE).getAll();
      var value;
      request.onsuccess = function () { value = request.result; };
      transaction.oncomplete = function () { resolve(value); };
      transaction.onerror = transaction.onabort = function () { reject(transaction.error || request.error || new Error('读取本地曲库失败')); };
    });
  }

  async function write(records) {
    var db = await database();
    return new Promise(function (resolve, reject) {
      var transaction = db.transaction(STORE, 'readwrite');
      try { records.forEach(function (record) { transaction.objectStore(STORE).put(record); }); }
      catch (error) { transaction.abort(); reject(error); return; }
      transaction.oncomplete = function () { changed(); resolve(); };
      transaction.onerror = transaction.onabort = function () { reject(transaction.error || new Error('浏览器空间不足，无法保存本地音乐')); };
    });
  }

  function relativePath(file) { return String(file.webkitRelativePath || file.name || '').replace(/\\/g, '/'); }
  function lyricKey(file) { return relativePath(file).replace(/\.[^/.]+$/, '').toLowerCase(); }
  function validId(value) { return /^[a-f0-9]{24}$/.test(String(value || '')); }

  async function fileId(file) {
    // Include bounded content samples so two same-name/size/timestamp files do
    // not alias, without reading a large album into JavaScript memory at once.
    var identity = new TextEncoder().encode([relativePath(file), file.size, file.lastModified || 0].join('|'));
    var first = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
    var last = new Uint8Array(await file.slice(Math.max(65536, file.size - 65536)).arrayBuffer());
    var bytes = new Uint8Array(identity.length + first.length + last.length);
    bytes.set(identity); bytes.set(first, identity.length); bytes.set(last, identity.length + first.length);
    var digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map(function (value) { return value.toString(16).padStart(2, '0'); }).join('').slice(0, 24);
  }

  function track(record, materialize) {
    if (!record || !validId(record.id) || !(record.bytes instanceof ArrayBuffer && record.bytes.byteLength || record.file instanceof Blob && record.file.size)) return null;
    var revision = String(record.size) + ':' + String(record.modified) + ':' + (record.sha256 || record.mime || '');
    var current = mediaUrls.get(record.id);
    if (materialize !== false && (!current || current.revision !== revision)) {
      if (current) URL.revokeObjectURL(current.url);
      var file = playableFile(record);
      if (!file) return null;
      current = { url:URL.createObjectURL(file), revision:revision };
      mediaUrls.set(record.id, current);
      // A catalogue may contain thousands of songs. Only materialized playback
      // handles get URLs, with a small recently used pool for preload handoffs.
      while (mediaUrls.size > 8) {
        var oldest = mediaUrls.keys().next().value;
        var entry = mediaUrls.get(oldest);
        if (window.audio && window.audio.src === entry.url) { mediaUrls.delete(oldest); mediaUrls.set(oldest, entry); continue; }
        URL.revokeObjectURL(entry.url); mediaUrls.delete(oldest);
      }
    }
    return Object.assign({}, record.song, { id:'local:' + record.id, localFileId:record.id,
      localKey:record.id, localUrl:current ? current.url : '', localMissing:false, hasLyric:!!record.lyric,
      lyricSource:record.lyric ? '本地 LRC' : '' });
  }

  async function listLocalMusicLibrary() {
    var records = await read();
    records.sort(function (a, b) { return String(a.path).localeCompare(String(b.path), 'zh-CN', { numeric:true, sensitivity:'base' }); });
    var tracks = records.map(function (record) { return track(record, false); }).filter(Boolean);
    if (window.desktopWindow && typeof desktopWindow.listLocalMusicLibrary === 'function') {
      var native = await desktopWindow.listLocalMusicLibrary();
      if (native && Array.isArray(native.tracks)) tracks = native.tracks.concat(tracks);
    }
    return { ok:true, count:tracks.length, tracks:tracks };
  }

  async function importLocalMusicFiles(files) {
    if (window.desktopWindow && typeof desktopWindow.importLocalMusicFiles === 'function') {
      await desktopWindow.importLocalMusicFiles(files);
      return listLocalMusicLibrary();
    }
    var selected = Array.from(files || []);
    var audio = selected.filter(function (file) { return AUDIO.test(file.name || '') || /^audio\//i.test(file.type || ''); });
    if (!audio.length) return { ok:false, error:'NO_SUPPORTED_LOCAL_AUDIO', tracks:[] };
    var lyrics = new Map();
    selected.forEach(function (file) {
      if (/\.lrc$/i.test(file.name || '') && file.size <= 512 * 1024) lyrics.set(lyricKey(file), file);
    });
    var records = [];
    for (var i = 0; i < audio.length; i++) {
      var file = audio[i];
      var id = await fileId(file);
      var path = relativePath(file);
      var name = String(file.name || '').replace(/\.[^.]+$/, '') || '本地音乐';
      var lyricFile = lyrics.get(lyricKey(file));
      var lyric = lyricFile ? await lyricFile.text() : '';
      var previous = lyric ? null : await read(id);
      var extension = String(file.name || '').split('.').pop().toLowerCase();
      records.push({ id:id, file:file.type ? file : file.slice(0, file.size, MIME[extension] || 'application/octet-stream'),
        path:path, size:file.size, modified:file.lastModified || 0,
        lyric:lyric || previous && previous.lyric || '',
        song:{ type:'local', source:'local', provider:'local', name:name, title:name, artist:'本地文件',
          album:path.indexOf('/') >= 0 ? path.split('/').slice(0, -1).join(' / ') : '', localPath:path, duration:0 } });
    }
    // One transaction: quota failure cannot leave a half-saved import behind.
    await write(records);
    var result = await listLocalMusicLibrary();
    result.importedCount = new Set(records.map(function (record) { return record.id; })).size;
    return result;
  }

  async function saveDownloadedTrack(file, song, lyric, cover) {
    if (!(file instanceof Blob) || !file.size || file.size > 512 * 1024 * 1024) throw new Error('音乐文件为空或超出本地保存大小限制');
    var id = await fileId(file), name = String(song.name || song.title || '本地音乐');
    var bytes = await file.arrayBuffer(), mime = audioMime(bytes, file.name, file.type);
    if (!mime) throw new Error('下载内容不是可识别的音频文件，未保存为歌曲');
    // Store the owned bytes rather than a WebKit temporary downloaded File.
    // Reconstruct a correctly typed Blob for each actual playback handle.
    await checkPlayback(new Blob([bytes],{type:mime}));
    var digest = await checksum(bytes);
    // Store only public metadata, never authenticated URLs, cookies or account data.
    var metadata = { type:'local', source:'local', provider:'local', name:name, title:name,
      artist:String(song.artist || song.author || ''), album:String(song.album || ''),
      duration:Number(song.duration) || 0, cover:String(cover || ''), localPath:'下载/' + file.name,
      originProvider:sourceProvider(song), originId:sourceId(song) };
    if (!lyric) lyric = await readDownloadedLyric(song);
    await write([{ id:id, bytes:bytes, mime:mime, sha256:digest, path:metadata.localPath, size:bytes.byteLength, modified:0,
      lyric:String(lyric || '').slice(0, 512 * 1024), song:metadata }]);
    var stored = await read(id);
    if (!(stored && stored.bytes instanceof ArrayBuffer) || stored.bytes.byteLength !== bytes.byteLength || await checksum(stored.bytes) !== digest) {
      throw new Error('音频写入后校验失败，请重新下载；歌词不会被删除');
    }
    await checkPlayback(playableFile(stored));
    var result = await listLocalMusicLibrary(); result.savedId = id; return result;
  }

  function sourceId(song) { return String(song.mid || song.songmid || song.hash || song.providerSongId || song.id || ''); }
  function sourceProvider(song) { var p = String(song.provider || song.source || 'netease'); return p === 'qqmusic' ? 'qq' : p; }
  function downloadedLyricKey(song) { return sourceProvider(song) + ':' + sourceId(song); }
  async function readDownloadedLyric(song) {
    var db = await database();
    return new Promise(function (resolve, reject) {
      var tx = db.transaction('downloadedLyrics'), request = tx.objectStore('downloadedLyrics').get(downloadedLyricKey(song)), value;
      request.onsuccess = function () { value = request.result; };
      tx.oncomplete = function () { resolve(value && value.lyric || ''); };
      tx.onerror = tx.onabort = function () { reject(tx.error || new Error('读取已下载歌词失败')); };
    });
  }
  async function saveTrackLyric(song, lyric) {
    if (!song || typeof lyric !== 'string' || !lyric.trim()) return false;
    var provider = sourceProvider(song);
    var originalId = sourceId(song);
    var records = (await read()).filter(function (record) {
      return record.id === song.localFileId || record.song &&
        sourceProvider({provider:record.song.originProvider}) === provider && record.song.originId === originalId;
    });
    records.forEach(function (record) { record.lyric = lyric.slice(0, 512 * 1024); });
    var db = await database();
    await new Promise(function (resolve, reject) {
      var tx = db.transaction([STORE, 'downloadedLyrics'], 'readwrite');
      records.forEach(function (record) { tx.objectStore(STORE).put(record); });
      tx.objectStore('downloadedLyrics').put({key:downloadedLyricKey(song),lyric:lyric.slice(0,512*1024)});
      tx.oncomplete = function () { changed(); resolve(); };
      tx.onerror = tx.onabort = function () { reject(tx.error || new Error('保存歌词失败')); };
    });
    return true;
  }

  async function readLyricCache(key) {
    try {
      var db = await database();
      return await new Promise(function (resolve) {
        var transaction = db.transaction('lyrics', 'readonly');
        var request = transaction.objectStore('lyrics').get(String(key || ''));
        var record;
        request.onsuccess = function () { record = request.result; };
        transaction.oncomplete = function () { resolve({ ok:true, hit:!!record, payload:record && record.payload, cachedAt:record && record.cachedAt }); };
        transaction.onabort = transaction.onerror = function () { resolve({ ok:false, hit:false }); };
      });
    } catch (_) { return { ok:false, hit:false }; }
  }

  async function writeLyricCache(key, payload) {
    try {
      if (!key || !payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok:false };
      // Keep lyric content and its public source only. Never persist arbitrary
      // response fields such as request headers, cookies or account summaries.
      var clean = {};
      ['lyric','tlyric','trans','translatedLyric','translation','translated_lyric','yrc','ytlrc',
        'klyric','romalrc','provider','source','nolyric','uncollected','ok'].forEach(function (field) {
        var value = payload[field];
        if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') clean[field] = value;
      });
      if (String(key).length > 4096 || new TextEncoder().encode(JSON.stringify(clean)).length > 1024 * 1024) return { ok:false };
      var db = await database();
      return await new Promise(function (resolve) {
        var transaction = db.transaction('lyrics', 'readwrite');
        var store = transaction.objectStore('lyrics');
        store.put({ key:String(key), payload:clean, cachedAt:Date.now() });
        var count = store.count();
        count.onsuccess = function () {
          var excess = count.result - 500;
          if (excess <= 0) return;
          var cursor = store.index('cachedAt').openCursor();
          cursor.onsuccess = function () {
            if (!cursor.result || excess-- <= 0) return;
            cursor.result.delete(); cursor.result.continue();
          };
        };
        transaction.oncomplete = function () { resolve({ ok:true }); };
        transaction.onabort = transaction.onerror = function () { resolve({ ok:false }); };
      });
    } catch (_) { return { ok:false }; }
  }

  window.browserLocalMusic = Object.freeze({
    readLocalMusicFile:async function (id) {
      var record = validId(id) ? await read(id) : null;
      if (record) {
        var blob = playableFile(record);
        if (!blob) throw new Error('本地音频不可读，请重新导入');
        return {blob:blob, name:String(record.path || '本地音乐').split('/').pop()};
      }
      if (window.desktopWindow && typeof desktopWindow.listLocalMusicLibrary === 'function') {
        var library = await desktopWindow.listLocalMusicLibrary();
        var song = (library.tracks || []).find(function (entry) { return entry.localFileId === id; });
        if (song && song.localUrl) {
          var response = await fetch(song.localUrl);
          if (!response.ok) throw new Error('本地音频读取失败');
          return {blob:await response.blob(), name:String(song.localPath || song.name || '本地音乐').split(/[\\/]/).pop()};
        }
      }
      throw new Error('本地歌曲不存在，请重新导入');
    },
    readDownloadedLyric:readDownloadedLyric,
    saveTrackLyric:saveTrackLyric,
    saveDownloadedTrack:saveDownloadedTrack,
    importLocalMusicFiles:importLocalMusicFiles,
    listLocalMusicLibrary:listLocalMusicLibrary,
    readLyricCache:readLyricCache,
    writeLyricCache:writeLyricCache,
    getLocalMusicTrack:async function (id) {
      var record = validId(id) ? await read(id) : null;
      // Repair legacy File-backed records lazily, keeping their metadata/LRC.
      if (record && !(record.bytes instanceof ArrayBuffer) && record.file instanceof Blob) {
        var recovered = await record.file.arrayBuffer(), mime = audioMime(recovered, record.path, record.file.type);
        if (!recovered.byteLength || !mime) throw new Error('已保存的音频不可读，请重新下载这首歌');
        record.bytes = recovered; record.mime = mime; record.sha256 = await checksum(recovered);
        delete record.file;
        await write([record]);
      }
      var own = record ? track(record) : null;
      if (own) return own;
      if (window.desktopWindow && typeof desktopWindow.listLocalMusicLibrary === 'function') {
        var result = await desktopWindow.listLocalMusicLibrary();
        return (result.tracks || []).find(function (song) { return song.localFileId === id || song.localKey === id; }) || null;
      }
      return null;
    },
    ownsLocalMusicUrl:function (url) {
      return Array.from(mediaUrls.values()).some(function (entry) { return entry.url === url; });
    },
    readLocalMusicLyric:async function (id) {
      var record = validId(id) ? await read(id) : null;
      if (!record && window.desktopWindow && typeof desktopWindow.readLocalMusicLyric === 'function') return desktopWindow.readLocalMusicLyric(id);
      return record ? { ok:true, localFileId:id, lyric:record.lyric || '', lyricSource:record.lyric ? '本地 LRC' : '' }
        : { ok:false, error:'LOCAL_TRACK_MISSING', lyric:'' };
    }
  });
})();

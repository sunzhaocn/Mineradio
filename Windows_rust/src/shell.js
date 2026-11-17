'use strict';
(function installDesktopBridge() {
  if (window.top !== window || location.origin !== __MINERADIO_ORIGIN__) return;
  const replies = new Map();
  const listeners = new Set();
  const updateListeners = new Set();
  const desktopEvents = new Map();
  let messageId = 0;

  function invoke(method, ...args) {
    return new Promise(function (resolve, reject) {
      const id = ++messageId;
      const timeout = ['chooseCache', 'chooseExport', 'chooseVideo', 'importJson'].includes(method) ? 5 * 60 * 1000 : method === 'memoryPurge' ? 90000 : 30000;
      const timer = setTimeout(function () {
        replies.delete(id);
        reject(new Error('Mineradio 本机请求已超时'));
      }, timeout);
      replies.set(id, { resolve, reject, timer });
      try {
        window.ipc.postMessage(JSON.stringify({ id, method, args }));
      } catch (error) {
        clearTimeout(timer);
        replies.delete(id);
        reject(error);
      }
    });
  }

  Object.defineProperty(window, '__mineradioDesktopReply', {
    value: function (id, result, error) {
      const pending = replies.get(id);
      if (!pending) return;
      replies.delete(id);
      clearTimeout(pending.timer);
      if (error) pending.reject(new Error(error));
      else pending.resolve(result);
    }
  });
  Object.defineProperty(window, '__mineradioDesktopState', {
    value: function (state) { listeners.forEach(callback => callback(state)); },
  });
  Object.defineProperty(window, '__mineradioUpdateState', {
    value: function (state) { updateListeners.forEach(callback => callback(state)); },
  });
  Object.defineProperty(window, '__mineradioDesktopEvent', {
    value: function (event, payload) { desktopEvents.get(event)?.forEach(callback => callback(payload)); },
  });
  function subscribe(event, callback) {
    if (typeof callback !== 'function') return () => {};
    if (!desktopEvents.has(event)) desktopEvents.set(event, new Set());
    const handlers = desktopEvents.get(event);
    handlers.add(callback);
    return () => handlers.delete(callback);
  }
  async function library(method, ...args) {
    const response = await fetch('/api/native/library', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, args }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || '本机曲库暂不可用');
    return result;
  }
  async function prepareWallpaperGlass(options) {
    const session = String(options?.sessionId || '');
    if (!/^[a-f0-9]{24}$/i.test(session)) throw new Error('WALLPAPER_ENGINE_SESSION_INVALID');
    const prepared = await invoke('wallpaperGlassPrepare', options);
    if (!prepared?.ok) return prepared;
    const url = '/api/native/wallpaper/glass/' + session;
    let after = 0;
    async function nextFrame() {
      const response = await fetch(url + '?after=' + after, { cache: 'no-store', signal: AbortSignal.timeout(3000) });
      if (response.status === 204) return null;
      if (!response.ok) throw new Error('WALLPAPER_GLASS_CAPTURE_UNAVAILABLE');
      after = Number(response.headers.get('X-Mineradio-Frame')) || after;
      return createImageBitmap(await response.blob());
    }
    let initial = null;
    const deadline = performance.now() + 4400;
    while (!initial && performance.now() < deadline) initial = await nextFrame();
    if (!initial) throw new Error('WALLPAPER_GLASS_CAPTURE_FIRST_FRAME_TIMEOUT');
    const canvas = document.createElement('canvas');
    canvas.width = initial.width;
    canvas.height = initial.height;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      initial.close();
      throw new Error('WALLPAPER_GLASS_CAPTURE_UNAVAILABLE');
    }
    const stream = canvas.captureStream(0);
    const track = stream.getVideoTracks()[0];
    function draw(bitmap) {
      try {
        if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
        }
        ctx.drawImage(bitmap, 0, 0);
        track.requestFrame();
      } finally { bitmap.close(); }
    }
    try {
      if (!track || typeof track.requestFrame !== 'function' || typeof storeWallpaperEnginePreparedGlassCaptureStream !== 'function') {
        initial.close();
        throw new Error('WALLPAPER_GLASS_CAPTURE_UNAVAILABLE');
      }
      draw(initial);
      storeWallpaperEnginePreparedGlassCaptureStream(session, stream);
    } catch (error) {
      track?.stop();
      throw error;
    }
    void (async function pump() {
      try {
        while (track.readyState === 'live') {
          const frame = await nextFrame();
          if (!frame) continue;
          if (track.readyState === 'live') draw(frame);
          else frame.close();
        }
      } catch (_) {
        if (track.readyState === 'live') {
          track.stop();
          track.dispatchEvent(new Event('ended'));
        }
      }
    })();
    return prepared;
  }
  function readVisualSettings() {
    const request = new XMLHttpRequest();
    request.open('GET', '/api/native/fx-autosave', false);
    request.send();
    return request.status === 200 ? JSON.parse(request.responseText) : { ok: false };
  }
  async function wallpaperAppearance(options) {
    try {
      const applied = await invoke('wallpaperAppearance', options || {});
      if (!applied?.ok || applied.sessionId !== window.wallpaperEngineNativeSessionId) return applied;
      const video = document.getElementById('wallpaper-engine-glass-sampler-video');
      if (video) {
        video.parentElement.style.backgroundColor = '#000';
        video.style.opacity = String(applied.opacity);
        video.style.transformOrigin = '0 0';
        video.style.transform = 'translate(' + (100 * applied.left) + 'vw,' + (100 * applied.top) + 'vh) scale(' + applied.scale + ')';
      }
      return applied;
    } catch (_) { return null; }
  }
  async function saveVisualSettings(payload) {
    const response = await fetch('/api/native/fx-autosave', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return response.json();
  }
  async function nativeFetch(path, options) {
    const response = await fetch('/api/native/' + path, options);
    return response.json();
  }
  function binary(path, content) {
    return nativeFetch(path, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: content,
    });
  }
  async function saveExport(name, bytes, jsonFile) {
    const chosen = await invoke('chooseExport', name, !!jsonFile);
    return chosen && chosen.ok && chosen.token ? binary('export/' + chosen.token, bytes) : chosen;
  }
  let slideVersion = null;
  async function listSlides() {
    const result = await nativeFetch('slides');
    if (result.ok) slideVersion = JSON.stringify(result.images.map(item => item.url));
    return result;
  }
  function watchSlides(callback) {
    if (typeof callback !== 'function') return function () {};
    let active = true;
    const timer = setInterval(async () => {
      if (document.hidden) return;
      try {
        const previous = slideVersion;
        await listSlides();
        if (active && previous !== slideVersion) callback();
      } catch (_) {}
    }, 4000);
    return () => { active = false; clearInterval(timer); };
  }
  async function exportVideo(payload) {
    const { audio, video, ...config } = payload || {};
    if (!audio?.byteLength) return { ok: false, error: '音频文件为空' };
    const reservation = await invoke('chooseVideo', config.name);
    if (!reservation?.ok || !reservation.jobId) return reservation;
    const prefix = 'video-export/' + reservation.jobId + '/';
    try {
      const documents = [
        binary(prefix + 'audio', audio),
        binary(prefix + 'config', new TextEncoder().encode(JSON.stringify(config))),
      ];
      if (video?.byteLength) documents.push(binary(prefix + 'video', video));
      const results = await Promise.all(documents);
      if (results.some(result => !result?.ok)) throw new Error('视频素材保存失败');
      return await invoke('videoStart', reservation.jobId);
    } catch (error) {
      await invoke('videoCancel').catch(() => {});
      return { ok: false, error: error.message || '无法开始导出视频' };
    }
  }
  function watchVideo(callback) {
    if (typeof callback !== 'function') return function () {};
    let active = true, polling = false, previous = '';
    const timer = setInterval(async () => {
      if (polling) return;
      polling = true;
      try {
        const result = await invoke('videoState');
        const value = JSON.stringify(result);
        if (active && value !== previous) callback(result);
        previous = value;
      } catch (_) {} finally { polling = false; }
    }, 400);
    return () => { active = false; clearInterval(timer); };
  }
  const desktop = Object.freeze({
    isDesktop: true,
    prepareStartupSplash: true,
    getUpdateState: () => invoke('updateState'),
    checkForUpdates: () => invoke('updateCheck'),
    downloadUpdate: () => invoke('updateDownload'),
    onUpdateState: function (callback) {
      if (typeof callback !== 'function') return function () {};
      updateListeners.add(callback);
      return () => updateListeners.delete(callback);
    },
    defaultCloseBehavior: 'tray',
    minimize: () => invoke('minimize'),
    restore: () => invoke('restore'),
    toggleMaximize: () => invoke('toggleMaximize'),
    toggleFullscreen: () => invoke('toggleFullscreen'),
    exitFullscreenWindowed: () => invoke('exitFullscreenWindowed'),
    getState: () => invoke('state'),
    close: behavior => invoke('close', behavior),
    getCloseBehavior: () => invoke('getCloseBehavior'),
    setCloseBehavior: behavior => invoke('setCloseBehavior', behavior),
    getDesktopPreferences: () => invoke('preferences'),
    setStartAtLogin: enabled => invoke('setStartup', !!enabled),
    getCacheSettings: () => nativeFetch('cache'),
    chooseCacheDirectory: () => invoke('chooseCache'),
    setCacheSettings: async settings => {
      await invoke('setCache', settings?.rootPath);
      return nativeFetch('cache');
    },
    restartApp: () => invoke('restartApp'),
    getGpuDiagnostics: async () => {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2');
      if (!gl) return { status: { webgl2: 'unavailable' } };
      const adapter = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = adapter ? gl.getParameter(adapter.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      const vendor = adapter ? gl.getParameter(adapter.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return { status: { webgl2: 'available' }, basicInfo: { renderer, vendor } };
    },
    getMemorySnapshot: () => invoke('memorySnapshot'),
    configureMemoryReduct: options => invoke('memoryConfigure', options || {}),
    trimAppMemory: options => invoke('memoryTrim', options || {}),
    purgeSystemMemory: options => invoke('memoryPurge', options || {}),
    manualMemoryPurgeMinimizes: true,
    openUpdatePage: url => invoke('openUpdatePage', String(url || '')),
    configureGlobalHotkeys: bindings => invoke('configureHotkeys', bindings || []),
    onGlobalHotkey: callback => subscribe('hotkey', callback),
    setDesktopLyricsEnabled: (enabled, payload) => invoke('lyricsEnabled', !!enabled, payload || {}),
    updateDesktopLyrics: payload => invoke('lyricsUpdate', payload || {}),
    onDesktopLyricsLockState: callback => subscribe('lyricsLock', callback),
    onDesktopLyricsEnabledState: callback => subscribe('lyricsEnabled', callback),
    copyText: text => navigator.clipboard.writeText(String(text || '')).then(() => ({ ok: true })),
    readText: () => navigator.clipboard.readText().then(text => ({ ok: true, text })),
    exportJsonFile: payload => {
      const rawName = String(payload?.defaultName || 'mineradio-export.json');
      const name = /\.json$/i.test(rawName) ? rawName : rawName + '.json';
      const content = typeof payload?.text === 'string' ? payload.text : JSON.stringify(payload?.data || {}, null, 2);
      return saveExport(name, new TextEncoder().encode(content), true);
    },
    saveExportFile: payload => saveExport(String(payload?.name || 'Mineradio-export'), payload?.bytes, false),
    exportVisualVideo: exportVideo,
    getVisualVideoExportState: () => invoke('videoState'),
    cancelVisualVideoExport: () => invoke('videoCancel'),
    onVisualVideoExportState: watchVideo,
    importJsonFile: () => invoke('importJson'),
    listSlideshowImages: listSlides,
    addSlideshowImage: payload => binary('slides?name=' + encodeURIComponent(payload?.name || ''), payload?.bytes),
    openSlideshowFolder: () => invoke('openSlides'),
    onSlideshowChanged: watchSlides,
    wallpaperEngineHttpMedia: true,
    listWallpaperEngineProjects: options => nativeFetch('wallpaper/list' + (options?.force ? '?force=1' : '')),
    getWallpaperEngineProjectDetails: id => nativeFetch('wallpaper/details/' + encodeURIComponent(id)),
    openWallpaperEngineProjectDetails: (id, target) => invoke('openWallpaperDetails', id, target),
    chooseWallpaperEngineDirectory: () => invoke('chooseWallpaperDirectory'),
    chooseWallpaperEngineProjectFile: () => invoke('chooseWallpaperFile'),
    removeWallpaperEngineDirectory: id => invoke('removeWallpaperDirectory', id),
    getWallpaperEngineRuntimeStatus: () => invoke('wallpaperRuntimeStatus'),
    startWallpaperEngineScene: options => invoke('startWallpaperScene', options || {}),
    reportWallpaperEngineCaptureResult: options => invoke('wallpaperCaptureResult', options || {}),
    activateWallpaperEngineDwmSurface: options => invoke('wallpaperActivate', options || {}),
    prepareWallpaperEngineGlassCapture: prepareWallpaperGlass,
    updateWallpaperEngineGlassSurface: options => { void invoke('wallpaperGlassVisibility', options || {}).catch(() => {}); },
    updateWallpaperEngineVisualSettings: wallpaperAppearance,
    stopWallpaperEngineScene: options => invoke('stopWallpaperScene', options || {}),
    onWallpaperEngineHostBoundsChanged: callback => subscribe('wallpaperBounds', callback),
    listLocalMusicLibrary: () => library('listLocalMusicLibrary'),
    readLocalMusicLyric: id => library('readLocalMusicLyric', id),
    listBuiltInPlaylists: () => library('listBuiltInPlaylists'),
    readBuiltInPlaylist: (id, options) => library('readBuiltInPlaylist', id, options || {}),
    createBuiltInPlaylist: name => library('createBuiltInPlaylist', name),
    renameBuiltInPlaylist: (id, name) => library('renameBuiltInPlaylist', id, name),
    deleteBuiltInPlaylist: id => library('deleteBuiltInPlaylist', id),
    addBuiltInPlaylistTrack: (id, track) => library('addBuiltInPlaylistTrack', id, track),
    removeBuiltInPlaylistTrack: (id, index) => library('removeBuiltInPlaylistTrack', id, index),
    reorderBuiltInPlaylistTrack: (id, from, to) => library('reorderBuiltInPlaylistTrack', id, from, to),
    readLyricCache: key => library('readLyricCache', key),
    writeLyricCache: (key, payload) => library('writeLyricCache', key, payload),
    readCurrentFxAutosaveSync: readVisualSettings,
    saveCurrentFxAutosave: saveVisualSettings,
    onStateChange: function (callback) {
      if (typeof callback !== 'function') return function () {};
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  });
  Object.defineProperty(window, 'desktopWindow', { value: desktop });

  document.addEventListener('DOMContentLoaded', function () {
    document.documentElement.classList.add('desktop-shell-root');
    document.body.classList.add('desktop-shell');
    document.getElementById('splash')?.classList.add('preparing');
    invoke('ready').catch(function () {});
  });
  document.addEventListener('pointerdown', function (event) {
    if (!event.isPrimary || event.button !== 0 || !document.body?.matches(
      '.desktop-shell:not(.desktop-maximized, .desktop-fullscreen)'
    ) || document.fullscreenElement) return;
    // WebView2 fills the native window, including the visible resize edges.
    const inset = 6;
    const vertical = event.clientY < inset ? 'n' : event.clientY >= window.innerHeight - inset ? 's' : '';
    const horizontal = event.clientX < inset ? 'w' : event.clientX >= window.innerWidth - inset ? 'e' : '';
    if (!vertical && !horizontal) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void invoke('resizeWindow', vertical + horizontal).catch(() => {});
  }, true);
  document.addEventListener('pointerdown', function (event) {
    if (event.button === 0 && event.target instanceof Element && event.target.closest('.desktop-drag-region')) {
      invoke('dragWindow').catch(function () {});
    }
  });
})();

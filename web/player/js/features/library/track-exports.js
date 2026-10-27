'use strict';

// Track recipes are independent of accounts and audio bytes. Only explicit
// bindings are written; exporting never changes playback or another track.
(function () {
  var opening, menu, menuElement, mobilePreset;
  var MAX_PRESET = 128 * 1024 * 1024;
  function key(song) {
    if (song.localFileId) return 'local:' + song.localFileId;
    return String(song.originProvider || song.provider || song.source || 'netease') + ':'
      + String(song.originId || song.mid || song.songmid || song.hash || song.providerSongId || song.id || '');
  }
  function db() {
    if (!opening) opening = new Promise(function (resolve, reject) {
      var request = indexedDB.open('mineradio-track-presets-v1', 1);
      request.onupgradeneeded = function () { request.result.createObjectStore('presets'); };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    }).catch(function (error) { opening = null; throw error; });
    return opening;
  }
  async function recipe(song, value) {
    if (value) value = canonical(value);
    var database = await db();
    return new Promise(function (resolve, reject) {
      var tx = database.transaction('presets', value ? 'readwrite' : 'readonly');
      var request = value ? tx.objectStore('presets').put(value, key(song)) : tx.objectStore('presets').get(key(song));
      var result;
      request.onsuccess = function () { result = request.result; };
      tx.oncomplete = function () { resolve(value || result || null); };
      tx.onerror = tx.onabort = function () { reject(tx.error || new Error('预设保存失败')); };
    });
  }
  function filename(song, extension) {
    return String(song.name || song.title || 'Mineradio').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 100)
      + String(extension || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_');
  }
  async function save(blob, name) {
    if (window.desktopWindow && typeof desktopWindow.saveExportFile === 'function') {
      var result = await desktopWindow.saveExportFile({name:name, bytes:new Uint8Array(await blob.arrayBuffer())});
      if (!result || !result.ok) { if (result && result.canceled) return false; throw new Error('文件保存失败'); }
      return true;
    }
    var url = URL.createObjectURL(blob), anchor = document.createElement('a');
    if (window.__mineradioAndroid && typeof window.mineradioAndroidSaveBlob === 'function') {
      try {
        if (!await mineradioAndroidSaveBlob(url, name)) throw new Error('文件导出失败，请重试');
        return 'picker';
      } finally { URL.revokeObjectURL(url); }
    }
    anchor.href = url; anchor.download = name; anchor.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    return true;
  }
  function dataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader(); reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error); }; reader.readAsDataURL(blob);
    });
  }
  async function capture() {
    if (mobilePreset && window.mineradioSimplePlayer && mineradioSimplePlayer.active()) return canonical(mobilePreset);
    var snapshot = captureFxArchiveSnapshot();
    if (window.mineradioMV && mineradioMV.selected()) snapshot.preset = 13;
    if (window.mineradioSlideshow && mineradioSlideshow.selected()) snapshot.preset = 14;
    var value = {type:'mineradio-track-preset', schema:USER_FX_ARCHIVE_SCHEMA, exportedAt:Date.now(),
      name:presetMeta[snapshot.preset].name, snapshot:snapshot, resources:{}};
    var font = customLyricFontRecordForKey(snapshot.lyricFont);
    if (font) value.resources.font = normalizeCustomLyricFontRecord(font);
    if (typeof wallpaperEngineSelection !== 'undefined' && wallpaperEngineSelection.active)
      value.resources.externalProject = normalizeWallpaperEngineSelection(wallpaperEngineSelection);
    if (snapshot.preset === 13 && window.mineradioMV) {
      value.resources.mvFallback = mineradioMV.fallback();
      value.resources.mvEndMode = localStorage.getItem('mineradio-mv-end-mode') === 'loop' ? 'loop' : 'fallback';
    }
    var media = typeof customBackgroundActiveMedia === 'function' ? customBackgroundActiveMedia() : null;
    if (media && media.id && typeof getCustomBackgroundBlob === 'function') {
      var blob = await getCustomBackgroundBlob(media.id);
      if (blob) {
        if (blob.size > MAX_PRESET / 2) throw new Error('自定义背景过大，请先选择较小的背景再保存预设');
        value.resources.background = {name:media.name || 'background', data:await dataUrl(blob)};
      }
    } else if (fx.backgroundImage && /^(data:|blob:)/.test(fx.backgroundImage)) {
      var image = await (await fetch(fx.backgroundImage)).blob();
      if (image.size > MAX_PRESET / 2) throw new Error('背景图片过大');
      value.resources.background = {name:'background.png', data:await dataUrl(image)};
    }
    if (snapshot.preset === 14 && window.mineradioSlideshow && mineradioSlideshow.exportImages) {
      var images = await mineradioSlideshow.exportImages();
      var size = images.reduce(function (total, file) { return total + file.size; }, 0);
      if (size > MAX_PRESET / 2) throw new Error('幻灯片素材超过预设文件大小限制');
      value.resources.slides = await Promise.all(images.map(async function (file, index) {
        return {name:file.name || 'image-' + index, data:await dataUrl(file)};
      }));
      value.resources.slideSeconds = mineradioSlideshow.intervalSeconds();
    }
    return value;
  }
  function resourceFile(resource) {
    if (!resource || typeof resource.data !== 'string' || resource.data.length > MAX_PRESET
        || !/^data:(image\/(png|jpeg|webp|gif)|video\/(mp4|webm));base64,/i.test(resource.data))
      throw new Error('预设素材格式无效');
    var split = resource.data.indexOf(','), mime = resource.data.slice(5, resource.data.indexOf(';'));
    var raw = atob(resource.data.slice(split + 1)), bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return new File([bytes], String(resource.name || 'preset-asset').replace(/[\\/]/g, '_'), {type:mime});
  }
  async function forSong(song) {
    var value = await capture();
    var src = typeof songCoverSrc === 'function' ? songCoverSrc(song,600) : song.cover;
    if (src) try {
      if (!/^(data:|blob:|mineradio-local:|\/)/.test(src)) src = '/api/cover?url=' + encodeURIComponent(src);
      var response = await fetch(src, {signal:AbortSignal.timeout(20000)}), blob = await response.blob();
      if (response.ok && blob.size <= 8*1024*1024 && /^image\/(png|jpeg|webp|gif)$/.test(blob.type))
        value.resources.cover = {name:'cover',data:await dataUrl(blob)};
    } catch (_) {}
    return value;
  }
  function normalize(value) {
    if (!value || !['mineradio-track-preset','mineradio-user-fx-archive'].includes(value.type) || value.schema !== USER_FX_ARCHIVE_SCHEMA)
      throw new Error('这不是支持的 Mineradio 预设文件');
    var snapshot = normalizeFxArchiveSnapshot(value.snapshot);
    if (!snapshot || !Number.isInteger(snapshot.preset)) throw new Error('预设参数无效');
    var resources = value.resources || {};
    var font = resources.font ? normalizeCustomLyricFontRecord(resources.font) : null;
    if (resources.font && (!font || font.dataUrl.length > 5 * 1024 * 1024 || !/^data:[^;,]+;base64,[A-Za-z0-9+/=]+$/.test(font.dataUrl))) throw new Error('预设字体无效或过大');
    if (font) font.family = 'MineradioCustomLyricFont-' + font.id;
    if (font && customLyricFontIdFromKey(value.snapshot.lyricFont) === font.id) snapshot.lyricFont = customLyricFontKey(font.id);
    var background = resources.background ? resourceFile(resources.background) : null;
    var cover = resources.cover ? resourceFile(resources.cover) : null;
    if (cover && (!cover.type.startsWith('image/') || cover.size > 8*1024*1024)) throw new Error('预设封面无效或过大');
    var slides = Array.isArray(resources.slides) ? resources.slides.slice(0, 200).map(resourceFile) : [];
    if (slides.length !== (resources.slides || []).length) throw new Error('幻灯片素材数量过多');
    return {snapshot:snapshot, background:background, slides:slides, font:font, cover:cover,
      externalProject:resources.externalProject ? normalizeWallpaperEngineSelection(resources.externalProject) : null,
      slideSeconds:Math.max(2, Math.min(3600, Number(resources.slideSeconds) || 8))};
  }
  function canonical(value) {
    var data = normalize(value), source = value.resources || {}, resources = {};
    if (data.background) resources.background = {name:data.background.name, data:source.background.data};
    if (data.cover) resources.cover = {name:data.cover.name,data:source.cover.data};
    if (data.slides.length) resources.slides = source.slides.map(function (entry, i) { return {name:data.slides[i].name, data:entry.data}; });
    resources.slideSeconds = data.slideSeconds;
    resources.mvFallback = Math.max(0, Math.min(12, Number(source.mvFallback) || 0));
    resources.mvEndMode = source.mvEndMode === 'loop' ? 'loop' : 'fallback';
    if (data.font) resources.font = data.font;
    if (data.externalProject && data.externalProject.active) resources.externalProject = data.externalProject;
    var clean = {type:'mineradio-track-preset',schema:USER_FX_ARCHIVE_SCHEMA,
      name:String(value.name || presetMeta[data.snapshot.preset].name).slice(0,80),
      exportedAt:Number(value.exportedAt)||Date.now(),snapshot:data.snapshot,resources:resources};
    if (new Blob([JSON.stringify(clean)]).size > MAX_PRESET) throw new Error('预设素材总大小超过限制，请减少背景或幻灯片素材');
    return clean;
  }
  async function apply(value) {
    var data = normalize(value);
    if (data.externalProject && data.externalProject.active) {
      if (!wallpaperEngineDesktopApi()) throw new Error('此预设依赖外部 Wallpaper Engine 项目，当前设备未配置');
      await loadWallpaperEngineLibrary(false, false);
      if (!wallpaperEngineProjectById(data.externalProject.id)) throw new Error('请先在此电脑中导入预设所需的 Wallpaper Engine 项目');
    }
    if (data.font) {
      if (!await registerCustomLyricFont(data.font)) throw new Error('预设字体无法加载');
      customLyricFonts = [data.font].concat(customLyricFonts.filter(function (entry) { return entry.id !== data.font.id; })).slice(0,CUSTOM_LYRIC_FONT_MAX_COUNT);
      saveCustomLyricFonts();
    }
    if (window.mineradioSimplePlayer && mineradioSimplePlayer.active()) {
      Object.keys(data.snapshot).forEach(function (key) { if (key !== 'wallpaperMode' && key !== 'desktopLyrics') fx[key] = data.snapshot[key]; });
      mobilePreset = canonical(value);
      saveLyricLayout({user:true,reason:'track-preset'});
      return true;
    }
    if (data.background) await readBackgroundMediaFile(data.background);
    if (data.slides.length && window.mineradioSlideshow) {
      await mineradioSlideshow.useRecipe(data.slides, data.slideSeconds);
    }
    if (data.snapshot.preset === 13 && window.mineradioMV && value.resources) {
      mineradioMV.setFallback(Math.max(0,Math.min(12,Number(value.resources.mvFallback)||0)));
      mineradioMV.setEndMode(value.resources.mvEndMode);
    }
    if (!applyFxArchiveSnapshot(data.snapshot)) throw new Error('无法应用此预设');
    if (data.externalProject && data.externalProject.active) {
      wallpaperEngineSelection = data.externalProject;
      activateWallpaperEngineItem(data.externalProject.id);
    }
    return true;
  }
  async function lyric(song) {
    if (song.localFileId) {
      var stored = await browserLocalMusic.readLocalMusicLyric(song.localFileId);
      if (!stored.ok || !stored.lyric) throw new Error('这首本地歌曲没有已保存的歌词');
      return stored.lyric;
    }
    if (typeof song.lyric === 'string' && song.lyric.trim()) return song.lyric;
    var p = normalizePlaybackProvider(songProviderKey(song));
    var id = song.mid || song.songmid || song.hash || song.providerSongId || song.id;
    var response = await apiJson('/api/' + (p === 'netease' ? '' : p + '/') + 'lyric?id=' + encodeURIComponent(id));
    var text = response && (response.lyric || response.lrc && response.lrc.lyric);
    if (typeof text !== 'string' || !text.trim()) throw new Error('这首歌曲暂无可下载歌词');
    return text;
  }
  async function audioFile(song, quality, signal) {
    if (song.localFileId) return browserLocalMusic.readLocalMusicFile(song.localFileId);
    var p = normalizePlaybackProvider(songProviderKey(song));
    var id = song.mid || song.songmid || song.hash || song.providerSongId || song.id;
    var url = '/api/download?provider=' + encodeURIComponent(p) + '&id=' + encodeURIComponent(id) + '&quality=' + encodeURIComponent(quality || 'auto');
    var limit = AbortSignal.timeout(180000);
    var combined = signal && typeof AbortSignal.any === 'function' ? AbortSignal.any([signal,limit]) : signal || limit;
    var response = await fetch(url, {headers:window.localMusicCredentials ? localMusicCredentials.headers(url) : {}, signal:combined});
    if (!response.ok || response.status === 206 || /json/i.test(response.headers.get('content-type') || ''))
      throw new Error('当前音源无法完整下载，请先保存可下载的音频到本机');
    var blob = await response.blob();
    if (!blob.size || blob.size > 512 * 1024 * 1024) throw new Error('音频为空或超出导出大小限制');
    return {blob:blob, name:filename(song, '.audio')};
  }
  function perform(action) { return Promise.resolve().then(action).catch(function (error) { showToast(error.message || '导出失败，请重试'); }); }
  async function exportAudio(song) {
    var file = await audioFile(song);
    var result = await save(file.blob, file.name);
    if (result) showToast(result === 'picker' ? '请选择音频保存位置' : '已导出音频文件');
  }
  async function exportLyric(song) {
    var result = await save(new Blob(['\ufeff' + await lyric(song)], {type:'text/plain;charset=utf-8'}), filename(song, '.lrc'));
    if (result) showToast(result === 'picker' ? '请选择歌词保存位置' : '已导出歌词');
  }
  async function exportPreset(song, value) {
    value = value || await recipe(song);
    if (!value) throw new Error('这首歌尚未保存预设，请先选择“保存当前预设”');
    value = canonical(value);
    var result = await save(new Blob([JSON.stringify(value, null, 2)], {type:'application/json'}), filename(song, ' - ' + value.name + '.json'));
    if (result) showToast(result === 'picker' ? '请选择预设保存位置' : '已导出可重新加载的预设');
  }
  function importPreset(song) {
    var input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json';
    input.onchange = function () { perform(async function () {
      var file = input.files[0]; if (!file) return;
      if (file.size > MAX_PRESET) throw new Error('预设文件过大');
      var value = JSON.parse(await file.text()); normalize(value); await recipe(song, value);
      showToast('已导入此曲预设，选择“加载此曲预设”即可应用');
    }); }; input.click();
  }
  function presetMenu(song, event) {
    if (!menu) {
      menuElement = document.createElement('div'); menuElement.className = 'web-anchored-menu control-source-switcher'; menuElement.hidden = true;
      menuElement.setAttribute('role', 'menu'); document.body.append(menuElement);
      menu = webAnchoredMenus.create({element:menuElement});
    }
    menuElement.replaceChildren();
    [['保存当前预设到此曲', async function () { await recipe(song, await forSong(song)); showToast('已保存当前预设到此曲'); }],
     ['下载此曲预设', function () { return exportPreset(song); }],
     ['加载此曲预设', async function () { var value = await recipe(song); if (!value) throw new Error('这首歌还没有预设'); await apply(value); showToast('已加载此曲预设'); }],
     ['导入预设文件到此曲', function () { importPreset(song); }]].forEach(function (entry) {
      var button = document.createElement('button'); button.type = 'button'; button.className = 'web-download-option';
      button.textContent = entry[0]; button.onclick = function () { menu.close('select'); perform(entry[1]); }; menuElement.append(button);
    });
    menu.open(event.currentTarget);
  }
  function row(song) {
    var wrapper = document.createElement('div'); wrapper.className = 'web-local-export-row';
    var title = document.createElement('strong'); title.textContent = song.name || '本地歌曲'; wrapper.append(title);
    var actions = document.createElement('div'); actions.className = 'web-local-export-actions';
    [['音频', function () { perform(function () { return exportAudio(song); }); }],
     ['歌词', function () { perform(function () { return exportLyric(song); }); }],
     ['预设', function (event) { presetMenu(song, event); }]].forEach(function (entry) {
      var button = document.createElement('button'); button.type = 'button'; button.className = 'fx-mini-btn ghost';
      button.textContent = entry[0]; button.onclick = entry[1]; actions.append(button);
    });
    if (window.desktopWindow && typeof desktopWindow.exportVisualVideo === 'function') {
      var video = document.createElement('button'); video.type = 'button'; video.className = 'fx-mini-btn ghost'; video.textContent = '导出视频';
      video.onclick = function () { perform(function () { return videoDialog(song); }); }; actions.append(video);
    }
    wrapper.append(actions); return wrapper;
  }
  // The Windows video module supplies the isolated render/encode workflow.
  function videoDialog(song) {
    if (!window.mineradioVideoExport) throw new Error('当前设备不支持视频导出');
    return mineradioVideoExport.open(song);
  }
  window.mineradioTrackExports = {capture:capture, forSong:forSong, normalize:normalize, apply:apply, recipe:recipe, save:save,
    audioFile:audioFile, lyric:lyric, exportAudio:exportAudio, exportLyric:exportLyric, exportPreset:exportPreset,
    createLibraryRow:row, video:videoDialog, perform:perform, filename:filename};
})();

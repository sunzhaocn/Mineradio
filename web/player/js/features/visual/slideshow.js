'use strict';
(function () {
  var opening, keys = [], selected = false, layer, images, urls = ['', ''], slot = 0;
  var cursor = 0, generation = 0, clock = 0, nextAt = 0, busy = null, imported = false;
  var suspended = document.hidden || !document.hasFocus(), pageHidden = false, displayedSource = '';
  var interval = 8000, importTask = Promise.resolve(), nativeFiles = [], refreshing;
  var recipeFiles = null;
  var native = window.desktopWindow && typeof desktopWindow.listSlideshowImages === 'function' ? desktopWindow : null;
  var previousPreset = 0;
  try { previousPreset = Math.max(0, Math.min(13, Number(localStorage.getItem('mineradio-slideshow-previous')) || 0)); } catch (_) {}
  try { interval = Math.max(2, Number(localStorage.getItem('mineradio-slideshow-seconds')) || 8) * 1000; } catch (_) {}
  function db() {
    if (!opening) opening = new Promise(function (resolve, reject) {
      var req = indexedDB.open('mineradio-slideshow-v1', 1);
      req.onupgradeneeded = function () { req.result.createObjectStore('images', { autoIncrement: true }); };
      req.onsuccess = function () { req.result.onversionchange = function () { req.result.close(); opening = null; }; resolve(req.result); };
      req.onerror = req.onblocked = function () { reject(req.error || new Error('幻灯片存储不可用')); };
    }).catch(function (e) { opening = null; throw e; });
    return opening;
  }
  async function operation(mode, action) {
    var database = await db();
    return new Promise(function (resolve, reject) {
      var tx = database.transaction('images', mode), request = action(tx.objectStore('images')), result;
      if (request) request.onsuccess = function () { result = request.result; };
      tx.oncomplete = function () { resolve(result); };
      tx.onerror = tx.onabort = function () { reject(tx.error); };
    });
  }
  function status() {
    var caption = document.getElementById('slideshow-count'); if (caption) caption.textContent = keys.length + ' 张图片';
    var row = document.getElementById('slideshow-settings'); if (row) row.hidden = !(selected || imported);
  }
  function restorePrevious() {
    if (!selected) return;
    select(false);
    if (typeof setPreset === 'function') setPreset(previousPreset, { silent: true });
  }
  function refresh() {
    if (recipeFiles) { keys = recipeFiles.map(function (_, i) { return i; }); status(); return Promise.resolve(); }
    if (refreshing) return refreshing;
    refreshing = (async function () {
      if (native) {
        var result = await native.listSlideshowImages();
        // A temporarily unavailable folder must not discard the last valid list.
        if (!result || !result.ok) return;
        nativeFiles = result.images || []; keys = nativeFiles.map(function (item) { return item.id; });
      } else keys = await operation('readonly', function (store) { return store.getAllKeys(); });
      if (!keys.length) restorePrevious();
      cursor %= Math.max(1, keys.length); status();
    }()).catch(function () {}).finally(function () { refreshing = null; });
    return refreshing;
  }
  function create() {
    if (layer) return;
    layer = document.createElement('div'); layer.id = 'slideshow-layer'; layer.setAttribute('aria-hidden', 'true');
    images = [document.createElement('img'), document.createElement('img')];
    images.forEach(function (img) { img.alt = ''; img.decoding = 'async'; layer.append(img); });
    (document.getElementById('desktop-window-shell') || document.body).prepend(layer);
  }
  async function advance() {
    if (!keys.length || busy || !selected || suspended || pageHidden || document.hidden) return;
    create(); var task = {}, owner = generation, target = 1 - slot; busy = task;
    try {
      var index = cursor % keys.length;
      var file = recipeFiles ? recipeFiles[index] : native ? nativeFiles[index] : await operation('readonly', function (store) { return store.get(keys[index]); });
      if (owner !== generation || !selected || !file) return;
      var nativeSource = native && !recipeFiles;
      var src = nativeSource ? file.url : URL.createObjectURL(file);
      if (urls[target]) URL.revokeObjectURL(urls[target]);
      urls[target] = nativeSource ? '' : src; images[target].src = src;
      await images[target].decode();
      if (owner !== generation || !selected) return;
      images[slot].classList.remove('visible'); images[target].classList.add('visible'); slot = target;
      displayedSource = src; cursor = (index + 1) % Math.max(1, keys.length);
      nextAt = performance.now() + interval;
    } catch (_) { if (owner === generation && selected) { nextAt = performance.now() + 2000; refresh(); } }
    finally { if (busy === task) busy = null; }
  }
  function tick() {
    if (!selected || suspended || pageHidden || document.hidden || document.body.classList.contains('empty-home-active')) return;
    var audio = window.audio;
    if (audio && !audio.paused && !audio.ended && performance.now() >= nextAt) advance();
  }
  function suspend() {
    suspended = true; generation++; busy = null;
    clearInterval(clock); clock = 0;
  }
  function resume() {
    if (pageHidden || document.hidden || !document.hasFocus()) return;
    if (!suspended && clock) return;
    suspended = false;
    if (!selected) return;
    // Discard time spent outside the window instead of replaying overdue work.
    nextAt = performance.now() + interval;
    if (!displayedSource) advance();
    clearInterval(clock); clock = setInterval(tick, 500);
  }
  function select(value, prior) {
    if (!value) imported = false;
    if (selected === !!value && !value) { status(); return true; }
    if (value && !keys.length) {
      imported = true; status();
      if (typeof showToast === 'function') showToast('请先添加图片，再应用幻灯片');
      return false;
    }
    if (value && !selected && Number.isInteger(prior) && prior >= 0 && prior < 14) {
      previousPreset = prior;
      try { localStorage.setItem('mineradio-slideshow-previous', String(prior)); } catch (_) {}
    }
    selected = !!value; generation++; busy = null;
    clearInterval(clock); clock = 0;
    document.body.classList.toggle('slideshow-selected', selected);
    if (selected) { create(); nextAt = performance.now() + interval; advance(); if (!suspended && !pageHidden) clock = setInterval(tick, 500); }
    else {
      displayedSource = '';
      if (layer) images.forEach(function (img) { img.classList.remove('visible'); });
      // Fade out before releasing both decoders and object URLs.
      var owner = generation;
      setTimeout(function () {
        if (owner !== generation || selected) return;
        urls.forEach(function (url, i) { if (url) URL.revokeObjectURL(url); urls[i] = ''; if (images) images[i].removeAttribute('src'); });
      }, 500);
    }
    try { localStorage.setItem('mineradio-slideshow-selected', selected ? '1' : '0'); } catch (_) {}
    status(); return true;
  }
  async function importImages(files) {
    var added = 0;
    for (var file of files) {
      if (!/^image\//.test(file.type) && !/\.(png|jpe?g|webp|gif|avif|bmp)$/i.test(file.name || '')) continue;
      // Decode one image at a time. Invalid files never become slide entries.
      var src = URL.createObjectURL(file), probe = new Image(); probe.src = src;
      try {
        await probe.decode();
        if (native) {
          var result = await native.addSlideshowImage({ name: file.name || '图片.png', bytes: await file.arrayBuffer() });
          if (!result || !result.ok) continue;
        } else {
          var key = await operation('readwrite', function (store) { return store.add(file); }); keys.push(key);
        }
        added++;
      } catch (_) {} finally { probe.removeAttribute('src'); URL.revokeObjectURL(src); }
    }
    if (added && recipeFiles) { recipeFiles = null; generation++; busy = null; }
    if (native || added) await refresh();
    imported = true; status();
    if (typeof showToast === 'function') showToast('已添加 ' + added + ' 张图片，非图片文件已跳过');
    if (added && typeof setPreset === 'function') setPreset(14);
    return added;
  }
  function add(files) { files=Array.from(files||[]);if(!files.length)return Promise.resolve(0);importTask = importTask.catch(function () {}).then(function () { return importImages(files); }); return importTask; }
  async function entries(entry) {
    if (!entry) return [];
    if (entry.isFile) return new Promise(function (resolve) { entry.file(function (file) { resolve([file]); }, function () { resolve([]); }); });
    var reader = entry.createReader(), result = [];
    while (true) {
      var batch = await new Promise(function (resolve) { reader.readEntries(resolve, function () { resolve([]); }); });
      if (!batch.length) break;
      for (var child of batch) result.push.apply(result, await entries(child));
    }
    return result;
  }
  function renderSettings(grid) {
    var row = document.createElement('div'); row.id = 'slideshow-settings'; row.className = 'slideshow-settings';
    row.innerHTML = '<span id="slideshow-count"></span><button type="button" data-slide-folder>打开图片文件夹</button><button type="button" data-slide-files>添加图片</button><label>每张 <input type="number" min="2" step="1" aria-label="幻灯片间隔秒数"> 秒</label><span>可将图片或文件夹拖到这里</span>';
    function picker(folder) {
      var input = document.createElement('input'); input.type = 'file'; input.multiple = true; input.accept = 'image/*';
      if (folder) input.setAttribute('webkitdirectory', '');
      input.onchange = function () { add(Array.from(input.files)); }; input.click();
    }
    row.querySelector('[data-slide-folder]').onclick = async function () {
      if (native) {
        var result = await native.openSlideshowFolder();
        if (!result || !result.ok) showToast('无法打开图片文件夹，请稍后重试');
      } else showToast('当前浏览器无法打开本机存放目录，请使用添加图片');
    };
    row.querySelector('[data-slide-folder]').hidden = !native;
    row.querySelector('[data-slide-files]').onclick = function () { picker(false); };
    var input = row.querySelector('input'); input.value = interval / 1000;
    input.onchange = function () { interval = Math.max(2, Number(input.value) || 8) * 1000; input.value = interval / 1000; localStorage.setItem('mineradio-slideshow-seconds', String(interval / 1000)); nextAt = performance.now() + interval; };
    row.addEventListener('dragover', function (e) { e.preventDefault(); e.stopPropagation(); });
    row.addEventListener('drop', async function (e) {
      e.preventDefault(); e.stopPropagation(); var files = [];
      if (e.dataTransfer.items.length && e.dataTransfer.items[0].webkitGetAsEntry) {
        var roots = Array.from(e.dataTransfer.items).map(function (item) { return item.webkitGetAsEntry(); });
        for (var root of roots) files.push.apply(files, await entries(root));
      } else files = Array.from(e.dataTransfer.files);
      add(files);
    });
    var card = grid.querySelector('[data-preset="14"]'); if (card) card.after(row); else grid.append(row);
    if (card) card.addEventListener('dragover', function (e) { e.preventDefault(); imported = true; status(); });
    status();
  }
  window.mineradioSlideshow = { select: select, selected: function () { return selected; }, renderSettings: renderSettings, add: add, count: function () { return keys.length; },
    intervalSeconds:function () { return interval/1000; },
    useRecipe:function (files, seconds) {
      recipeFiles = Array.from(files); interval = Math.max(2, Math.min(3600, Number(seconds) || 8)) * 1000;
      var input=document.querySelector('#slideshow-settings input');if(input)input.value=interval/1000;
      cursor = 0; generation++; busy = null; keys = recipeFiles.map(function (_, i) { return i; }); status();
      if (selected) { nextAt = 0; return advance(); } return Promise.resolve();
    },
    exportImages:async function () {
      if (recipeFiles) return recipeFiles.slice();
      await refresh(); var files = [];
      for (var i = 0; i < keys.length; i++) {
        if (native) {
          var response = await fetch(nativeFiles[i].url); if (!response.ok) throw new Error('无法读取幻灯片素材');
          var blob = await response.blob(); files.push(new File([blob], nativeFiles[i].name || 'image-' + i, {type:blob.type}));
        } else files.push(await operation('readonly', (function (id) { return function (store) { return store.get(id); }; })(keys[i])));
      }
      return files;
    }
  };
  // Move legacy browser blobs into the editable desktop directory one at a time.
  // Delete a legacy entry only after its native copy was successfully saved.
  async function initialize() {
    if (native) {
      try {
        var legacy = await operation('readonly', function (store) { return store.getAllKeys(); });
        for (var id of legacy) {
          var blob = await operation('readonly', function (store) { return store.get(id); });
          if (!(blob instanceof Blob)) continue;
          var extension = { 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif', 'image/bmp': '.bmp' }[blob.type] || '.png';
          var saved = await native.addSlideshowImage({ name: blob.name || '图片-' + id + extension, bytes: await blob.arrayBuffer() });
          if (saved && saved.ok) await operation('readwrite', function (store) { return store.delete(id); });
        }
      } catch (_) {}
      native.onSlideshowChanged(function () {
        refresh().then(function () {
          // Watchers can emit duplicate or delayed events. Only replace a slide
          // immediately when the displayed file was removed or modified.
          if (selected && !nativeFiles.some(function (file) { return file.url === displayedSource; })) advance();
        });
      });
      window.addEventListener('focus', refresh);
    }
    await refresh();
  }
  var ready = initialize();
  window.addEventListener('mineradio:ready', function () {
    ready.then(function () {
      if (localStorage.getItem('mineradio-slideshow-selected') !== '1') return;
      if (keys.length) setPreset(14, { silent: true, restoreSlideshow: true });
      else { localStorage.setItem('mineradio-slideshow-selected', '0'); setPreset(previousPreset, { silent: true }); }
    });
  });
  window.addEventListener('blur', suspend);
  window.addEventListener('focus', resume);
  document.addEventListener('visibilitychange', function () { if (document.hidden) suspend(); else resume(); });
  window.addEventListener('pagehide', function (e) {
    pageHidden = true; suspend();
    if (!e.persisted) urls.forEach(function (url) { if (url) URL.revokeObjectURL(url); });
  });
  window.addEventListener('pageshow', function () { pageHidden = false; resume(); });
})();

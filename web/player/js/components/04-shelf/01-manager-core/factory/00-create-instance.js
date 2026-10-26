'use strict';

function makeShelfManager() {
  const _moduleState = {};
  _moduleState.shelfPointerSelectionForegroundActive = makeShelfManagerShelfPointerSelectionForegroundActive.bind(undefined, _moduleState);
  _moduleState.splitPlaylists = makeShelfManagerSplitPlaylists.bind(undefined, _moduleState);
  _moduleState.shelfShowsPodcasts = makeShelfManagerShelfShowsPodcasts.bind(undefined, _moduleState);
  _moduleState.shelfMergesCollections = makeShelfManagerShelfMergesCollections.bind(undefined, _moduleState);
  _moduleState.activePlaylists = makeShelfManagerActivePlaylists.bind(undefined, _moduleState);
  _moduleState.currentItems = makeShelfManagerCurrentItems.bind(undefined, _moduleState);
  _moduleState.makeRoundRect = makeShelfManagerMakeRoundRect.bind(undefined, _moduleState);
  _moduleState.wrapText = makeShelfManagerWrapText.bind(undefined, _moduleState);
  _moduleState.cardDrawSignature = makeShelfManagerCardDrawSignature.bind(undefined, _moduleState);
  _moduleState.drawCard = makeShelfManagerDrawCard.bind(undefined, _moduleState);
  _moduleState.buildOneCard = makeShelfManagerBuildOneCard.bind(undefined, _moduleState);
  _moduleState.shelfCardAction = makeShelfManagerShelfCardAction.bind(undefined, _moduleState);
  _moduleState.rebindShelfCard = makeShelfManagerRebindShelfCard.bind(undefined, _moduleState);
  _moduleState.disposeShelfCard = makeShelfManagerDisposeShelfCard.bind(undefined, _moduleState);
  _moduleState.warmTextureUpload = makeShelfManagerWarmTextureUpload.bind(undefined, _moduleState);
  _moduleState.cancelCardBuildQueue = makeShelfManagerCancelCardBuildQueue.bind(undefined, _moduleState);
  _moduleState.disposeRenderedCards = makeShelfManagerDisposeRenderedCards.bind(undefined, _moduleState);
  _moduleState.scheduleQueuedCardBuild = makeShelfManagerScheduleQueuedCardBuild.bind(undefined, _moduleState);
  _moduleState.syncRenderedWindow = makeShelfManagerSyncRenderedWindow.bind(undefined, _moduleState);
  _moduleState.rebuild = makeShelfManagerRebuild.bind(undefined, _moduleState);
  _moduleState.placeCard = makeShelfManagerPlaceCard.bind(undefined, _moduleState);
  _moduleState.setCardCenter = makeShelfManagerSetCardCenter.bind(undefined, _moduleState);
  _moduleState.playPlaylistCard = makeShelfManagerPlayPlaylistCard.bind(undefined, _moduleState);
  _moduleState.pulseCard = makeShelfManagerPulseCard.bind(undefined, _moduleState);
  _moduleState.createStageExtras = makeShelfManagerCreateStageExtras.bind(undefined, _moduleState);
  _moduleState.sig = makeShelfManagerSig.bind(undefined, _moduleState);
  _moduleState.switchPane = makeShelfManagerSwitchPane.bind(undefined, _moduleState);
  _moduleState.applySelectedIndex = makeShelfManagerApplySelectedIndex.bind(undefined, _moduleState);
  _moduleState.step = makeShelfManagerStep.bind(undefined, _moduleState);
  _moduleState.screenHitCard = makeShelfManagerScreenHitCard.bind(undefined, _moduleState);
  _moduleState.pickCardAtScreen = makeShelfManagerPickCardAtScreen.bind(undefined, _moduleState);
  return makeShelfManagerInitialize(_moduleState);
}

function makeShelfManagerShelfPointerSelectionForegroundActive(_moduleState) {
    return _moduleState.selectedIdx >= 0 && !document.body.classList.contains('cursor-hidden');
  }

function makeShelfManagerSplitPlaylists(_moduleState) {
    if (_moduleState.playlistPaneCache.revision === playlistCatalogRevision && _moduleState.playlistPaneCache.source === userPlaylists) {
      return { mine: _moduleState.playlistPaneCache.mine, fav: _moduleState.playlistPaneCache.fav };
    }
    var mine = [], fav = [];
    userPlaylists.forEach(function (pl) {
      var pane = pl && (pl.shelfPane || pl.shelf_pane);
      if (pane === 'mine' || pane === 'fav') (pane === 'fav' ? fav : mine).push(pl);
      else (pl.subscribed ? fav : mine).push(pl);
    });
    _moduleState.playlistPaneCache = { revision: playlistCatalogRevision, source: userPlaylists, mine: mine, fav: fav };
    return { mine: mine, fav: fav };
  }

function makeShelfManagerShelfShowsPodcasts(_moduleState) {
    return !fx || fx.shelfShowPodcasts !== false;
  }

function makeShelfManagerShelfMergesCollections(_moduleState) {
    return !!(fx && fx.shelfMergeCollections === true);
  }

function makeShelfManagerActivePlaylists(_moduleState) {
    var panes = _moduleState.splitPlaylists();
    if (_moduleState.shelfMergesCollections()) return panes.mine.concat(panes.fav);
    var source = (_moduleState.shelfPane === 'fav') ? panes.fav : panes.mine;
    if (!source.length && _moduleState.shelfPane === 'mine' && panes.fav.length) source = panes.fav;
    if (!source.length && _moduleState.shelfPane === 'fav' && panes.mine.length) source = panes.mine;
    return source;
  }

function makeShelfManagerCurrentItems(_moduleState) {
    if (userPlaylists.length || (hasAnyPlatformLogin() && myPodcastCollections.length)) {
      var source = _moduleState.activePlaylists();
      var items = source.map(function (pl) {
        var provider = pl.provider === 'mineradio' ? 'mineradio' : (pl.provider === 'qq' ? 'qq' : (pl.provider === 'kugou' ? 'kugou' : (pl.provider === 'qishui' ? 'qishui' : (pl.provider === 'spotify' ? 'spotify' : 'netease'))));
        var sourceLabel = provider === 'mineradio' ? 'MR' : (provider === 'qq' ? 'QQ' : (provider === 'kugou' ? 'KG' : (provider === 'qishui' ? 'QS' : (provider === 'spotify' ? 'SP' : 'NE'))));
        if (provider === 'spotify' && String(pl.id || '').indexOf('spotify:') !== 0) pl = Object.assign({}, pl, { id: 'spotify:' + pl.id });
        return {
          type: 'playlist', title: pl.name, sub: sourceLabel + ' · ' + (pl.trackCount || 0) + ' 首 · 播放 ' + compactCount(pl.playCount || 0),
          cover: pl.cover || '', tag: provider === 'mineradio' ? '内置歌单' : ((pl.shelfPane || pl.shelf_pane) === 'fav' || (!(pl.shelfPane || pl.shelf_pane) && pl.subscribed) ? '收藏歌单' : (provider === 'qishui' ? '汽水歌单' : '我的歌单')), playlistId: (provider === 'mineradio' ? 'mineradio:' : (provider === 'qq' ? 'qq:' : (provider === 'kugou' ? 'kugou:' : (provider === 'qishui' ? 'qishui:' : '')))) + pl.id, provider: provider
        };
      });
      if (_moduleState.shelfShowsPodcasts() && (_moduleState.shelfPane === 'mine' || _moduleState.shelfMergesCollections()) && myPodcastCollections.length) {
        myPodcastCollections.forEach(function (pc) {
          items.push({ type: 'podcastCollection', title: pc.title, sub: (pc.count || 0) + ' items', cover: pc.cover || '', tag: '我的播客', podcastKey: pc.key, itemType: pc.itemType });
        });
      }
      if (items.length) return items;
    }
    if (playQueue.length) {
      return playQueue.map(function (song, idx) {
        return {
          type: 'queue', title: song.name, sub: song.artist || '未知歌手',
          cover: songCoverSrc(song, 360), tag: idx === currentIdx ? '正在播放' : ('#' + (idx + 1)), queueIndex: idx,
          provider: songProviderKey(song)
        };
      });
    }
    return [];
  }

function makeShelfManagerMakeRoundRect(_moduleState, ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

function makeShelfManagerWrapText(_moduleState, ctx, text, x, y, maxWidth, lineHeight, maxLines) {
    var chars = String(text || '').split('');
    var line = '', lines = [];
    for (var i = 0; i < chars.length; i++) {
      var test = line + chars[i];
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line); line = chars[i];
        if (lines.length >= maxLines - 1) break;
      } else line = test;
    }
    if (line && lines.length < maxLines) lines.push(line);
    for (var j = 0; j < lines.length; j++) ctx.fillText(lines[j], x, y + j * lineHeight);
  }

function makeShelfManagerCardDrawSignature(_moduleState, card, item) {
    item = item || {};
    var coverUrl = item.cover || shelfCoverFallbackSrc(item);
    var rec = coverUrl ? playlistCoverCache[coverUrl] : null;
    var coverState = coverUrl ? (rec && rec.loaded ? 'ready' : (rec && rec.failed ? (Date.now() >= rec.retryAt ? 'retry' : 'fail') : 'wait')) : 'none';
    var fallbackRec = playlistCoverCache[shelfCoverFallbackSrc(item)];
    var pulseBucket = card && card.isCenter ? Math.round((bass + beatPulse * 0.85) * 6) : 0;
    return [
      item.type || '', item.title || '', item.sub || '', item.tag || '',
      item.playlistId || '', item.podcastKey || '', item.queueIndex == null ? '' : item.queueIndex,
      coverUrl, coverState, fallbackRec && fallbackRec.loaded ? 1 : 0, card && card.isCenter ? 1 : 0, card && card.selected ? 1 : 0,
      card && card.dofBucket == null ? -1 : card.dofBucket, pulseBucket, shelfAccentHex(), shelfSettings().bgOpacity
    ].join('|');
  }

function makeShelfManagerDrawCard(_moduleState, card, item) {
    item = item || card.item || {};
    var nextDrawKey = _moduleState.cardDrawSignature(card, item);
    if (card.drawKey === nextDrawKey) return;
    card.drawKey = nextDrawKey;
    var cv = card.canvas, ctx = card.ctx;
    var W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    var pad = 18;
    var isNow = item.type === 'queue' && item.tag === '正在播放';
    var shelfLook = shelfSettings();

    // 卡片底
    _moduleState.makeRoundRect(ctx, pad, pad, W - pad * 2, H - pad * 2, 32);
    ctx.fillStyle = 'rgba(0,0,0,' + shelfLook.bgOpacity.toFixed(3) + ')'; ctx.fill();
    var grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, 'rgba(255,255,255,0.10)');
    grad.addColorStop(1, 'rgba(255,255,255,0.018)');
    ctx.fillStyle = grad; ctx.fill();

    if (isNow) {
      ctx.strokeStyle = shelfAccentRgba(0.72);
      ctx.lineWidth = 1.8 + Math.sin(uniforms.uTime.value * 3) * 0.28 + bass * 1.2;
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 1.1;
    }
    ctx.stroke();

    if (card.selected) {
      ctx.save();
      _moduleState.makeRoundRect(ctx, pad + 2, pad + 2, W - pad * 2 - 4, H - pad * 2 - 4, 30);
      ctx.shadowColor = shelfAccentRgba(0.58);
      ctx.shadowBlur = 18;
      ctx.strokeStyle = shelfAccentRgba(0.72);
      ctx.lineWidth = 2.2;
      ctx.stroke();
      ctx.restore();
    }

    // 大封面方块
    var coverSize = H - pad * 2 - 8;
    var cx = pad + 6, cy = pad + 4;
    _moduleState.makeRoundRect(ctx, cx, cy, coverSize, coverSize, 26);
    ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fill();
    var coverUrl = item.cover || shelfCoverFallbackSrc(item);
    var fallbackUrl = shelfCoverFallbackSrc(item);
    var rec = coverUrl && playlistCoverCache[coverUrl];
    var fallbackRec = fallbackUrl && playlistCoverCache[fallbackUrl];
    var drawable = rec && rec.loaded && rec.img ? rec : fallbackRec && fallbackRec.loaded && fallbackRec.img ? fallbackRec : null;
    if (drawable) {
        ctx.save(); _moduleState.makeRoundRect(ctx, cx, cy, coverSize, coverSize, 26); ctx.clip();
        ctx.drawImage(drawable.img, cx, cy, coverSize, coverSize); ctx.restore();
    } else {
      drawShelfCoverPlaceholder(ctx, cx, cy, coverSize);
    }
    if (coverUrl && shelfCoverMayRequest(rec) && !(rec && rec.loaded)) {
      requestShelfTargetCover(card, coverUrl, function () { _moduleState.drawCard(card, card.item); });
    }
    if (fallbackUrl && fallbackUrl !== coverUrl && !(fallbackRec && fallbackRec.loaded) && shelfCoverMayRequest(fallbackRec)) {
      if (!fallbackRec || !fallbackRec.loading) requestPlaylistCover(fallbackUrl, function () {
        if (card.mesh && card.mesh.parent) { card.drawKey = ''; _moduleState.drawCard(card, card.item); }
      });
    }

    // 文本区
    var tx = pad + coverSize + 32;
    ctx.font = '700 17px Inter, Arial';
    ctx.fillStyle = isNow ? shelfAccentRgba(0.92) : 'rgba(255,255,255,0.92)';
    ctx.fillText(item.tag || '', tx, pad + 36);

    ctx.font = '700 30px Inter, Arial';
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    _moduleState.wrapText(ctx, item.title || '', tx, pad + 78, W - tx - pad - 14, 36, 2);

    ctx.font = '400 17px Inter, Arial';
    ctx.fillStyle = 'rgba(255,255,255,0.52)';
    _moduleState.wrapText(ctx, item.sub || '', tx, pad + 156, W - tx - pad - 14, 24, 2);

    // 律动进度条
    ctx.strokeStyle = isNow ? shelfAccentRgba(0.90) : 'rgba(255,255,255,0.30)';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(tx, H - pad - 22);
    ctx.lineTo(tx + Math.min(260, 80 + bass * 320), H - pad - 22);
    ctx.stroke();

    if (card.isCenter) {
      var actionY = H - pad - 78;
      if (item.type === 'playlist') {
        _moduleState.makeRoundRect(ctx, tx, actionY, 138, 38, 18);
        var playGrad = ctx.createLinearGradient(tx, actionY, tx + 138, actionY + 38);
        playGrad.addColorStop(0, 'rgba(255,255,255,0.88)');
        playGrad.addColorStop(0.55, shelfAccentRgba(0.94));
        playGrad.addColorStop(1, shelfAccentRgba(0.58));
        ctx.fillStyle = playGrad; ctx.fill();
        ctx.strokeStyle = shelfAccentRgba(0.44);
        ctx.lineWidth = 1.1; ctx.stroke();
        ctx.font = '800 14px Inter, "Microsoft YaHei", Arial';
        ctx.fillStyle = readableInkForHex(shelfAccentHex());
        ctx.fillText('▶ 播放歌单', tx + 25, actionY + 24);

        _moduleState.makeRoundRect(ctx, tx + 150, actionY, 104, 38, 18);
        ctx.fillStyle = 'rgba(255,255,255,0.055)'; ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.14)';
        ctx.lineWidth = 1.1; ctx.stroke();
        ctx.font = '700 14px Inter, "Microsoft YaHei", Arial';
        ctx.fillStyle = 'rgba(255,255,255,0.78)';
        ctx.fillText('详情', tx + 184, actionY + 24);
      } else if (item.type === 'queue') {
        ctx.font = '600 14px Inter, "Microsoft YaHei", Arial';
        ctx.fillStyle = shelfAccentRgba(0.84);
        ctx.fillText('点击播放', tx, actionY + 25);
      }
    }

    var dof = card.dofBlur || 0;
    if (dof > 0.12) {
      _moduleState.makeRoundRect(ctx, pad, pad, W - pad * 2, H - pad * 2, 32);
      ctx.fillStyle = 'rgba(0,0,0,' + Math.min(0.28, dof * 0.18).toFixed(3) + ')';
      ctx.fill();
    }

    card.texture.needsUpdate = true;
  }

function makeShelfManagerBuildOneCard(_moduleState, item, i) {
    var cv = document.createElement('canvas');
    cv.width = 720; cv.height = 360;
    var ctx = cv.getContext('2d');
    var tx = new THREE.CanvasTexture(cv);
    tx.minFilter = THREE.LinearFilter; tx.magFilter = THREE.LinearFilter;
    tx.generateMipmaps = false;
    var mat = new THREE.MeshBasicMaterial({ map: tx, transparent: true, opacity: 0.96, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
    var geo = new THREE.PlaneGeometry(2.05, 1.025, 1, 1);
    var mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 50 + i;
    mesh.userData.action = item.type === 'playlist'
      ? { kind: 'loadPlaylist', playlistId: item.playlistId, title: item.title }
      : (item.type === 'podcastCollection'
        ? { kind: 'loadPlaylist', playlistId: 'podcast:' + item.podcastKey, title: item.title }
        : (item.type === 'queue' ? { kind: 'playQueue', index: item.queueIndex } : { kind: 'empty' }));
    _moduleState.group.add(mesh);
    var card = { canvas: cv, ctx: ctx, texture: tx, mesh: mesh, item: item, index: i, isCenter: false, selected: i === _moduleState.selectedIdx, floatMix: 0, fxPulse: 0, dofBlur: 0, dofBucket: -1, drawKey: '' };
    return card;
  }

function makeShelfManagerShelfCardAction(_moduleState, item) {
    return item.type === 'playlist'
      ? { kind: 'loadPlaylist', playlistId: item.playlistId, title: item.title }
      : (item.type === 'podcastCollection'
        ? { kind: 'loadPlaylist', playlistId: 'podcast:' + item.podcastKey, title: item.title }
        : (item.type === 'queue' ? { kind: 'playQueue', index: item.queueIndex } : { kind: 'empty' }));
  }

function makeShelfManagerRebindShelfCard(_moduleState, card, item, index) {
    if (card.item !== item) card.pendingCoverUrl = '';
    card.item = item;
    card.index = index;
    card.selected = index === _moduleState.selectedIdx;
    card.isCenter = Math.abs(index - _moduleState.centerSmooth) < 0.5;
    card.drawKey = '';
    card.mesh.userData.action = _moduleState.shelfCardAction(item);
    card.mesh.renderOrder = 50 + index;
    _moduleState.drawCard(card, item);
    return card;
  }

function makeShelfManagerDisposeShelfCard(_moduleState, card) {
    if (!card) return;
    if (card.mesh && card.mesh.parent) card.mesh.parent.remove(card.mesh);
    if (card.mesh && card.mesh.material) {
      if (card.mesh.material.map) card.mesh.material.map.dispose();
      card.mesh.material.dispose();
    }
    if (card.mesh && card.mesh.geometry) card.mesh.geometry.dispose();
  }

function makeShelfManagerWarmTextureUpload(_moduleState, tex) {
    if (!tex || !renderer || typeof renderer.initTexture !== 'function') return;
    try { renderer.initTexture(tex); } catch (e) { }
  }

function makeShelfManagerCancelCardBuildQueue(_moduleState) {
    if (!_moduleState.cardBuildQueue) return;
    _moduleState.cardBuildQueue.cancelled = true;
    if (_moduleState.cardBuildQueue.raf) cancelAnimationFrame(_moduleState.cardBuildQueue.raf);
    _moduleState.cardBuildQueue = null;
  }

function makeShelfManagerDisposeRenderedCards(_moduleState) {
    _moduleState.cancelCardBuildQueue();
    _moduleState.cards.forEach(_moduleState.disposeShelfCard);
    _moduleState.cards = [];
    _moduleState.renderedStart = -1;
  }

function makeShelfManagerScheduleQueuedCardBuild(_moduleState, job) {
    function step(deadline) {
      if (!job || job.cancelled || _moduleState.cardBuildQueue !== job || !_moduleState.group) return;
      var started = performance.now();
      var built = 0;
      while (job.next <= job.end && built < 2 && performance.now() - started < 7) {
        var card = _moduleState.buildOneCard(_moduleState.allItems[job.next], job.next);
        _moduleState.cards.push(card);
        _moduleState.drawCard(card, card.item);
        _moduleState.warmTextureUpload(card.texture);
        job.next += 1;
        built += 1;
      }
      if (job.next <= job.end) {
        if (window.requestIdleCallback) {
          requestIdleCallback(step, { timeout: 180 });
        } else {
          job.raf = requestAnimationFrame(step);
        }
      } else {
        _moduleState.cardBuildQueue = null;
      }
    }
    if (window.requestIdleCallback) requestIdleCallback(step, { timeout: 180 });
    else job.raf = requestAnimationFrame(step);
  }

function makeShelfManagerSyncRenderedWindow(_moduleState, force, asyncBuild) {
    if (!_moduleState.group) return;
    var total = _moduleState.allItems.length;
    if (!total) { _moduleState.disposeRenderedCards(); return; }
    var center = Math.round(_moduleState.centerTarget);
    var start = Math.max(0, center - _moduleState.SHELF_VISIBLE_RADIUS);
    var end = Math.min(total - 1, start + _moduleState.SHELF_MAX_RENDER - 1);
    start = Math.max(0, end - _moduleState.SHELF_MAX_RENDER + 1);
    if (!force && start === _moduleState.renderedStart && _moduleState.cards.length === (end - start + 1)) {
      _moduleState.cards.forEach(function (c) {
        var nextItem = _moduleState.allItems[c.index] || c.item;
        if (c.item !== nextItem) {
          c.item = nextItem;
          c.drawKey = '';
          _moduleState.drawCard(c, c.item);
        }
      });
      return;
    }
    _moduleState.cancelCardBuildQueue();
    _moduleState.renderedStart = start;
    if (asyncBuild && !_moduleState.cards.length) {
      _moduleState.cardBuildQueue = { start: start, end: end, next: start, cancelled: false, raf: 0 };
      _moduleState.scheduleQueuedCardBuild(_moduleState.cardBuildQueue);
      return;
    }
    var existingByIndex = Object.create(null);
    _moduleState.cards.forEach(function (card) { existingByIndex[card.index] = card; });
    var reusable = _moduleState.cards.filter(function (card) { return card.index < start || card.index > end; });
    var nextCards = [];
    for (var itemIdx = start; itemIdx <= end; itemIdx++) {
      var card = existingByIndex[itemIdx] || reusable.shift();
      if (!card) card = _moduleState.buildOneCard(_moduleState.allItems[itemIdx], itemIdx);
      else _moduleState.rebindShelfCard(card, _moduleState.allItems[itemIdx], itemIdx);
      if (!card.drawKey) _moduleState.drawCard(card, card.item);
      nextCards.push(card);
    }
    reusable.forEach(_moduleState.disposeShelfCard);
    _moduleState.cards = nextCards;
  }

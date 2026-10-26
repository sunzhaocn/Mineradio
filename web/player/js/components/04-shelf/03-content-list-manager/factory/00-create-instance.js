'use strict';

function makeContentListManager() {
  const _moduleState = {};
  _moduleState.detailLayout = makeContentListManagerDetailLayout.bind(undefined, _moduleState);
  _moduleState.placeDynamicDetailFromCamera = makeContentListManagerPlaceDynamicDetailFromCamera.bind(undefined, _moduleState);
  _moduleState.makeRoundRect = makeContentListManagerMakeRoundRect.bind(undefined, _moduleState);
  _moduleState.ellipsize = makeContentListManagerEllipsize.bind(undefined, _moduleState);
  _moduleState.canvasAccent = makeContentListManagerCanvasAccent.bind(undefined, _moduleState);
  _moduleState.ensurePanel = makeContentListManagerEnsurePanel.bind(undefined, _moduleState);
  _moduleState.drawPanel = makeContentListManagerDrawPanel.bind(undefined, _moduleState);
  _moduleState.disposePanelObject = makeContentListManagerDisposePanelObject.bind(undefined, _moduleState);
  _moduleState.disposePanel = makeContentListManagerDisposePanel.bind(undefined, _moduleState);
  _moduleState.isLoadingLabel = makeContentListManagerIsLoadingLabel.bind(undefined, _moduleState);
  _moduleState.isLoadingContent = makeContentListManagerIsLoadingContent.bind(undefined, _moduleState);
  _moduleState.contentSongKey = makeContentListManagerContentSongKey.bind(undefined, _moduleState);
  _moduleState.appendContentTracks = makeContentListManagerAppendContentTracks.bind(undefined, _moduleState);
  _moduleState.clearContentWarmPrefetch = makeContentListManagerClearContentWarmPrefetch.bind(undefined, _moduleState);
  _moduleState.prefetchContentCoversFrom = makeContentListManagerPrefetchContentCoversFrom.bind(undefined, _moduleState);
  _moduleState.prefetchContentCoversAround = makeContentListManagerPrefetchContentCoversAround.bind(undefined, _moduleState);
  _moduleState.scheduleContentWarmPrefetch = makeContentListManagerScheduleContentWarmPrefetch.bind(undefined, _moduleState);
  _moduleState.contentPageUrl = makeContentListManagerContentPageUrl.bind(undefined, _moduleState);
  _moduleState.loadMoreContentRows = makeContentListManagerLoadMoreContentRows.bind(undefined, _moduleState);
  _moduleState.maybeLoadMoreContentRows = makeContentListManagerMaybeLoadMoreContentRows.bind(undefined, _moduleState);
  _moduleState.drawPanelIfNeeded = makeContentListManagerDrawPanelIfNeeded.bind(undefined, _moduleState);
  _moduleState.drawRow = makeContentListManagerDrawRow.bind(undefined, _moduleState);
  _moduleState.place = makeContentListManagerPlace.bind(undefined, _moduleState);
  _moduleState.disposeRowList = makeContentListManagerDisposeRowList.bind(undefined, _moduleState);
  _moduleState.disposeRows = makeContentListManagerDisposeRows.bind(undefined, _moduleState);
  _moduleState.rebindContentRow = makeContentListManagerRebindContentRow.bind(undefined, _moduleState);
  _moduleState.disposeCapturedDetail = makeContentListManagerDisposeCapturedDetail.bind(undefined, _moduleState);
  _moduleState.startRowsLoadedIntro = makeContentListManagerStartRowsLoadedIntro.bind(undefined, _moduleState);
  _moduleState.syncRenderedRows = makeContentListManagerSyncRenderedRows.bind(undefined, _moduleState);
  _moduleState.makeRow = makeContentListManagerMakeRow.bind(undefined, _moduleState);
  return makeContentListManagerInitialize(_moduleState);
}

function makeContentListManagerDetailLayout(_moduleState) {
    return shelfLayoutProfile().detail || _moduleState.DETAIL_BASE;
  }

function makeContentListManagerPlaceDynamicDetailFromCamera(_moduleState, layout, intro, parX, parY) {
    if (!_moduleState.group || !camera) return false;
    var portrait = isPortraitShelfViewport();
    var narrow = !portrait && innerWidth < 980;
    var introMix = intro * (layout.intro == null ? 1 : layout.intro);
    var parallax = layout.parallax == null ? 1 : layout.parallax;
    var distance = portrait ? 5.04 : (narrow ? 4.96 : 4.86);
    var rightOffset = portrait ? 0.02 : (narrow ? 0.06 : 0.10);
    var upOffset = portrait ? -0.06 : -0.04;
    distance += clampRange((layout.z - _moduleState.DETAIL_BASE.z) * 0.12, -0.20, 0.24);
    rightOffset += clampRange((layout.x - _moduleState.DETAIL_BASE.x) * 0.08, -0.24, 0.24);
    upOffset += clampRange((layout.y - _moduleState.DETAIL_BASE.y) * 0.08, -0.16, 0.16);
    rightOffset += introMix * (portrait ? 0.34 : 0.46) + parX * (portrait ? 0.045 : 0.055) * parallax;
    upOffset -= introMix * (portrait ? 0.050 : 0.040);
    upOffset += parY * (portrait ? 0.042 : 0.045) * parallax;
    distance += introMix * 0.12 + parY * 0.018 * parallax - parX * 0.012 * parallax;
    camera.getWorldDirection(_moduleState.detailCameraDir);
    _moduleState.detailCameraRight.set(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
    _moduleState.detailCameraUp.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
    _moduleState.detailCameraPos.copy(camera.position)
      .addScaledVector(_moduleState.detailCameraDir, distance)
      .addScaledVector(_moduleState.detailCameraRight, rightOffset)
      .addScaledVector(_moduleState.detailCameraUp, upOffset);
    _moduleState.group.position.copy(_moduleState.detailCameraPos);
    return true;
  }

function makeContentListManagerMakeRoundRect(_moduleState, ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

function makeContentListManagerEllipsize(_moduleState, ctx, text, maxWidth) {
    text = String(text || '');
    if (ctx.measureText(text).width <= maxWidth) return text;
    var out = text;
    while (out.length > 1 && ctx.measureText(out + '...').width > maxWidth) out = out.slice(0, -1);
    return out + '...';
  }

function makeContentListManagerCanvasAccent(_moduleState, alpha, fallback) {
    return shelfAccentRgba(alpha, fallback);
  }

function makeContentListManagerEnsurePanel(_moduleState) {
    if (_moduleState.panel || !_moduleState.group) return;
    var cv = document.createElement('canvas');
    cv.width = 900; cv.height = 1024;
    var tx = new THREE.CanvasTexture(cv);
    tx.minFilter = THREE.LinearFilter; tx.magFilter = THREE.LinearFilter;
    tx.generateMipmaps = false;
    var mat = new THREE.MeshBasicMaterial({ map: tx, transparent: true, opacity: 0.86, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
    var geo = new THREE.PlaneGeometry(2.62, 3.02, 1, 1);
    var mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(-0.02, 0.0, 0.20);
    mesh.renderOrder = 232;
    _moduleState.group.add(mesh);
    _moduleState.panel = { canvas: cv, texture: tx, mesh: mesh };
  }

function makeContentListManagerDrawPanel(_moduleState) {
    _moduleState.ensurePanel();
    if (!_moduleState.panel) return;
    var ctx = _moduleState.panel.canvas.getContext('2d');
    var W = _moduleState.panel.canvas.width, H = _moduleState.panel.canvas.height;
    ctx.clearRect(0, 0, W, H);
    _moduleState.makeRoundRect(ctx, 24, 28, W - 48, H - 56, 34);
    var bg = ctx.createLinearGradient(0, 0, W, H);
    var panelBgAlpha = shelfSettings().bgOpacity;
    bg.addColorStop(0, 'rgba(0,0,0,' + Math.min(0.98, panelBgAlpha + 0.02).toFixed(3) + ')');
    bg.addColorStop(0.42, 'rgba(0,0,0,' + panelBgAlpha.toFixed(3) + ')');
    bg.addColorStop(1, 'rgba(0,0,0,' + Math.max(0.20, panelBgAlpha - 0.04).toFixed(3) + ')');
    ctx.fillStyle = bg; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.font = '800 38px Inter, "Microsoft YaHei", Arial';
    ctx.fillStyle = 'rgba(255,246,220,0.94)';
    ctx.fillText(_moduleState.ellipsize(ctx, _moduleState.playlistTitle || '歌单详情', W - 310), 72, 92);
    ctx.font = '500 18px Inter, "Microsoft YaHei", Arial';
    ctx.fillStyle = _moduleState.canvasAccent(0.62);
    var playableCount = _moduleState.allTracks.filter(function (song) { return song && song.id && song.type !== 'podcast-radio'; }).length;
    var contentCount = _moduleState.allTracks.filter(function (song) { return song && song.id; }).length;
    var isLoading = _moduleState.allTracks.length === 1 && _moduleState.isLoadingLabel(_moduleState.allTracks[0] && _moduleState.allTracks[0].name);
    var countLabel = _moduleState.contentKind === 'podcast'
      ? (contentCount ? (contentCount + ' 项播客内容') : (isLoading ? '正在载入' : '暂无播客内容'))
      : (playableCount ? (playableCount + ' 首歌曲') : (isLoading ? '正在载入' : '暂无可播放歌曲'));
    if (_moduleState.contentKind !== 'podcast' && _moduleState.contentTotalCount && _moduleState.contentTotalCount > playableCount) {
      countLabel = playableCount + '/' + _moduleState.contentTotalCount + (_moduleState.contentLoadingMore ? ' loading' : ' loaded');
    }
    ctx.fillText(countLabel, 74, 128);
    var coverUrl = _moduleState.sourceCard && _moduleState.sourceCard.item && _moduleState.sourceCard.item.cover;
    var coverSize = 96, coverX = W - 172, coverY = 56;
    _moduleState.makeRoundRect(ctx, coverX, coverY, coverSize, coverSize, 22);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fill();
    if (coverUrl) {
      var coverRec = playlistCoverCache[coverUrl];
      if (coverRec && coverRec.loaded && coverRec.img) {
        ctx.save();
        _moduleState.makeRoundRect(ctx, coverX, coverY, coverSize, coverSize, 22);
        ctx.clip();
        ctx.drawImage(coverRec.img, coverX, coverY, coverSize, coverSize);
        ctx.restore();
      } else if (!coverRec || (!coverRec.loading && !coverRec.failed)) {
        requestPlaylistCover(coverUrl, function () { _moduleState.drawPanel(); });
      }
    }
    var sweep = (Math.sin((uniforms.uTime.value || 0) * 1.7) + 1) * 0.5;
    var shine = ctx.createLinearGradient(70, 154, W - 80, 154);
    shine.addColorStop(0, _moduleState.canvasAccent(0));
    shine.addColorStop(Math.max(0.01, sweep * 0.72), _moduleState.canvasAccent(0.14));
    shine.addColorStop(Math.min(0.99, sweep * 0.72 + 0.14), _moduleState.canvasAccent(0.56));
    shine.addColorStop(1, _moduleState.canvasAccent(0));
    ctx.fillStyle = shine;
    ctx.fillRect(72, 154, W - 144, 2);
    _moduleState.panel.texture.needsUpdate = true;
  }

function makeContentListManagerDisposePanelObject(_moduleState, targetPanel) {
    if (!targetPanel) return;
    if (targetPanel.mesh && targetPanel.mesh.parent) targetPanel.mesh.parent.remove(targetPanel.mesh);
    if (targetPanel.texture) targetPanel.texture.dispose();
    if (targetPanel.mesh && targetPanel.mesh.material) targetPanel.mesh.material.dispose();
    if (targetPanel.mesh && targetPanel.mesh.geometry) targetPanel.mesh.geometry.dispose();
  }

function makeContentListManagerDisposePanel(_moduleState) {
    _moduleState.disposePanelObject(_moduleState.panel);
    _moduleState.panel = null;
  }

function makeContentListManagerIsLoadingLabel(_moduleState, text) {
    return /加载中|正在载入/.test(String(text || ''));
  }

function makeContentListManagerIsLoadingContent(_moduleState) {
    return _moduleState.allTracks.length === 1 && _moduleState.isLoadingLabel(_moduleState.allTracks[0] && _moduleState.allTracks[0].name);
  }

function makeContentListManagerContentSongKey(_moduleState, song, fallback) {
    return String(song && (song.id || song.mid || song.qqId || song.localKey || (song.name + '|' + song.artist)) || fallback || '');
  }

function makeContentListManagerAppendContentTracks(_moduleState, tracks) {
    tracks = Array.isArray(tracks) ? tracks : [];
    if (!tracks.length) return 0;
    var seen = Object.create(null);
    _moduleState.allTracks.forEach(function (song, i) {
      var key = _moduleState.contentSongKey(song, i);
      if (key) seen[key] = true;
    });
    var added = 0;
    tracks.forEach(function (song, i) {
      var key = _moduleState.contentSongKey(song, 'new:' + i);
      if (!song || !key || seen[key]) return;
      seen[key] = true;
      _moduleState.allTracks.push(song);
      added += 1;
    });
    return added;
  }

function makeContentListManagerClearContentWarmPrefetch(_moduleState) {
    if (_moduleState.contentWarmPrefetchTimer) {
      clearTimeout(_moduleState.contentWarmPrefetchTimer);
      _moduleState.contentWarmPrefetchTimer = 0;
    }
  }

function makeContentListManagerPrefetchContentCoversFrom(_moduleState, start, count) {
    if (!_moduleState.allTracks.length) return;
    start = Math.max(0, Math.round(Number(start) || 0));
    count = Math.max(1, Math.round(Number(count) || _moduleState.CONTENT_COVER_PREFETCH_LIMIT));
    var end = Math.min(_moduleState.allTracks.length, start + count);
    var issued = 0;
    for (var i = start; i < end && issued < _moduleState.CONTENT_COVER_PREFETCH_LIMIT; i++) {
      var song = _moduleState.allTracks[i];
      var url = songCoverSrc(song, 80);
      if (!url) continue;
      var rec = playlistCoverCache[url];
      if (rec && (rec.loaded || rec.loading || rec.failed)) continue;
      requestPlaylistCover(url);
      issued++;
    }
  }

function makeContentListManagerPrefetchContentCoversAround(_moduleState, center, reason) {
    if (!_moduleState.open || !_moduleState.allTracks.length || _moduleState.isLoadingContent()) return;
    center = Math.max(0, Math.round(Number(center) || 0));
    var key = center + '|' + _moduleState.allTracks.length + '|' + (reason || '');
    if (key === _moduleState.contentCoverPrefetchKey) return;
    _moduleState.contentCoverPrefetchKey = key;
    _moduleState.prefetchContentCoversFrom(Math.max(0, center - 2), _moduleState.CONTENT_COVER_PREFETCH_LIMIT);
    _moduleState.prefetchContentCoversFrom(Math.max(0, center + _moduleState.CONTENT_VISIBLE_RADIUS), _moduleState.CONTENT_COVER_PREFETCH_LIMIT);
    _moduleState.prefetchContentCoversFrom(Math.max(0, _moduleState.allTracks.length - _moduleState.CONTENT_PREFETCH_AHEAD), Math.ceil(_moduleState.CONTENT_COVER_PREFETCH_LIMIT * 0.75));
  }

function makeContentListManagerScheduleContentWarmPrefetch(_moduleState, token) {
    _moduleState.clearContentWarmPrefetch();
    if (!_moduleState.contentHasMore || !_moduleState.contentSource) return;
    _moduleState.contentWarmPrefetchTimer = setTimeout(function () {
      _moduleState.contentWarmPrefetchTimer = 0;
      if (!_moduleState.open || token !== _moduleState.requestToken || !_moduleState.contentHasMore || _moduleState.contentLoadingMore || !_moduleState.contentSource) return;
      _moduleState.prefetchContentCoversAround(_moduleState.centerTarget, 'warm');
      _moduleState.loadMoreContentRows('warm-prefetch');
    }, 360);
  }

function makeContentListManagerContentPageUrl(_moduleState, offset) {
    if (!_moduleState.contentSource) return '';
    var limit = PLAYLIST_LAZY_BATCH_SIZE;
    if (_moduleState.contentSource.provider === 'qq') {
      return '/api/qq/playlist/tracks?id=' + encodeURIComponent(_moduleState.contentSource.id) + '&limit=' + limit + '&offset=' + Math.max(0, offset || 0);
    }
    if (_moduleState.contentSource.provider === 'kugou') {
      return '/api/kugou/playlist/tracks?id=' + encodeURIComponent(_moduleState.contentSource.id) + '&limit=' + limit + '&offset=' + Math.max(0, offset || 0);
    }
    if (_moduleState.contentSource.provider === 'qishui') {
      return '/api/qishui/playlist/tracks?id=' + encodeURIComponent(_moduleState.contentSource.id) + '&limit=' + limit + '&offset=' + Math.max(0, offset || 0);
    }
    if (_moduleState.contentSource.provider === 'spotify') {
      return '/api/spotify/playlist/tracks?id=' + encodeURIComponent(_moduleState.contentSource.id) + '&limit=' + limit + '&offset=' + Math.max(0, offset || 0);
    }
    if (_moduleState.contentSource.provider === 'netease') {
      return '/api/playlist/tracks?id=' + encodeURIComponent(_moduleState.contentSource.id) + '&limit=' + limit + '&offset=' + Math.max(0, offset || 0);
    }
    return '';
  }

async function makeContentListManagerLoadMoreContentRows(_moduleState, reason) {
    if (!_moduleState.open || _moduleState.contentLoadingMore || !_moduleState.contentHasMore || !_moduleState.contentSource) return false;
    var url = _moduleState.contentPageUrl(_moduleState.contentNextOffset);
    if (!url && _moduleState.contentSource.provider !== 'mineradio') return false;
    var token = _moduleState.requestToken;
    _moduleState.contentLoadingMore = true;
    _moduleState.panelDirty = true;
    try {
      var r = _moduleState.contentSource.provider === 'mineradio'
        ? await builtInPlaylistTracksPage(_moduleState.contentSource.id, { limit: PLAYLIST_LAZY_BATCH_SIZE, offset: _moduleState.contentNextOffset })
        : await apiJson(url);
      if (!_moduleState.open || token !== _moduleState.requestToken) return false;
      var tracks = r && r.tracks || [];
      var before = _moduleState.allTracks.length;
      var added = _moduleState.appendContentTracks(tracks);
      _moduleState.contentNextOffset = Math.max(_moduleState.contentNextOffset + tracks.length, Number(r && r.nextOffset) || (_moduleState.contentNextOffset + tracks.length));
      var total = Number(r && (r.total || (r.playlist && r.playlist.trackCount))) || 0;
      if (total) _moduleState.contentTotalCount = Math.max(_moduleState.contentTotalCount || 0, total);
      _moduleState.contentHasMore = !!(r && r.hasMore);
      if (!added && (!tracks.length || _moduleState.allTracks.length === before)) _moduleState.contentHasMore = false;
      _moduleState.panelDirty = true;
      _moduleState.rowsDirty = true;
      _moduleState.prefetchContentCoversAround(_moduleState.centerTarget, 'append');
      _moduleState.syncRenderedRows(true);
      return added > 0;
    } catch (e) {
      console.warn('[ShelfContentLoadMore]', reason || '', e);
      if (_moduleState.open && token === _moduleState.requestToken) showToast('歌单后续加载失败');
      return false;
    } finally {
      if (_moduleState.open && token === _moduleState.requestToken) {
        _moduleState.contentLoadingMore = false;
        _moduleState.panelDirty = true;
      }
    }
  }

function makeContentListManagerMaybeLoadMoreContentRows(_moduleState, reason) {
    if (!_moduleState.contentHasMore || _moduleState.contentLoadingMore || !_moduleState.contentSource || !_moduleState.allTracks.length || _moduleState.isLoadingContent()) return;
    _moduleState.prefetchContentCoversAround(_moduleState.centerTarget, reason || 'scroll');
    var remaining = (_moduleState.allTracks.length - 1) - Math.round(_moduleState.centerTarget);
    if (remaining <= _moduleState.CONTENT_PREFETCH_AHEAD) {
      _moduleState.loadMoreContentRows(reason);
    }
  }

function makeContentListManagerDrawPanelIfNeeded(_moduleState, force, nowT) {
    nowT = nowT == null ? (uniforms.uTime.value || 0) : nowT;
    if (!force && !_moduleState.panelDirty && (!_moduleState.isLoadingContent() || nowT - _moduleState.panelDrawAt < _moduleState.LOADING_ANIM_INTERVAL)) return;
    _moduleState.drawPanel();
    _moduleState.panelDirty = false;
    _moduleState.panelDrawAt = nowT;
  }

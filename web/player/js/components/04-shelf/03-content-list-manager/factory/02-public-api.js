'use strict';

function makeContentListManagerApi(_moduleState) {
  return {
    isOpen: function () { return _moduleState.open; },
    refreshTheme: function () {
      _moduleState.panelDirty = true;
      _moduleState.rowsDirty = true;
      if (!_moduleState.open || !_moduleState.group) return;
      _moduleState.drawPanelIfNeeded(true);
      _moduleState.syncRenderedRows(true);
    },
    open: async function (playlistId, title, fromCard) {
      _moduleState.open = true;
      _moduleState.playlistTitle = title;
      _moduleState.sourceCard = fromCard;
      var token = ++_moduleState.requestToken;
      _moduleState.openAnimAt = uniforms.uTime.value;
      _moduleState.rowAnimAt = _moduleState.openAnimAt;
      _moduleState.centerTarget = 0;
      _moduleState.centerSmooth = 0;
      _moduleState.panelDirty = true;
      _moduleState.rowsDirty = true;
      _moduleState.panelDrawAt = -10;
      _moduleState.rowDrawAt = -10;
      _moduleState.contentSource = null;
      _moduleState.contentNextOffset = 0;
      _moduleState.contentTotalCount = Number(fromCard && fromCard.item && fromCard.item.trackCount) || 0;
      _moduleState.contentHasMore = false;
      _moduleState.contentLoadingMore = false;
      _moduleState.clearContentWarmPrefetch();
      _moduleState.contentCoverPrefetchKey = '';
      if (!_moduleState.group) {
        _moduleState.group = new THREE.Group();
        _moduleState.group.renderOrder = 320;
        scene.add(_moduleState.group);
      }
      var openLayout = _moduleState.detailLayout();
      var openSkullDetail = shouldUseSkullSafeShelfCamera();
      var openDynamicDetail = !openSkullDetail && shouldUseShelfDynamicCamera('shelf-detail') && camera;
      var openCoverRx = particles && particles.rotation ? particles.rotation.x : 0;
      var openCoverRy = particles && particles.rotation ? particles.rotation.y : 0;
      var openCoverRz = particles && particles.rotation ? particles.rotation.z : 0;
      _moduleState.group.userData.detailIntro = 1;
      if (openDynamicDetail) {
        _moduleState.placeDynamicDetailFromCamera(openLayout, 1, 0, 0);
      } else {
        _moduleState.group.position.set(openLayout.x + (openSkullDetail ? 0.10 : 0.16), openLayout.y - (openSkullDetail ? 0.02 : 0.024), openLayout.z - (openSkullDetail ? 0.05 : 0.070));
      }
      if ((openSkullDetail || openDynamicDetail) && camera) {
        _moduleState.group.quaternion.copy(camera.quaternion);
        _moduleState.group.rotateX(openLayout.rx);
        _moduleState.group.rotateY(openLayout.ry + (openSkullDetail ? 0.014 : 0.018));
      } else {
        _moduleState.group.rotation.y = openCoverRy * 0.82 + openLayout.ry + 0.018;
        _moduleState.group.rotation.x = openCoverRx * 0.72 + openLayout.rx;
        _moduleState.group.rotation.z = openCoverRz * 0.70;
      }
      _moduleState.group.scale.setScalar(openLayout.scale * 0.965);
      if (window.gsap) {
        window.gsap.killTweensOf(_moduleState.group.userData);
        window.gsap.to(_moduleState.group.userData, { detailIntro: 0, duration: openLayout.openDuration || 0.48, ease: 'power3.out' });
      } else {
        _moduleState.group.userData.detailIntro = 0;
      }
      try {
        _moduleState.drawPanelIfNeeded(true);
        // 清旧
        _moduleState.disposeRows();
        // loading 行
        _moduleState.allTracks = [{ name: '加载中…', artist: '' }];
        _moduleState.panelDirty = true;
        _moduleState.rowsDirty = true;
        _moduleState.syncRenderedRows(true);
      } catch (renderLoadingErr) {
        console.warn('[ShelfContentLoadingRender]', playlistId, renderLoadingErr);
      }
      var podcastCollectionKey = String(playlistId || '').indexOf('podcast:') === 0 ? String(playlistId).slice(8) : '';
      var qqPlaylistId = String(playlistId || '').indexOf('qq:') === 0 ? String(playlistId).slice(3) : '';
      var kugouPlaylistId = String(playlistId || '').indexOf('kugou:') === 0 ? String(playlistId).slice(6) : '';
      var qishuiPlaylistId = String(playlistId || '').indexOf('qishui:') === 0 ? String(playlistId).slice(7) : '';
      var spotifyPlaylistId = String(playlistId || '').indexOf('spotify:') === 0 ? String(playlistId).slice(8) : '';
      var builtInPlaylistId = String(playlistId || '').indexOf('mineradio:') === 0 ? String(playlistId).slice(10) : '';
      _moduleState.contentKind = podcastCollectionKey ? 'podcast' : 'playlist';
      _moduleState.contentSource = podcastCollectionKey ? null : {
        provider: builtInPlaylistId ? 'mineradio' : (qqPlaylistId ? 'qq' : (kugouPlaylistId ? 'kugou' : (qishuiPlaylistId ? 'qishui' : (spotifyPlaylistId ? 'spotify' : 'netease')))),
        id: builtInPlaylistId || qqPlaylistId || kugouPlaylistId || qishuiPlaylistId || spotifyPlaylistId || playlistId
      };
      // 拉取歌单/播客集合
      var r = null;
      try {
        r = builtInPlaylistId
          ? await builtInPlaylistTracksPage(builtInPlaylistId, { limit: PLAYLIST_LAZY_BATCH_SIZE, offset: 0 })
          : (podcastCollectionKey
          ? await apiJson('/api/podcast/my/items?key=' + encodeURIComponent(podcastCollectionKey) + '&limit=' + PLAYLIST_LAZY_BATCH_SIZE)
          : (qqPlaylistId
            ? await apiJson('/api/qq/playlist/tracks?id=' + encodeURIComponent(qqPlaylistId) + '&limit=' + PLAYLIST_LAZY_BATCH_SIZE + '&offset=0')
            : (kugouPlaylistId
              ? await apiJson('/api/kugou/playlist/tracks?id=' + encodeURIComponent(kugouPlaylistId) + '&limit=' + PLAYLIST_LAZY_BATCH_SIZE + '&offset=0')
              : (qishuiPlaylistId
                ? await apiJson('/api/qishui/playlist/tracks?id=' + encodeURIComponent(qishuiPlaylistId) + '&limit=' + PLAYLIST_LAZY_BATCH_SIZE + '&offset=0')
                : (spotifyPlaylistId
                  ? await apiJson('/api/spotify/playlist/tracks?id=' + encodeURIComponent(spotifyPlaylistId) + '&limit=' + PLAYLIST_LAZY_BATCH_SIZE + '&offset=0')
                  : await apiJson('/api/playlist/tracks?id=' + encodeURIComponent(playlistId) + '&limit=' + PLAYLIST_LAZY_BATCH_SIZE + '&offset=0'))))));
      } catch (e) {
        if (!_moduleState.open || token !== _moduleState.requestToken) return;
        console.warn('[ShelfContentLoadApi]', playlistId, e);
        try {
          _moduleState.allTracks = [{ name: '歌单加载失败', artist: '' }];
          _moduleState.panelDirty = true;
          _moduleState.rowsDirty = true;
          _moduleState.startRowsLoadedIntro();
          _moduleState.syncRenderedRows(true);
        } catch (renderErrorErr) {
          console.warn('[ShelfContentErrorRender]', playlistId, renderErrorErr);
        }
        showToast('歌单加载失败');
        return;
      }
      if (!_moduleState.open || token !== _moduleState.requestToken) return;
      try {
        // 清 loading
        _moduleState.disposeRows();
        var tracks = podcastCollectionKey ? (r.items || []) : (r.tracks || []);
        if (!tracks.length) {
          _moduleState.allTracks = [{ name: podcastCollectionKey ? '播客为空' : '歌单为空', artist: '' }];
          _moduleState.panelDirty = true;
          _moduleState.rowsDirty = true;
          _moduleState.startRowsLoadedIntro();
          _moduleState.syncRenderedRows(true);
          return;
        }
        _moduleState.allTracks = tracks;
        if (!podcastCollectionKey) {
          _moduleState.contentNextOffset = Number(r && r.nextOffset) || _moduleState.allTracks.length;
          _moduleState.contentTotalCount = Math.max(_moduleState.contentTotalCount || 0, Number(r && (r.total || (r.playlist && r.playlist.trackCount))) || 0);
          _moduleState.contentHasMore = !!(r && r.hasMore);
        }
        _moduleState.centerTarget = 0; _moduleState.centerSmooth = 0;
        _moduleState.panelDirty = true;
        _moduleState.rowsDirty = true;
        _moduleState.startRowsLoadedIntro();
        _moduleState.syncRenderedRows(true);
        _moduleState.prefetchContentCoversAround(0, 'initial');
        _moduleState.scheduleContentWarmPrefetch(token);
      } catch (renderReadyErr) {
        console.warn('[ShelfContentReadyRender]', playlistId, renderReadyErr);
        showToast('歌单已载入，3D列表刷新失败');
      }
    },
    close: function () {
      _moduleState.open = false;
      _moduleState.requestToken++;
      var targetGroup = _moduleState.group;
      var targetRows = _moduleState.rows.slice();
      var targetPanel = _moduleState.panel;
      _moduleState.group = null;
      _moduleState.rows = [];
      _moduleState.panel = null;
      _moduleState.renderedStart = -1;
      _moduleState.allTracks = [];
      _moduleState.contentKind = 'playlist';
      _moduleState.contentSource = null;
      _moduleState.contentNextOffset = 0;
      _moduleState.contentTotalCount = 0;
      _moduleState.contentHasMore = false;
      _moduleState.contentLoadingMore = false;
      _moduleState.clearContentWarmPrefetch();
      _moduleState.contentCoverPrefetchKey = '';
      _moduleState.sourceCard = null;
      _moduleState.panelDirty = true;
      _moduleState.rowsDirty = true;
      _moduleState.panelDrawAt = -10;
      _moduleState.rowDrawAt = -10;
      if (!targetGroup) return;
      var closeLayout = _moduleState.detailLayout();
      var closeDuration = closeLayout.closeDuration || 0.18;
      var closeIntro = closeLayout.intro == null ? 1 : closeLayout.intro;
      var materials = targetRows.map(function (row) { return row.mesh && row.mesh.material; }).filter(Boolean);
      if (targetPanel && targetPanel.mesh && targetPanel.mesh.material) materials.push(targetPanel.mesh.material);
      if (window.gsap) {
        window.gsap.killTweensOf(targetGroup.position);
        window.gsap.killTweensOf(targetGroup.scale);
        window.gsap.to(targetGroup.scale, { x: 0.965, y: 0.965, z: 0.965, duration: closeDuration, ease: 'power2.in' });
        window.gsap.to(targetGroup.position, {
          x: targetGroup.position.x + 0.18 * closeIntro,
          y: targetGroup.position.y - 0.02 * closeIntro,
          z: targetGroup.position.z - 0.10 * closeIntro,
          duration: closeDuration,
          ease: 'power2.in'
        });
        var finishClose = function () { _moduleState.disposeCapturedDetail(targetGroup, targetRows, targetPanel); };
        if (materials.length) {
          window.gsap.to(materials, {
            opacity: 0,
            duration: Math.max(0.06, closeDuration * 0.88),
            ease: 'power2.in',
            onComplete: finishClose
          });
        } else {
          window.gsap.delayedCall(closeDuration, finishClose);
        }
      } else {
        _moduleState.disposeCapturedDetail(targetGroup, targetRows, targetPanel);
      }
    },
    update: function (dt) {
      if (!_moduleState.group || !_moduleState.open) return;
      var intro = _moduleState.group.userData.detailIntro || 0;
      var parX = pointerParallax.x || 0;
      var parY = pointerParallax.y || 0;
      var layout = _moduleState.detailLayout();
      var skullDetail = shouldUseSkullSafeShelfCamera();
      var introMix = intro * (layout.intro == null ? 1 : layout.intro);
      var parallax = layout.parallax == null ? 1 : layout.parallax;
      var dynamicDetail = !skullDetail && shouldUseShelfDynamicCamera('shelf-detail') && camera;
      var coverBoundDetail = !skullDetail && !dynamicDetail && particles && particles.rotation;
      var coverBindX = coverBoundDetail ? particles.rotation.y * 0.18 : 0;
      var coverBindY = coverBoundDetail ? particles.rotation.x * -0.16 : 0;
      var coverBindZ = coverBoundDetail ? Math.abs(particles.rotation.y) * 0.030 : 0;
      if (dynamicDetail) {
        _moduleState.placeDynamicDetailFromCamera(layout, intro, parX, parY);
      } else {
        _moduleState.group.position.set(
          layout.x + coverBindX + introMix * (skullDetail ? 0.10 : 0.16) + parX * (skullDetail ? 0.024 : 0.030) * parallax,
          layout.y + coverBindY - introMix * (skullDetail ? 0.02 : 0.024) + parY * (skullDetail ? 0.026 : 0.026) * parallax,
          layout.z + coverBindZ - introMix * (skullDetail ? 0.05 : 0.070) + parY * (skullDetail ? 0.014 : 0.016) * parallax - parX * (skullDetail ? 0.010 : 0.010) * parallax
        );
      }
      if (skullDetail && camera) {
        _moduleState.group.quaternion.copy(camera.quaternion);
        _moduleState.group.rotateX(layout.rx - parY * 0.004 * parallax);
        _moduleState.group.rotateY(layout.ry + introMix * 0.004 + parX * 0.004 * parallax);
      } else if (dynamicDetail) {
        _moduleState.group.quaternion.copy(camera.quaternion);
        _moduleState.group.rotateX(layout.rx - parY * 0.006 * parallax);
        _moduleState.group.rotateY(layout.ry + introMix * 0.012 + parX * 0.008 * parallax);
      } else {
        var coverRx = particles && particles.rotation ? particles.rotation.x : 0;
        var coverRy = particles && particles.rotation ? particles.rotation.y : 0;
        var coverRz = particles && particles.rotation ? particles.rotation.z : 0;
        _moduleState.group.rotation.x += ((coverRx * 0.72 + layout.rx - parY * 0.010 * parallax) - _moduleState.group.rotation.x) * 0.16;
        _moduleState.group.rotation.y += ((coverRy * 0.82 + layout.ry + introMix * 0.018 + parX * 0.014 * parallax) - _moduleState.group.rotation.y) * 0.16;
        _moduleState.group.rotation.z += ((coverRz * 0.70) - _moduleState.group.rotation.z) * 0.14;
      }
      _moduleState.group.scale.setScalar(layout.scale * (1 - introMix * (skullDetail ? 0.020 : 0.035)));
      _moduleState.centerSmooth += (_moduleState.centerTarget - _moduleState.centerSmooth) * 0.18;
      if (Math.abs(_moduleState.centerSmooth - _moduleState.centerTarget) < 0.001) _moduleState.centerSmooth = _moduleState.centerTarget;
      _moduleState.syncRenderedRows(false);
      _moduleState.maybeLoadMoreContentRows('update');
      if (_moduleState.panel && _moduleState.panel.mesh) {
        var pr = Math.max(0, Math.min(1, (uniforms.uTime.value - _moduleState.openAnimAt) / (layout.openDuration || 0.72)));
        pr = pr * pr * (3 - 2 * pr);
        _moduleState.panel.mesh.material.opacity = 0.86 * pr * shelfSettings().opacity;
      }
      for (var i = 0; i < _moduleState.rows.length; i++) {
        _moduleState.place(_moduleState.rows[i], i);
        var isC = Math.abs(_moduleState.rows[i].index - _moduleState.centerSmooth) < 0.5;
        if (_moduleState.rows[i].lastCenter !== isC) {
          _moduleState.rows[i].lastCenter = isC;
          _moduleState.drawRow(_moduleState.rows[i], _moduleState.rows[i].song, isC);
        }
      }
    },
    next: function () {
      if (_moduleState.allTracks.length) {
        var prevTarget = Math.round(_moduleState.centerTarget);
        _moduleState.centerTarget = Math.min(_moduleState.allTracks.length - 1, _moduleState.centerTarget + 1);
        var nextTarget = Math.round(_moduleState.centerTarget);
        _moduleState.syncRenderedRows(false);
        _moduleState.maybeLoadMoreContentRows('next');
        if (nextTarget !== prevTarget) playShelfSelectTick(1, 'row');
        pulseObjectValue(_moduleState.rows.find(function (r) { return r.index === nextTarget; }), 'fxPulse', 0.48, 0.36);
      }
    },
    prev: function () {
      if (_moduleState.allTracks.length) {
        var prevTarget = Math.round(_moduleState.centerTarget);
        _moduleState.centerTarget = Math.max(0, _moduleState.centerTarget - 1);
        var nextTarget = Math.round(_moduleState.centerTarget);
        _moduleState.syncRenderedRows(false);
        _moduleState.maybeLoadMoreContentRows('prev');
        if (nextTarget !== prevTarget) playShelfSelectTick(-1, 'row');
        pulseObjectValue(_moduleState.rows.find(function (r) { return r.index === nextTarget; }), 'fxPulse', 0.48, 0.36);
      }
    },
    scrollBy: function (d) {
      if (_moduleState.allTracks.length) {
        var prevTarget = Math.round(_moduleState.centerTarget);
        _moduleState.centerTarget = Math.max(0, Math.min(_moduleState.allTracks.length - 1, _moduleState.centerTarget + d));
        var nextTarget = Math.round(_moduleState.centerTarget);
        _moduleState.syncRenderedRows(false);
        _moduleState.maybeLoadMoreContentRows('scroll');
        if (nextTarget !== prevTarget) playShelfSelectTick(d, 'row');
        pulseObjectValue(_moduleState.rows.find(function (r) { return r.index === nextTarget; }), 'fxPulse', 0.48, 0.36);
      }
    },
    getRows: function () { return _moduleState.rows; },
    getCenterIdx: function () { return Math.round(_moduleState.centerSmooth); },
    pulseRow: function (row, amount) {
      if (!row) return;
      pulseObjectValue(row, 'fxPulse', amount || 1, 0.42);
    },
    raycastRows: function (rc) {
      if (!_moduleState.rows.length) return null;
      var vm = _moduleState.rows.filter(function (r) { return r.mesh.visible; }).map(function (r) { return r.mesh; });
      var hits = rc.intersectObjects(vm, false);
      if (!hits.length) return null;
      var row = _moduleState.rows.find(function (r) { return r.mesh === hits[0].object; });
      return { row: row, uv: hits[0].uv };
    },
    pickRowAtScreen: function (sx, sy) {
      if (!_moduleState.rows.length || !_moduleState.open) return null;
      var ordered = _moduleState.rows.filter(function (r) { return r.mesh && r.mesh.visible; }).sort(function (a, b) {
        return (b.mesh.renderOrder || 0) - (a.mesh.renderOrder || 0);
      });
      for (var ri = 0; ri < ordered.length; ri++) {
        var row = ordered[ri];
        var params = row.mesh.geometry && row.mesh.geometry.parameters || {};
        var hw = (params.width || 2.50) / 2;
        var hh = (params.height || 0.36) / 2;
        var pts = [
          new THREE.Vector3(-hw, -hh, 0),
          new THREE.Vector3(hw, -hh, 0),
          new THREE.Vector3(hw, hh, 0),
          new THREE.Vector3(-hw, hh, 0),
        ];
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        row.mesh.updateMatrixWorld(true);
        for (var pi = 0; pi < pts.length; pi++) {
          pts[pi].applyMatrix4(row.mesh.matrixWorld).project(camera);
          var x = (pts[pi].x + 1) * innerWidth / 2;
          var y = (1 - pts[pi].y) * innerHeight / 2;
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
        var padX = 24, padY = 16;
        if (sx < minX - padX || sx > maxX + padX || sy < minY - padY || sy > maxY + padY) continue;
        var u = clampRange((sx - minX) / Math.max(1, maxX - minX), 0, 1);
        var v = 1 - clampRange((sy - minY) / Math.max(1, maxY - minY), 0, 1);
        return { row: row, uv: { x: u, y: v }, screenPick: true };
      }
      return null;
    },
    raycastPanel: function (rc) {
      if (!_moduleState.panel || !_moduleState.panel.mesh) return null;
      var hits = rc.intersectObject(_moduleState.panel.mesh, false);
      return hits && hits.length ? hits[0] : null;
    },
    screenContainsPanel: function (sx, sy) {
      if (!_moduleState.panel || !_moduleState.panel.mesh || !_moduleState.open) return false;
      var params = _moduleState.panel.mesh.geometry && _moduleState.panel.mesh.geometry.parameters || {};
      var hw = (params.width || 2.62) / 2;
      var hh = (params.height || 3.02) / 2;
      var pts = [
        new THREE.Vector3(-hw, -hh, 0),
        new THREE.Vector3(hw, -hh, 0),
        new THREE.Vector3(hw, hh, 0),
        new THREE.Vector3(-hw, hh, 0),
      ];
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      _moduleState.panel.mesh.updateMatrixWorld(true);
      for (var pi = 0; pi < pts.length; pi++) {
        pts[pi].applyMatrix4(_moduleState.panel.mesh.matrixWorld).project(camera);
        var x = (pts[pi].x + 1) * innerWidth / 2;
        var y = (1 - pts[pi].y) * innerHeight / 2;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
      var pad = 42;
      return sx >= minX - pad && sx <= maxX + pad && sy >= minY - pad && sy <= maxY + pad;
    },
    rowActionAtScreen: function (row, sx, sy) {
      if (!row || !row.mesh || !row.mesh.visible) return null;
      var song = row.song || {};
      var isCenter = Math.abs(row.index - Math.round(_moduleState.centerSmooth)) < 0.5;
      if (!isCenter || !((song && song.id) || song.type === 'podcast-radio')) return null;
      var params = row.mesh.geometry && row.mesh.geometry.parameters || {};
      var hw = (params.width || 2.50) / 2;
      var hh = (params.height || 0.36) / 2;
      var corners = [
        new THREE.Vector3(-hw, -hh, 0),
        new THREE.Vector3(hw, -hh, 0),
        new THREE.Vector3(hw, hh, 0),
        new THREE.Vector3(-hw, hh, 0),
      ];
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      row.mesh.updateMatrixWorld(true);
      for (var i = 0; i < corners.length; i++) {
        corners[i].applyMatrix4(row.mesh.matrixWorld).project(camera);
        var x = (corners[i].x + 1) * innerWidth / 2;
        var y = (1 - corners[i].y) * innerHeight / 2;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
      var w = Math.max(1, maxX - minX);
      var h = Math.max(1, maxY - minY);
      var u = clampRange((sx - minX) / w, 0, 1);
      var v = clampRange((sy - minY) / h, 0, 1);
      if (u > 0.60 && u < 0.68 && v > 0.12 && v < 0.88) return 'like';
      if (u >= 0.68 && u < 0.75 && v > 0.12 && v < 0.88) return 'collect';
      if (u >= 0.75 && u < 0.82 && v > 0.12 && v < 0.88) return 'next';
      if (u >= 0.82 && v > 0.10 && v < 0.90) return 'play';
      return null;
    },
    playRow: function (row) {
      // 把整个歌单导入队列, 从这首开始播
      pulseObjectValue(row, 'fxPulse', 1.0, 0.34);
      var idx = row.index;
      if (idx < 0) return;
      if (row.song && row.song.type === 'podcast-radio') {
        loadPodcastRadioIntoQueue(row.song.id || row.song.radioId, true, row.song.name || _moduleState.playlistTitle);
        var smRadio = shelfManager;
        if (smRadio) safeShelfCloseContent('content-play-podcast-radio');
        return;
      }
      var playIndex = _moduleState.allTracks.slice(0, idx + 1).filter(function (song) { return song && song.id; }).length - 1;
      var allSongs = _moduleState.allTracks.filter(function (song) { return song && song.id; }).map(function (song) {
        return cloneSong(song);
      });
      if (!allSongs.length || playIndex < 0) return;
      var queuePlaylistId = _moduleState.contentSource && _moduleState.contentSource.provider && _moduleState.contentSource.provider !== 'netease'
        ? (_moduleState.contentSource.provider + ':' + _moduleState.contentSource.id)
        : (_moduleState.contentSource && _moduleState.contentSource.id || '');
      if (!queuePlaylistId) return;
      loadPlaylistIntoQueueById(queuePlaylistId, true, _moduleState.playlistTitle, {
        seedTracks: allSongs,
        startIndex: playIndex,
        total: _moduleState.contentTotalCount,
        nextOffset: _moduleState.contentNextOffset,
        hasMore: _moduleState.contentHasMore,
        preserveHomeState: true
      }).catch(function (e) { console.warn('[ContentPlayRow]', e); });
      // 关闭内容框
      var sm = shelfManager;
      if (sm) safeShelfCloseContent('content-play-row');
    }
  };
}

'use strict';

function makeContentListManagerDrawRow(_moduleState, row, song, isCenter) {
    var cv = row.canvas, ctx = cv.getContext('2d');
    var W = cv.width, H = cv.height;
    var isPodcastRadio = !!(song && song.type === 'podcast-radio');
    var playable = !!(song && song.id && !isPodcastRadio);
    var actionReady = playable || isPodcastRadio;
    ctx.clearRect(0, 0, W, H);
    _moduleState.makeRoundRect(ctx, 14, 10, W - 28, H - 20, 22);
    var rowGrad = ctx.createLinearGradient(0, 0, W, H);
    var rowBgAlpha = shelfSettings().bgOpacity;
    var centerRowBgAlpha = isCenter ? Math.max(rowBgAlpha, 0.92) : rowBgAlpha;
    if (isCenter) {
      rowGrad.addColorStop(0, 'rgba(8,14,24,' + Math.min(0.985, centerRowBgAlpha + 0.040).toFixed(3) + ')');
      rowGrad.addColorStop(0.48, 'rgba(0,0,0,' + Math.min(0.985, centerRowBgAlpha + 0.030).toFixed(3) + ')');
      rowGrad.addColorStop(1, 'rgba(0,0,0,' + Math.min(0.98, centerRowBgAlpha + 0.015).toFixed(3) + ')');
    } else {
      rowGrad.addColorStop(0, 'rgba(16,16,20,' + Math.max(0.20, rowBgAlpha - 0.02).toFixed(3) + ')');
      rowGrad.addColorStop(1, 'rgba(0,0,0,' + Math.max(0.20, rowBgAlpha - 0.04).toFixed(3) + ')');
    }
    if (isCenter) {
      ctx.shadowColor = _moduleState.canvasAccent(0.20);
      ctx.shadowBlur = 18;
    }
    ctx.fillStyle = rowGrad;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = isCenter ? _moduleState.canvasAccent(0.48) : 'rgba(255,255,255,0.10)';
    ctx.lineWidth = isCenter ? 1.6 : 1;
    ctx.stroke();
    ctx.font = '700 18px Inter, Arial';
    ctx.fillStyle = isCenter ? _moduleState.canvasAccent(0.95) : 'rgba(255,255,255,0.34)';
    var n = String(row.index + 1);
    if (n.length < 2) n = '0' + n;
    ctx.fillText(n, 32, 52);
    var coverSize = 54;
    var coverX = 84;
    var coverY = H / 2 - coverSize / 2;
    var songCover = songCoverSrc(song, 80) || shelfCoverFallbackSrc(song);
    var hasSongCover = !!songCover;
    if (actionReady || hasSongCover) {
      _moduleState.makeRoundRect(ctx, coverX, coverY, coverSize, coverSize, 13);
      ctx.fillStyle = isCenter ? _moduleState.canvasAccent(0.12) : 'rgba(255,255,255,0.07)';
      ctx.fill();
      if (hasSongCover) {
        var songCoverRec = playlistCoverCache[songCover];
        if (songCoverRec && songCoverRec.loaded && songCoverRec.img) {
          ctx.save();
          _moduleState.makeRoundRect(ctx, coverX, coverY, coverSize, coverSize, 13);
          ctx.clip();
          ctx.drawImage(songCoverRec.img, coverX, coverY, coverSize, coverSize);
          ctx.restore();
        } else {
          drawShelfCoverPlaceholder(ctx, coverX, coverY, coverSize);
          if (shelfCoverMayRequest(songCoverRec)) requestShelfTargetCover(row, songCover, function () {
            _moduleState.drawRow(row, row.song, !!row.lastCenter);
          });
        }
      }
    }
    // 标题
    var textX = (actionReady || hasSongCover) ? 154 : 82;
    var btnW = 104, btnH = 48, btnX = W - 144, btnY = H / 2 - btnH / 2;
    var miniBtn = 44, likeX = btnX - 156, collectX = btnX - 104, nextX = btnX - 52;
    var textMax = actionReady && isCenter ? (isPodcastRadio ? btnX - textX - 24 : likeX - textX - 24) : W - textX - 42;
    var loadingRow = !playable && _moduleState.isLoadingLabel(song && song.name);
    if (loadingRow) {
      ctx.font = '700 22px Inter, "Microsoft YaHei", Arial';
      ctx.fillStyle = 'rgba(255,247,224,0.88)';
      ctx.fillText('正在载入歌单', textX, 42);
      var phase = ((uniforms.uTime.value || 0) * 0.85) % 1;
      for (var sk = 0; sk < 3; sk++) {
        var barY = 58 + sk * 13;
        var barW = sk === 0 ? 330 : (sk === 1 ? 250 : 180);
        _moduleState.makeRoundRect(ctx, textX, barY, barW, 7, 4);
        var skGrad = ctx.createLinearGradient(textX, barY, textX + barW, barY);
        var hot = (phase + sk * 0.14) % 1;
        skGrad.addColorStop(0, 'rgba(255,255,255,0.08)');
        skGrad.addColorStop(Math.max(0, hot - 0.18), _moduleState.canvasAccent(0.10));
        skGrad.addColorStop(Math.min(0.99, hot), _moduleState.canvasAccent(0.34));
        skGrad.addColorStop(1, 'rgba(255,255,255,0.08)');
        ctx.fillStyle = skGrad; ctx.fill();
      }
      row.texture.needsUpdate = true;
      return;
    }
    ctx.font = isCenter ? '800 24px Inter, "Microsoft YaHei", Arial' : '600 20px Inter, "Microsoft YaHei", Arial';
    ctx.fillStyle = isCenter ? 'rgba(255,247,224,0.96)' : 'rgba(255,255,255,0.80)';
    ctx.fillText(_moduleState.ellipsize(ctx, song.name || '', textMax), textX, 44);
    ctx.font = '500 15px Inter, "Microsoft YaHei", Arial';
    ctx.fillStyle = isCenter ? 'rgba(255,255,255,0.88)' : 'rgba(255,255,255,0.64)';
    ctx.fillText(_moduleState.ellipsize(ctx, song.artist || '', textMax), textX, 72);
    // center 行右侧显示红心/收藏/播放按钮
    if (isCenter && actionReady) {
      if (!isPodcastRadio) {
        var liked = isSongLiked(song);
        _moduleState.makeRoundRect(ctx, likeX, btnY + 2, miniBtn, btnH - 4, 15);
        ctx.fillStyle = liked ? 'rgba(255,122,144,0.18)' : 'rgba(255,255,255,0.075)';
        ctx.fill();
        ctx.strokeStyle = liked ? 'rgba(255,122,144,0.52)' : 'rgba(255,255,255,0.14)';
        ctx.lineWidth = 1.1;
        ctx.stroke();
        drawCanvasHeart(ctx, likeX + miniBtn / 2, btnY + 26, 20, liked ? '#ff7a90' : 'rgba(255,255,255,0.76)');

        _moduleState.makeRoundRect(ctx, collectX, btnY + 2, miniBtn, btnH - 4, 15);
        var collectGrad = ctx.createLinearGradient(collectX, btnY + 2, collectX + miniBtn, btnY + btnH);
        collectGrad.addColorStop(0, 'rgba(255,255,255,0.080)');
        collectGrad.addColorStop(1, _moduleState.canvasAccent(0.075));
        ctx.fillStyle = collectGrad;
        ctx.fill();
        ctx.strokeStyle = _moduleState.canvasAccent(0.22);
        ctx.lineWidth = 1.1;
        ctx.stroke();
        var collectCx = collectX + miniBtn / 2;
        var collectCy = btnY + btnH / 2;
        ctx.strokeStyle = _moduleState.canvasAccent(0.72);
        ctx.lineWidth = 2.35;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(collectCx - 11, collectCy + 1);
        ctx.lineTo(collectCx - 11, collectCy + 12);
        ctx.lineTo(collectCx + 11, collectCy + 12);
        ctx.lineTo(collectCx + 11, collectCy + 1);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(collectCx, collectCy - 9);
        ctx.lineTo(collectCx, collectCy + 5);
        ctx.moveTo(collectCx - 7, collectCy - 2);
        ctx.lineTo(collectCx + 7, collectCy - 2);
        ctx.stroke();

        _moduleState.makeRoundRect(ctx, nextX, btnY + 2, miniBtn, btnH - 4, 15);
        var nextGrad = ctx.createLinearGradient(nextX, btnY + 2, nextX + miniBtn, btnY + btnH);
        nextGrad.addColorStop(0, 'rgba(255,255,255,0.082)');
        nextGrad.addColorStop(0.62, 'rgba(255,255,255,0.045)');
        nextGrad.addColorStop(1, _moduleState.canvasAccent(0.055));
        ctx.fillStyle = nextGrad;
        ctx.fill();
        ctx.strokeStyle = _moduleState.canvasAccent(0.24);
        ctx.lineWidth = 1.1;
        ctx.stroke();
        var nextCx = nextX + miniBtn / 2;
        var nextCy = btnY + btnH / 2;
        ctx.strokeStyle = 'rgba(255,255,255,0.90)';
        ctx.lineWidth = 2.8;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(nextCx, nextCy - 8);
        ctx.lineTo(nextCx, nextCy + 8);
        ctx.moveTo(nextCx - 8, nextCy);
        ctx.lineTo(nextCx + 8, nextCy);
        ctx.stroke();
      }

      _moduleState.makeRoundRect(ctx, btnX, btnY, btnW, btnH, 18);
      var btnGrad = ctx.createLinearGradient(btnX, btnY, btnX + btnW, btnY + btnH);
      btnGrad.addColorStop(0, 'rgba(255,255,255,0.88)');
      btnGrad.addColorStop(0.56, _moduleState.canvasAccent(0.94));
      btnGrad.addColorStop(1, _moduleState.canvasAccent(0.58));
      ctx.fillStyle = btnGrad; ctx.fill();
      ctx.strokeStyle = _moduleState.canvasAccent(0.42);
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.font = '700 15px Inter, Arial';
      ctx.fillStyle = readableInkForHex(shelfAccentHex());
      ctx.fillText('播放', btnX + 36, btnY + 29);
    }
    row.texture.needsUpdate = true;
  }

function makeContentListManagerPlace(_moduleState, row, i) {
    var delta = row.index - _moduleState.centerSmooth;
    var absD = Math.abs(delta);
    if (absD > _moduleState.CONTENT_VISIBLE_RADIUS + 0.5) { row.mesh.visible = false; return; }
    row.mesh.visible = true;
    row.mesh.renderOrder = 240 + Math.round((_moduleState.CONTENT_VISIBLE_RADIUS + 1 - Math.min(absD, _moduleState.CONTENT_VISIBLE_RADIUS + 1)) * 14);
    var nowT = uniforms.uTime.value;
    var layout = _moduleState.detailLayout();
    var revealRaw = Math.max(0, Math.min(1, (nowT - _moduleState.rowAnimAt - absD * 0.040) / (layout.rowDuration || 0.72)));
    var reveal = revealRaw * revealRaw * (3 - 2 * revealRaw);
    var parX = pointerParallax.x || 0;
    var parY = pointerParallax.y || 0;
    var parWeight = Math.max(0, 1 - absD * 0.12);
    var pulse = row.fxPulse || 0;
    var settle = _moduleState.group && _moduleState.group.userData ? (_moduleState.group.userData.rowSettle || 0) : 0;
    var shelfLook = shelfSettings();
    var skullDetail = shouldUseSkullSafeShelfCamera();
    var introStrength = layout.intro == null ? 1 : layout.intro;
    var parallax = layout.parallax == null ? 1 : layout.parallax;
    var rowBaseX = skullDetail ? 0.22 : -0.04;
    var rowSpreadX = skullDetail ? 0.030 : 0.014;
    var rowIntroX = skullDetail ? 0.58 : 0.38;
    var rowCenterZ = skullDetail ? 0.62 : 0.62;
    var rowBackZ = skullDetail ? 0.58 : 0.58;
    var rowDepthStep = skullDetail ? 0.046 : 0.048;
    var px = rowBaseX + absD * rowSpreadX + (1 - reveal) * (rowIntroX + absD * rowSpreadX) * introStrength;
    var py = -delta * layout.rowStep + (1 - reveal) * (0.20 + (delta < 0 ? -0.10 : 0.10)) * introStrength;
    var pz = (absD < 0.5 ? rowCenterZ : (rowBackZ - absD * rowDepthStep)) - (1 - reveal) * (skullDetail ? 0.10 : 0.16) * introStrength;
    px += settle * ((skullDetail ? 0.11 : 0.12) + absD * (skullDetail ? 0.010 : 0.012));
    py += settle * (delta < 0 ? -0.08 : 0.08);
    pz -= settle * (skullDetail ? 0.045 : 0.08);
    px += parX * (skullDetail ? 0.022 : 0.026) * parWeight * parallax;
    py += parY * (skullDetail ? 0.024 : 0.036) * parWeight * parallax;
    pz += (parY * (skullDetail ? 0.014 : 0.024) - parX * (skullDetail ? 0.010 : 0.020)) * parWeight * parallax;
    var scale = (absD < 0.5 ? 1.00 : Math.max(0.66, 0.94 - absD * 0.070)) * (0.90 + reveal * 0.10) * (1 + pulse * 0.052) * (1 - settle * 0.025) * layout.rowScale;
    row.mesh.position.set(px, py, pz);
    row.mesh.scale.setScalar(scale);
    var rowOpacityBase = Math.min(1, (absD < 0.5 ? 1.0 : Math.max(0.34, 1.0 - absD * 0.12)) * reveal + pulse * 0.14);
    var rowOpacityScale = absD < 0.5 ? Math.max(0.94, shelfLook.opacity) : shelfLook.opacity;
    row.mesh.material.opacity = Math.min(1, rowOpacityBase * rowOpacityScale);
    row.mesh.rotation.y = (skullDetail ? -0.070 : 0.10) + (1 - reveal) * (skullDetail ? 0.018 : 0.052) * introStrength + parX * (skullDetail ? 0.010 : 0.018) * parWeight * parallax;
    row.mesh.rotation.x = (skullDetail ? 0.010 : 0) - delta * (skullDetail ? 0.010 : 0.022) - parY * (skullDetail ? 0.006 : 0.014) * parWeight * parallax;
  }

function makeContentListManagerDisposeRowList(_moduleState, rowList) {
    while (rowList.length) {
      var row = rowList.pop();
      if (row.mesh && row.mesh.parent) row.mesh.parent.remove(row.mesh);
      if (row.mesh && row.mesh.material) {
        if (row.mesh.material.map) row.mesh.material.map.dispose();
        row.mesh.material.dispose();
      }
      if (row.mesh && row.mesh.geometry) row.mesh.geometry.dispose();
    }
  }

function makeContentListManagerDisposeRows(_moduleState) {
    _moduleState.disposeRowList(_moduleState.rows);
    _moduleState.renderedStart = -1;
  }

function makeContentListManagerRebindContentRow(_moduleState, row, song, index) {
    row.song = song;
    row.index = index;
    row.lastCenter = index === Math.round(_moduleState.centerSmooth);
    row.mesh.renderOrder = 240 + index;
    _moduleState.drawRow(row, song, row.lastCenter);
    return row;
  }

function makeContentListManagerDisposeCapturedDetail(_moduleState, targetGroup, targetRows, targetPanel) {
    if (targetGroup && targetGroup.parent) targetGroup.parent.remove(targetGroup);
    _moduleState.disposeRowList(targetRows || []);
    _moduleState.disposePanelObject(targetPanel);
  }

function makeContentListManagerStartRowsLoadedIntro(_moduleState) {
    _moduleState.rowAnimAt = uniforms.uTime.value;
    _moduleState.panelDirty = true;
    _moduleState.rowsDirty = true;
    if (!_moduleState.group || !_moduleState.group.userData) return;
    _moduleState.group.userData.rowSettle = 1;
    var layout = _moduleState.detailLayout();
    var rowDuration = layout.rowDuration || 0.72;
    if (window.gsap) {
      window.gsap.killTweensOf(_moduleState.group.userData, 'rowSettle');
      window.gsap.to(_moduleState.group.userData, { rowSettle: 0, duration: rowDuration + 0.04, ease: 'expo.out' });
    } else {
      _moduleState.group.userData.rowSettle = 0;
    }
  }

function makeContentListManagerSyncRenderedRows(_moduleState, force) {
    if (!_moduleState.group) return;
    var nowT = uniforms.uTime.value || 0;
    var refreshLoading = _moduleState.isLoadingContent() && nowT - _moduleState.rowDrawAt >= _moduleState.LOADING_ANIM_INTERVAL;
    _moduleState.drawPanelIfNeeded(force || refreshLoading, nowT);
    var total = _moduleState.allTracks.length;
    if (!total) { _moduleState.disposeRows(); return; }
    var center = Math.round(_moduleState.centerTarget);
    var start = Math.max(0, center - _moduleState.CONTENT_VISIBLE_RADIUS);
    var end = Math.min(total - 1, start + _moduleState.CONTENT_MAX_RENDER - 1);
    start = Math.max(0, end - _moduleState.CONTENT_MAX_RENDER + 1);
    if (!force && start === _moduleState.renderedStart && _moduleState.rows.length === (end - start + 1)) {
      _moduleState.rows.forEach(function (row) { row.song = _moduleState.allTracks[row.index] || row.song; });
      if (_moduleState.rowsDirty || refreshLoading) {
        _moduleState.rows.forEach(function (row) {
          var isCenter = Math.abs(row.index - _moduleState.centerSmooth) < 0.5;
          _moduleState.drawRow(row, row.song, isCenter);
          row.lastCenter = isCenter;
        });
        _moduleState.rowsDirty = false;
        _moduleState.rowDrawAt = nowT;
      }
      _moduleState.prefetchContentCoversAround(center, 'visible');
      return;
    }
    var existingByIndex = Object.create(null);
    _moduleState.rows.forEach(function (row) { existingByIndex[row.index] = row; });
    var reusable = _moduleState.rows.filter(function (row) { return row.index < start || row.index > end; });
    _moduleState.renderedStart = start;
    var nextRows = [];
    for (var idx = start; idx <= end; idx++) {
      var row = existingByIndex[idx] || reusable.shift();
      if (!row) {
        row = _moduleState.makeRow(_moduleState.allTracks[idx], idx);
        _moduleState.drawRow(row, row.song, idx === Math.round(_moduleState.centerSmooth));
        row.lastCenter = idx === Math.round(_moduleState.centerSmooth);
      } else {
        _moduleState.rebindContentRow(row, _moduleState.allTracks[idx], idx);
      }
      nextRows.push(row);
    }
    _moduleState.disposeRowList(reusable);
    _moduleState.rows = nextRows;
    _moduleState.rowsDirty = false;
    _moduleState.rowDrawAt = nowT;
    _moduleState.prefetchContentCoversAround(center, 'render-window');
  }

function makeContentListManagerMakeRow(_moduleState, song, i) {
    var cv = document.createElement('canvas');
    cv.width = 800; cv.height = 104;
    var ctx = cv.getContext('2d');
    var tx = new THREE.CanvasTexture(cv);
    tx.minFilter = THREE.LinearFilter; tx.magFilter = THREE.LinearFilter;
    tx.generateMipmaps = false;
    var mat = new THREE.MeshBasicMaterial({ map: tx, transparent: true, opacity: 0.96, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
    var geo = new THREE.PlaneGeometry(2.50, 0.36, 1, 1);
    var mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 240 + i;
    _moduleState.group.add(mesh);
    return { canvas: cv, texture: tx, mesh: mesh, song: song, index: i, fxPulse: 0 };
  }

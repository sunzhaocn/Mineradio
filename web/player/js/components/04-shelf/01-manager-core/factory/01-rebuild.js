'use strict';

function makeShelfManagerRebuild(_moduleState, asyncCards) {
    if (window.mineradioSimplePlayer && window.mineradioSimplePlayer.active()) return;
    if (!_moduleState.group) return;
    _moduleState.cancelCardBuildQueue();
    if (_moduleState.connectorParticles) {
      if (_moduleState.connectorParticles.parent) _moduleState.connectorParticles.parent.remove(_moduleState.connectorParticles);
      if (_moduleState.connectorParticles.geometry) _moduleState.connectorParticles.geometry.dispose();
      if (_moduleState.connectorParticles.material) _moduleState.connectorParticles.material.dispose();
      _moduleState.connectorParticles = null;
    }
    _moduleState.allItems = _moduleState.currentItems();
    _moduleState.lastSig = _moduleState.sig(_moduleState.allItems);
    _moduleState.lastCardRedrawAt = -10;
    _moduleState.lastCardPulseBucket = -1;
    // center 起始 = currentIdx (如果是 queue), 否则 0
    if (_moduleState.allItems.length && _moduleState.allItems[0].type === 'queue' && currentIdx >= 0) {
      _moduleState.centerTarget = Math.min(_moduleState.allItems.length - 1, currentIdx);
      _moduleState.centerSmooth = _moduleState.centerTarget;
      _moduleState.centerIdx = _moduleState.centerTarget;
    } else if (_moduleState.centerTarget >= _moduleState.allItems.length) {
      _moduleState.centerTarget = Math.max(0, _moduleState.allItems.length - 1);
      _moduleState.centerSmooth = _moduleState.centerTarget;
    }
    if (_moduleState.selectedIdx >= _moduleState.allItems.length) _moduleState.selectedIdx = -1;
    _moduleState.syncRenderedWindow(true, !!asyncCards);
    if (_moduleState.mode === 'stage') {
      _moduleState.createStageExtras();
    }
  }

function makeShelfManagerPlaceCard(_moduleState, card, i, totalCards, modeIs) {
    var delta = card.index - _moduleState.centerSmooth;     // 正=下方, 负=上方
    var absD = Math.abs(delta);
    // 隐藏太远的卡 (>4 全隐藏)
    if (absD > _moduleState.SHELF_VISIBLE_RADIUS + 0.5) { card.mesh.visible = false; return; }
    card.mesh.visible = true;
    card.mesh.renderOrder = 60 + Math.round((_moduleState.SHELF_VISIBLE_RADIUS + 1 - Math.min(absD, _moduleState.SHELF_VISIBLE_RADIUS + 1)) * 10);
    var parX = pointerParallax.x || 0;
    var parY = pointerParallax.y || 0;
    var parWeight = Math.max(0, 1 - absD * 0.16);
    var pulse = card.fxPulse || 0;
    var layout = shelfLayoutProfile();
    var shelfLook = shelfSettings();
    var summon = shelfSummonSettings();
    var nextDof = Math.max(0, Math.min(1, (absD - 0.45) / 3.2));
    var nextDofBucket = Math.round(nextDof * 5);
    if (card.dofBucket !== nextDofBucket) {
      card.dofBucket = nextDofBucket;
      card.dofBlur = nextDof;
      _moduleState.drawCard(card, card.item);
    }

    if (modeIs === 'side') {
      // 右侧 3D 架: 恢复更靠近、更斜切的打开姿态，让卡片有真正的前后层次。
      var detailOpenSide = _moduleState.contentList && _moduleState.contentList.isOpen();
      var nowT = uniforms.uTime.value;
      var hoverBreath = (!shelfPinnedOpen && !detailOpenSide) ? shelfVisibility : 0;
      var passiveAlways = shelfAlwaysVisible() && !shelfPinnedOpen && !detailOpenSide;
      var liftTarget = card.selected && _moduleState.shelfPointerSelectionForegroundActive() && !detailOpenSide ? 1 : 0;
      var liftRate = liftTarget > (card.floatMix || 0) ? 0.20 : 0.13;
      card.floatMix = (card.floatMix || 0) + (liftTarget - (card.floatMix || 0)) * liftRate;
      if (!liftTarget && card.floatMix < 0.004) card.floatMix = 0;
      var lift = card.floatMix || 0;
      var sideLayer = Math.max(0, _moduleState.SHELF_VISIBLE_RADIUS + 1 - Math.min(absD, _moduleState.SHELF_VISIBLE_RADIUS + 1));
      card.mesh.renderOrder = passiveAlways
        ? (30 + Math.round(sideLayer * 1.1) + Math.round(lift * 96))
        : (60 + Math.round(sideLayer * 10) + Math.round(lift * 70));
      var breathPulse = hoverBreath * (0.5 + 0.5 * Math.sin(nowT * 1.22 + card.index * 0.74));
      var revealRaw = Math.max(0, Math.min(1, (nowT - shelfOpenAnimAt - absD * 0.035 * summon.stagger) / summon.openDuration));
      var reveal = revealRaw * revealRaw * (3 - 2 * revealRaw);
      var entry = (1 - reveal) * (0.82 + absD * 0.075 * summon.stagger) * summon.slide;
      var paneRaw = Math.max(0, Math.min(1, (nowT - _moduleState.paneSwitchAt - absD * 0.030 * summon.stagger) / Math.max(0.12, summon.openDuration * 1.16)));
      var paneEase = 1 - paneRaw * paneRaw * (3 - 2 * paneRaw);
      var wallpaperShelfPose = shouldUseWallpaperSafeShelfCamera();
      var skullShelfPose = shouldUseSkullSafeShelfCamera();
      var safeShelfPose = wallpaperShelfPose || skullShelfPose;
      var px = layout.sideX + absD * layout.sideXStep - (detailOpenSide ? layout.sideDetailShift : 0) + entry * layout.sideEntryX;
      var py = (layout.sideY || 0) - delta * layout.sideYStep + (1 - reveal) * (delta < 0 ? -0.18 : 0.18) * summon.slide;
      var pz = layout.sideZ - absD * layout.sideZStep - (1 - reveal) * 0.20 * summon.slide;
      px += paneEase * _moduleState.paneSwitchDir * 0.60;
      py += paneEase * (delta < 0 ? -0.16 : 0.16);
      pz -= paneEase * 0.22;
      px += parX * 0.060 * parWeight * summon.parallax;
      py += parY * 0.046 * parWeight * summon.parallax;
      pz += (parY * 0.026 - parX * 0.028) * parWeight * summon.parallax;
      py += Math.sin(nowT * 0.92 + card.index * 0.64) * 0.052 * hoverBreath * Math.max(0.20, parWeight);
      pz += Math.cos(nowT * 0.78 + card.index * 0.52) * 0.030 * hoverBreath * parWeight;
      if (lift > 0.001) {
        px -= lift * (skullShelfPose ? 0.035 : (layout.portrait ? 0.065 : 0.145));
        py += lift * (skullShelfPose ? 0.045 : (layout.portrait ? 0.075 : 0.105));
        pz += lift * (skullShelfPose ? 0.080 : 0.220);
      }
      var revealScale = 1 - (1 - reveal) * 0.12 * summon.scale;
      var scale = (absD < 0.5 ? 1.12 : Math.max(0.55, 1.04 - absD * 0.14)) * revealScale * (1 + pulse * 0.056 + breathPulse * 0.026 + lift * (skullShelfPose ? 0.045 : 0.075)) * layout.sideScale;
      if (wallpaperShelfPose) scale *= 1.22;
      else if (skullShelfPose) scale *= 1.04;
      card.mesh.position.set(px, py, pz);
      if (skullShelfPose && camera) {
        card.mesh.quaternion.copy(camera.quaternion);
        card.mesh.rotateX(layout.sideRotX - delta * 0.008 - parY * 0.004 * parWeight * summon.parallax);
        card.mesh.rotateY(layout.sideRotY + (1 - reveal) * 0.012 * summon.slide + parX * 0.006 * parWeight * summon.parallax);
      } else {
        var safeRotY = wallpaperShelfPose ? 0.12 : layout.sideRotY;
        var safeEntryRotY = wallpaperShelfPose ? 0.05 : 0.16;
        card.mesh.rotation.y = (safeShelfPose ? safeRotY : layout.sideRotY) + (1 - reveal) * safeEntryRotY * summon.slide + parX * (safeShelfPose ? 0.014 : 0.038) * parWeight * summon.parallax;
        var safeRotX = wallpaperShelfPose ? 0.020 : layout.sideRotX;
        card.mesh.rotation.x = -delta * (safeShelfPose ? safeRotX : layout.sideRotX) - parY * (safeShelfPose ? 0.010 : 0.024) * parWeight * summon.parallax;
      }
      card.mesh.scale.setScalar(scale);
      var disabledByDetail = detailOpenSide;
      var opacity = absD < 0.5 ? 1.0 : Math.max(0.22, 1.0 - absD * 0.30);
      if (disabledByDetail) {
        opacity *= card.index === _moduleState.openCardIdx ? 0.16 : 0.08;
        card.mesh.material.color.setScalar(card.index === _moduleState.openCardIdx ? 0.42 : 0.25);
      } else {
        if (passiveAlways) opacity *= 0.92 + lift * 0.08;
        card.mesh.material.color.setScalar(passiveAlways ? (0.96 + lift * 0.04) : 1);
      }
      // v8: 自动隐藏 — shelf 不在 focus 区时整体淡化
      card.mesh.material.opacity = Math.min(1, opacity * (shelfVisibility != null ? shelfVisibility : 1) * reveal * (1 - paneEase * 0.24) + pulse * 0.10 * reveal + breathPulse * 0.035) * shelfLook.opacity;
      _moduleState.setCardCenter(card, absD < 0.5);
    } else {
      // 舞台 PSP: 水平展开 + center 突出, dock 在底部
      var pxStage = (layout.stageX || 0) + delta * layout.stageXStep;
      var pyStage = layout.stageY;
      var pzStage = absD < 0.5 ? layout.stageZ : (layout.stageZ - Math.min(2.0, absD) * 0.55);
      var paneRawS = Math.max(0, Math.min(1, (uniforms.uTime.value - _moduleState.paneSwitchAt - absD * 0.030) / 0.72));
      var paneEaseS = 1 - paneRawS * paneRawS * (3 - 2 * paneRawS);
      pxStage += paneEaseS * _moduleState.paneSwitchDir * 0.80;
      pzStage -= paneEaseS * 0.28;
      pxStage += parX * 0.110 * parWeight;
      pyStage += parY * 0.060 * parWeight;
      pzStage += (parY * 0.040 - parX * 0.035) * parWeight;
      var scaleS = (absD < 0.5 ? 1.20 : Math.max(0.45, 1.0 - absD * 0.22)) * (1 + pulse * 0.060) * layout.stageScale;
      card.mesh.position.set(pxStage, pyStage, pzStage);
      card.mesh.rotation.y = -delta * 0.22 + parX * 0.050 * parWeight;
      card.mesh.rotation.x = 0.10 - absD * 0.04 - parY * 0.028 * parWeight;
      card.mesh.scale.setScalar(scaleS);
      var disabledStage = _moduleState.contentList && _moduleState.contentList.isOpen();
      var opS = absD < 0.5 ? 1.0 : Math.max(0.18, 1.0 - absD * 0.32);
      if (disabledStage) {
        opS *= card.index === _moduleState.openCardIdx ? 0.16 : 0.08;
        card.mesh.material.color.setScalar(card.index === _moduleState.openCardIdx ? 0.42 : 0.25);
      } else {
        card.mesh.material.color.setScalar(1);
      }
      card.mesh.material.opacity = Math.min(1, opS * (shelfVisibility != null ? shelfVisibility : 1) * (1 - paneEaseS * 0.24) + pulse * 0.10) * shelfLook.opacity;
      _moduleState.setCardCenter(card, absD < 0.5);
    }
  }

function makeShelfManagerSetCardCenter(_moduleState, card, isCenter) {
    if (card.isCenter !== isCenter) {
      card.isCenter = isCenter;
      _moduleState.drawCard(card, card.item);
    } else {
      card.isCenter = isCenter;
    }
  }

function makeShelfManagerPlayPlaylistCard(_moduleState, card) {
    if (!card || !card.mesh || !card.mesh.userData) return false;
    var action = card.mesh.userData.action;
    if (!action || action.kind !== 'loadPlaylist' || !action.playlistId) return false;
    if (String(action.playlistId).indexOf('podcast:') === 0) return false;
    _moduleState.pulseCard(card, 1.05);
    if (_moduleState.contentList && _moduleState.contentList.isOpen && _moduleState.contentList.isOpen()) _moduleState.contentList.close();
    _moduleState.openCardIdx = -1;
    setShelfPinnedOpen(false, true);
    if (typeof setFocusZone === 'function') setFocusZone(null, true);
    loadPlaylistIntoQueueById(action.playlistId, true, action.title || (card.item && card.item.title) || '');
    return true;
  }

function makeShelfManagerPulseCard(_moduleState, card, amount) {
    if (!card) return;
    pulseObjectValue(card, 'fxPulse', amount || 1, 0.46);
  }

function makeShelfManagerCreateStageExtras(_moduleState) {
    if (!_moduleState.group) return;
    var pcount = 80;
    var pgeo = new THREE.BufferGeometry();
    var ppos = new Float32Array(pcount * 3);
    var pcol = new Float32Array(pcount * 3);
    var prnd = new Float32Array(pcount);
    for (var i = 0; i < pcount; i++) {
      ppos[i * 3] = (Math.random() - 0.5) * 6;
      ppos[i * 3 + 1] = (Math.random() - 0.5) * 1.2 + 0.3;
      ppos[i * 3 + 2] = 1.0 + Math.random() * 1.5;
      pcol[i * 3] = 0.56; pcol[i * 3 + 1] = 0.91; pcol[i * 3 + 2] = 1.0;
      prnd[i] = Math.random();
    }
    pgeo.setAttribute('position', new THREE.BufferAttribute(ppos, 3));
    pgeo.setAttribute('aColor', new THREE.BufferAttribute(pcol, 3));
    pgeo.setAttribute('aRand', new THREE.BufferAttribute(prnd, 1));
    var pmat = new THREE.ShaderMaterial({
      uniforms: { uTime: uniforms.uTime, uPixel: uniforms.uPixel, uDotTex: uniforms.uDotTex },
      vertexShader: `precision highp float; uniform float uTime, uPixel; attribute vec3 aColor; attribute float aRand;
varying vec3 vC; varying float vA;
void main(){
  vec3 p = position;
  p.x += sin(uTime * 0.4 + aRand * 6.0) * 1.5;
  p.y += sin(uTime * 0.6 + aRand * 4.0) * 0.2;
  p.z += cos(uTime * 0.5 + aRand * 5.0) * 0.4;
  vC = aColor; vA = 0.4 + 0.4 * sin(uTime * 1.5 + aRand * 7.0);
  vec4 m = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = 4.0 * uPixel;
  gl_Position = projectionMatrix * m;
}`,
      fragmentShader: `precision highp float; uniform sampler2D uDotTex;
varying vec3 vC; varying float vA;
void main(){ vec4 t = texture2D(uDotTex, gl_PointCoord); if (t.a < 0.02) discard; gl_FragColor = vec4(vC, t.a * vA); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    _moduleState.connectorParticles = new THREE.Points(pgeo, pmat);
    _moduleState.connectorParticles.frustumCulled = false;
    _moduleState.connectorParticles.renderOrder = 49;
    _moduleState.connectorParticles.position.set(0, -2.2, 0);
    if (_moduleState.group.parent) _moduleState.group.parent.add(_moduleState.connectorParticles); else scene.add(_moduleState.connectorParticles);
  }

function makeShelfManagerSig(_moduleState, items) {
    if (hasAnyPlatformLogin() && (userPlaylists.length || myPodcastCollections.length)) {
      var source = _moduleState.activePlaylists();
      var sampleItems = source.slice(0, 3).concat(source.slice(Math.max(3, source.length - 3)));
      return [
        'platform',
        _moduleState.shelfPane,
        _moduleState.shelfMergesCollections() ? 1 : 0,
        _moduleState.shelfShowsPodcasts() ? 1 : 0,
        source.length,
        myPodcastCollections.length,
        sampleItems.map(function (pl) {
          return [pl.provider || '', pl.id || '', pl.name || '', pl.trackCount || 0, pl.subscribed ? 1 : 0].join('|');
        }).join('||')
      ].join('::');
    }
    var sample = playQueue.slice(0, 3).concat(playQueue.slice(Math.max(3, playQueue.length - 3)));
    return ['queue', playQueue.length, currentIdx, sample.map(function (song, index) { return [queueItemKey(song), song && song.name || '', index].join('|'); }).join('||')].join('::');
  }

function makeShelfManagerSwitchPane(_moduleState, nextPane) {
    if (_moduleState.shelfMergesCollections()) return false;
    if (nextPane === _moduleState.shelfPane) return false;
    _moduleState.paneMemory[_moduleState.shelfPane] = Math.max(0, Math.round(_moduleState.centerTarget));
    _moduleState.shelfPane = nextPane;
    _moduleState.collectionReveal = 0;
    var targetList = _moduleState.activePlaylists();
    var remembered = _moduleState.paneMemory[nextPane] || 0;
    _moduleState.centerTarget = Math.max(0, Math.min(Math.max(0, targetList.length - 1), remembered));
    _moduleState.centerSmooth = _moduleState.centerTarget + (nextPane === 'fav' ? 1.85 : -1.85);
    _moduleState.centerIdx = _moduleState.centerTarget;
    _moduleState.paneSwitchAt = uniforms.uTime.value;
    _moduleState.paneSwitchDir = nextPane === 'fav' ? 1 : -1;
    shelfOpenAnimAt = uniforms.uTime.value;
    if (_moduleState.contentList) _moduleState.contentList.close();
    _moduleState.selectedIdx = Math.round(_moduleState.centerTarget);
    playShelfSelectTick(_moduleState.paneSwitchDir, 'card');
    _moduleState.rebuild();
    showToast(nextPane === 'fav' ? '收藏歌单' : '我的歌单');
    return true;
  }

function makeShelfManagerApplySelectedIndex(_moduleState, idx) {
    idx = idx == null || idx < 0 ? -1 : Math.round(idx);
    _moduleState.selectedIdx = idx;
    _moduleState.cards.forEach(function (c) {
      var next = c.index === _moduleState.selectedIdx;
      if (c.selected !== next) {
        c.selected = next;
        _moduleState.drawCard(c, c.item);
      }
    });
  }

function makeShelfManagerStep(_moduleState, direction) {
    if (!_moduleState.allItems.length) return;
    var panes = _moduleState.splitPlaylists();
    var atEnd = _moduleState.centerTarget >= _moduleState.allItems.length - 1 && direction > 0;
    var atStart = _moduleState.centerTarget <= 0 && direction < 0;
    if (!_moduleState.shelfMergesCollections()) {
      if (hasAnyPlatformLogin() && userPlaylists.length && _moduleState.shelfPane === 'mine' && atEnd && panes.fav.length) {
        _moduleState.collectionReveal += Math.min(1.5, Math.abs(direction));
        if (_moduleState.collectionReveal >= 3) _moduleState.switchPane('fav');
        return;
      }
      if (hasAnyPlatformLogin() && userPlaylists.length && _moduleState.shelfPane === 'fav' && atStart && panes.mine.length) {
        _moduleState.collectionReveal += Math.min(1.5, Math.abs(direction));
        if (_moduleState.collectionReveal >= 3) _moduleState.switchPane('mine');
        return;
      }
    }
    _moduleState.collectionReveal = 0;
    var prevTarget = Math.round(_moduleState.centerTarget);
    _moduleState.centerTarget = Math.max(0, Math.min(_moduleState.allItems.length - 1, _moduleState.centerTarget + direction));
    var nextTarget = Math.round(_moduleState.centerTarget);
    _moduleState.paneMemory[_moduleState.shelfPane] = Math.max(0, Math.round(_moduleState.centerTarget));
    _moduleState.syncRenderedWindow(false);
    _moduleState.applySelectedIndex(nextTarget);
    if (nextTarget !== prevTarget) playShelfSelectTick(direction, 'card');
    _moduleState.pulseCard(_moduleState.cards.find(function (c) { return c.index === nextTarget; }), 0.55);
  }

function makeShelfManagerScreenHitCard(_moduleState, card, sx, sy, pad) {
    if (!card || !card.mesh || !card.mesh.visible || !_moduleState.group || !_moduleState.group.visible) return null;
    var params = card.mesh.geometry && card.mesh.geometry.parameters || {};
    var hw = (params.width || 1.7) / 2;
    var hh = (params.height || 0.85) / 2;
    var pts = [
      new THREE.Vector3(-hw, -hh, 0),
      new THREE.Vector3(hw, -hh, 0),
      new THREE.Vector3(hw, hh, 0),
      new THREE.Vector3(-hw, hh, 0),
    ];
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    card.mesh.updateMatrixWorld(true);
    for (var i = 0; i < pts.length; i++) {
      pts[i].applyMatrix4(card.mesh.matrixWorld).project(camera);
      var x = (pts[i].x + 1) * innerWidth / 2;
      var y = (1 - pts[i].y) * innerHeight / 2;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    pad = pad == null ? 28 : pad;
    if (sx < minX - pad || sx > maxX + pad || sy < minY - pad || sy > maxY + pad) return null;
    var u = clampRange((sx - minX) / Math.max(1, maxX - minX), 0, 1);
    var v = 1 - clampRange((sy - minY) / Math.max(1, maxY - minY), 0, 1);
    return { x: u, y: v };
  }

function makeShelfManagerPickCardAtScreen(_moduleState, sx, sy, pad) {
    if (!_moduleState.cards.length || !_moduleState.group || !_moduleState.group.visible) return null;
    var ordered = _moduleState.cards.slice().sort(function (a, b) { return (b.mesh.renderOrder || 0) - (a.mesh.renderOrder || 0); });
    for (var i = 0; i < ordered.length; i++) {
      var uv = _moduleState.screenHitCard(ordered[i], sx, sy, pad == null ? 72 : pad);
      if (uv) return { card: ordered[i], uv: uv, screenPick: true };
    }
    return null;
  }

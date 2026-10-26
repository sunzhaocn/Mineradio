'use strict';

function makeShelfManagerApi(_moduleState) {
  return {
    setMode: function (m) {
      if (m === _moduleState.mode && _moduleState.group) return;
      _moduleState.mode = m;
      if (m === 'off') {
        if (_moduleState.group) { scene.remove(_moduleState.group); _moduleState.cards.forEach(function (c) { c.texture.dispose(); c.mesh.material.dispose(); c.mesh.geometry.dispose(); }); }
        if (_moduleState.connectorParticles) { scene.remove(_moduleState.connectorParticles); _moduleState.connectorParticles.geometry.dispose(); _moduleState.connectorParticles.material.dispose(); _moduleState.connectorParticles = null; }
        _moduleState.group = null; _moduleState.cards = [];
        if (_moduleState.contentList) _moduleState.contentList.close();
        return;
      }
      if (!_moduleState.group) {
        _moduleState.group = new THREE.Group();
        _moduleState.group.renderOrder = 50;
        scene.add(_moduleState.group);
      }
      var asyncCards = _moduleState.mode === 'side' && document.body.classList.contains('splash-active');
      _moduleState.rebuild(asyncCards);
    },
    getMode: function () { return _moduleState.mode; },
    update: function (dt) {
      if (!_moduleState.group) return;
      // PSP 滚动平滑
      _moduleState.centerSmooth += (_moduleState.centerTarget - _moduleState.centerSmooth) * 0.16;
      if (Math.abs(_moduleState.centerSmooth - _moduleState.centerTarget) < 0.001) _moduleState.centerSmooth = _moduleState.centerTarget;
      var px = pointerParallax.x, py = pointerParallax.y;
      var appRevealed = !document.body.classList.contains('splash-active');
      var cueVis = tickShelfHoverCue(dt);
      // v8: shelf 自动可见度 — 启动页期间不显示；侧栏只在右侧停留时淡入。
      var targetVis;
      if (!appRevealed) {
        targetVis = 0;
      } else if (_moduleState.mode === 'side') {
        var contentOpen = _moduleState.contentList && _moduleState.contentList.isOpen();
        var switchGuard = typeof shelfPlaybackSwitchGuardActive === 'function' && shelfPlaybackSwitchGuardActive();
        if (!_moduleState.allItems.length && !contentOpen) targetVis = 0;
        else if (switchGuard && !contentOpen && !shelfPinnedOpen) targetVis = 0;
        else targetVis = (contentOpen || shelfPinnedOpen || shelfAlwaysVisible()) ? 1.0 : (cueVis > 0.01 ? Math.max(0.16, cueVis * 0.88) : 0);
      } else {
        targetVis = _moduleState.allItems.length ? 1.0 : 0;
      }
      var summonVis = shelfSummonSettings();
      var visDuration = targetVis > shelfVisibility
        ? Math.max(0.05, summonVis.openDuration * 0.45)
        : Math.max(0.05, summonVis.closeDuration * 0.65);
      shelfVisibility += (targetVis - shelfVisibility) * durationEaseFactor(visDuration, dt);
      if (shelfVisibility < 0.01 && targetVis === 0) shelfVisibility = 0;
      _moduleState.group.visible = appRevealed && (_moduleState.mode !== 'side' || shelfVisibility > 0) && (_moduleState.allItems.length > 0 || (_moduleState.contentList && _moduleState.contentList.isOpen()));
      if (_moduleState.connectorParticles) _moduleState.connectorParticles.visible = _moduleState.group.visible && _moduleState.mode === 'stage';
      if (_moduleState.mode === 'side') {
        var contentOpenForLayer = !!(_moduleState.contentList && _moduleState.contentList.isOpen());
        var passiveAlwaysGroup = shelfAlwaysVisible() && !shelfPinnedOpen && !contentOpenForLayer;
        var pointerSelectionForeground = _moduleState.shelfPointerSelectionForegroundActive();
        var liftedCardActive = passiveAlwaysGroup && _moduleState.cards.some(function (c) {
          return (pointerSelectionForeground && c.selected) || (c.floatMix || 0) > 0.025;
        });
        _moduleState.group.renderOrder = (contentOpenForLayer || shelfPinnedOpen || liftedCardActive) ? 300 : 30;
        _moduleState.group.position.set(0, 0, 0);
        var bindToCover = (shelfAlwaysVisible() || shelfPinnedOpen || shelfVisibility > 0.06) && particles && particles.rotation && !(_moduleState.contentList && _moduleState.contentList.isOpen());
        if (bindToCover) {
          var bindEase = uniforms.uTime.value < _moduleState.coverBindResumeUntil ? 0.18 : 0.075;
          _moduleState.group.rotation.x += ((particles.rotation.x - py * 0.010) - _moduleState.group.rotation.x) * bindEase;
          _moduleState.group.rotation.y += ((particles.rotation.y + px * 0.018) - _moduleState.group.rotation.y) * bindEase;
          _moduleState.group.rotation.z += (particles.rotation.z - _moduleState.group.rotation.z) * bindEase;
        } else {
          _moduleState.group.rotation.y += ((px * 0.018) - _moduleState.group.rotation.y) * 0.045;
          _moduleState.group.rotation.x += ((-py * 0.010) - _moduleState.group.rotation.x) * 0.045;
          _moduleState.group.rotation.z += (0 - _moduleState.group.rotation.z) * 0.045;
        }
      } else {
        _moduleState.group.renderOrder = ((_moduleState.contentList && _moduleState.contentList.isOpen()) || _moduleState.selectedIdx >= 0) ? 300 : 30;
        var t = uniforms.uTime.value;
        _moduleState.group.position.y = Math.sin(t * 0.3) * 0.04;
        _moduleState.group.position.x = px * 0.10;
        _moduleState.group.rotation.y = px * 0.025;
        _moduleState.group.rotation.x = -py * 0.012;
      }
      for (var i = 0; i < _moduleState.cards.length; i++) {
        _moduleState.placeCard(_moduleState.cards[i], i, _moduleState.cards.length, _moduleState.mode);
      }
      // 内容更新 (节流)
      if (uniforms.uTime.value - _moduleState.lastUpdate > 0.8) {
        _moduleState.lastUpdate = uniforms.uTime.value;
        var nextSig = _moduleState.sig();
        if (nextSig !== _moduleState.lastSig) _moduleState.rebuild();
        else {
          var pulseBucket = Math.round((bass + beatPulse * 0.85) * 10);
          var redrawInterval = playing ? 1.35 : 4.0;
          if (pulseBucket !== _moduleState.lastCardPulseBucket || uniforms.uTime.value - _moduleState.lastCardRedrawAt > redrawInterval) {
            _moduleState.lastCardPulseBucket = pulseBucket;
            _moduleState.lastCardRedrawAt = uniforms.uTime.value;
            _moduleState.cards.forEach(function (c) {
              c.item = _moduleState.allItems[c.index] || c.item;
              c.isCenter = Math.abs(c.index - _moduleState.centerSmooth) < 0.5;
              if (c.isCenter || c.dofBucket <= 1 || c.index === currentIdx) _moduleState.drawCard(c, c.item);
            });
          }
        }
      }
      // 二级内容框 update
      if (_moduleState.contentList) _moduleState.contentList.update(dt);
    },
    onCoverChange: function () {
      _moduleState.coverBindResumeUntil = uniforms && uniforms.uTime ? uniforms.uTime.value + 1.2 : _moduleState.coverBindResumeUntil;
      if (_moduleState.group && _moduleState.mode === 'side' && (shelfAlwaysVisible() || shelfPinnedOpen || shelfVisibility > 0.06) && particles && particles.rotation && !(_moduleState.contentList && _moduleState.contentList.isOpen())) {
        _moduleState.group.rotation.x += (particles.rotation.x - _moduleState.group.rotation.x) * 0.28;
        _moduleState.group.rotation.y += (particles.rotation.y - _moduleState.group.rotation.y) * 0.28;
        _moduleState.group.rotation.z += (particles.rotation.z - _moduleState.group.rotation.z) * 0.28;
      }
      if (_moduleState.group && _moduleState.mode !== 'off' && uniforms.uTime.value - _moduleState.lastUpdate > 0.2) {
        _moduleState.lastUpdate = uniforms.uTime.value;
        _moduleState.rebuild();
      }
    },
    rebuild: _moduleState.rebuild,
    refreshTheme: function () {
      _moduleState.cards.forEach(function (c) {
        c.drawKey = '';
        _moduleState.drawCard(c, c.item);
      });
      if (_moduleState.contentList && _moduleState.contentList.refreshTheme) _moduleState.contentList.refreshTheme();
    },
    raycastCards: function (raycaster) {
      if (!_moduleState.group || !_moduleState.group.visible || !_moduleState.cards.length) return null;
      var visibleMeshes = _moduleState.cards.filter(function (c) { return c.mesh.visible; }).map(function (c) { return c.mesh; });
      var hits = raycaster.intersectObjects(visibleMeshes, false);
      if (!hits.length) return null;
      var card = _moduleState.cards.find(function (c) { return c.mesh === hits[0].object; });
      return { card: card, point: hits[0].point, uv: hits[0].uv };
    },
    pickCardAtScreen: _moduleState.pickCardAtScreen,
    // PSP 步进
    next: function () { _moduleState.step(1); },
    prev: function () { _moduleState.step(-1); },
    scrollBy: function (d) { _moduleState.step(d); },
    getCenterIdx: function () { return Math.round(_moduleState.centerSmooth); },
    getCardAt: function (idx) { return _moduleState.cards.find(function (c) { return c.index === idx; }); },
    getCards: function () { return _moduleState.cards; },
    playPlaylistAt: function (idx) {
      return _moduleState.playPlaylistCard(_moduleState.cards.find(function (c) { return c.index === idx; }));
    },
    clearSelected: function () {
      _moduleState.applySelectedIndex(-1);
    },
    setSelected: function (idx) {
      _moduleState.applySelectedIndex(idx);
    },
    triggerAction: function (action) {
      if (!action) return;
      var card = _moduleState.cards.find(function (c) { return c.mesh.userData.action === action; });
      _moduleState.pulseCard(card, action.kind === 'loadPlaylist' ? 1.0 : 0.70);
      if (action.kind === 'playQueue') {
        playQueueAt(action.index);
      } else if (action.kind === 'loadPlaylist') {
        if (!_moduleState.contentList) _moduleState.contentList = makeContentListManager();
        _moduleState.openCardIdx = card ? card.index : -1;
        _moduleState.contentList.open(action.playlistId, action.title || (card && card.item.title), card);
        setShelfPinnedOpen(true, true);
        if (typeof updateEmptyHomeVisibility === 'function') updateEmptyHomeVisibility({ forceLoad: false });
        if (typeof setFocusZone === 'function') setFocusZone('shelf-detail', true);
      } else if (action.kind === 'empty') {
        togglePlaylistPanel(true);
      }
    },
    // 二级内容框 open/close
    openContent: function (cardIdx) {
      var card = _moduleState.cards.find(function (c) { return c.index === cardIdx; });
      if (!card) return;
      var action = card.mesh.userData.action;
      if (!action) return;
      _moduleState.pulseCard(card, 1.0);
      // queue 类型 → 直接播放, 不需要内容框
      if (action.kind === 'playQueue') {
        playQueueAt(action.index);
        return;
      }
      if (action.kind === 'loadPlaylist') {
        if (!_moduleState.contentList) _moduleState.contentList = makeContentListManager();
        _moduleState.openCardIdx = card.index;
        _moduleState.contentList.open(action.playlistId, action.title || card.item.title, card);
        setShelfPinnedOpen(true, true);
        if (typeof updateEmptyHomeVisibility === 'function') updateEmptyHomeVisibility({ forceLoad: false });
        if (typeof setFocusZone === 'function') setFocusZone('shelf-detail', true);
      }
      if (action.kind === 'empty') togglePlaylistPanel(true);
    },
    closeContent: function () {
      _moduleState.openCardIdx = -1;
      if (_moduleState.contentList) _moduleState.contentList.close();
      var hint = document.getElementById('hint');
      if (hint) hint.classList.toggle('shelf-hidden', shelfPinnedOpen);
      if (typeof setFocusZone === 'function') setFocusZone(shelfPinnedOpen ? 'shelf-side' : null, true);
      if (typeof updateEmptyHomeVisibility === 'function') updateEmptyHomeVisibility({ forceLoad: false });
    },
    hasOpenContent: function () { return _moduleState.contentList && _moduleState.contentList.isOpen(); },
    getContentList: function () { return _moduleState.contentList; },
    getOpenContentIndex: function () { return _moduleState.openCardIdx; },
    canInteract: function () { return _moduleState.mode !== 'off' && _moduleState.allItems.length > 0; }
  };
}

function makeShelfManagerInitialize(_moduleState) {
_moduleState.group = null;
_moduleState.cards = [];
_moduleState.allItems = [];
_moduleState.renderedStart = -1;
_moduleState.SHELF_VISIBLE_RADIUS = 5;
_moduleState.SHELF_MAX_RENDER = _moduleState.SHELF_VISIBLE_RADIUS * 2 + 1;
_moduleState.shelfPane = 'mine';
_moduleState.collectionReveal = 0;
_moduleState.paneMemory = { mine: 0, fav: 0 };
_moduleState.paneSwitchAt = -10;
_moduleState.paneSwitchDir = 1;
_moduleState.mode = 'side';
_moduleState.lastSig = '';
_moduleState.lastUpdate = 0;
_moduleState.lastCardRedrawAt = -10;
_moduleState.lastCardPulseBucket = -1;
_moduleState.cardBuildQueue = null;
_moduleState.selectedIdx = -1;
_moduleState.coverBindResumeUntil = -10;
_moduleState.centerIdx = 0;
_moduleState.centerTarget = 0;
_moduleState.centerSmooth = 0;
_moduleState.openCardIdx = -1;
_moduleState.contentList = null;
_moduleState.connectorParticles = null;
_moduleState.playlistPaneCache = { revision: -1, source: null, mine: [], fav: [] };
return makeShelfManagerApi(_moduleState);
}

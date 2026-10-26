'use strict';


function renderAudioOutputDeviceUi() {
  var list = document.getElementById('audio-output-list');
  if (!list) return;
  var outputs = [{ deviceId: '', label: '系统默认' }].concat(audioOutputDevices || []);
  var bridgeId = recommendedAudioInputBridgeDeviceId();
  var bridgeEnabled = !!(audioInputBridgeState && audioInputBridgeState.enabled);
  var mirrorIds = normalizeAudioOutputIdList(audioOutputMirrorDeviceIds);
  var outputItems = outputs.map(function (device, index) {
    return {
      device: device,
      index: index,
      id: device && device.deviceId ? String(device.deviceId) : '',
      label: audioOutputDeviceLabel(device, index)
    };
  });
  function sortedRouteItems(items, rank) {
    return items.slice().sort(function (a, b) {
      var ra = rank(a);
      var rb = rank(b);
      if (ra !== rb) return ra - rb;
      return String(a.label || '').localeCompare(String(b.label || ''), 'zh-Hans-CN');
    });
  }
  var primaryItems = sortedRouteItems(outputItems, function (item) {
    if (item.id === (audioOutputDeviceId || '')) return 0;
    if (!item.id) return 1;
    return 2;
  });
  var mirrorItems = sortedRouteItems(outputItems.filter(function (item) { return !!item.id; }), function (item) {
    if (mirrorIds.indexOf(item.id) >= 0 && item.id !== (audioOutputDeviceId || '')) return 0;
    if (isVirtualMicOutputDevice(item.device)) return 1;
    if (item.id === (audioOutputDeviceId || '')) return 3;
    return 2;
  });
  var primaryHtml = primaryItems.map(function (item) {
    var device = item.device;
    var index = item.index;
    var id = device && device.deviceId ? String(device.deviceId) : '';
    var active = id === (audioOutputDeviceId || '');
    var virtualClass = device && device.deviceId && isVirtualMicOutputDevice(device) ? ' virtual' : '';
    return '<button class="audio-route-node output workflow-node' + virtualClass + (active ? ' active connected' : '') + '" type="button" data-output-primary="' + escHtml(id) + '" title="' + escHtml(audioOutputDeviceLabel(device, index)) + '">' +
      '<span class="flow-port in" data-output-primary-target="' + escHtml(id) + '" title="连接为主输出"></span><span class="route-node-icon">' + (id ? 'OUT' : 'SYS') + '</span><span class="route-node-text"><b>' + escHtml(audioOutputDeviceLabel(device, index)) + '</b><small>' + (active ? '主输出已连接' : '拖线连接主输出') + '</small></span>' +
      '<span class="route-node-pulse"></span></button>';
  }).join('');
  var mirrorHtml = mirrorItems.map(function (item) {
    var device = item.device;
    var index = item.index;
    var id = String(device.deviceId || '');
    var disabled = id === (audioOutputDeviceId || '');
    var active = mirrorIds.indexOf(id) >= 0 && !disabled;
    var rt = audioOutputMirrorRuntimeFor(id);
    var pendingClass = active && (!rt || rt.state !== 'playing') ? ' pending' : '';
    var warningClass = active && rt && (rt.state === 'sink-error' || rt.state === 'play-error' || rt.state === 'unsupported') ? ' warning' : '';
    return '<button class="audio-route-node mirror workflow-node' + (active ? ' active connected' : '') + pendingClass + warningClass + (disabled ? ' disabled' : '') + '" type="button" data-output-mirror="' + escHtml(id) + '" title="' + escHtml(audioOutputDeviceLabel(device, index)) + '">' +
      '<span class="flow-port in" data-output-mirror-target="' + escHtml(id) + '" title="连接为实验镜像监听"></span><span class="route-node-icon">MON</span><span class="route-node-text"><b>' + escHtml(audioOutputDeviceLabel(device, index)) + '</b><small>' + escHtml(audioOutputMirrorStatusText(id, active, disabled)) + '</small></span>' +
      '<span class="route-node-pulse"></span></button>';
  }).join('');
  var bridgeDevice = bridgeId ? audioOutputDeviceById(bridgeId) : null;
  var bridgeLabel = bridgeDevice ? audioOutputDeviceLabel(bridgeDevice, 0) : '未检测到 VB-CABLE / VoiceMeeter';
  var inputHint = (audioInputDevices || []).slice(0, 2).map(function (device, index) { return audioInputDeviceLabel(device, index); }).join(' / ');
  var activePrimary = audioOutputDeviceId ? audioOutputDeviceById(audioOutputDeviceId) : null;
  var summaryText = audioOutputDeviceStatusText();
  var mirrorCount = mirrorIds.filter(function (id) { return id && id !== (audioOutputDeviceId || ''); }).length;
  var mirrorConfirmedCount = audioOutputMirrorConfirmedCount(mirrorIds);
  var mirrorStateLabel = mirrorCount ? (mirrorConfirmedCount ? ('已确认 ' + mirrorConfirmedCount + '/' + mirrorCount) : ('待确认 ' + mirrorCount + ' 路')) : '关闭';
  var workflowHtml =
    '<div class="audio-route-graph' + (bridgeEnabled ? ' bridge-on' : '') + '">' +
      '<svg id="audio-route-workflow-svg" class="workflow-link-layer audio-link-layer" aria-hidden="true"></svg>' +
      '<div class="audio-flow-source workflow-node" data-audio-node="player">' +
        '<span class="route-node-kicker">SOURCE</span><span class="route-node-icon">MR</span><span class="route-node-text"><b>Mineradio Player</b><small>' + escHtml(summaryText) + '</small></span><span class="audio-source-meter" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span class="flow-port out" data-audio-route-source="player" title="Mineradio 输出"></span>' +
      '</div>' +
      '<div class="audio-route-status"><span class="route-energy-dot"></span><b>Patch Bay</b><small>' + escHtml(audioOutputDeviceId ? '主监听已指定' : '主监听跟随系统默认') + '</small></div>' +
      '<div class="audio-route-board">' +
        '<div class="audio-route-board-head">' +
          '<span class="route-board-title"><b>路由矩阵</b><small>Patch Bay</small></span>' +
          '<span class="route-board-badges"><span class="audio-route-chip active">主监听 ' + escHtml(activePrimary ? audioOutputDeviceLabel(activePrimary, 0) : '系统默认') + '</span>' +
          '<span class="audio-route-chip">镜像监听 ' + escHtml(mirrorStateLabel) + '</span>' +
          '<span class="audio-route-chip' + (bridgeEnabled ? ' active' : '') + '">虚拟麦克风 ' + (bridgeEnabled ? '已接入' : '未接入') + '</span></span>' +
        '</div>' +
        '<div class="audio-route-lanes">' +
          '<div class="route-lane primary"><div class="route-lane-head"><span class="route-lane-index">01</span><span><b>主监听</b><small>播放器默认输出端</small></span><em class="route-lane-state">' + escHtml(activePrimary ? '已指定' : '系统默认') + '</em></div><div class="route-node-grid">' + primaryHtml + '</div></div>' +
          '<div class="route-lane mirror"><div class="route-lane-head"><span class="route-lane-index">02</span><span><b>镜像监听</b><small>实验功能：复制播放流到另一输出</small></span><em class="route-lane-state">' + escHtml(mirrorStateLabel) + '</em></div><div class="route-node-grid mirror-grid">' + (mirrorHtml || '<div class="audio-route-empty">没有可镜像的输出设备</div>') + '</div><div class="audio-route-note">镜像监听不是系统级多输出，可能有轻微延迟或因平台音源失效；直播/语音输入建议走虚拟声卡桥接。</div></div>' +
          '<div class="route-lane bridge"><div class="route-lane-head"><span class="route-lane-index">03</span><span><b>虚拟麦克风</b><small>' + escHtml(inputHint || '游戏 / 语音软件从对应输入端接收') + '</small></span><em class="route-lane-state">' + escHtml(bridgeEnabled ? '已桥接' : '未接入') + '</em></div>' +
            '<div class="route-node-grid bridge-grid"><button class="audio-route-node bridge workflow-node' + (bridgeEnabled ? ' active connected' : '') + (!bridgeId ? ' disabled' : '') + '" type="button" data-input-bridge="' + escHtml(bridgeId) + '">' +
              '<span class="flow-port in" data-input-bridge-target="' + escHtml(bridgeId) + '" title="虚拟麦克风输入"></span><span class="route-node-icon">MIC</span><span class="route-node-text"><b>' + escHtml(bridgeLabel) + '</b><small>' + escHtml(bridgeEnabled ? '已送入虚拟输入链路' : (bridgeId ? '可接入虚拟输入链路' : '需要虚拟声卡线缆')) + '</small></span><span class="route-node-pulse"></span>' +
            '</button></div>' +
            '<div class="audio-route-note">' + escHtml(inputHint ? ('输入端: ' + inputHint) : '真实麦克风不能被直接写入；请在游戏或语音软件里选择虚拟声卡的输入端。') + '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  var workflowSubtitle = document.getElementById('audio-output-workflow-subtitle');
  if (workflowSubtitle) workflowSubtitle.textContent = summaryText;
  list.innerHTML =
    '<button class="audio-output-summary-card" type="button" onclick="openAudioOutputWorkflowPanel()">' +
      '<span class="route-node-icon">MR</span>' +
      '<span class="audio-output-summary-copy"><b>' + escHtml(summaryText) + '</b><small>' +
        escHtml((activePrimary ? '主输出已指定' : '主输出使用系统默认') + ' / 镜像监听 ' + mirrorStateLabel + ' / 桥接 ' + (bridgeEnabled ? '开启' : '关闭')) +
      '</small></span>' +
      '<span class="audio-output-summary-action">路由</span>' +
    '</button>';
  var workflowBody = document.getElementById('audio-output-workflow-body');
  if (workflowBody) workflowBody.innerHTML = workflowHtml;
  requestAnimationFrame(function () { renderAudioRouteWorkflowEdges(); });
}

function openAudioOutputWorkflowPanel() {
  var modal = document.getElementById('audio-output-workflow-modal');
  if (!modal) return;
  openGsapModal(modal);
  bindAudioOutputControls();
  renderAudioOutputDeviceUi();
  requestAnimationFrame(function () {
    renderAudioRouteWorkflowEdges();
    setTimeout(renderAudioRouteWorkflowEdges, 80);
  });
  refreshAudioOutputDevices(false);
}

function closeAudioOutputWorkflowPanel() {
  closeGsapModal(document.getElementById('audio-output-workflow-modal'));
}

async function refreshAudioOutputDevices(showNotice) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
    audioOutputDevices = [];
    audioInputDevices = [];
    renderAudioOutputDeviceUi();
    if (showNotice) showToast('当前环境不支持输出接口选择');
    return;
  }
  try {
    var devices = await navigator.mediaDevices.enumerateDevices();
    audioOutputDevices = devices.filter(function (device) { return device && device.kind === 'audiooutput' && device.deviceId !== 'default'; });
    audioInputDevices = devices.filter(function (device) { return device && device.kind === 'audioinput' && device.deviceId !== 'default'; });
    if (audioInputBridgeState && audioInputBridgeState.enabled && audioInputBridgeState.deviceId && !audioOutputDeviceById(audioInputBridgeState.deviceId)) {
      audioInputBridgeState.enabled = false;
      saveAudioInputBridgePreference();
    }
    renderAudioOutputDeviceUi();
    if (showNotice) showToast('输出接口已刷新');
  } catch (e) {
    audioOutputDevices = [];
    audioInputDevices = [];
    renderAudioOutputDeviceUi();
    if (showNotice) showToast('输出接口读取失败');
  }
}

function bindAudioOutputMirrorEvents(media) {
  if (!media || media._mineradioAudioMirrorBound) return;
  media._mineradioAudioMirrorBound = true;
  ['play', 'playing', 'pause', 'ended', 'seeking', 'seeked', 'ratechange', 'volumechange', 'emptied'].forEach(function (name) {
    media.addEventListener(name, function () { syncAudioOutputMirrors(name); });
  });
}

function removeAudioOutputMirror(id) {
  var mirror = audioOutputMirrorElements && audioOutputMirrorElements[id];
  if (mirror) {
    try { mirror.pause(); } catch (e) { }
    try { mirror.removeAttribute('src'); mirror.load(); } catch (e) { }
    delete audioOutputMirrorElements[id];
  }
  if (audioOutputMirrorRuntime && id) delete audioOutputMirrorRuntime[id];
}

function clearAudioOutputMirrors() {
  Object.keys(audioOutputMirrorElements || {}).forEach(removeAudioOutputMirror);
  if (audioOutputMirrorSyncTimer) {
    clearInterval(audioOutputMirrorSyncTimer);
    audioOutputMirrorSyncTimer = 0;
  }
}

async function applyAudioOutputMirrorSink(mirror, sinkId) {
  if (!mirror || typeof mirror.setSinkId !== 'function') {
    markAudioOutputMirrorRuntime(sinkId, 'unsupported', '内核不支持');
    return false;
  }
  try {
    markAudioOutputMirrorRuntime(sinkId, 'sink-pending', '正在选择设备');
    await mirror.setSinkId(sinkId);
    markAudioOutputMirrorRuntime(sinkId, 'sink-ready', '设备已选');
    return true;
  } catch (e) {
    markAudioOutputMirrorRuntime(sinkId, 'sink-error', audioOutputMirrorReadableError(e));
    console.warn('[AudioOutputMirror]', e);
    return false;
  }
}

function syncAudioOutputMirrors(reason) {
  var ids = normalizeAudioOutputIdList(audioOutputMirrorDeviceIds).filter(function (id) { return id && id !== (audioOutputDeviceId || ''); });
  var src = audio && (audio.currentSrc || audio.src || '');
  Object.keys(audioOutputMirrorRuntime || {}).forEach(function (id) {
    if (ids.indexOf(id) < 0) delete audioOutputMirrorRuntime[id];
  });
  if (!ids.length) {
    clearAudioOutputMirrors();
    return;
  }
  if (!audioOutputMirrorSinkSupported()) {
    clearAudioOutputMirrors();
    ids.forEach(function (id) { markAudioOutputMirrorRuntime(id, 'unsupported', '内核不支持'); });
    return;
  }
  if (!audio || !src) {
    clearAudioOutputMirrors();
    ids.forEach(function (id) { markAudioOutputMirrorRuntime(id, 'waiting', '待播放时尝试'); });
    return;
  }
  Object.keys(audioOutputMirrorElements || {}).forEach(function (id) {
    if (ids.indexOf(id) < 0) removeAudioOutputMirror(id);
  });
  ids.forEach(function (id) {
    var mirror = audioOutputMirrorElements[id];
    if (!mirror) {
      mirror = new Audio();
      mirror.crossOrigin = 'anonymous';
      mirror.preload = 'auto';
      mirror.muted = !!audio.muted;
      mirror.volume = audio.volume;
      mirror.playbackRate = audio.playbackRate || 1;
      audioOutputMirrorElements[id] = mirror;
    }
    if (mirror._mineradioSinkId !== id || !mirror._mineradioSinkReady) {
      mirror._mineradioSinkId = id;
      if (!mirror._mineradioSinkBusy) {
        mirror._mineradioSinkBusy = true;
        Promise.resolve(applyAudioOutputMirrorSink(mirror, id)).then(function (ok) {
          mirror._mineradioSinkBusy = false;
          mirror._mineradioSinkReady = !!ok;
          if (ok) syncAudioOutputMirrors('mirror-sink-ready');
        });
      }
    }
    if ((mirror.currentSrc || mirror.src || '') !== src) {
      try { mirror.src = src; mirror.load(); } catch (e) { }
    }
    try { mirror.muted = !!audio.muted; mirror.volume = audio.volume; mirror.playbackRate = audio.playbackRate || 1; } catch (e) { }
    try {
      if (isFinite(audio.currentTime) && Math.abs((mirror.currentTime || 0) - audio.currentTime) > 0.22) {
        mirror.currentTime = audio.currentTime;
      }
    } catch (e) { }
    if (!mirror._mineradioSinkReady) return;
    if (audio.paused || audio.ended) {
      try { mirror.pause(); } catch (e) { }
      markAudioOutputMirrorRuntime(id, 'paused', '随主播放器暂停');
    } else {
      var rt = audioOutputMirrorRuntimeFor(id);
      if (!rt || rt.state !== 'playing') markAudioOutputMirrorRuntime(id, 'play-pending', '正在播放');
      var p = mirror.play();
      if (p && p.then) {
        p.then(function () {
          markAudioOutputMirrorRuntime(id, 'playing', '已确认');
        }).catch(function (e) {
          markAudioOutputMirrorRuntime(id, 'play-error', audioOutputMirrorReadableError(e));
          console.warn('[AudioOutputMirror] play failed:', e);
        });
      } else {
        markAudioOutputMirrorRuntime(id, 'playing', '已确认');
      }
    }
  });
  if (!audioOutputMirrorSyncTimer) {
    audioOutputMirrorSyncTimer = setInterval(function () { syncAudioOutputMirrors('clock'); }, 2200);
  }
}

async function applyAudioOutputDevice(media) {
  var sinkId = audioOutputDeviceId || '';
  var hasTarget = !!(media || audioCtx || uiSfxCtx);
  var mediaResult = null;
  var contextResult = null;
  var sfxResult = null;
  var errors = [];
  async function applySink(target, label) {
    if (!target) return null;
    if (typeof target.setSinkId !== 'function') return false;
    try {
      await target.setSinkId(sinkId);
      return true;
    } catch (e) {
      errors.push({ label: label, error: e });
      return false;
    }
  }
  bindAudioOutputMirrorEvents(media);
  mediaResult = await applySink(media, 'audio');
  contextResult = await applySink(audioCtx, 'audio-context');
  sfxResult = await applySink(uiSfxCtx, 'ui-sfx');
  var webAudioRouteActive = !!(audioReady && audioCtx && gainNode);
  var ok = webAudioRouteActive ? contextResult === true : (mediaResult === true || contextResult === true);
  if (sfxResult === true && !webAudioRouteActive && !media) ok = true;
  syncAudioOutputMirrors('apply-device');
  if (ok) {
    renderAudioOutputDeviceUi();
    return true;
  }
  if (!hasTarget) {
    renderAudioOutputDeviceUi();
    return null;
  }
  if (errors.length) {
    console.warn('[AudioOutput]', errors);
    if (errors.some(function (item) { return item.error && item.error.name === 'NotFoundError'; })) {
      audioOutputDeviceId = '';
      saveAudioOutputDevicePreference();
    }
  }
  renderAudioOutputDeviceUi();
  return false;
}

function setAudioOutputDevice(deviceId, showNotice) {
  audioOutputDeviceId = String(deviceId || '');
  var requestedDeviceId = audioOutputDeviceId;
  if (!requestedDeviceId || requestedDeviceId !== (audioInputBridgeState && audioInputBridgeState.deviceId || '')) {
    if (audioInputBridgeState && audioInputBridgeState.enabled) {
      audioInputBridgeState.enabled = false;
      saveAudioInputBridgePreference();
    }
  }
  audioOutputMirrorDeviceIds = normalizeAudioOutputIdList(audioOutputMirrorDeviceIds).filter(function (id) { return id !== requestedDeviceId; });
  saveAudioOutputMirrorPreference();
  saveAudioOutputDevicePreference();
  renderAudioOutputDeviceUi();
  Promise.resolve(applyAudioOutputDevice(audio)).then(function (ok) {
    if (!showNotice) return;
    if (!requestedDeviceId) showToast('已切回系统默认输出');
    else if (ok === true) showToast('输出接口已切换');
    else if (ok === null) showToast('输出接口已保存，播放时自动启用');
    else if (audioReady && audioCtx && typeof audioCtx.setSinkId !== 'function') showToast('当前内核不支持频谱输出实时切换，已保存选择');
    else showToast('当前输出接口暂不可用，已保存选择');
  });
}

function toggleAudioOutputMirrorDevice(deviceId) {
  deviceId = String(deviceId || '');
  if (!deviceId) return;
  if (!audioOutputMirrorSinkSupported()) {
    markAudioOutputMirrorRuntime(deviceId, 'unsupported', '内核不支持');
    showToast('当前内核不支持实验镜像监听');
    return;
  }
  if (deviceId === (audioOutputDeviceId || '')) {
    showToast('这个接口已经是主输出');
    return;
  }
  var ids = normalizeAudioOutputIdList(audioOutputMirrorDeviceIds);
  var pos = ids.indexOf(deviceId);
  if (pos >= 0) {
    ids.splice(pos, 1);
    removeAudioOutputMirror(deviceId);
    showToast('已关闭实验镜像监听');
  } else {
    ids.push(deviceId);
    markAudioOutputMirrorRuntime(deviceId, audio && (audio.currentSrc || audio.src || '') ? 'sink-pending' : 'waiting', audio && (audio.currentSrc || audio.src || '') ? '正在尝试' : '待播放时尝试');
    showToast(audio && (audio.currentSrc || audio.src || '') ? '正在尝试实验镜像监听' : '已保存实验镜像监听，播放时尝试启用');
  }
  audioOutputMirrorDeviceIds = normalizeAudioOutputIdList(ids);
  saveAudioOutputMirrorPreference();
  renderAudioOutputDeviceUi();
  syncAudioOutputMirrors('mirror-toggle');
}
'use strict';

function installSonicWorkshopPresetCloneWorkshopTheme(_moduleState, theme) {
    theme = theme || _moduleState.workshopCustomThemeForColor('#cb6c89');
    var out = {
      name: theme.name || 'Mineradio Region Palette',
      id: theme.id || 'mineradio-custom',
      __primaryColor: _moduleState.normalizeHex(theme.__primaryColor || '#cb6c89', '#cb6c89'),
      uGlowIntensity: Number(theme.uGlowIntensity) || 1
    };
    _moduleState.WORKSHOP_THEME_COLOR_KEYS.forEach(function (key) {
      out[key] = _moduleState.normalizeHex(theme[key] || '#000000', '#000000');
    });
    return out;
  }

function installSonicWorkshopPresetMixWorkshopTheme(_moduleState, from, to, t) {
    from = _moduleState.cloneWorkshopTheme(from);
    to = _moduleState.cloneWorkshopTheme(to);
    t = _moduleState.clamp01(t);
    var out = {
      name: to.name || from.name || 'Mineradio Region Palette',
      id: to.id || from.id || 'mineradio-custom',
      __primaryColor: _moduleState.mixHex(from.__primaryColor, to.__primaryColor, t),
      uGlowIntensity: Number((from.uGlowIntensity + (to.uGlowIntensity - from.uGlowIntensity) * t).toFixed(3))
    };
    _moduleState.WORKSHOP_THEME_COLOR_KEYS.forEach(function (key) {
      out[key] = _moduleState.mixHex(from[key], to[key], t);
    });
    return out;
  }

function installSonicWorkshopPresetWorkshopEase(_moduleState, t) {
    t = _moduleState.clamp01(t);
    return 0.5 - Math.cos(Math.PI * t) * 0.5;
  }

function installSonicWorkshopPresetScheduleWorkshopThemeTransition(_moduleState) {
    if (!_moduleState.state.themeTransition || _moduleState.state.themeTransitionRaf) return;
    var raf = _moduleState.global.requestAnimationFrame || function (fn) { return setTimeout(function () { fn(_moduleState.nowMs()); }, 33); };
    _moduleState.state.themeTransitionRaf = raf(function () {
      _moduleState.state.themeTransitionRaf = 0;
      if (_moduleState.state.themeTransition) _moduleState.pushProperties(true);
    });
  }

function installSonicWorkshopPresetApplyWorkshopThemeTransition(_moduleState, props) {
    if (!props || !props.mineradioCustomTheme) return props;
    var target = _moduleState.cloneWorkshopTheme(props.mineradioCustomTheme);
    _moduleState.state.displayedTheme = target;
    _moduleState.state.themeTransition = null;
    props.mineradioCustomTheme = target;
    props.schemecolor = _moduleState.hexToSchemeColor(target.__primaryColor);
    return props;
  }

function installSonicWorkshopPresetBuildMediaState(_moduleState) {
    var song = _moduleState.currentSong();
    var cover = '';
    if (song && typeof _moduleState.global.songCoverSrc === 'function') cover = _moduleState.global.songCoverSrc(song, 512) || '';
    if (!cover && song && song.cover) {
      cover = typeof _moduleState.global.coverUrlWithSize === 'function' ? _moduleState.global.coverUrlWithSize(song.cover, 512) : song.cover;
    }
    var pal = _moduleState.global.stageLyrics && (_moduleState.global.stageLyrics.coverPalette || _moduleState.global.stageLyrics.palette) || {};
    var duration = _moduleState.global.audio && isFinite(_moduleState.global.audio.duration) ? Number(_moduleState.global.audio.duration) : Number(song && (song.duration || song.durationSec || 0)) || 0;
    if (duration > 10000) duration /= 1000;
    return {
      title: String((song && (song.name || song.title)) || ''),
      artist: String((song && (song.artist || song.ar || song.author)) || ''),
      thumbnail: cover || '',
      primaryColor: _moduleState.cssColorToHex(pal.primary || pal.secondary || pal.highlight, '#6bd9ff'),
      textColor: _moduleState.cssColorToHex(pal.highlight || pal.primary, '#f8fbff'),
      isPlaying: !!(_moduleState.global.playing && _moduleState.global.audio && !_moduleState.global.audio.paused),
      position: _moduleState.global.audio && isFinite(_moduleState.global.audio.currentTime) ? Number(_moduleState.global.audio.currentTime) : 0,
      duration: duration
    };
  }

function installSonicWorkshopPresetPostMessage(_moduleState, type, payload) {
    var frame = _moduleState.state.iframe && _moduleState.state.iframe.contentWindow;
    if (!frame) return;
    try {
      if (type === 'mineradio-sonic-workshop-audio' && typeof frame.__mineradioApplyAudio === 'function') {
        frame.__mineradioApplyAudio(payload.samples);
        return;
      }
      if (type === 'mineradio-sonic-workshop-media' && typeof frame.__mineradioApplyMedia === 'function') {
        frame.__mineradioApplyMedia(payload.media);
        return;
      }
      if (type === 'mineradio-sonic-workshop-properties' && typeof frame.__mineradioApplyProperties === 'function') {
        frame.__mineradioApplyProperties(payload.properties);
        return;
      }
    } catch (e) {}
    try { frame.postMessage(Object.assign({ type: type }, payload), '*'); } catch (e2) {}
  }

function installSonicWorkshopPresetEnsureLayer(_moduleState) {
    if (_moduleState.state.layer && _moduleState.state.iframe) return;
    var layer = document.getElementById(_moduleState.MOUNT_ID);
    if (!layer) {
      layer = document.createElement('div');
      layer.id = _moduleState.MOUNT_ID;
      layer.setAttribute('aria-hidden', 'true');
      layer.setAttribute('inert', '');
      layer.tabIndex = -1;
      layer.style.pointerEvents = 'none';
      layer.style.userSelect = 'none';
      layer.style.webkitUserSelect = 'none';
      var canvasAnchor = document.getElementById('canvas-container');
      if (canvasAnchor && canvasAnchor.parentNode) canvasAnchor.parentNode.insertBefore(layer, canvasAnchor);
      else document.body.insertBefore(layer, document.body.firstChild);
    }
    layer.style.opacity = '0';
    layer.style.pointerEvents = 'none';
    layer.setAttribute('inert', '');
    var iframe = layer.querySelector('iframe');
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.setAttribute('title', 'Sonic Workshop Visual');
      iframe.setAttribute('aria-hidden', 'true');
      iframe.setAttribute('tabindex', '-1');
      iframe.setAttribute('inert', '');
      iframe.setAttribute('allow', 'autoplay');
      iframe.setAttribute('frameborder', '0');
      iframe.draggable = false;
      iframe.tabIndex = -1;
      iframe.style.pointerEvents = 'none';
      iframe.style.userSelect = 'none';
      iframe.style.webkitUserSelect = 'none';
      iframe.src = _moduleState.BRIDGE_SRC;
      layer.appendChild(iframe);
    }
    iframe.style.pointerEvents = 'none';
    iframe.setAttribute('inert', '');
    iframe.onload = function () {
      _moduleState.state.ready = true;
      _moduleState.pushProperties(true);
      _moduleState.pushMedia(true);
      _moduleState.pushAudio(true);
    };
    _moduleState.state.layer = layer;
    _moduleState.state.iframe = iframe;
  }

function installSonicWorkshopPresetRemoveLayer(_moduleState) {
    if (_moduleState.state.themeTransitionRaf) {
      try {
        if (_moduleState.global.cancelAnimationFrame) _moduleState.global.cancelAnimationFrame(_moduleState.state.themeTransitionRaf);
        else clearTimeout(_moduleState.state.themeTransitionRaf);
      } catch (e) {}
    }
    if (_moduleState.state.layer && _moduleState.state.layer.parentNode) _moduleState.state.layer.parentNode.removeChild(_moduleState.state.layer);
    _moduleState.state.layer = null;
    _moduleState.state.iframe = null;
    _moduleState.state.ready = false;
    _moduleState.state.lastMediaKey = '';
    _moduleState.state.lastPropertiesKey = '';
    _moduleState.state.displayedTheme = null;
    _moduleState.state.themeTransition = null;
    _moduleState.state.themeTransitionRaf = 0;
  }

function installSonicWorkshopPresetBodyClass(_moduleState, active) {
    if (document && document.body) document.body.classList.toggle('sonic-workshop-active', !!active);
  }

function installSonicWorkshopPresetDeriveProperties(_moduleState, fx) {
    fx = fx || {};
    var coverHexes = _moduleState.workshopPaletteHexesFromCover();
    var props = Object.assign({}, _moduleState.WORKSHOP_DEFAULT_PROPERTIES);
    props.audioIntensity = _moduleState.clamp(fx.sonicWorkshopAudioIntensity == null ? props.audioIntensity : Number(fx.sonicWorkshopAudioIntensity), 0.3, 2.5);
    props.responseRange = _moduleState.clamp(fx.sonicWorkshopResponseRange == null ? props.responseRange : Number(fx.sonicWorkshopResponseRange), 0.3, 2);
    props.peakColorIntensity = _moduleState.clamp(fx.sonicWorkshopPeakIntensity == null ? props.peakColorIntensity : Number(fx.sonicWorkshopPeakIntensity), 0, 1.4);
    var customTheme = _moduleState.normalizeWorkshopTheme(fx.sonicWorkshopTheme);
    var regions = _moduleState.workshopRegionsFromFx(fx);
    var colorHex = _moduleState.normalizeHex(regions.primary, '#cb6c89');
    var paletteHexes = [
      regions.primary,
      regions.base,
      regions.warm,
      regions.cool,
      regions.ripple,
      regions.peak
    ];
    coverHexes.forEach(function (hex) {
      if (!hex) return;
      var key = hex.toLowerCase();
      for (var i = 0; i < paletteHexes.length; i++) {
        if (paletteHexes[i] && paletteHexes[i].toLowerCase() === key) return;
      }
      paletteHexes.push(hex);
    });
    props.theme = 'mineradio-custom';
    props.mineradioCustomTheme = _moduleState.workshopCustomThemeForRegions(regions);
    props.schemecolor = _moduleState.hexToSchemeColor(colorHex);
    props.__mineradioColorHex = colorHex;
    props.__mineradioPaletteHexes = paletteHexes.join(',');
    props.__mineradioNearestTheme = fx.sonicWorkshopColorMode === 'custom' ? customTheme : _moduleState.workshopThemeForColor(colorHex);
    return props;
  }

function installSonicWorkshopPresetPushProperties(_moduleState, force) {
    if (!_moduleState.state.iframe) return;
    var props = _moduleState.applyWorkshopThemeTransition(_moduleState.deriveProperties(_moduleState.global.fx || {}));
    var key = JSON.stringify(props);
    var now = _moduleState.nowMs();
    if (!force && key === _moduleState.state.lastPropertiesKey && now - _moduleState.state.lastPropertiesAt < _moduleState.PROPERTIES_PUSH_INTERVAL_MS) return;
    _moduleState.state.lastPropertiesKey = key;
    _moduleState.state.lastPropertiesAt = now;
    _moduleState.postMessage('mineradio-sonic-workshop-properties', { properties: props });
  }

function installSonicWorkshopPresetPushMedia(_moduleState, force) {
    if (!_moduleState.state.iframe) return;
    var media = _moduleState.buildMediaState();
    var key = [
      media.title,
      media.artist,
      media.thumbnail,
      media.primaryColor,
      media.textColor,
      media.isPlaying ? 1 : 0,
      Math.round(media.duration || 0),
      Math.floor((media.position || 0) * 2) / 2
    ].join('|');
    var now = _moduleState.nowMs();
    if (!force && key === _moduleState.state.lastMediaKey && now - _moduleState.state.lastMediaAt < _moduleState.MEDIA_PUSH_INTERVAL_MS) return;
    _moduleState.state.lastMediaKey = key;
    _moduleState.state.lastMediaAt = now;
    _moduleState.state.media = media;
    _moduleState.postMessage('mineradio-sonic-workshop-media', { media: media });
  }

function installSonicWorkshopPresetRawAudioArray(_moduleState) {
    if (_moduleState.global.frequencyData && _moduleState.global.frequencyData.length) return _moduleState.global.frequencyData;
    return null;
  }

function installSonicWorkshopPresetFrameValue(_moduleState, audioFrame, key) {
    return audioFrame && isFinite(audioFrame[key]) ? Number(audioFrame[key]) : 0;
  }

function installSonicWorkshopPresetRawBinValue(_moduleState, raw, idx) {
    var value = Number(raw[idx]) || 0;
    return _moduleState.clamp01(value > 1 ? value / 255 : value);
  }

function installSonicWorkshopPresetWorkshopAudioFrameStats(_moduleState, raw) {
    var len = raw && raw.length || 0;
    var sum = 0;
    var max = 0;
    if (!len) return { mean: 0, max: 0, floor: _moduleState.WORKSHOP_AUDIO_MIN_FLOOR, peakFloor: 0.38, bodyGain: _moduleState.WORKSHOP_AUDIO_BODY_GAIN };
    for (var i = 0; i < 512; i++) {
      var idx = Math.min(len - 1, Math.floor(i * len / 512));
      var v = _moduleState.rawBinValue(raw, idx);
      sum += v;
      if (v > max) max = v;
    }
    var mean = sum / 512;
    return {
      mean: mean,
      max: max,
      floor: _moduleState.clamp(Math.max(_moduleState.WORKSHOP_AUDIO_MIN_FLOOR, mean * 0.48), _moduleState.WORKSHOP_AUDIO_MIN_FLOOR, 0.20),
      peakFloor: _moduleState.clamp(Math.max(0.38, mean * 1.72), 0.38, 0.76),
      bodyGain: _moduleState.clamp(_moduleState.WORKSHOP_AUDIO_BODY_GAIN - mean * 0.10, 0.28, _moduleState.WORKSHOP_AUDIO_BODY_GAIN)
    };
  }

function installSonicWorkshopPresetShapeWorkshopAudioValue(_moduleState, value, i, stats, beat, bassDrive) {
    var floor = stats && isFinite(stats.floor) ? stats.floor : _moduleState.WORKSHOP_AUDIO_MIN_FLOOR;
    var body = Math.pow(_moduleState.clamp01((value - floor) / Math.max(0.001, 1 - floor)), _moduleState.WORKSHOP_AUDIO_GAMMA);
    var peakFloor = stats && isFinite(stats.peakFloor) ? stats.peakFloor : 0.38;
    var peak = Math.pow(_moduleState.clamp01((value - peakFloor) / Math.max(0.001, 1 - peakFloor)), 1.08);
    var lowLift = i < 36 ? (1 - i / 36) * (beat * _moduleState.WORKSHOP_AUDIO_LOW_LIFT + bassDrive * 0.022) : 0;
    var shaped = body * (stats && stats.bodyGain || _moduleState.WORKSHOP_AUDIO_BODY_GAIN) + peak * _moduleState.WORKSHOP_AUDIO_PEAK_GAIN + lowLift;
    return _moduleState.clamp(shaped, 0, _moduleState.WORKSHOP_AUDIO_TARGET_MAX_SAMPLE);
  }

function installSonicWorkshopPresetBuildAudioSamples(_moduleState, audioFrame) {
    var raw = _moduleState.rawAudioArray();
    var out = new Array(512);
    var inputGainValue = _moduleState.global.fx && _moduleState.global.fx.sonicWorkshopInputGain != null ? Number(_moduleState.global.fx.sonicWorkshopInputGain) : 82;
    var inputGain = _moduleState.clamp(inputGainValue, 40, 100) / 100;
    var beat = Math.max(_moduleState.frameValue(audioFrame, 'beat'), _moduleState.frameValue(audioFrame, 'kickEnvelope'), _moduleState.frameValue(audioFrame, 'triggerPulse'));
    var bassDrive = Math.max(_moduleState.frameValue(audioFrame, 'subBass'), _moduleState.frameValue(audioFrame, 'bass'));
    if (raw && raw.length) {
      var len = raw.length;
      var stats = _moduleState.workshopAudioFrameStats(raw);
      for (var i = 0; i < 512; i++) {
        var idx = Math.min(len - 1, Math.floor(i * len / 512));
        out[i] = _moduleState.shapeWorkshopAudioValue(_moduleState.rawBinValue(raw, idx), i, stats, beat, bassDrive) * inputGain;
      }
    } else {
      var bands = [
        _moduleState.frameValue(audioFrame, 'subBass') || _moduleState.frameValue(audioFrame, 'bass'),
        _moduleState.frameValue(audioFrame, 'bass'),
        _moduleState.frameValue(audioFrame, 'lowMid') || _moduleState.frameValue(audioFrame, 'mid'),
        _moduleState.frameValue(audioFrame, 'mid'),
        _moduleState.frameValue(audioFrame, 'highMid') || _moduleState.frameValue(audioFrame, 'treble'),
        _moduleState.frameValue(audioFrame, 'presence') || _moduleState.frameValue(audioFrame, 'treble'),
        _moduleState.frameValue(audioFrame, 'brilliance') || _moduleState.frameValue(audioFrame, 'treble'),
        _moduleState.frameValue(audioFrame, 'air') || _moduleState.frameValue(audioFrame, 'treble')
      ];
      for (var j = 0; j < 512; j++) {
        var bandPos = j / 511 * (bands.length - 1);
        var bandIndex = Math.floor(bandPos);
        var mix = bandPos - bandIndex;
        var a = bands[bandIndex] || 0;
        var b = bands[Math.min(bands.length - 1, bandIndex + 1)] || a;
        var v = a + (b - a) * mix;
        var fallbackLift = j < 36 ? beat * (1 - j / 36) * _moduleState.WORKSHOP_AUDIO_LOW_LIFT : 0;
        out[j] = _moduleState.clamp(Math.pow(_moduleState.clamp01(v), 1.35) * 0.30 + fallbackLift, 0, _moduleState.WORKSHOP_AUDIO_TARGET_MAX_SAMPLE) * inputGain;
      }
    }
    if (!(_moduleState.global.playing && _moduleState.global.audio && !_moduleState.global.audio.paused)) {
      for (var k = 0; k < out.length; k++) out[k] = out[k] * _moduleState.WORKSHOP_AUDIO_PAUSED_GAIN;
    }
    _moduleState.state.samples = out;
    return out;
  }

function installSonicWorkshopPresetPushAudio(_moduleState, force, audioFrame) {
    if (!_moduleState.state.iframe) return;
    var now = _moduleState.nowMs();
    if (!force && now - _moduleState.state.lastAudioAt < _moduleState.AUDIO_PUSH_INTERVAL_MS) return;
    _moduleState.state.lastAudioAt = now;
    _moduleState.postMessage('mineradio-sonic-workshop-audio', { samples: _moduleState.buildAudioSamples(audioFrame || {}) });
  }

function installSonicWorkshopPresetUpdate(_moduleState, dt, ctx) {
    ctx = ctx || {};
    var targetActive = _moduleState.isActive(ctx.fx || _moduleState.global.fx);
    _moduleState.state.active = targetActive;
    _moduleState.bodyClass(targetActive || _moduleState.state.opacity > 0.02);
    if (targetActive) _moduleState.ensureLayer();
    var targetOpacity = targetActive ? 1 : 0;
    var rate = targetOpacity > _moduleState.state.opacity ? 7.5 : 5.0;
    _moduleState.state.opacity += (targetOpacity - _moduleState.state.opacity) * _moduleState.clamp(1 - Math.exp(-rate * Math.max(0.001, dt || 1 / 60)), 0, 1);
    if (_moduleState.state.layer) _moduleState.state.layer.style.opacity = _moduleState.state.opacity.toFixed(3);
    if (targetActive) {
      _moduleState.pushProperties(false);
      _moduleState.pushMedia(false);
      _moduleState.pushAudio(false, ctx.audio);
    } else if (_moduleState.state.layer && _moduleState.state.opacity <= 0.01) {
      _moduleState.removeLayer();
      _moduleState.bodyClass(false);
    }
  }

function installSonicWorkshopPresetClear(_moduleState) {
    _moduleState.state.active = false;
    _moduleState.state.opacity = 0;
    _moduleState.bodyClass(false);
    _moduleState.removeLayer();
  }

function installSonicWorkshopPresetOnPresetChange(_moduleState, prev, next, opts) {
    if (Number(next) === _moduleState.INDEX) {
      _moduleState.ensureLayer();
      _moduleState.state.opacity = Math.max(_moduleState.state.opacity, 0.001);
      _moduleState.bodyClass(true);
      _moduleState.pushProperties(true);
      _moduleState.pushMedia(true);
      _moduleState.pushAudio(true, opts && opts.audio);
    } else if (Number(prev) === _moduleState.INDEX) {
      _moduleState.state.active = false;
      _moduleState.bodyClass(true);
    }
  }

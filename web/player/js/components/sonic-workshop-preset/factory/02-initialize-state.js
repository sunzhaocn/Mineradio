'use strict';

function installSonicWorkshopPresetInitialize(_moduleState) {
_moduleState.INDEX = 8;
_moduleState.BRIDGE_SRC = 'vendor/sonic-workshop/mineradio-bridge.html';
_moduleState.MOUNT_ID = 'sonic-workshop-layer';
_moduleState.AUDIO_PUSH_INTERVAL_MS = 33;
_moduleState.MEDIA_PUSH_INTERVAL_MS = 250;
_moduleState.PROPERTIES_PUSH_INTERVAL_MS = 1000;
_moduleState.WORKSHOP_THEME_TRANSITION_MS = 1280;
_moduleState.WORKSHOP_AUDIO_TARGET_MAX_SAMPLE = 0.52;
_moduleState.WORKSHOP_AUDIO_BODY_GAIN = 0.33;
_moduleState.WORKSHOP_AUDIO_PEAK_GAIN = 0.12;
_moduleState.WORKSHOP_AUDIO_GAMMA = 1.55;
_moduleState.WORKSHOP_AUDIO_MIN_FLOOR = 0.035;
_moduleState.WORKSHOP_AUDIO_LOW_LIFT = 0.035;
_moduleState.WORKSHOP_AUDIO_PAUSED_GAIN = 0.12;
_moduleState.WORKSHOP_DEFAULT_PROPERTIES = {
    schemecolor: '0.3333333333333333 0.0196078431372549 0.3333333333333333',
    theme: 'coral-mirage',
    mineradioCustomTheme: null,
    themeCycleInterval: 50,
    peakColorEnabled: true,
    peakColorIntensity: 0.62,
    gridSize: 320,
    audioIntensity: 1.15,
    responseRange: 1.3,
    pulseEnabled: true,
    pulseSensitivity: 0.05,
    pulseCooldown: 0,
    meteorEnabled: true,
    meteorSensitivity: 0.3,
    meteorCooldown: 60,
    meteorClickEnabled: true,
    idleWaveEnabled: true,
    idleWaveDebounce: 1,
    idleWaveFadeDuration: 1,
    cameraDistance: 80,
    autoRotateEnabled: true,
    autoRotateSpeed: 7,
    cameraAngleX: 150,
    cameraAngleY: 30,
    showPlayerController: false,
    showAlbumCover: true,
    controllerSize: 'large',
    controllerX: 2,
    controllerY: 3
  };
_moduleState.zeroSamples = new Array(512).fill(0);
_moduleState.state = {
    layer: null,
    iframe: null,
    active: false,
    ready: false,
    opacity: 0,
    lastAudioAt: 0,
    lastMediaAt: 0,
    lastPropertiesAt: 0,
    lastMediaKey: '',
    lastPropertiesKey: '',
    samples: _moduleState.zeroSamples.slice(),
    media: null,
    displayedTheme: null,
    themeTransition: null,
    themeTransitionRaf: 0
  };
_moduleState.WORKSHOP_THEME_ALIASES = {
    'minimal-mono': 'minimal-monochrome',
    'arctic-blue': 'arctic-aurora',
    'emerald-forest': 'cyber-forest',
    crimson: 'crimson-sunset',
    aurora: 'arctic-aurora',
    'violet-dream': 'neon-tokyo'
  };
_moduleState.WORKSHOP_THEME_COLORS = {
    nocturnal: '#7d3fff',
    'ocean-deep': '#1b6fb8',
    'arctic-aurora': '#79e1c4',
    'cyber-forest': '#3fc78a',
    'golden-hour': '#e8b44c',
    'ember-fire': '#f27a28',
    'crimson-sunset': '#d84252',
    'coral-mirage': '#cb6c89',
    'neon-tokyo': '#ff4fb8',
    'minimal-monochrome': '#d9dde3'
  };
_moduleState.WORKSHOP_THEME_COLOR_KEYS = ['uBaseColor1', 'uBaseColor2', 'uCoolCore', 'uCoolEdge', 'uWarmCore', 'uWarmEdge', 'uRippleColor', 'uPeakColor'];
_moduleState.global.addEventListener && _moduleState.global.addEventListener('message', function (event) {
    var data = event && event.data || {};
    if (data.type === 'mineradio-sonic-workshop-ready') {
      _moduleState.state.ready = true;
      _moduleState.pushProperties(true);
      _moduleState.pushMedia(true);
      _moduleState.pushAudio(true);
    }
  });
_moduleState.global.MineradioSonicWorkshop = {
    INDEX: _moduleState.INDEX,
    isActive: _moduleState.isActive,
    update: _moduleState.update,
    clear: _moduleState.clear,
    pushProperties: function (force) { _moduleState.pushProperties(force === true); },
    onPresetChange: _moduleState.onPresetChange
  };
}

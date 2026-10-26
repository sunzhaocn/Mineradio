'use strict';

var SONIC_AUDIO_BASE_BINS = 512;

var SONIC_AUDIO_MAX_BAND_START = SONIC_AUDIO_BASE_BINS - 2;

var SONIC_AUDIO_MAX_BAND_END = SONIC_AUDIO_BASE_BINS;

var SONIC_AUDIO_AUTO_TRACK_SCAN_BINS = 192;

var SONIC_AUDIO_DEFAULT_SAMPLE_RATE = 44100;


var sonicAudioMonitorState = {
  raw: new Uint8Array(SONIC_AUDIO_BASE_BINS),
  prev: new Float32Array(SONIC_AUDIO_BASE_BINS),
  smooth: {},
  beat: null,
  kick: { noiseFloor: 0, kickLevel: 0, kickOnset: 0, kickEnvelope: 0 },
  trigger: {
    smoothedFlux: 0,
    previousSmoothedFlux: 0,
    history: new Array(40).fill(0),
    historyIndex: 0,
    beatHold: 0,
    cooldownRemaining: 0,
    lastEnergy: 0,
    lastThreshold: 0,
    pulse: 0
  },
  autoTrack: {
    frames: [],
    lastAt: 0,
    start: 1,
    end: 2,
    windowIndex: 1,
    hzStart: 52,
    hzEnd: 165,
    sensitivity: 0.85
  },
  meta: null,
  frame: null,
  panelOpen: false,
  raf: 0,
  lastDrawAt: 0,
  lastOnsetAt: 0,
  lastAudioTime: 0
};


var SONIC_AUDIO_BAND_EDGES = [
  ['subBass', 32, 58],
  ['bass', 58, 118],
  ['lowMid', 118, 260],
  ['mid', 260, 720],
  ['highMid', 720, 1800],
  ['presence', 1800, 4200],
  ['brilliance', 4200, 9000],
  ['air', 9000, 16000]
];

var SONIC_AUDIO_BEAT_WINDOWS = [
  { name: 'Deep', startHz: 36, endHz: 82, bias: 1.04 },
  { name: 'Club', startHz: 46, endHz: 118, bias: 1.22 },
  { name: 'Kick', startHz: 54, endHz: 142, bias: 1.16 },
  { name: 'Punch', startHz: 68, endHz: 156, bias: 1.02 },
  { name: 'Body', startHz: 86, endHz: 190, bias: 0.86 },
  { name: 'Wide', startHz: 38, endHz: 155, bias: 0.78 }
];


if (typeof window !== 'undefined') {
  window.stepSonicAudioMonitor = stepSonicAudioMonitor;
  window.getSonicAudioMonitorSnapshot = getSonicAudioMonitorSnapshot;
  window.toggleSonicAudioMonitorPanel = toggleSonicAudioMonitorPanel;
  window.refreshSonicAudioMonitorUi = refreshSonicAudioMonitorUi;
  onMineradioDomReady(bindSonicAudioMonitorControls);
}

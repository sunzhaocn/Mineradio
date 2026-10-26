'use strict';

var homeWaveTrackState = { bars: 0, smooth: [] };

var SONIC_ORIGINAL_FX_CONTROL_IDS = [
  'fx-sonic-ground-section', 'fx-sonicamp', 'fx-sonicspeed', 'fx-sonicdensity', 'fx-sonicrange', 'fx-soniclower', 'fx-sonicdepth', 'fx-sonicautorotate',
  'fx-sonic-audio-section', 'sonic-audio-toggle-grid', 'sonic-audio-monitor', 'fx-sonicaudiosensitivity', 'fx-sonicaudiobandstart', 'fx-sonicaudiobandend', 'fx-sonicaudiothreshold', 'fx-sonicaudiopulse',
  'fx-sonicsubbass', 'fx-sonicbass', 'fx-soniclowmid', 'fx-sonicmid', 'fx-sonichighmid', 'fx-sonicpresence', 'fx-sonicbrilliance', 'fx-sonicair',
  'fx-sonic-color-section', 'sonic-ground-base-row', 'sonic-ground-cool-row', 'sonic-ground-warm-row', 'sonic-ground-accent-row', 'fx-sonicglow',
  'fx-sonic-floating-section', 'sonic-floating-toggle-grid', 'fx-sonicfloatcount', 'fx-sonicfloatintensity', 'fx-sonicfloatmin', 'fx-sonicfloatmax', 'fx-sonicfloatspeed'
];

var SONIC_WORKSHOP_FX_CONTROL_IDS = [
  'fx-sonic-workshop-section', 'fx-sonicwegain', 'fx-sonicweaudio', 'fx-sonicwerange', 'fx-sonicwepeak',
  'sonic-workshop-color-row', 'sonic-workshop-base-row', 'sonic-workshop-warm-row', 'sonic-workshop-cool-row',
  'sonic-workshop-ripple-row', 'sonic-workshop-peak-row', 'sonic-workshop-theme-seg'
];

var lyricRealtimeRefreshTimer = null;

var lyricRealtimeLastRefreshAt = 0;

var fxPanelTab = 'home';

var fxPanelTabScroll = {};

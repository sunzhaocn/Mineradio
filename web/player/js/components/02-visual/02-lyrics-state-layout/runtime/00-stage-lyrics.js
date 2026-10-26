'use strict';

// ============================================================
var stageLyrics = {
  group: null,
  current: null,
  outgoing: [],
  currentIdx: -1,
  currentText: '',
  highBloom: 0,
  beatGlow: 0,
  glowFollowX: 0,
  glowFollowY: 0,
  glowFollowRoll: 0,
  palette: {
    primary: '#d6f8ff',
    secondary: '#9cffdf',
    highlight: '#eef7ff',
    shadow: 'rgba(2,8,12,0.42)',
    glow: 'rgba(143,233,255,0.34)',
  },
  coverPalette: {
    primary: '#d6f8ff',
    secondary: '#9cffdf',
    highlight: '#eef7ff',
    shadow: 'rgba(2,8,12,0.42)',
    glow: 'rgba(143,233,255,0.34)',
  },
  starRiver: null,
  starRiverWidth: 4.2,
  starRiverHeight: 0.58,
  lockFitScale: 1,
  snapCameraLockFrames: 0,
  transitionLineStep: 0,
  currentDisplayKey: '',
  currentPayload: null,
};

var lyricSunColor = new THREE.Color(0xffe6a4);

var lyricSunHotColor = new THREE.Color(0xfff4cc);

var lyricCameraDir = new THREE.Vector3();

var lyricCameraRight = new THREE.Vector3();

var lyricCameraUp = new THREE.Vector3();

var lyricCameraTarget = new THREE.Vector3();

var lyricLayoutBase = new THREE.Vector3();

var lyricLayoutTarget = new THREE.Vector3();

var lyricCoverWorldPos = new THREE.Vector3();

var lyricCoverWorldQuat = new THREE.Quaternion();

var lyricBaseEuler = new THREE.Euler(0, 0, 0, 'YXZ');

var lyricTiltEuler = new THREE.Euler(0, 0, 0, 'YXZ');

var lyricBaseQuat = new THREE.Quaternion();

var lyricTiltQuat = new THREE.Quaternion();

var lyricTargetQuat = new THREE.Quaternion();

var LYRIC_CAMERA_LOCK_MAX_SCALE = 0.80;
// 兼容旧变量名以便其它代码不破坏

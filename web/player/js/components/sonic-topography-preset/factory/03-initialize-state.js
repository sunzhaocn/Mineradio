'use strict';

function installSonicTopographyPresetInitialize(_moduleState) {
_moduleState.INDEX = 7;
_moduleState.RIPPLE_MAX = 10;
_moduleState.RIPPLE_LIFETIME = 4.8;
_moduleState.RIPPLE_SOFT_FADE_START = 2.1;
_moduleState.METEOR_MAX = 20;
_moduleState.TRAIL_MAX = 200;
_moduleState.DEFAULT_FLOATING_BLOCK_COUNT = 80;
_moduleState.FLOATING_BLOCK_MIN_COUNT = 0;
_moduleState.FLOATING_BLOCK_MAX_COUNT = 100;
_moduleState.DEFAULT_GROUND_MOTION_SPEED = 50;
_moduleState.DEFAULT_GROUND_AMPLITUDE = 50;
_moduleState.DEFAULT_TERRAIN_DENSITY = 46;
_moduleState.DEFAULT_GROUND_RANGE = 82;
_moduleState.DEFAULT_GROUND_LOWER = 68;
_moduleState.DEFAULT_GROUND_DEPTH = 62;
_moduleState.DEFAULT_GROUND_AUTO_ROTATE = 50;
_moduleState.DEFAULT_GROUND_GLOW = 68;
_moduleState.DEFAULT_GROUND_BASE_COLOR = '#05070c';
_moduleState.DEFAULT_GROUND_COOL_COLOR = '#0066ff';
_moduleState.DEFAULT_GROUND_WARM_COLOR = '#ff3c19';
_moduleState.DEFAULT_GROUND_ACCENT_COLOR = '#33e6ff';
_moduleState.TERRAIN_BASE_SIZE = 168;
_moduleState.TERRAIN_MIN_GRID_SIZE = 96;
_moduleState.TERRAIN_MAX_GRID_SIZE = 224;
_moduleState.QUALITY_GRID_CAP = { eco: 112, balanced: 160, high: 192, ultra: 224 };
_moduleState.DEFAULT_FLOATING_BLOCK_INTENSITY = 55;
_moduleState.DEFAULT_FLOATING_BLOCK_MIN_SIZE = 9;
_moduleState.DEFAULT_FLOATING_BLOCK_MAX_SIZE = 26;
_moduleState.DEFAULT_FLOATING_BLOCK_SPEED = 77;
_moduleState.MAX_SHADER_SUB_BASS = 1.2;
_moduleState.MAX_SHADER_BASS = 1.15;
_moduleState.MAX_KICK_DEFORM = 0.75;
_moduleState.GROUND_BAND_KEYS = [
    'sonicGroundSubBass',
    'sonicGroundBass',
    'sonicGroundLowMid',
    'sonicGroundMid',
    'sonicGroundHighMid',
    'sonicGroundPresence',
    'sonicGroundBrilliance',
    'sonicGroundAir'
  ];
_moduleState.DEFAULT_GROUND_BANDS = [90, 92, 50, 50, 50, 50, 50, 48];
_moduleState.state = {
    root: null,
    terrain: null,
    terrainMat: null,
    floatingBlocks: null,
    floatingMat: null,
    meteors: null,
    meteorMat: null,
    trails: null,
    trailMat: null,
    scene: null,
    opacity: 0,
    gridSize: 0,
    gridSpacing: 0,
    floatingCount: _moduleState.DEFAULT_FLOATING_BLOCK_COUNT,
    initialized: false,
    sonicTime: 0,
    autoYaw: 0,
    manualYaw: 0,
    boundRotX: 0,
    boundRotY: 0,
    lastOrbitTheta: 0,
    orbitThetaReady: false,
    ripples: [],
    rippleIdx: 0,
    meteorsData: [],
    meteorIdx: 0,
    lastMeteorAt: -999,
    trailsData: [],
    trailIdx: 0,
    floatingData: [],
    floatingPulse: 0,
    lastKickActive: false,
    lastSnareActive: false,
    smoothAudio: {
      subBass: 0,
      bass: 0,
      lowMid: 0,
      mid: 0,
      highMid: 0,
      presence: 0,
      brilliance: 0,
      air: 0
    },
    dummyPos: null,
    dummyQuat: null,
    dummyScale: null,
    dummyMat4: null,
    dummyEuler: null,
    dummyObj: null
  };
_moduleState.global.MineradioSonicTopography = {
    INDEX: _moduleState.INDEX,
    isActive: _moduleState.isActive,
    update: _moduleState.update,
    clear: _moduleState.clearLayer,
    onPresetChange: _moduleState.onPresetChange,
    pointerRipple: _moduleState.pointerRipple
  };
}

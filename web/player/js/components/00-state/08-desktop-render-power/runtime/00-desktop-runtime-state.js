'use strict';



var desktopRuntimeState = {
  desktop: !!window.desktopWindow,
  minimized: false,
  visible: true,
  focused: true,
  fullscreen: false,
  embedded: false,
  interactive: false
};

var renderPowerState = { mode: '', width: 0, height: 0, pixelRatio: 0 };

var backgroundCacheTrimTimer = 0;

var backgroundAppMemoryTrimTimer = 0;

var backgroundAppMemoryTrimInFlight = false;

var runtimePerfState = {
  lastCacheTrimAt: 0,
  lastAppMemoryTrimAt: 0,
  lastAppMemoryTrimReason: '',
  lastAppMemoryTrimResult: null,
  cacheTrimCount: 0,
  lastCacheTrimReason: '',
  lastHeapSampleAt: 0,
  heapMB: 0,
  cacheCounts: {}
};

var runtimeGpuDiagnostics = null;

var runtimeGpuDiagnosticsError = '';

var runtimeHardwareProfile = detectRuntimeHardwareProfile();

window.__mineradioPerfSnapshot = collectRuntimePerfSnapshot;

// ============================================================
//  Three.js 场景

'use strict';
(function (root) {
  // The shipped scene has a 168 x 168 ground and a 45-degree perspective
  // camera. Its original fixed radius (80) puts the camera inside that ground.
  // Fit its projected bounds rather than scaling a rendered canvas with CSS.
  var half = 84, peak = 24, lastKey = '', lastDistance = 0;
  function fitDistance(width, height, properties) {
    properties = properties || {};
    var aspect = Math.max(.1, Number(width) || 1) / Math.max(1, Number(height) || 1);
    var elevation = Math.max(10, Math.min(70, Number(properties.cameraAngleY) || 30)) * Math.PI / 180;
    var azimuth = (Number(properties.cameraAngleX) || 150) * Math.PI / 180;
    var rotating = properties.autoRotateEnabled !== false;
    var authored = Math.max(20, Number(properties.cameraDistance) || 80);
    var key = [aspect.toFixed(5), elevation, rotating ? 'rotate' : azimuth, authored].join('|');
    if (key === lastKey) return lastDistance;
    var tanV = Math.tan(Math.PI / 8), tanH = tanV * aspect, distance = 0;
    var count = rotating ? 72 : 1;
    for (var heading = 0; heading < count; heading++) {
      var angle = rotating ? heading * Math.PI * 2 / count : azimuth;
      var sin = Math.sin(angle), cos = Math.cos(angle), se = Math.sin(elevation), ce = Math.cos(elevation);
      for (var x of [-half, half]) for (var z of [-half, half]) for (var y of [0, peak]) {
        var depth = x * sin * ce + y * se + z * cos * ce;
        var right = x * cos - z * sin;
        var up = -x * sin * se + y * ce - z * cos * se;
        distance = Math.max(distance, depth + Math.abs(right) / tanH, depth + Math.abs(up) / tanV);
      }
    }
    lastKey = key;
    lastDistance = Math.ceil(Math.max(authored, distance * 1.06) * 1000) / 1000;
    return lastDistance;
  }
  function applyFog(fog, distance) {
    if (!fog) return;
    // Preserve the original fog's distance from the scene when the camera
    // moves back. Otherwise fitting the ground hides it behind the old fog.
    var offset = Math.max(0, Number(distance) - 80);
    fog.near = 30 + offset;
    fog.far = 95 + offset;
  }
  var api = { fitDistance: fitDistance, applyFog: applyFog };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MineradioWorkshopViewport = api;
})(typeof window !== 'undefined' ? window : globalThis);

'use strict';

const {registerWallpaperEngineScheme} = require('./wallpaper-engine-library');
const {registerLocalMusicScheme} = require('./local-music-library');
const {registerSlideshowScheme} = require('./slideshow-library');

function registerMediaSchemes(protocol) {
  // Electron accepts privileged scheme registration once. A later call
  // replaces earlier privileges and silently breaks fetch for local media.
  const schemes = [];
  const collector = {registerSchemesAsPrivileged: entries => schemes.push(...entries)};
  for (const register of [registerWallpaperEngineScheme, registerLocalMusicScheme, registerSlideshowScheme]) register(collector);
  protocol.registerSchemesAsPrivileged(schemes);
}

module.exports = {registerMediaSchemes};

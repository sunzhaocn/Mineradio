'use strict';


function clonePackagedDefaultFxSnapshot() {
  return Object.assign({}, PACKAGED_DEFAULT_FX_SNAPSHOT);
}

function packagedDefaultLyricLayoutRaw() {
  return Object.assign({ desktopLyricsSchema: 'desktop-lyrics-v3' }, clonePackagedDefaultFxSnapshot());
}
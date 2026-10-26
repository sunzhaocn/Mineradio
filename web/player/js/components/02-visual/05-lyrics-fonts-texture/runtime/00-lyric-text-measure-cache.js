'use strict';


var lyricTextMeasureCache = { fonts: {}, order: [], maxFonts: 64, maxCharsPerFont: 512 };

var lyricTextMeasureWarmupTimer = 0;

if (typeof document !== 'undefined' && document.fonts && document.fonts.addEventListener) {
  document.fonts.addEventListener('loadingdone', function () {
    clearLyricTextMeasureCache();
    scheduleLyricTextMeasureWarmup(0);
  });
}

scheduleLyricTextMeasureWarmup(120);

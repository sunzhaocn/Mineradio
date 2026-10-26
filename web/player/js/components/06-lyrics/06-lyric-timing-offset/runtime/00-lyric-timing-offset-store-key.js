'use strict';

var LYRIC_TIMING_OFFSET_STORE_KEY = 'mineradio-lyric-timing-offsets-v1';

var LYRIC_TIMING_OFFSET_LIMIT = 500;

var lyricTimingOffsetMap = readLyricTimingOffsetMap();

var lyricTimingPopoverCloseTimer = null;


onMineradioDomReady(bindLyricTimingOffsetControls);

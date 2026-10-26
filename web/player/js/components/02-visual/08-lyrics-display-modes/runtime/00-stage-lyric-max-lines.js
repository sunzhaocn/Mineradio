'use strict';

var STAGE_LYRIC_MAX_LINES = 1;

var STAGE_LYRIC_DISPLAY_MODES = { single: 1, dual: 1, triple: 1, cinema: 1, custom: 1 };

var STAGE_LYRIC_TRANSLATION_MODES = { off: 1, current: 1, dual: 1, multi: 1 };

var STAGE_LYRIC_MOTION_STYLES = { glass: 1, smooth: 1, float: 1, quick: 1, shine: 1, glitch: 1 };

var lyricPrimaryVirtualPrefixCache = { key: '', values: [0] };

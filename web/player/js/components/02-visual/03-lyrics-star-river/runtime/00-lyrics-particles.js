'use strict';

var lyricsParticles = null;

var lyricsGeo = null;


// 三个 attribute: 源位置(随机扩散态), 目标位置(组成字), color, brightness
var lyricsAttrTargetA = null;

var lyricsAttrTargetB = null;

var lyricsAttrSeed = null;


var lyricDisposeQueue = [];

var lyricDisposeTimer = 0;

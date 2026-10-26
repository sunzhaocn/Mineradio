"use strict";
const platforms = [
  ["netease", "网易云音乐", "网易云音乐 App"],
  ["qqmusic", "QQ 音乐", "手机 QQ"],
  ["kugou", "酷狗音乐", "酷狗音乐 App"],
  ["qishui", "汽水音乐", "汽水音乐 App"],
];
const $ = (id) => document.getElementById(id);
let selected = 0,
  epoch = 0,
  key = "",
  expiry = 0,
  timer = null,
  result = null,
  openWindowUrl = "",
  phoneBusy = false,
  smsRetryAt = 0;
const completed = new Map();

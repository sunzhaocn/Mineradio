'use strict';


var customBackgroundCropModalState = null;

var customBackgroundCropModalBound = false;

var customBackgroundCropModalObjectUrl = '';


var SONIC_GROUND_COLOR_CONTROLS = [
  { key: 'sonicGroundBaseColor', picker: 'sonic-ground-base-picker', value: 'sonic-ground-base-value', label: '地形暗部' },
  { key: 'sonicGroundCoolColor', picker: 'sonic-ground-cool-picker', value: 'sonic-ground-cool-value', label: '冷色峰值' },
  { key: 'sonicGroundWarmColor', picker: 'sonic-ground-warm-picker', value: 'sonic-ground-warm-value', label: '暖色峰值' },
  { key: 'sonicGroundAccentColor', picker: 'sonic-ground-accent-picker', value: 'sonic-ground-accent-value', label: '涟漪高光' }
];


var SONIC_WORKSHOP_THEME_ALIASES = {
  'minimal-mono': 'minimal-monochrome',
  'arctic-blue': 'arctic-aurora',
  'emerald-forest': 'cyber-forest',
  crimson: 'crimson-sunset',
  aurora: 'arctic-aurora',
  'violet-dream': 'neon-tokyo'
};

var SONIC_WORKSHOP_THEMES = {
  'coral-mirage': { label: '\u73ca\u745a', color: '#cb6c89', base: '#16060f', warm: '#cb6c89', cool: '#99c4ff', ripple: '#f8d8ff', peak: '#99c4ff' },
  'ocean-deep': { label: '\u6df1\u6d77', color: '#1b6fb8', base: '#031025', warm: '#2e8ed4', cool: '#7fdcff', ripple: '#b7f5ff', peak: '#80b8ff' },
  'arctic-aurora': { label: '\u51b0\u84dd', color: '#79e1c4', base: '#05161d', warm: '#79e1c4', cool: '#99c4ff', ripple: '#e6fbff', peak: '#b7e6ff' },
  'cyber-forest': { label: '\u7fe0\u7eff', color: '#3fc78a', base: '#04150d', warm: '#3fc78a', cool: '#74f5ff', ripple: '#b9ffd8', peak: '#d1ffe9' },
  'minimal-monochrome': { label: '\u6781\u7b80', color: '#d9dde3', base: '#0b0c0e', warm: '#d9dde3', cool: '#ffffff', ripple: '#ffffff', peak: '#f2f5f8' },
  'neon-tokyo': { label: '\u9713\u8679', color: '#ff4fb8', base: '#100018', warm: '#ff4fb8', cool: '#39d7ff', ripple: '#ffd6f2', peak: '#e8ff6e' },
  'golden-hour': { label: '\u91d1\u8272', color: '#e8b44c', base: '#160d02', warm: '#e8b44c', cool: '#89c8ff', ripple: '#fff0b8', peak: '#ffffff' },
  'ember-fire': { label: '\u70ed\u706b', color: '#f27a28', base: '#180603', warm: '#f27a28', cool: '#76c8ff', ripple: '#ffd2a1', peak: '#fff2cf' },
  'crimson-sunset': { label: '\u6df1\u7ea2', color: '#d84252', base: '#180307', warm: '#d84252', cool: '#8ec7ff', ripple: '#ffd5df', peak: '#fff1f4' }
};

var SONIC_WORKSHOP_COLOR_CONTROLS = [
  { id: 'theme', role: 'primary', modeKey: 'sonicWorkshopColorMode', colorKey: 'sonicWorkshopCustomColor', picker: 'sonic-workshop-cover-picker', value: 'sonic-workshop-theme-value', button: 'sonic-workshop-cover-btn', fallback: '#cb6c89', label: '\u4e3b\u9898\u57fa\u8272' },
  { id: 'base', role: 'base', modeKey: 'sonicWorkshopBaseColorMode', colorKey: 'sonicWorkshopBaseColor', picker: 'sonic-workshop-base-picker', value: 'sonic-workshop-base-value', button: 'sonic-workshop-base-btn', fallback: '#16060f', label: '\u5730\u5f62\u5e95\u8272' },
  { id: 'warm', role: 'warm', modeKey: 'sonicWorkshopWarmColorMode', colorKey: 'sonicWorkshopWarmColor', picker: 'sonic-workshop-warm-picker', value: 'sonic-workshop-warm-value', button: 'sonic-workshop-warm-btn', fallback: '#cb6c89', label: '\u6696\u8272\u4e3b\u4f53' },
  { id: 'cool', role: 'cool', modeKey: 'sonicWorkshopCoolColorMode', colorKey: 'sonicWorkshopCoolColor', picker: 'sonic-workshop-cool-picker', value: 'sonic-workshop-cool-value', button: 'sonic-workshop-cool-btn', fallback: '#99c4ff', label: '\u4e0a\u5c42\u9ad8\u5149' },
  { id: 'ripple', role: 'ripple', modeKey: 'sonicWorkshopRippleColorMode', colorKey: 'sonicWorkshopRippleColor', picker: 'sonic-workshop-ripple-picker', value: 'sonic-workshop-ripple-value', button: 'sonic-workshop-ripple-btn', fallback: '#f8d8ff', label: '\u6ce2\u7eb9\u4eae\u533a' },
  { id: 'peak', role: 'peak', modeKey: 'sonicWorkshopPeakColorMode', colorKey: 'sonicWorkshopPeakColor', picker: 'sonic-workshop-peak-picker', value: 'sonic-workshop-peak-value', button: 'sonic-workshop-peak-btn', fallback: '#99c4ff', label: '\u5cf0\u503c\u9ad8\u5149' }
];

var sonicWorkshopCoverUiSample = {
  key: '',
  palette: null,
  loading: false,
  refreshing: false,
  token: 0
};

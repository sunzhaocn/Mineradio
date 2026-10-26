'use strict';


function sonicWorkshopRegionHex(item) {
  item = sonicWorkshopRegionControl(item);
  if (!item) return '#cb6c89';
  var fallback = item.fallback || '#cb6c89';
  if (fx[item.modeKey] === 'custom') return normalizeHexColor(fx[item.colorKey] || fallback, fallback);
  return normalizeHexColor(sonicWorkshopCoverHex(item.role), fallback);
}

function updateSonicWorkshopColorControls() {
  ensureSonicWorkshopCoverPaletteForUi();
  var theme = currentSonicWorkshopTheme();
  var meta = SONIC_WORKSHOP_THEMES[theme] || SONIC_WORKSHOP_THEMES['coral-mirage'];
  SONIC_WORKSHOP_COLOR_CONTROLS.forEach(function (item) {
    var coverMode = fx[item.modeKey] !== 'custom';
    var hex = sonicWorkshopRegionHex(item);
    var picker = document.getElementById(item.picker);
    var value = document.getElementById(item.value);
    var coverBtn = document.getElementById(item.button);
    if (picker) picker.value = normalizeHexColor(hex, item.fallback);
    if (value) {
      value.textContent = coverMode
        ? ('\u5c01\u9762 ' + hex.toUpperCase() + (item.id === 'theme' ? ' / ' + meta.label : ''))
        : ('\u56fa\u5b9a ' + hex.toUpperCase() + (item.id === 'theme' ? ' / ' + meta.label : ''));
    }
    if (coverBtn) coverBtn.classList.toggle('active', coverMode);
  });
  document.querySelectorAll('#sonic-workshop-theme-seg [data-sonic-workshop-theme]').forEach(function (btn) {
    btn.classList.toggle('active', fx.sonicWorkshopColorMode === 'custom' && normalizeSonicWorkshopTheme(btn.getAttribute('data-sonic-workshop-theme')) === theme);
  });
}

function pushSonicWorkshopColorChange(reason) {
  updateSonicWorkshopColorControls();
  var workshop = window.MineradioSonicWorkshop;
  if (workshop && typeof workshop.pushProperties === 'function') workshop.pushProperties(true);
  if (typeof syncFxUniforms === 'function') syncFxUniforms();
  saveLyricLayout({ user: true, reason: reason || 'sonicWorkshopRegionColors' });
}

function setSonicWorkshopRegionColorMode(id, mode, silent) {
  var item = sonicWorkshopRegionControl(id);
  if (!item) return;
  fx[item.modeKey] = mode === 'custom' ? 'custom' : 'cover';
  pushSonicWorkshopColorChange(item.id === 'theme' ? 'sonicWorkshopColorMode' : item.colorKey);
  if (!silent) showToast('\u97f3\u57df\u56de\u54cd\u00b7WE ' + item.label + ': ' + (fx[item.modeKey] === 'cover' ? '\u5c01\u9762\u53d6\u8272' : '\u56fa\u5b9a\u989c\u8272'));
}

function setSonicWorkshopColorMode(mode, silent) {
  setSonicWorkshopRegionColorMode('theme', mode, silent);
}

function setSonicWorkshopTheme(theme, silent) {
  theme = normalizeSonicWorkshopTheme(theme);
  var meta = SONIC_WORKSHOP_THEMES[theme] || SONIC_WORKSHOP_THEMES['coral-mirage'];
  fx.sonicWorkshopColorMode = 'custom';
  fx.sonicWorkshopTheme = theme;
  fx.sonicWorkshopCustomColor = normalizeHexColor(meta.color, '#cb6c89');
  SONIC_WORKSHOP_COLOR_CONTROLS.forEach(function (item) {
    if (item.id === 'theme') return;
    fx[item.modeKey] = 'custom';
    fx[item.colorKey] = normalizeHexColor(meta[item.id] || item.fallback, item.fallback);
  });
  pushSonicWorkshopColorChange('sonicWorkshopRegionColors');
  if (!silent) showToast('\u97f3\u57df\u56de\u54cd\u00b7WE: ' + meta.label);
}

function setSonicWorkshopThemeFromPicker(color, silent) {
  var hex = normalizeHexColor(color || '#cb6c89', '#cb6c89');
  var theme = sonicWorkshopThemeForColor(hex);
  var meta = SONIC_WORKSHOP_THEMES[theme] || SONIC_WORKSHOP_THEMES['coral-mirage'];
  fx.sonicWorkshopColorMode = 'custom';
  fx.sonicWorkshopTheme = theme;
  fx.sonicWorkshopCustomColor = hex;
  SONIC_WORKSHOP_COLOR_CONTROLS.forEach(function (item) {
    if (item.id === 'theme') return;
    fx[item.modeKey] = 'custom';
    fx[item.colorKey] = normalizeHexColor(meta[item.id] || item.fallback, item.fallback);
  });
  pushSonicWorkshopColorChange('sonicWorkshopRegionColors');
  if (!silent) showToast('\u97f3\u57df\u56de\u54cd\u00b7WE ' + SONIC_WORKSHOP_COLOR_CONTROLS[0].label + ': ' + fx.sonicWorkshopCustomColor.toUpperCase());
}

function setSonicWorkshopRegionColorFromPicker(id, color, silent) {
  var item = sonicWorkshopRegionControl(id);
  if (!item) return;
  if (item.id === 'theme') {
    setSonicWorkshopThemeFromPicker(color, silent);
    return;
  }
  var hex = normalizeHexColor(color || item.fallback, item.fallback);
  fx[item.modeKey] = 'custom';
  fx[item.colorKey] = hex;
  pushSonicWorkshopColorChange(item.colorKey);
  if (!silent) showToast('\u97f3\u57df\u56de\u54cd\u00b7WE ' + item.label + ': ' + hex.toUpperCase());
}
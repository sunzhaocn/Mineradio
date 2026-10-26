/** Sonic Topography preset, ported from yin-yizhen/sonic-topography 1.1.1 (3ff303e). */
'use strict';

function installSonicTopographyPreset(global) {
  const _moduleState = {global: global};
  _moduleState.clamp = installSonicTopographyPresetClamp.bind(undefined, _moduleState);
  _moduleState.clamp01 = installSonicTopographyPresetClamp01.bind(undefined, _moduleState);
  _moduleState.smoothstep01 = installSonicTopographyPresetSmoothstep01.bind(undefined, _moduleState);
  _moduleState.blend01 = installSonicTopographyPresetBlend01.bind(undefined, _moduleState);
  _moduleState.lerp = installSonicTopographyPresetLerp.bind(undefined, _moduleState);
  _moduleState.sonicNumber = installSonicTopographyPresetSonicNumber.bind(undefined, _moduleState);
  _moduleState.sonicHex = installSonicTopographyPresetSonicHex.bind(undefined, _moduleState);
  _moduleState.sonicPaletteHex = installSonicTopographyPresetSonicPaletteHex.bind(undefined, _moduleState);
  _moduleState.sonicUsesCustomGroundColors = installSonicTopographyPresetSonicUsesCustomGroundColors.bind(undefined, _moduleState);
  _moduleState.sonicCoverGroundTheme = installSonicTopographyPresetSonicCoverGroundTheme.bind(undefined, _moduleState);
  _moduleState.sonicCustomGroundTheme = installSonicTopographyPresetSonicCustomGroundTheme.bind(undefined, _moduleState);
  _moduleState.floatingBlockCountForFx = installSonicTopographyPresetFloatingBlockCountForFx.bind(undefined, _moduleState);
  _moduleState.deriveGroundLayoutSettings = installSonicTopographyPresetDeriveGroundLayoutSettings.bind(undefined, _moduleState);
  _moduleState.readBands = installSonicTopographyPresetReadBands.bind(undefined, _moduleState);
  _moduleState.applyGroundEqBandValue = installSonicTopographyPresetApplyGroundEqBandValue.bind(undefined, _moduleState);
  _moduleState.deriveTerrainGridSettings = installSonicTopographyPresetDeriveTerrainGridSettings.bind(undefined, _moduleState);
  _moduleState.readMineradioAudio = installSonicTopographyPresetReadMineradioAudio.bind(undefined, _moduleState);
  _moduleState.deriveKickFollowLowBands = installSonicTopographyPresetDeriveKickFollowLowBands.bind(undefined, _moduleState);
  _moduleState.smoothGroundAudio = installSonicTopographyPresetSmoothGroundAudio.bind(undefined, _moduleState);
  _moduleState.buildTerrainVertexShader = installSonicTopographyPresetBuildTerrainVertexShader.bind(undefined, _moduleState);
  _moduleState.buildTerrainFragmentShader = installSonicTopographyPresetBuildTerrainFragmentShader.bind(undefined, _moduleState);
  _moduleState.buildFloatingVertexShader = installSonicTopographyPresetBuildFloatingVertexShader.bind(undefined, _moduleState);
  _moduleState.buildFloatingFragmentShader = installSonicTopographyPresetBuildFloatingFragmentShader.bind(undefined, _moduleState);
  _moduleState.makeRippleUniforms = installSonicTopographyPresetMakeRippleUniforms.bind(undefined, _moduleState);
  _moduleState.makeTerrainUniforms = installSonicTopographyPresetMakeTerrainUniforms.bind(undefined, _moduleState);
  _moduleState.makeFloatingUniforms = installSonicTopographyPresetMakeFloatingUniforms.bind(undefined, _moduleState);
  _moduleState.initData = installSonicTopographyPresetInitData.bind(undefined, _moduleState);
  _moduleState.buildTerrainMesh = installSonicTopographyPresetBuildTerrainMesh.bind(undefined, _moduleState);
  _moduleState.buildFloatingBlocksMesh = installSonicTopographyPresetBuildFloatingBlocksMesh.bind(undefined, _moduleState);
  _moduleState.buildSimpleInstanced = installSonicTopographyPresetBuildSimpleInstanced.bind(undefined, _moduleState);
  _moduleState.applyLayout = installSonicTopographyPresetApplyLayout.bind(undefined, _moduleState);
  _moduleState.bindVisualRotation = installSonicTopographyPresetBindVisualRotation.bind(undefined, _moduleState);
  _moduleState.updateSonicRotation = installSonicTopographyPresetUpdateSonicRotation.bind(undefined, _moduleState);
  _moduleState.ensureLayer = installSonicTopographyPresetEnsureLayer.bind(undefined, _moduleState);
  _moduleState.colorUniformLerp = installSonicTopographyPresetColorUniformLerp.bind(undefined, _moduleState);
  _moduleState.syncTheme = installSonicTopographyPresetSyncTheme.bind(undefined, _moduleState);
  _moduleState.syncTerrainUniforms = installSonicTopographyPresetSyncTerrainUniforms.bind(undefined, _moduleState);
  _moduleState.syncRippleUniforms = installSonicTopographyPresetSyncRippleUniforms.bind(undefined, _moduleState);
  _moduleState.addRipple = installSonicTopographyPresetAddRipple.bind(undefined, _moduleState);
  _moduleState.addMeteor = installSonicTopographyPresetAddMeteor.bind(undefined, _moduleState);
  _moduleState.spawnTrail = installSonicTopographyPresetSpawnTrail.bind(undefined, _moduleState);
  _moduleState.updateAudioTriggers = installSonicTopographyPresetUpdateAudioTriggers.bind(undefined, _moduleState);
  _moduleState.updateFloatingBlocks = installSonicTopographyPresetUpdateFloatingBlocks.bind(undefined, _moduleState);
  _moduleState.updateMeteorsAndTrails = installSonicTopographyPresetUpdateMeteorsAndTrails.bind(undefined, _moduleState);
  _moduleState.clearLayer = installSonicTopographyPresetClearLayer.bind(undefined, _moduleState);
  _moduleState.isActive = installSonicTopographyPresetIsActive.bind(undefined, _moduleState);
  _moduleState.pointerRipple = installSonicTopographyPresetPointerRipple.bind(undefined, _moduleState);
  _moduleState.update = installSonicTopographyPresetUpdate.bind(undefined, _moduleState);
  _moduleState.onPresetChange = installSonicTopographyPresetOnPresetChange.bind(undefined, _moduleState);
  return installSonicTopographyPresetInitialize(_moduleState);
}

function installSonicTopographyPresetClamp(_moduleState, v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

function installSonicTopographyPresetClamp01(_moduleState, v) {
    return _moduleState.clamp(Number.isFinite(v) ? v : 0, 0, 1);
  }

function installSonicTopographyPresetSmoothstep01(_moduleState, v) {
    var t = _moduleState.clamp01(v);
    return t * t * (3 - 2 * t);
  }

function installSonicTopographyPresetBlend01(_moduleState, value) {
    return _moduleState.clamp(Number.isFinite(value) ? value : 0, 0, 1);
  }

function installSonicTopographyPresetLerp(_moduleState, a, b, t) {
    return a + (b - a) * t;
  }

function installSonicTopographyPresetSonicNumber(_moduleState, fx, key, fallback, min, max) {
    var value = fx && fx[key] != null ? Number(fx[key]) : fallback;
    if (!Number.isFinite(value)) value = fallback;
    return _moduleState.clamp(value, min, max);
  }

function installSonicTopographyPresetSonicHex(_moduleState, fx, key, fallback) {
    var value = fx && fx[key] != null ? String(fx[key]).trim() : fallback;
    if (!/^#[0-9a-fA-F]{6}$/.test(value)) value = fallback;
    return value;
  }

function installSonicTopographyPresetSonicPaletteHex(_moduleState, value, fallback) {
    if (typeof _moduleState.global.lyricPaletteColorToHex === 'function') {
      return _moduleState.global.lyricPaletteColorToHex(value, fallback, 0.42);
    }
    value = value == null ? '' : String(value).trim();
    if (/^#[0-9a-fA-F]{6}$/.test(value)) return value;
    if (/^#[0-9a-fA-F]{3}$/.test(value)) {
      return '#' + value.slice(1).split('').map(function (c) { return c + c; }).join('');
    }
    var rgb = value.match(/^rgba?\(\s*([.\d]+)\s*,\s*([.\d]+)\s*,\s*([.\d]+)/i);
    if (rgb) {
      return '#' + [rgb[1], rgb[2], rgb[3]].map(function (part) {
        return Math.round(_moduleState.clamp(Number(part) || 0, 0, 255)).toString(16).padStart(2, '0');
      }).join('');
    }
    return fallback;
  }

function installSonicTopographyPresetSonicUsesCustomGroundColors(_moduleState, fx) {
    return !!(fx && fx.sonicGroundColorMode === 'custom');
  }

function installSonicTopographyPresetSonicCoverGroundTheme(_moduleState, fx) {
    var stage = _moduleState.global.stageLyrics || {};
    var palette = stage.coverPalette || stage.palette || {};
    var tint = _moduleState.sonicHex(fx, 'visualTintColor', '#62d6ff');
    var primaryHex = _moduleState.sonicPaletteHex(palette.primary, tint);
    var secondaryHex = _moduleState.sonicPaletteHex(palette.secondary, _moduleState.DEFAULT_GROUND_COOL_COLOR);
    var highlightHex = _moduleState.sonicPaletteHex(palette.highlight, _moduleState.DEFAULT_GROUND_ACCENT_COLOR);
    var primary = new THREE.Color(primaryHex);
    var secondary = new THREE.Color(secondaryHex);
    var highlight = new THREE.Color(highlightHex);
    var base1 = primary.clone().lerp(new THREE.Color(_moduleState.DEFAULT_GROUND_BASE_COLOR), 0.84);
    var base2 = base1.clone().lerp(highlight, 0.14);
    var coolCore = primary.clone().lerp(new THREE.Color('#ffffff'), 0.08);
    var warmCore = secondary.clone().lerp(new THREE.Color('#ffb15a'), 0.18);
    var ripple = highlight.clone().lerp(new THREE.Color('#ffffff'), 0.10);
    return { base1: base1, base2: base2, coolCore: coolCore, warmCore: warmCore, ripple: ripple };
  }

function installSonicTopographyPresetSonicCustomGroundTheme(_moduleState, fx) {
    var tint = new THREE.Color((fx && fx.visualTintColor) || '#62d6ff');
    var base1 = new THREE.Color(_moduleState.sonicHex(fx, 'sonicGroundBaseColor', _moduleState.DEFAULT_GROUND_BASE_COLOR));
    return {
      base1: base1,
      base2: base1.clone().lerp(new THREE.Color('#ffffff'), 0.12),
      coolCore: new THREE.Color(_moduleState.sonicHex(fx, 'sonicGroundCoolColor', _moduleState.DEFAULT_GROUND_COOL_COLOR)).lerp(tint, fx && fx.visualTintMode === 'custom' ? 0.08 : 0.0),
      warmCore: new THREE.Color(_moduleState.sonicHex(fx, 'sonicGroundWarmColor', _moduleState.DEFAULT_GROUND_WARM_COLOR)).lerp(tint, fx && fx.visualTintMode === 'custom' ? 0.05 : 0.0),
      ripple: new THREE.Color(_moduleState.sonicHex(fx, 'sonicGroundAccentColor', _moduleState.DEFAULT_GROUND_ACCENT_COLOR))
    };
  }

function installSonicTopographyPresetFloatingBlockCountForFx(_moduleState, fx) {
    return Math.round(_moduleState.sonicNumber(fx, 'sonicGroundFloatingCount', _moduleState.DEFAULT_FLOATING_BLOCK_COUNT, _moduleState.FLOATING_BLOCK_MIN_COUNT, _moduleState.FLOATING_BLOCK_MAX_COUNT));
  }

function installSonicTopographyPresetDeriveGroundLayoutSettings(_moduleState, fx) {
    var range = _moduleState.sonicNumber(fx, 'sonicGroundRange', _moduleState.DEFAULT_GROUND_RANGE, 0, 100);
    var lower = _moduleState.sonicNumber(fx, 'sonicGroundLower', _moduleState.DEFAULT_GROUND_LOWER, 0, 100);
    var depth = _moduleState.sonicNumber(fx, 'sonicGroundDepth', _moduleState.DEFAULT_GROUND_DEPTH, 0, 100);
    return {
      scale: 0.096 + range * 0.00072,
      y: -4.05 - lower * 0.034,
      z: -4.20 - depth * 0.055
    };
  }

function installSonicTopographyPresetReadBands(_moduleState, fx) {
    var bands = [];
    for (var i = 0; i < _moduleState.GROUND_BAND_KEYS.length; i++) {
      bands.push(_moduleState.sonicNumber(fx, _moduleState.GROUND_BAND_KEYS[i], _moduleState.DEFAULT_GROUND_BANDS[i], 0, 100));
    }
    return bands;
  }

function installSonicTopographyPresetApplyGroundEqBandValue(_moduleState, value, bands, index, max) {
    var eq = Number(bands[index]);
    if (!Number.isFinite(eq)) eq = 50;
    var delta = (eq - 50) / 50;
    if (delta >= 0) return _moduleState.clamp(value * (1 + delta * 1.8), 0, max == null ? 1 : max);
    var dullness = Math.abs(delta);
    return _moduleState.clamp(Math.max(0, value - dullness * 0.35) * (1 - dullness * 0.35), 0, max == null ? 1 : max);
  }

function installSonicTopographyPresetDeriveTerrainGridSettings(_moduleState, fx) {
    var density = _moduleState.sonicNumber(fx, 'sonicGroundDensity', _moduleState.DEFAULT_TERRAIN_DENSITY, 0, 100);
    var raw = _moduleState.TERRAIN_MIN_GRID_SIZE + ((_moduleState.TERRAIN_MAX_GRID_SIZE - _moduleState.TERRAIN_MIN_GRID_SIZE) * density) / 100;
    var cap = _moduleState.QUALITY_GRID_CAP[(fx && fx.performanceQuality) || 'balanced'] || _moduleState.QUALITY_GRID_CAP.balanced;
    var gridSize = _moduleState.clamp(Math.round(raw / 4) * 4, _moduleState.TERRAIN_MIN_GRID_SIZE, cap);
    var spacing = _moduleState.TERRAIN_BASE_SIZE / gridSize;
    return {
      gridSize: gridSize,
      spacing: spacing,
      boxWidth: spacing * (0.9 / 1.05),
      instanceCount: gridSize * gridSize,
      floatingCount: _moduleState.floatingBlockCountForFx(fx)
    };
  }

function installSonicTopographyPresetReadMineradioAudio(_moduleState, raw) {
    raw = raw || {};
    if (raw.sonicDetailed || raw.subBass != null || raw.lowMid != null || raw.highMid != null) {
      var detailedTreble = _moduleState.clamp01(Number(raw.treble) || Number(raw.brilliance) || Number(raw.air) || 0);
      var detailedEnergy = _moduleState.clamp01(Number(raw.energy) || 0);
      var detailedKick = _moduleState.clamp01(raw.kickEnvelope != null ? Number(raw.kickEnvelope) : (raw.beat != null ? Number(raw.beat) : 0));
      return {
        subBass: _moduleState.clamp01(Number(raw.subBass) || 0),
        bass: _moduleState.clamp01(Number(raw.bass) || 0),
        lowMid: _moduleState.clamp01(Number(raw.lowMid) || 0),
        mid: _moduleState.clamp01(Number(raw.mid) || 0),
        highMid: _moduleState.clamp01(Number(raw.highMid) || 0),
        presence: _moduleState.clamp01(Number(raw.presence) || 0),
        brilliance: _moduleState.clamp01(Number(raw.brilliance) || 0),
        air: _moduleState.clamp01(Number(raw.air) || 0),
        treble: detailedTreble,
        kickEnvelope: detailedKick,
        energy: detailedEnergy,
        sharpness: _moduleState.clamp01(Number(raw.sharpness) || detailedTreble * 0.70 + detailedKick * 0.20),
        smoothness: _moduleState.clamp01(raw.smoothness == null ? (1.0 - detailedTreble * 0.42 + _moduleState.clamp01(Number(raw.mid) || 0) * 0.14) : Number(raw.smoothness)),
        density: _moduleState.clamp01(raw.density == null ? (0.45 + detailedTreble * 0.35 + detailedKick * 0.10) : Number(raw.density))
      };
    }
    var bass = _moduleState.clamp01(Number(raw.bass) || 0);
    var mid = _moduleState.clamp01(Number(raw.mid) || 0);
    var treble = _moduleState.clamp01(Number(raw.treble) || 0);
    var beat = _moduleState.clamp01(Number(raw.beat) || 0);
    var energy = _moduleState.clamp01(Number(raw.energy) || 0);
    return {
      subBass: _moduleState.clamp01(bass * 0.58 + beat * 0.48),
      bass: _moduleState.clamp01(bass * 0.76 + beat * 0.26),
      lowMid: _moduleState.clamp01(mid * 0.54 + bass * 0.16 + energy * 0.08),
      mid: _moduleState.clamp01(mid * 0.86 + energy * 0.08),
      highMid: _moduleState.clamp01(treble * 0.48 + mid * 0.22),
      presence: _moduleState.clamp01(treble * 0.62 + beat * 0.10),
      brilliance: _moduleState.clamp01(treble * 0.74 + energy * 0.06),
      air: _moduleState.clamp01(treble * 0.45 + energy * 0.10),
      treble: treble,
      kickEnvelope: beat,
      energy: energy,
      sharpness: _moduleState.clamp01(treble * 0.70 + beat * 0.20),
      smoothness: _moduleState.clamp01(1.0 - treble * 0.42 + mid * 0.14),
      density: _moduleState.clamp01(0.45 + treble * 0.35 + beat * 0.10)
    };
  }

function installSonicTopographyPresetDeriveKickFollowLowBands(_moduleState, data, bands) {
    var safeKick = _moduleState.clamp(Number.isFinite(data.kickEnvelope) ? data.kickEnvelope : 0, 0, _moduleState.MAX_KICK_DEFORM);
    var normalizedKick = safeKick / _moduleState.MAX_KICK_DEFORM;
    var subBassInput = _moduleState.clamp01(data.subBass) * 0.22 + normalizedKick * 1.28;
    var bassInput = _moduleState.clamp01(data.bass) * 0.20 + normalizedKick * 1.15;
    return {
      subBass: _moduleState.applyGroundEqBandValue(subBassInput, bands, 0, _moduleState.MAX_SHADER_SUB_BASS),
      bass: _moduleState.applyGroundEqBandValue(bassInput, bands, 1, _moduleState.MAX_SHADER_BASS)
    };
  }

function installSonicTopographyPresetSmoothGroundAudio(_moduleState, target, fx, dt) {
    var motionSpeed = _moduleState.sonicNumber(fx, 'sonicGroundMotionSpeed', _moduleState.DEFAULT_GROUND_MOTION_SPEED, 0, 100);
    var responseRate = _moduleState.lerp(2.2, 60, motionSpeed / 100);
    var responseBlend = _moduleState.blend01(1 - Math.exp(-responseRate * Math.max(0.001, dt || 1 / 60)));
    var s = _moduleState.state.smoothAudio;
    s.subBass += (target.subBass - s.subBass) * responseBlend;
    s.bass += (target.bass - s.bass) * responseBlend;
    s.lowMid += (target.lowMid - s.lowMid) * responseBlend;
    s.mid += (target.mid - s.mid) * responseBlend;
    s.highMid += (target.highMid - s.highMid) * responseBlend;
    s.presence += (target.presence - s.presence) * responseBlend;
    s.brilliance += (target.brilliance - s.brilliance) * responseBlend;
    s.air += (target.air - s.air) * responseBlend;
    return s;
  }

function installSonicTopographyPresetBuildTerrainVertexShader(_moduleState) {
    return [
      'precision highp float;',
      'uniform float uTime;',
      'uniform float uSubBass;',
      'uniform float uBass;',
      'uniform float uLowMid;',
      'uniform float uMid;',
      'uniform float uHighMid;',
      'uniform float uSmoothness;',
      'uniform float uDensity;',
      'uniform float uEnergy;',
      'uniform float uAmplitude;',
      'uniform vec4 uRipples[' + _moduleState.RIPPLE_MAX + '];',
      'varying vec2 vUv;',
      'varying float vElevation;',
      'varying float vDistance;',
      'varying vec2 vRippleAnim;',
      'varying vec3 vNormal;',
      'varying float vRelativeY;',
      'varying vec2 vInstancePos;',
      'vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}',
      'vec2 mod289(vec2 x){return x-floor(x*(1.0/289.0))*289.0;}',
      'vec3 permute(vec3 x){return mod289(((x*34.0)+1.0)*x);}',
      'float snoise(vec2 v){',
      '  const vec4 C=vec4(0.211324865405187,0.366025403784439,-0.577350269189626,0.024390243902439);',
      '  vec2 i=floor(v+dot(v,C.yy));',
      '  vec2 x0=v-i+dot(i,C.xx);',
      '  vec2 i1=(x0.x>x0.y)?vec2(1.0,0.0):vec2(0.0,1.0);',
      '  vec4 x12=x0.xyxy+C.xxzz; x12.xy-=i1;',
      '  i=mod289(i);',
      '  vec3 p=permute(permute(i.y+vec3(0.0,i1.y,1.0))+i.x+vec3(0.0,i1.x,1.0));',
      '  vec3 m=max(0.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.0);',
      '  m=m*m; m=m*m;',
      '  vec3 x=2.0*fract(p*C.www)-1.0;',
      '  vec3 h=abs(x)-0.5;',
      '  vec3 ox=floor(x+0.5);',
      '  vec3 a0=x-ox;',
      '  m*=1.79284291400159-0.85373472095314*(a0*a0+h*h);',
      '  vec3 g; g.x=a0.x*x0.x+h.x*x0.y; g.yz=a0.yz*x12.xz+h.yz*x12.yw;',
      '  return 130.0*dot(m,g);',
      '}',
      'float random(vec2 st){return fract(sin(dot(st.xy,vec2(12.9898,78.233)))*43758.5453123);}',
      'void main(){',
      '  vUv=uv;',
      '  vNormal=normal;',
      '  vec4 instancePos=instanceMatrix*vec4(0.0,0.0,0.0,1.0);',
      '  vec2 pos2D=instancePos.xz;',
      '  vInstancePos=pos2D;',
      '  float centerDist=length(pos2D);',
      '  vDistance=centerDist;',
      '  float rnd=random(pos2D);',
      '  vec2 movingPos=pos2D*0.05+vec2(uTime*0.1,uTime*0.05);',
      '  float baseNoise=(snoise(movingPos)+1.0)*0.5;',
      '  float wave=sin(pos2D.x*0.15+pos2D.y*0.1-uTime*0.6)*0.5+0.5;',
      '  float globalFalloff=smoothstep(60.0,30.0,centerDist);',
      '  float idleElevation=mix(baseNoise,wave,uSmoothness*0.5+0.2)*0.8*globalFalloff;',
      '  float subRegion=smoothstep(25.0,0.0,centerDist);',
      '  float subLift=uSubBass*subRegion*5.0;',
      '  float bassNoise=snoise(pos2D*0.1-vec2(0.0,uTime*0.2));',
      '  float bassRegion=smoothstep(35.0,5.0,centerDist+bassNoise*5.0);',
      '  float bassLift=uBass*bassRegion*(smoothstep(0.0,1.0,rnd+uDensity*0.5))*4.0;',
      '  float lowMidNoise=snoise(pos2D*0.05+vec2(uTime*0.1,0.0));',
      '  float lowMidLift=uLowMid*(lowMidNoise*0.5+0.5)*2.5;',
      '  float riverFlow=sin(pos2D.x*0.2+pos2D.y*0.2+snoise(pos2D*0.1)*2.0-uTime*2.0);',
      '  float midLift=uMid*max(0.0,riverFlow)*3.0;',
      '  float highMidRegion=smoothstep(10.0,45.0,centerDist);',
      '  float highMidLift=0.0;',
      '  if(fract(rnd*13.3)>0.8){highMidLift=uHighMid*highMidRegion*fract(rnd*7.7)*2.5;}',
      '  float audioElevation=subLift+bassLift+lowMidLift+midLift+highMidLift;',
      '  if(rnd>0.99){audioElevation+=uEnergy*5.0;}',
      '  audioElevation*=globalFalloff;',
      '  audioElevation=max(0.0,audioElevation-0.2);',
      '  audioElevation*=uAmplitude;',
      '  float elevation=idleElevation+audioElevation;',
      '  float rippleElevation=0.0;',
      '  float rippleIntensityNormal=0.0;',
      '  float rippleIntensityWhite=0.0;',
      '  for(int i=0;i<' + _moduleState.RIPPLE_MAX + ';i++){',
      '    vec4 rd=uRipples[i];',
      '    if(rd.w!=0.0){',
      '      float strength=abs(rd.w);',
      '      bool whiteRipple=rd.w<0.0;',
      '      float dist=length(pos2D-rd.xy);',
      '      float timeSince=uTime-rd.z;',
      '      float curSpeed=whiteRipple?18.0:13.0;',
      '      float curWidth=whiteRipple?1.35:5.5;',
      '      float curFadeDist=whiteRipple?12.0:26.0;',
      '      float elevationScale=whiteRipple?1.15:3.35;',
      '      float waveRadius=timeSince*curSpeed;',
      '      float d=dist-waveRadius;',
      '      float rippleWave=exp(-d*d/curWidth);',
      '      float fade=exp(-waveRadius/curFadeDist);',
      '      float lifeFade=1.0-smoothstep(2.10,4.80,timeSince);',
      '      float rPulse=rippleWave*fade*lifeFade*strength;',
      '      rippleElevation+=rPulse*elevationScale;',
      '      if(whiteRipple){rippleIntensityWhite+=rPulse;}else{rippleIntensityNormal+=rPulse;}',
      '    }',
      '  }',
      '  elevation+=rippleElevation;',
      '  vRippleAnim=vec2(clamp(rippleIntensityNormal,0.0,1.0),clamp(rippleIntensityWhite,0.0,1.0));',
      '  vElevation=elevation;',
      '  float yPos=position.y+0.5;',
      '  vRelativeY=yPos;',
      '  float totalHeight=1.0+elevation;',
      '  vec3 pos=position;',
      '  pos.y=-0.5+yPos*totalHeight;',
      '  vec4 worldPosition=modelMatrix*instanceMatrix*vec4(pos,1.0);',
      '  gl_Position=projectionMatrix*viewMatrix*worldPosition;',
      '}'
    ].join('\n');
  }

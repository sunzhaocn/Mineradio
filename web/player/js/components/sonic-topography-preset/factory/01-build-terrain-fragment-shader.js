'use strict';

function installSonicTopographyPresetBuildTerrainFragmentShader(_moduleState) {
    return [
      'precision highp float;',
      'uniform float uTime;',
      'uniform float uPresence;',
      'uniform float uBrilliance;',
      'uniform float uAir;',
      'uniform float uWarmth;',
      'uniform float uBrightness;',
      'uniform float uSharpness;',
      'uniform vec3 uBaseColor1;',
      'uniform vec3 uBaseColor2;',
      'uniform vec3 uFogColor;',
      'uniform vec3 uCoolCore;',
      'uniform vec3 uCoolEdge;',
      'uniform vec3 uWarmCore;',
      'uniform vec3 uWarmEdge;',
      'uniform vec3 uRippleColor;',
      'uniform float uGlowIntensity;',
      'varying vec2 vUv;',
      'varying float vElevation;',
      'varying float vDistance;',
      'varying vec2 vRippleAnim;',
      'varying vec3 vNormal;',
      'varying float vRelativeY;',
      'varying vec2 vInstancePos;',
      'float random(vec2 st){return fract(sin(dot(st.xy,vec2(12.9898,78.233)))*43758.5453123);}',
      'void main(){',
      '  bool isTop=vNormal.y>0.5;',
      '  float distFromTop=1.0-vRelativeY;',
      '  float rnd=random(vInstancePos);',
      '  float centerDist=length(vInstancePos);',
      '  float normElevation=clamp(vElevation/8.0,0.0,1.0);',
      '  vec3 cBase1=uBaseColor1;',
      '  vec3 cBase2=uBaseColor2;',
      '  float warmBlend=smoothstep(0.0,1.0,uWarmth*1.5+(0.5-centerDist/80.0));',
      '  vec3 zoneCore=mix(uCoolCore,uWarmCore,warmBlend);',
      '  vec3 zoneEdge=mix(uCoolEdge,uWarmEdge,warmBlend);',
      '  vec3 targetGlow=mix(zoneCore,zoneEdge,fract(rnd*11.0));',
      '  float distFade=1.0-smoothstep(40.0,75.0,centerDist);',
      '  vec3 brightCool=mix(uCoolCore,vec3(1.0),0.24);',
      '  targetGlow=mix(targetGlow,brightCool,uBrightness*0.6);',
      '  vec3 currentGlow=mix(cBase2,targetGlow,normElevation)*uGlowIntensity*distFade;',
      '  currentGlow=mix(currentGlow,uRippleColor,clamp(vRippleAnim.x*0.82,0.0,0.72));',
      '  currentGlow=mix(currentGlow,vec3(1.0),vRippleAnim.y);',
      '  vec3 bodyColor=mix(cBase1,cBase2,vRelativeY*distFade);',
      '  vec3 finalColor;',
      '  if(isTop){',
      '    float topIntensity=smoothstep(0.0,0.4,normElevation);',
      '    float twinkleDistFalloff=smoothstep(60.0,30.0,centerDist);',
      '    float twinkleMultiplier=mix(twinkleDistFalloff,1.0,smoothstep(0.01,0.1,normElevation));',
      '    if(fract(rnd*31.0)>0.95&&normElevation<0.1){topIntensity+=uAir*2.0*twinkleMultiplier;}',
      '    finalColor=mix(cBase2,currentGlow,topIntensity);',
      '    float edgeX=smoothstep(0.05,0.01,vUv.x)+smoothstep(0.95,0.99,vUv.x);',
      '    float edgeY=smoothstep(0.05,0.01,vUv.y)+smoothstep(0.95,0.99,vUv.y);',
      '    float edge=min(edgeX+edgeY,1.0);',
      '    finalColor+=currentGlow*edge*0.8*(topIntensity+0.3);',
      '    float flashChance=smoothstep(0.3,1.0,uPresence);',
      '    if(fract(rnd*53.0)>0.98-flashChance*0.1){',
      '      float flashSync=sin(uTime*40.0+rnd*100.0)*0.5+0.5;',
      '      finalColor+=mix(vec3(1.0),vec3(0.5,1.0,1.0),rnd)*flashSync*uPresence*(1.0+uSharpness*2.0)*twinkleMultiplier;',
      '    }',
      '    if(edge>0.5&&fract(rnd*89.0+uTime*2.0)>0.98){finalColor+=vec3(1.0)*uBrilliance*3.0*twinkleMultiplier;}',
      '  }else{',
      '    float verticalFalloff=mix(1.0,3.0,uSharpness);',
      '    float sideGlow=smoothstep(0.5/verticalFalloff,0.0,distFromTop)*normElevation;',
      '    if(normElevation<0.02)sideGlow=0.0;',
      '    finalColor=mix(bodyColor,currentGlow,sideGlow*1.5);',
      '    float rimGlow=smoothstep(0.03,0.0,distFromTop)*normElevation;',
      '    finalColor+=currentGlow*rimGlow;',
      '  }',
      '  finalColor+=uRippleColor*vRippleAnim.x*0.86;',
      '  finalColor+=vec3(1.0)*vRippleAnim.y*1.2;',
      '  float aerialFog=smoothstep(30.0,65.0,vDistance);',
      '  vec3 atmosphericColor=mix(cBase1,cBase2,0.4);',
      '  finalColor=mix(finalColor,atmosphericColor,aerialFog*0.35);',
      '  float alphaFade=1.0-smoothstep(55.0,78.0,vDistance);',
      '  float alphaBlend=1.0-alphaFade;',
      '  finalColor=mix(finalColor,uFogColor,alphaBlend*0.45);',
      '  gl_FragColor=vec4(finalColor,alphaFade);',
      '}'
    ].join('\n');
  }

function installSonicTopographyPresetBuildFloatingVertexShader(_moduleState) {
    return [
      'precision highp float;',
      'uniform float uPulse;',
      'varying vec2 vUv;',
      'varying float vElevation;',
      'varying float vDistance;',
      'varying vec2 vRippleAnim;',
      'varying vec3 vNormal;',
      'varying float vRelativeY;',
      'varying vec2 vInstancePos;',
      'void main(){',
      '  vUv=uv;',
      '  vNormal=normal;',
      '  vec4 instancePos=instanceMatrix*vec4(0.0,0.0,0.0,1.0);',
      '  vec2 pos2D=instancePos.xz;',
      '  vInstancePos=pos2D;',
      '  vDistance=length(pos2D);',
      '  vRippleAnim=vec2(uPulse*0.8,uPulse*0.3);',
      '  vElevation=uPulse*20.0;',
      '  vRelativeY=position.y+0.5;',
      '  vec4 worldPosition=modelMatrix*instanceMatrix*vec4(position,1.0);',
      '  gl_Position=projectionMatrix*viewMatrix*worldPosition;',
      '}'
    ].join('\n');
  }

function installSonicTopographyPresetBuildFloatingFragmentShader(_moduleState) {
    return _moduleState.buildTerrainFragmentShader();
  }

function installSonicTopographyPresetMakeRippleUniforms(_moduleState) {
    var arr = [];
    for (var i = 0; i < _moduleState.RIPPLE_MAX; i++) arr.push(new THREE.Vector4(0, 0, -100, 0));
    return arr;
  }

function installSonicTopographyPresetMakeTerrainUniforms(_moduleState) {
    return {
      uTime: { value: 0 },
      uSubBass: { value: 0 },
      uBass: { value: 0 },
      uLowMid: { value: 0 },
      uMid: { value: 0 },
      uHighMid: { value: 0 },
      uPresence: { value: 0 },
      uBrilliance: { value: 0 },
      uAir: { value: 0 },
      uWarmth: { value: 0 },
      uBrightness: { value: 0 },
      uSharpness: { value: 0 },
      uSmoothness: { value: 0 },
      uDensity: { value: 0 },
      uEnergy: { value: 0 },
      uAmplitude: { value: 1 },
      uRipples: { value: _moduleState.makeRippleUniforms() },
      uBaseColor1: { value: new THREE.Color(0.01, 0.02, 0.04) },
      uBaseColor2: { value: new THREE.Color(0.03, 0.05, 0.09) },
      uFogColor: { value: new THREE.Color(0.01, 0.02, 0.04) },
      uCoolCore: { value: new THREE.Color(0.0, 0.3, 1.0) },
      uCoolEdge: { value: new THREE.Color(0.6, 0.2, 1.0) },
      uWarmCore: { value: new THREE.Color(1.0, 0.2, 0.1) },
      uWarmEdge: { value: new THREE.Color(1.0, 0.6, 0.0) },
      uRippleColor: { value: new THREE.Color(0.2, 0.9, 1.0) },
      uGlowIntensity: { value: 1 }
    };
  }

function installSonicTopographyPresetMakeFloatingUniforms(_moduleState) {
    var uniforms = _moduleState.makeTerrainUniforms();
    uniforms.uPulse = { value: 0 };
    return uniforms;
  }

function installSonicTopographyPresetInitData(_moduleState, floatingCount) {
    var i;
    _moduleState.state.ripples = [];
    for (i = 0; i < _moduleState.RIPPLE_MAX; i++) _moduleState.state.ripples.push({ x: 0, z: 0, start: -100, strength: 0, white: false });
    _moduleState.state.meteorsData = [];
    for (i = 0; i < _moduleState.METEOR_MAX; i++) _moduleState.state.meteorsData.push({ active: false, x: 0, y: -1000, z: 0, speed: 0, strength: 0 });
    _moduleState.state.trailsData = [];
    for (i = 0; i < _moduleState.TRAIL_MAX; i++) {
      _moduleState.state.trailsData.push({ active: false, x: 0, y: -1000, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, scale: 1 });
    }
    _moduleState.state.floatingData = [];
    floatingCount = Math.max(0, Math.round(Number(floatingCount) || 0));
    for (i = 0; i < floatingCount; i++) {
      var ring = i / Math.max(1, floatingCount);
      var angle = ring * Math.PI * 2 * 5.0 + Math.sin(i * 12.9898) * 0.7;
      var radius = 14 + ((i * 37) % 62);
      var height = 6 + ((i * 17) % 19);
      _moduleState.state.floatingData.push({
        x: Math.cos(angle) * radius,
        z: Math.sin(angle) * radius,
        y: height,
        baseScale: 0.75 + ((i * 11) % 9) * 0.05,
        phase: i * 0.73,
        rotationSpeed: 0.18 + ((i * 7) % 10) * 0.035
      });
    }
  }

function installSonicTopographyPresetBuildTerrainMesh(_moduleState, settings) {
    var geo = new THREE.BoxGeometry(settings.boxWidth, 1, settings.boxWidth);
    var mat = new THREE.ShaderMaterial({
      uniforms: _moduleState.makeTerrainUniforms(),
      vertexShader: _moduleState.buildTerrainVertexShader(),
      fragmentShader: _moduleState.buildTerrainFragmentShader(),
      transparent: true,
      depthWrite: true,
      depthTest: true
    });
    var mesh = new THREE.InstancedMesh(geo, mat, settings.instanceCount);
    mesh.frustumCulled = false;
    var offset = (settings.gridSize * settings.spacing) / 2;
    var n = 0;
    for (var x = 0; x < settings.gridSize; x++) {
      for (var z = 0; z < settings.gridSize; z++) {
        _moduleState.state.dummyMat4.makeTranslation(x * settings.spacing - offset, 0.5, z * settings.spacing - offset);
        mesh.setMatrixAt(n++, _moduleState.state.dummyMat4);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }

function installSonicTopographyPresetBuildFloatingBlocksMesh(_moduleState, count) {
    count = Math.max(0, Math.round(Number(count) || 0));
    var geo = new THREE.BoxGeometry(1, 1, 1);
    var mat = new THREE.ShaderMaterial({
      uniforms: _moduleState.makeFloatingUniforms(),
      vertexShader: _moduleState.buildFloatingVertexShader(),
      fragmentShader: _moduleState.buildFloatingFragmentShader(),
      transparent: true,
      depthWrite: false,
      depthTest: true
    });
    var mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.frustumCulled = false;
    return mesh;
  }

function installSonicTopographyPresetBuildSimpleInstanced(_moduleState, count, size, color, opacity) {
    var geo = new THREE.BoxGeometry(size[0], size[1], size[2]);
    var mat = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: opacity == null ? 1 : opacity,
      depthWrite: false,
      toneMapped: false
    });
    var mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.frustumCulled = false;
    for (var i = 0; i < count; i++) {
      _moduleState.state.dummyScale.set(0, 0, 0);
      _moduleState.state.dummyMat4.compose(_moduleState.state.dummyPos.set(0, -1000, 0), _moduleState.state.dummyQuat, _moduleState.state.dummyScale);
      mesh.setMatrixAt(i, _moduleState.state.dummyMat4);
    }
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }

function installSonicTopographyPresetApplyLayout(_moduleState, fx) {
    if (!_moduleState.state.root) return;
    var layout = _moduleState.deriveGroundLayoutSettings(fx || {});
    _moduleState.state.root.rotation.x = _moduleState.state.boundRotX;
    _moduleState.state.root.rotation.y = _moduleState.state.boundRotY + _moduleState.state.autoYaw;
    _moduleState.state.root.rotation.z = 0;
    _moduleState.state.root.position.set(0, layout.y, layout.z);
    _moduleState.state.root.scale.setScalar(layout.scale);
  }

function installSonicTopographyPresetBindVisualRotation(_moduleState, ctx) {
    var src = ctx && ctx.visualRotation;
    if (!src && typeof particles !== 'undefined' && particles && particles.rotation) src = particles.rotation;
    _moduleState.state.boundRotX = src && Number.isFinite(Number(src.x)) ? Number(src.x) : 0;
    _moduleState.state.boundRotY = src && Number.isFinite(Number(src.y)) ? Number(src.y) : 0;
  }

function installSonicTopographyPresetUpdateSonicRotation(_moduleState, fx, dt, ctx) {
    _moduleState.bindVisualRotation(ctx);
    var autoRotate = _moduleState.sonicNumber(fx, 'sonicGroundAutoRotate', _moduleState.DEFAULT_GROUND_AUTO_ROTATE, 0, 100);
    var speed = _moduleState.lerp(0, 0.30, autoRotate / 100) * _moduleState.clamp((fx && fx.speed) || 1, 0.35, 1.8);
    _moduleState.state.manualYaw *= Math.pow(0.001, Math.max(0.001, dt || 1 / 60));
    if (typeof orbit !== 'undefined' && orbit) {
      if (orbit.rotating || (ctx && ctx.visualRotationActive)) speed *= 0.35;
    }
    _moduleState.state.autoYaw += dt * speed;
  }

function installSonicTopographyPresetEnsureLayer(_moduleState, scene, fx) {
    var settings = _moduleState.deriveTerrainGridSettings(fx);
    if (_moduleState.state.initialized && _moduleState.state.gridSize === settings.gridSize && _moduleState.state.floatingCount === settings.floatingCount) return;
    _moduleState.clearLayer();
    _moduleState.state.scene = scene;
    _moduleState.state.gridSize = settings.gridSize;
    _moduleState.state.gridSpacing = settings.spacing;
    _moduleState.state.floatingCount = settings.floatingCount;
    _moduleState.state.dummyObj = new THREE.Object3D();
    _moduleState.state.dummyPos = new THREE.Vector3();
    _moduleState.state.dummyQuat = new THREE.Quaternion();
    _moduleState.state.dummyScale = new THREE.Vector3();
    _moduleState.state.dummyMat4 = new THREE.Matrix4();
    _moduleState.state.dummyEuler = new THREE.Euler();
    _moduleState.initData(settings.floatingCount);
    _moduleState.state.root = new THREE.Group();
    _moduleState.state.root.name = 'sonic-topography-root';
    _moduleState.state.terrain = _moduleState.buildTerrainMesh(settings);
    _moduleState.state.terrainMat = _moduleState.state.terrain.material;
    _moduleState.state.root.add(_moduleState.state.terrain);
    _moduleState.state.floatingBlocks = _moduleState.buildFloatingBlocksMesh(settings.floatingCount);
    _moduleState.state.floatingMat = _moduleState.state.floatingBlocks.material;
    _moduleState.state.root.add(_moduleState.state.floatingBlocks);
    _moduleState.state.meteors = _moduleState.buildSimpleInstanced(_moduleState.METEOR_MAX, [0.4, 1.2, 0.4], 0xffffff, 1);
    _moduleState.state.meteorMat = _moduleState.state.meteors.material;
    _moduleState.state.root.add(_moduleState.state.meteors);
    _moduleState.state.trails = _moduleState.buildSimpleInstanced(_moduleState.TRAIL_MAX, [0.8, 0.8, 0.8], 0xa8ecff, 0.6);
    _moduleState.state.trailMat = _moduleState.state.trails.material;
    _moduleState.state.root.add(_moduleState.state.trails);
    _moduleState.state.root.visible = false;
    _moduleState.applyLayout(fx);
    scene.add(_moduleState.state.root);
    _moduleState.state.initialized = true;
  }

function installSonicTopographyPresetColorUniformLerp(_moduleState, uniform, target, alpha) {
    if (!uniform || !uniform.value) return;
    uniform.value.lerp(target, alpha);
  }

function installSonicTopographyPresetSyncTheme(_moduleState, mat, fx, audio, dt) {
    if (!mat) return;
    var u = mat.uniforms;
    var lerpSpeed = _moduleState.blend01(3.0 * Math.max(0.001, dt || 1 / 60));
    var theme = _moduleState.sonicUsesCustomGroundColors(fx) ? _moduleState.sonicCustomGroundTheme(fx) : _moduleState.sonicCoverGroundTheme(fx);
    var base1 = theme.base1;
    var base2 = theme.base2;
    var coolCore = theme.coolCore;
    var coolEdge = coolCore.clone().lerp(base1, 0.34);
    var warmCore = theme.warmCore;
    var warmEdge = warmCore.clone().lerp(base1, 0.26);
    var ripple = theme.ripple;
    _moduleState.colorUniformLerp(u.uBaseColor1, base1, lerpSpeed);
    _moduleState.colorUniformLerp(u.uBaseColor2, base2, lerpSpeed);
    _moduleState.colorUniformLerp(u.uFogColor, base1, lerpSpeed);
    _moduleState.colorUniformLerp(u.uCoolCore, coolCore, lerpSpeed);
    _moduleState.colorUniformLerp(u.uCoolEdge, coolEdge, lerpSpeed);
    _moduleState.colorUniformLerp(u.uWarmCore, warmCore, lerpSpeed);
    _moduleState.colorUniformLerp(u.uWarmEdge, warmEdge, lerpSpeed);
    _moduleState.colorUniformLerp(u.uRippleColor, ripple, lerpSpeed);
    var glow = _moduleState.sonicNumber(fx, 'sonicGroundGlow', _moduleState.DEFAULT_GROUND_GLOW, 0, 100);
    u.uGlowIntensity.value = _moduleState.lerp(u.uGlowIntensity.value, _moduleState.clamp(0.55 + glow * 0.014 + ((fx && fx.bloomStrength) || 0) * 0.22, 0.45, 2.2), lerpSpeed);
    var low = audio.subBass + audio.bass + audio.lowMid + audio.mid;
    var high = audio.presence + audio.brilliance + audio.air;
    var sum = Math.max(0.001, low + high);
    u.uWarmth.value = _moduleState.clamp(low / sum, 0, 1);
    u.uBrightness.value = _moduleState.clamp(high / sum, 0, 1);
    u.uSharpness.value = audio.sharpness;
    u.uSmoothness.value = audio.smoothness;
    u.uDensity.value = audio.density;
    if (_moduleState.state.meteorMat) _moduleState.state.meteorMat.color.copy(warmCore).lerp(new THREE.Color(0xffffff), 0.7);
    if (_moduleState.state.trailMat) _moduleState.state.trailMat.color.copy(ripple);
  }

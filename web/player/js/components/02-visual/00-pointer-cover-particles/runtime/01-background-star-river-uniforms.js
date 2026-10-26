'use strict';



var backgroundStarRiverUniforms = {
  uDotTex: uniforms.uDotTex,
  uTime: uniforms.uTime,
  uBass: uniforms.uBass,
  uTreble: uniforms.uTreble,
  uBeat: uniforms.uBeat,
  uEnergy: uniforms.uEnergy,
  uPixel: uniforms.uPixel,
  uPointScale: uniforms.uPointScale,
  uParticleDim: uniforms.uParticleDim,
  uTintColor: uniforms.uTintColor,
  uAlpha: { value: 0 }
};


var backgroundStarRiverVs = `
precision highp float;
attribute float aSeed, aLane, aDepthSeed;
uniform float uTime, uBass, uTreble, uBeat, uEnergy, uPixel, uPointScale, uAlpha, uParticleDim;
uniform vec3 uTintColor;
varying vec3 vColor;
varying float vAlpha, vTwinkle;

float hash11(float p){ return fract(sin(p * 127.1) * 43758.5453123); }

void main(){
  float band = floor(aLane * 6.0);
  float local = fract(aLane * 6.0);
  float bandN = (band + 0.5) / 6.0;
  float seed = aSeed + band * 19.17;
  float flow = fract(hash11(seed * 2.13) + uTime * (0.0022 + bandN * 0.0028 + hash11(seed * 5.1) * 0.0034));
  float arc = (flow - 0.5) * 6.2831853 * (0.68 + bandN * 0.46) + bandN * 2.4 + hash11(seed) * 6.2831853;
  float wave = sin(arc * (1.18 + bandN * 0.28) + uTime * (0.014 + bandN * 0.012) + seed * 0.07);
  float radius = 7.2 + bandN * 15.8 + hash11(seed * 3.7) * 6.2 + local * 1.8;
  vec3 pos;
  pos.x = cos(arc * 0.76 + bandN * 0.84) * radius + (flow - 0.5) * (18.0 + bandN * 14.0);
  pos.y = (bandN - 0.5) * 13.2 + wave * (1.5 + bandN * 1.4) + (local - 0.5) * 1.2;
  pos.z = mix(-31.0, -4.8, aDepthSeed) + wave * 1.2 + sin(uTime * (0.018 + hash11(seed) * 0.032) + seed) * 1.0;

  float twinkle = pow(0.5 + 0.5 * sin(uTime * (0.22 + hash11(seed * 4.0) * 0.44) + seed * 9.0), 5.0);
  float ridge = exp(-pow((local - (0.42 + hash11(seed * 6.0) * 0.16)) / (0.22 + hash11(seed * 7.0) * 0.10), 2.0));
  float dust = smoothstep(0.20, 0.98, hash11(seed * 8.0 + band));
  vec3 cool = mix(vec3(0.34, 0.76, 1.0), vec3(0.60, 0.44, 1.0), bandN);
  vec3 warm = vec3(1.0, 0.78, 0.58);
  vec3 tint = max(uTintColor, vec3(0.08));
  vColor = mix(cool, warm, ridge * 0.35 + uBass * 0.06);
  vColor = mix(vColor, tint, 0.22);
  vTwinkle = twinkle;
  vAlpha = uAlpha * uParticleDim * dust * (0.10 + ridge * 0.52 + twinkle * 0.32 + uBeat * 0.05) * (0.88 + uEnergy * 0.18);

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  float depthSize = 30.0 / max(0.65, -mv.z);
  float size = 1.10 + ridge * 2.40 + twinkle * 2.80 + uTreble * 0.80 + uBeat * 0.50;
  gl_PointSize = clamp(size * depthSize * uPixel * uPointScale, 0.75, 5.60);
  gl_Position = projectionMatrix * mv;
}
`;


var backgroundStarRiverFs = `
precision highp float;
uniform sampler2D uDotTex;
varying vec3 vColor;
varying float vAlpha, vTwinkle;

void main(){
  vec4 tex = texture2D(uDotTex, gl_PointCoord);
  if (tex.a < 0.02) discard;
  vec3 col = clamp(vColor * (0.66 + vTwinkle * 0.72), vec3(0.0), vec3(1.45));
  gl_FragColor = vec4(col, tex.a * vAlpha);
}
`;


var backgroundStarRiverMaterial = new THREE.ShaderMaterial({
  uniforms: backgroundStarRiverUniforms,
  vertexShader: backgroundStarRiverVs,
  fragmentShader: backgroundStarRiverFs,
  transparent: true,
  depthWrite: false,
  depthTest: false,
  blending: THREE.AdditiveBlending
});

var backgroundStarRiverParticles = new THREE.Points(buildBackgroundStarRiverGeometry(BACKGROUND_STAR_RIVER_COUNT), backgroundStarRiverMaterial);

backgroundStarRiverParticles.frustumCulled = false;

backgroundStarRiverParticles.renderOrder = -2;

scene.add(backgroundStarRiverParticles);

console.log('v7 shell loaded, JS pending');

// ============================================================
//  浮空粒子层 (独立 Points)
//   v7.1: 速度大幅放慢, 改用 sin/cos 长周期漂移 (优雅而非乱飞)

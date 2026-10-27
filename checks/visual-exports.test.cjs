'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {Spectrum} = require('../web/player/js/features/visual/export-spectrum');
const {validate} = require('../Windows_exe/desktop/video-exporter');
const {registerMediaSchemes} = require('../Windows_exe/desktop/media-schemes');

test('all local media protocols retain fetch privileges in one Electron registration', () => {
  const calls=[];registerMediaSchemes({registerSchemesAsPrivileged:schemes=>calls.push(schemes)});
  assert.equal(calls.length,1);assert.equal(calls[0].length,3);
  assert.equal(new Set(calls[0].map(item=>item.scheme)).size,3);
  const local=calls[0].find(item=>item.scheme==='mineradio-local');
  assert.ok(local.privileges.supportFetchAPI && local.privileges.standard && local.privileges.secure && local.privileges.corsEnabled);
});

test('export analyser preserves silence and locates a known tone at multiple sample rates', () => {
  for (const rate of [44100,48000]) {
    const spectrum = new Spectrum(2048,rate);
    spectrum.update(new Float32Array(2048));
    assert.ok(spectrum.frequency.every(value => value === 0));
    assert.ok(spectrum.time.every(value => value === 128));
    const pcm = Float32Array.from({length:2048},(_,i) => .003*Math.sin(2*Math.PI*440*i/rate));
    spectrum.update(pcm);
    const maximum = Math.max(...spectrum.frequency), peak = spectrum.frequency.indexOf(maximum);
    assert.ok(Math.abs(peak - 440*2048/rate) <= 1, `Tone peak ${peak} at ${rate} Hz`);
    assert.ok(maximum > 50 && maximum < 255);
  }
});

test('export analyser decays after audio stops and bounds clipping without invalid values', () => {
  const spectrum = new Spectrum(2048,48000);
  spectrum.update(Float32Array.from({length:2048},(_,i)=>.2*Math.sin(2*Math.PI*1000*i/48000)));
  let previous = Math.max(...spectrum.frequency);
  for (let frame=0;frame<80;frame++) {
    spectrum.update(new Float32Array(2048));
    const next = Math.max(...spectrum.frequency); assert.ok(next <= previous);previous=next;
  }
  assert.equal(previous,0);
  spectrum.update(new Float32Array(2048).fill(4));assert.ok(spectrum.time.every(value=>value===255));
  assert.throws(()=>new Spectrum(1000,48000));assert.throws(()=>new Spectrum(512.5,48000));
});

test('native video export rejects unsupported dimensions, non-audio payloads and external engines', () => {
  const payload = {audio:new Uint8Array([1]),width:1280,height:720,fps:30,
    preset:{type:'mineradio-track-preset',schema:1,snapshot:{preset:0},resources:{}}};
  assert.deepEqual(validate(payload),{width:1280,height:720,fps:30});
  for (const change of [{width:1281},{height:0},{fps:120},{audio:'C:/private-file.mp3'},
      {preset:{type:'other',snapshot:{preset:0}}}, {preset:{type:'mineradio-track-preset',snapshot:{preset:0},resources:{externalProject:{active:true}}}}])
    assert.throws(()=>validate({...payload,...change}));
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../app/src/main/assets/android-bridge.js'), 'utf8');
function media() {
  const events = new Map();
  return {
    paused: true, ended: false, duration: 180, currentTime: 0, events,
    addEventListener(name, listener) { events.set(name, listener); },
    removeEventListener(name, listener) { if (events.get(name) === listener) events.delete(name); },
  };
}
function fixture() {
  const messages = [], images = [], timers = [];
  class Document {}
  class Anchor { click() {} }
  const document = new Document();
  document.dispatchEvent = () => {};
  document.createElement = () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/jpeg;base64,' + 'a'.repeat(32768) });
  const context = {
    Document, HTMLAnchorElement: Anchor, document, Map, Event: class {},
    URL: { createObjectURL() {}, revokeObjectURL() {} },
    Image: class { constructor() { this.width = 512; this.height = 512; images.push(this); } },
    MineradioAndroid: { isForeground: () => true, playback: (json) => messages.push(JSON.parse(json)) },
    setInterval: (fn) => timers.push(fn), addEventListener() {},
    audio: media(), currentIdx: 0, playQueue: [{ title: 'Song', artist: 'Artist', cover: '' }],
  };
  context.window = context;
  vm.runInNewContext(source, context);
  return { context, messages, images, tick: () => timers[0]() };
}

test('idle heartbeats skip native calls, playback changes still arrive', () => {
  const f = fixture();
  f.tick();
  for (let i = 0; i < 60; i++) f.tick();
  assert.equal(f.messages.length, 1);
  f.context.audio.paused = false;
  f.context.audio.currentTime = 1;
  f.tick();
  assert.equal(f.messages.length, 2);
  assert.equal(f.messages[1].playing, true);
  assert.equal(f.messages[1].position, 1);
});

test('cover is sent once and forced service recovery receives a full snapshot', () => {
  const f = fixture();
  f.context.playQueue[0].cover = 'blob:cover';
  f.tick(); f.images[0].onload();
  assert.match(f.messages.at(-1).artwork, /^data:image/);
  f.context.audio.paused = false;
  const start = f.messages.length;
  for (let i = 1; i <= 60; i++) { f.context.audio.currentTime = i; f.tick(); }
  const heartbeats = f.messages.slice(start);
  assert.equal(heartbeats.length, 60);
  assert.ok(heartbeats.every((message) => !Object.hasOwn(message, 'artwork')));
  assert.ok(heartbeats.every((message) => message.artworkKey === 'blob:cover'));
  const bytes = Buffer.byteLength(JSON.stringify(heartbeats));
  const repeatedCoverBytes = 60 * 32768;
  assert.ok(bytes < repeatedCoverBytes / 100, `${bytes} bytes of state vs ${repeatedCoverBytes} cover bytes`);
  f.context.mineradioAndroidReport(true);
  assert.match(f.messages.at(-1).artwork, /^data:image/);
});

test('replacing audio detaches old event listeners', () => {
  const f = fixture(); f.tick();
  const old = f.context.audio;
  assert.equal(old.events.size, 6);
  f.context.audio = media(); f.tick();
  assert.equal(old.events.size, 0);
  assert.equal(f.context.audio.events.size, 6);
  f.tick();
  assert.equal(f.context.audio.events.size, 6);
});

test('late cover loads cannot replace the current cover and removal clears it', () => {
  const f = fixture();
  f.context.playQueue[0].cover = 'blob:old'; f.tick();
  f.context.playQueue[0].cover = 'blob:new'; f.tick();
  const count = f.messages.length;
  f.images[0].onload();
  assert.equal(f.messages.length, count);
  f.images[1].onload();
  assert.match(f.messages.at(-1).artwork, /^data:image/);
  f.context.playQueue[0].cover = ''; f.tick();
  assert.equal(f.messages.at(-1).artworkKey, '');
  assert.equal(f.messages.at(-1).artwork, '');
});

test('failed native submission retries on the next heartbeat', () => {
  const f = fixture(), send = f.context.MineradioAndroid.playback;
  f.context.MineradioAndroid.playback = () => { throw new Error('temporarily unavailable'); };
  f.tick();
  assert.equal(f.messages.length, 0);
  f.context.MineradioAndroid.playback = send;
  f.tick();
  assert.equal(f.messages.length, 1);
});

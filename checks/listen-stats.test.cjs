const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../web/player/js/components/05-playback/02-listen-stats/functions/00-empty-listen-rollup-v2.js'), 'utf8');
function fixture(listenMs, completed) {
  const stored = new Map(); let networkCalls = 0;
  const context = {
    audio: { paused: true, duration: 180 }, emptyHomeActive: false,
    HOME_LISTEN_STATS_KEY: 'stats', HOME_LISTEN_ROLLUP_V2_KEY: 'rollup',
    localStorage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) },
    fetch: () => { networkCalls++; return Promise.resolve({ ok: false }); },
    listenStatsState: { songs: {}, artists: {}, history: [] },
    listenSession: { key: 'local:test', sessionId: 'session', song: { key: 'local:test', name: 'Test', artist: 'A / B' }, listenMs, maxProgress: 0, startedAt: Date.now(), recentStarted: true },
  };
  vm.runInNewContext(source, context);
  context.finalizeListenSession(completed);
  return { context, stored, networkCalls };
}
test('completed listening persists recent history, song/artist totals and daily rollup locally', () => {
  const f = fixture(60000, true), stats = JSON.parse(f.stored.get('stats')), rollup = JSON.parse(f.stored.get('rollup'));
  assert.equal(f.context.listenSession, null);
  assert.equal(stats.history[0].statsCounted, true);
  assert.equal(stats.songs['local:test'].plays, 1);
  assert.equal(stats.songs['local:test'].completed, 1);
  assert.equal(stats.artists.A.listenMs, 60000);
  assert.equal(stats.artists.B.listenMs, 60000);
  assert.equal(rollup.sessions, 1);
  assert.equal(rollup.totalListenMs, 60000);
  assert.equal(f.networkCalls, 0);
});
test('short listening retains recent history without inflating counted totals', () => {
  const f = fixture(1000, false), stats = JSON.parse(f.stored.get('stats'));
  assert.equal(stats.history.length, 1);
  assert.equal(stats.history[0].statsCounted, false);
  assert.deepEqual(stats.songs, {});
  assert.equal(f.stored.has('rollup'), false);
  assert.equal(f.networkCalls, 0);
});

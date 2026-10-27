const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const html = execFileSync('python', ['-X', 'utf8', '-c',
  'from music_app.web.embedded import BOOTSTRAP_HTML; print(BOOTSTRAP_HTML.decode())'], { cwd: root, encoding: 'utf8' });
const cleanup = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const standalone = fs.readFileSync(path.join(root, 'web/player/js/features/shell/standalone.js'), 'utf8');

function fixture(platform = 'windows', next = '') {
  const caches = new Map([['mineradio-shell-legacy', 'old UI'], ['mineradio-offline-v1', 'older UI'],
    ['music-downloads', 'music'], ['other-cache', 'keep']]);
  const unregistered = [];
  const registration = (scope, script) => ({ scope, active: { scriptURL: script },
    async unregister() { unregistered.push(script); return true; } });
  const location = new URL('http://127.0.0.1:18180/__embedded_bootstrap' +
    (next ? '?next=' + encodeURIComponent(next) : ''));
  let destination;
  location.replace = value => { destination = value; };
  const status = { textContent: '' };
  const context = { URL, location, document: { getElementById: () => status },
    navigator: { serviceWorker: { getRegistrations: async () => [
      registration(location.origin + '/', location.origin + '/service-worker.js'),
      registration(location.origin + '/other/', location.origin + '/other/worker.js'),
      registration(location.origin + '/', location.origin + '/unrelated.js'),
    ] } },
    caches: { keys: async () => [...caches.keys()], delete: async key => caches.delete(key) },
    localStorage: { clear() { throw new Error('Must not clear user data'); } },
    indexedDB: { deleteDatabase() { throw new Error('Must not clear user databases'); } },
  };
  if (platform === 'windows') context.desktopWindow = { isDesktop: true };
  if (platform === 'android') context.MineradioAndroid = {};
  context.window = context;
  vm.runInNewContext(cleanup, context);
  return { context, caches, unregistered, status, destination: () => destination };
}

for (const platform of ['windows', 'android']) {
  test(`${platform}: removes only legacy UI registration and named caches`, async () => {
    const f = fixture(platform, '/?android_layout=phone&width=420');
    const result = await f.context.mineradioEmbeddedCleanup;
    assert.equal(result.removedRegistrations, 1);
    assert.equal(result.removedCaches, 2);
    assert.deepEqual([...f.caches.keys()], ['music-downloads', 'other-cache']);
    assert.deepEqual(f.unregistered, ['http://127.0.0.1:18180/service-worker.js']);
    assert.equal(f.destination(), 'http://127.0.0.1:18180/?android_layout=phone&width=420');
  });
  test(`${platform}: shared shell never registers offline UI or adds offline banner`, () => {
    const context = { URLSearchParams, location: { search: '' }, screen: { width: 1000, height: 700 },
      document: { documentElement: { classList: { add() {}, toggle() {} } } },
      matchMedia: () => ({ matches: true }),
      navigator: { get serviceWorker() { throw new Error('Must not start offline shell'); } },
    };
    if (platform === 'windows') context.desktopWindow = { isDesktop: true };
    else context.MineradioAndroid = {};
    context.window = context;
    vm.runInNewContext(standalone, context);
    assert.equal(context.mineradioOfflineStatus, undefined);
  });
}

test('cleanup refuses non-native callers', async () => {
  const f = fixture('browser');
  await assert.rejects(f.context.mineradioEmbeddedCleanup, /Native app entry required/);
  assert.equal(f.caches.size, 4);
  assert.equal(f.unregistered.length, 0);
});
test('bootstrap cannot redirect away from the local player', async () => {
  const f = fixture('android', '//example.com/');
  await f.context.mineradioEmbeddedCleanup;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.destination(), undefined);
  assert.ok(f.status.textContent);
});

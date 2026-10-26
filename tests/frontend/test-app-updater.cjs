'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createAppUpdater } = require('../../Windows_exe/desktop/app-updater');

(async () => {
  const updater = new EventEmitter();
  let checks = 0, downloads = 0, quits = 0, releaseDownload;
  updater.setFeedURL = value => assert.deepEqual(value, { provider: 'github', owner: 'sunzhaocn', repo: 'Mineradio' });
  updater.checkForUpdates = async () => { checks++; updater.emit('checking-for-update');
    await Promise.resolve(); updater.emit('update-available', { version: '2.3.12' }); };
  updater.downloadUpdate = async () => { downloads++; await new Promise(resolve => { releaseDownload = resolve; }); };
  const handlers = {}, timers = [], states = [];
  const api = createAppUpdater({ updater, app: { getVersion: () => '2.3.11', quit: () => quits++ },
    ipcMain: { handle: (name, fn) => handlers[name] = fn }, trusted: e => e === 'trusted',
    broadcast: s => states.push(s), schedule: fn => timers.push(fn) });
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal((await handlers['mineradio-update-download']('untrusted')).error, 'UNTRUSTED_SENDER');
  assert.equal(checks + downloads, 0);
  await Promise.all([api.check(), api.check()]);
  assert.equal(checks, 1);
  assert.equal(api.snapshot().version, '2.3.12');
  const first = api.download(), second = api.download();
  await api.check();
  assert.equal(checks, 1); assert.equal(downloads, 1);
  updater.emit('download-progress', { percent: 51.2, transferred: 512, total: 1000 });
  assert.equal(api.snapshot().progress, 51.2); assert.equal(quits, 0);
  updater.emit('error', new Error('SHA-512 checksum mismatch'));
  releaseDownload(); await Promise.all([first, second]);
  assert.equal(quits, 0); assert.equal(timers.length, 0);
  assert.equal(updater.autoInstallOnAppQuit, false);
  const retry = api.download();
  assert.equal(downloads, 2);
  updater.emit('update-downloaded'); updater.emit('update-downloaded');
  assert.equal(api.snapshot().progress, 100);
  assert.equal(updater.autoInstallOnAppQuit, true);
  assert.equal(updater.autoRunAppAfterInstall, false);
  assert.equal(quits, 0); assert.equal(timers.length, 1);
  releaseDownload(); await retry;
  await api.download(); assert.equal(downloads, 2);
  timers[0](); assert.equal(quits, 1);
  assert.equal(states.at(-1).status, 'installing');
  console.log('PASS: trusted IPC, fixed public feed, single-flight check/download, progress, checksum failure stays open, retry, one verified install on clean quit');
})().catch(error => { console.error(error); process.exitCode = 1; });

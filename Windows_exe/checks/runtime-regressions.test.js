'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { test } = require('node:test');
const { createAppUpdater } = require('../desktop/app-updater');

function updaterHarness() {
  const updater = new EventEmitter();
  updater.setFeedURL = () => {};
  const handlers = new Map();
  const scheduled = [];
  let quits = 0;
  const controller = createAppUpdater({
    updater,
    app: { getVersion: () => '2.3.11', quit: () => { quits += 1; } },
    ipcMain: { handle: (name, action) => handlers.set(name, action) },
    trusted: event => event.trusted === true,
    broadcast: () => {},
    schedule: action => scheduled.push(action),
  });
  return { updater, controller, handlers, scheduled, quits: () => quits };
}

test('checking for updates can retry after a synchronous updater failure', async () => {
  const { updater, controller } = updaterHarness();
  let calls = 0;
  updater.checkForUpdates = () => {
    calls += 1;
    if (calls === 1) throw new Error('feed temporarily unavailable');
    updater.emit('update-not-available');
    return Promise.resolve();
  };
  assert.equal((await controller.check()).status, 'error');
  assert.equal((await controller.check()).status, 'current');
  assert.equal(calls, 2);
});

test('update download can retry after a synchronous updater failure', async () => {
  const { updater, controller } = updaterHarness();
  updater.emit('update-available', { version: '2.3.12' });
  let calls = 0;
  updater.downloadUpdate = () => {
    calls += 1;
    if (calls === 1) throw new Error('temporary download failure');
    updater.emit('update-downloaded');
    return Promise.resolve();
  };
  assert.equal((await controller.download()).status, 'error');
  assert.equal((await controller.download()).status, 'installing');
  assert.equal(calls, 2);
});

test('concurrent update checks share one request and permit another after completion', async () => {
  const { updater, controller } = updaterHarness();
  let complete;
  let calls = 0;
  updater.checkForUpdates = () => {
    calls += 1;
    return new Promise(resolve => { complete = resolve; });
  };
  const first = controller.check();
  const second = controller.check();
  await Promise.resolve();
  assert.equal(calls, 1);
  complete();
  await Promise.all([first, second]);
  const third = controller.check();
  await Promise.resolve();
  assert.equal(calls, 2);
  complete();
  await third;
});

test('untrusted update IPC cannot start a download or schedule installation', async () => {
  const { updater, handlers, scheduled } = updaterHarness();
  updater.downloadUpdate = () => { throw new Error('should not be called'); };
  updater.emit('update-available', { version: '2.3.12' });
  assert.deepEqual(await handlers.get('mineradio-update-download')({ trusted: false }),
    { ok: false, error: 'UNTRUSTED_SENDER' });
  assert.equal(scheduled.length, 0);
});

test('verified download schedules installation only once', () => {
  const { updater, scheduled, quits } = updaterHarness();
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  updater.emit('update-downloaded');
  updater.emit('update-downloaded');
  assert.equal(updater.autoInstallOnAppQuit, true);
  assert.equal(scheduled.length, 1);
  scheduled[0]();
  assert.equal(quits(), 1);
});

function backendHarness({ spawnError = null } = {}) {
  const child = Object.assign(new EventEmitter(), {
    pid: spawnError ? undefined : 12345,
    exitCode: null, signalCode: null,
    stdout: new PassThrough(), stderr: new PassThrough(),
  });
  const log = new PassThrough();
  const errors = [];
  const chunks = [];
  const kills = [];
  log.on('error', error => errors.push(error));
  log.on('data', chunk => chunks.push(chunk));
  const closeChild = () => {
    child.stdout.end();
    child.stderr.end();
    child.emit('close', child.exitCode, child.signalCode);
  };
  const mocks = {
    'node:fs': {
      existsSync: () => true,
      readFileSync: () => JSON.stringify({ web: 18180, api: 18100 }),
      mkdirSync: () => {},
      statSync: () => ({ size: 0 }),
      createWriteStream: () => log,
    },
    'node:net': {
      createServer: () => {
        const server = new EventEmitter();
        server.listen = (_port, _host, callback) => queueMicrotask(callback);
        server.close = callback => callback();
        return server;
      },
    },
    'node:http': {
      get: (_options, callback) => {
        const request = new EventEmitter();
        request.destroy = () => {};
        queueMicrotask(() => spawnError ? request.emit('error', spawnError)
          : callback({ statusCode: 200, resume: () => {} }));
        return request;
      },
    },
    'node:child_process': {
      spawn: () => {
        if (spawnError) queueMicrotask(() => {
          child.emit('error', spawnError);
          closeChild();
        });
        return child;
      },
      execFile: (_exe, args, _options, callback) => {
        kills.push(args);
        closeChild();
        callback();
      },
    },
  };
  const filename = path.join(__dirname, '../desktop/backend-service.js');
  const context = {
    module: { exports: {} }, __dirname: path.dirname(filename),
    require: name => mocks[name] || require(name),
    process: { platform: 'win32', pid: 111, env: {} },
    setTimeout: (callback, delay) => setTimeout(callback, Math.min(delay, 10)),
    clearTimeout,
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  return { child, log, errors, chunks, kills, closeChild,
    start: () => context.module.exports.startBackend({ isPackaged: false }, 'user-data') };
}

test('backend exit preserves output arriving before its stdio pipes close', async () => {
  const harness = backendHarness();
  const service = await harness.start();
  harness.child.exitCode = 0;
  harness.child.emit('exit', 0, null);
  assert.equal(service.listening, false);
  assert.equal(harness.log.writableEnded, false);
  harness.child.stdout.write('final stdout\n');
  harness.child.stderr.write('final stderr\n');
  harness.closeChild();
  await service.close();
  await new Promise(setImmediate);
  assert.equal(harness.log.writableEnded, true);
  assert.equal(harness.errors.length, 0);
  assert.equal(Buffer.concat(harness.chunks).toString(), 'final stdout\nfinal stderr\n');
});

test('backend failed spawn closes its log and returns the original failure', async () => {
  const failure = new Error('spawn EACCES');
  const harness = backendHarness({ spawnError: failure });
  await assert.rejects(harness.start(), error => error === failure);
  assert.equal(harness.log.writableEnded, true);
  assert.equal(harness.errors.length, 0);
  assert.match(Buffer.concat(harness.chunks).toString(), /spawn EACCES/);
  assert.equal(harness.kills.length, 0);
});

test('cleanup does not kill the PID of a backend that already exited by signal', async () => {
  const harness = backendHarness();
  const service = await harness.start();
  harness.child.signalCode = 'SIGTERM';
  harness.child.emit('exit', null, 'SIGTERM');
  const closing = service.close();
  assert.equal(harness.kills.length, 0);
  harness.closeChild();
  await closing;
});

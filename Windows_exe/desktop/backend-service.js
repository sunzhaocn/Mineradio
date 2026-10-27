'use strict';

const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { spawn, execFile } = require('node:child_process');

function probePort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(port)));
  });
}

async function firstAvailable(start, excluded) {
  for (let port = start; port < start + 100; port++) {
    if (port === excluded) continue;
    try { return await probePort(port); }
    catch (error) { if (!['EADDRINUSE', 'EACCES'].includes(error.code)) throw error; }
  }
  throw new Error('没有可用的本机端口，请关闭冲突程序后重试。');
}

async function persistentPorts(userData) {
  const file = path.join(userData, 'backend-ports.json');
  if (fs.existsSync(file)) {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Number.isInteger(saved.web) || !Number.isInteger(saved.api) ||
        saved.web < 1024 || saved.api < 1024 || saved.web > 65535 || saved.api > 65535 || saved.web === saved.api) {
      throw new Error('本机端口配置损坏，请检查 backend-ports.json。');
    }
    try { await probePort(saved.web); await probePort(saved.api); }
    catch (_) { throw new Error(`Mineradio 的固定端口 ${saved.web}/${saved.api} 正被其他程序占用。请关闭冲突程序后重试；账号和收藏仍保存在原地址。`); }
    return saved;
  }
  const web = await firstAvailable(18180);
  const api = await firstAvailable(18100, web);
  const saved = { web, api };
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(saved, null, 2), { encoding: 'utf8', flag: 'wx' });
  return saved;
}

function httpReady(port, child, deadline) {
  return new Promise((resolve, reject) => {
    const probe = () => {
      if (child.startupError) return reject(child.startupError);
      if (child.exitCode !== null || child.signalCode) return reject(new Error('音乐后端提前退出，请查看 backend.log。'));
      if (Date.now() > deadline) return reject(new Error('音乐后端启动超时，请查看 backend.log。'));
      const request = http.get({ host: '127.0.0.1', port, path: '/', timeout: 1500 }, (response) => {
        response.resume();
        if (response.statusCode === 200) resolve();
        else setTimeout(probe, 150);
      });
      request.once('timeout', () => request.destroy());
      request.once('error', () => setTimeout(probe, 150));
    };
    probe();
  });
}

async function startBackend(app, userData, onUnexpectedExit) {
  const packaged = app.isPackaged;
  const project = path.resolve(__dirname, '..');
  const executable = process.env.MINERADIO_BACKEND_PATH || (packaged
    ? path.join(process.resourcesPath, 'backend', 'MineradioBackend.exe')
    : path.join(project, 'build', 'backend', 'MineradioBackend', 'MineradioBackend.exe'));
  const tools = packaged ? path.join(process.resourcesPath, 'tools') : path.join(project, 'build', 'tools');
  const sdk = packaged ? path.join(process.resourcesPath, 'qishui-sdk') : path.join(project, 'sdk');
  if (!fs.existsSync(executable)) throw new Error('找不到内置音乐后端，请完整解压软件后运行 Mineradio.exe。');
  const ports = await persistentPorts(userData);
  const data = path.join(userData, 'data');
  fs.mkdirSync(data, { recursive: true });
  const logFile = path.join(userData, 'backend.log');
  try { if (fs.existsSync(logFile) && fs.statSync(logFile).size > 1024 * 1024) fs.renameSync(logFile, logFile + '.previous'); } catch (_) {}
  const log = fs.createWriteStream(logFile, { flags: 'a' });
  const child = spawn(executable, ['--host', '127.0.0.1', '--api-port', String(ports.api), '--web-port', String(ports.web)], {
    cwd: path.dirname(executable),
      env: { ...process.env, MINERADIO_DATA_ROOT: data, MINERADIO_PARENT_PID: String(process.pid), MINERADIO_CLIENT_ASSET_INIT: '1',
      MINERADIO_NODE_PATH: path.join(tools, 'node.exe'), MINERADIO_FFMPEG_PATH: path.join(tools, 'ffmpeg.exe'),
      QISHUI_SDK_DIR: sdk, MINERADIO_BUNDLED_SDK_DIR: sdk,
      PATH: tools + path.delimiter + (process.env.PATH || ''), PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let expectedExit = false;
  let closePromise = null;
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  const closed = new Promise((resolve) => {
    child.once('exit', (code, signal) => {
      service.listening = false;
      if (!expectedExit && service.listeningStarted && typeof onUnexpectedExit === 'function') onUnexpectedExit(code, signal);
    });
    child.once('error', (error) => { child.startupError = error; log.write(String(error.message) + '\n'); });
    // 'exit' can precede the final stdout/stderr data. 'close' also runs after
    // a failed spawn, so finish the shared log only once both pipes are done.
    child.once('close', () => log.end(resolve));
  });
  const service = {
    child, pid: child.pid, ports, listening: false, listeningStarted: false,
    close() {
      if (closePromise) return closePromise;
      expectedExit = true;
      service.listening = false;
      closePromise = (async () => {
        if (child.exitCode === null && !child.signalCode && child.pid) {
          if (process.platform === 'win32') {
            await new Promise((resolve) => execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 8000 }, () => resolve()));
          } else { child.kill('SIGTERM'); }
        }
        let timeout;
        try {
          await Promise.race([closed, new Promise((resolve) => { timeout = setTimeout(resolve, 1500); })]);
        } finally { clearTimeout(timeout); }
      })();
      return closePromise;
    },
  };
  try {
    await httpReady(ports.web, child, Date.now() + 45000);
    service.listening = true;
    service.listeningStarted = true;
    return service;
  } catch (error) { await service.close(); throw error; }
}

module.exports = { startBackend, persistentPorts, probePort };

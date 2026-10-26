'use strict';
const { _electron } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'verification');
const executable = path.resolve(process.argv[2] || path.join(root, 'dist-installed/win-unpacked/Mineradio.exe'));
const qaName = `Mineradio-Installed-QA-${process.pid}`;
const profile = path.join(output, qaName);
const report = { ok: false, startupToggle: {}, layout: [], backgroundPlayback: {} };
const env = { ...process.env, MINERADIO_STARTUP_QA_HIDDEN: '1', MINERADIO_STARTUP_QA_USER_DATA: profile,
  MINERADIO_RUNTIME_NAME: qaName, MINERADIO_NO_DESKTOP_SHORTCUT: '1' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.MINERADIO_STARTUP_QA_EXIT_MS;
fs.mkdirSync(output, { recursive: true });
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(path.join(profile, 'backend-ports.json'), JSON.stringify({ web:19280, api:19200 }));
let application;
async function launch(args = []) {
  const started = Date.now();
  application = await _electron.launch({ executablePath: executable, args, env, timeout: 90000 });
  const page = await application.firstWindow();
  await page.waitForFunction(() => window.MINERADIO_MODULE_STATUS?.ready, { timeout: 60000 });
  return { page, readyMs: Date.now() - started };
}
(async () => {
  try {
    let { page, readyMs } = await launch();
    report.readyMs = readyMs;
    const preferences = await page.evaluate(() => window.desktopWindow.getDesktopPreferences());
    assert.equal(preferences.trayAvailable, true);
    assert.equal(preferences.closeBehavior, 'tray');
    assert.equal(preferences.enabled, false);
    const on = await page.evaluate(() => window.desktopWindow.setStartAtLogin(true));
    assert.equal(on.ok, true, on.message);
    assert.equal(on.enabled, true);
    const registryEntry = execFileSync('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', qaName],
      { windowsHide: true });
    assert.ok(registryEntry.includes(Buffer.from('--start-in-tray')), 'Windows startup command must include the background-start flag');
    const off = await page.evaluate(() => window.desktopWindow.setStartAtLogin(false));
    assert.equal(off.ok, true, off.message);
    assert.equal(off.enabled, false);
    report.startupToggle = { enabled: on.enabled, disabled: off.enabled === false, restoredToOff: true };
    if (await page.locator('#splash').isVisible()) {
      await page.waitForFunction(() => typeof splashReadyToEnter !== 'undefined' && splashReadyToEnter);
      await page.locator('#splash').click();
      await page.locator('#splash').waitFor({ state: 'hidden' });
    }
    const audioFile = path.join(output, 'installed-audio.wav');
    execFileSync(path.join(root, 'build/tools/ffmpeg.exe'), ['-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=60', '-ar', '44100', audioFile], { windowsHide: true });
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().forEach(window => window.webContents.setAudioMuted(true));
    });
    await page.evaluate(() => { if (audio) { audio.muted = true; audio.volume = 0; } });
    await page.locator('#file-input').setInputFiles(audioFile);
    await page.waitForFunction(() => audio && !audio.paused && audio.currentTime > 0.3, { timeout: 20000 });
    const skipAnalysis = page.getByRole('button', { name: '暂不分析', exact: true });
    try { await skipAnalysis.waitFor({ state: 'visible', timeout: 2500 }); await skipAnalysis.click(); } catch (_) {}
    await page.evaluate(() => { audio.muted = true; audio.volume = 0; });
    await page.evaluate(() => {
      document.body.classList.add('controls-visible');
      const bar = document.getElementById('bottom-bar'); bar.classList.add('visible'); bar.classList.remove('soft-hidden');
      playMode = 'loop'; updatePlayModeButton(false); syncActiveAudioRepeatMode(audio);
    });
    assert.equal(await page.locator('#controls [onclick="cyclePlayMode()"]').count(), 1);
    assert.equal(await page.locator('#controls #cuefield-automix-btn').count(), 0);
    report.playModes = [];
    for (const expected of ['shuffle', 'single', 'loop']) {
      await page.locator('#play-mode-btn').click();
      const mode = await page.evaluate(() => ({ mode: playMode, repeatAudio: audio.loop,
        label: document.getElementById('play-mode-btn').getAttribute('aria-label') }));
      assert.equal(mode.mode, expected);
      assert.equal(mode.repeatAudio, expected === 'single');
      report.playModes.push(mode);
    }
    for (const width of [960, 1100, 1280, 1440]) {
      await application.evaluate(({ BrowserWindow }, width) => {
        const win = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('http://127.0.0.1:'));
        win.setSize(width, 900);
      }, width);
      await page.waitForTimeout(550);
      await page.evaluate(() => {
        document.body.classList.add('controls-visible');
        const bar = document.getElementById('bottom-bar'); bar.classList.add('visible'); bar.classList.remove('soft-hidden');
      });
      const layout = await page.evaluate(() => {
        const buttons = [...document.querySelectorAll('#controls .ctrl-btn')].filter(button => button.id !== 'quality-btn').map(button => {
          const box = button.getBoundingClientRect();
          return { id: button.id || button.className, x: box.x, y: box.y, w: box.width, h: box.height };
        }).filter(box => box.w > 0 && box.h > 0);
        const overlaps = [];
        for (let i = 0; i < buttons.length; i++) for (let j = i + 1; j < buttons.length; j++) {
          const a = buttons[i], b = buttons[j];
          if (Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1 &&
              Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1) overlaps.push([a.id, b.id]);
        }
        const centers = buttons.map(box => box.y + box.h / 2);
        return { viewport: innerWidth, buttons: buttons.length, overlaps,
          singleRow: Math.max(...centers) - Math.min(...centers) < 5 };
      });
      report.layout.push(layout);
      assert.equal(layout.overlaps.length, 0, JSON.stringify(layout));
      assert.equal(layout.singleRow, true, JSON.stringify(layout));
      await page.locator('#bottom-bar').screenshot({ path: path.join(output, `player-controls-${width}.png`) });
    }
    const before = await page.evaluate(() => audio.currentTime);
    await page.evaluate(() => window.desktopWindow.close());
    await page.waitForFunction(async () => (await window.desktopWindow.getState()).isVisible === false);
    await page.waitForTimeout(4000);
    report.backgroundPlayback = await page.evaluate(() => ({ time: audio.currentTime, paused: audio.paused }));
    report.backgroundPlayback.advanced = report.backgroundPlayback.time - before;
    assert.equal(report.backgroundPlayback.paused, false);
    assert.ok(report.backgroundPlayback.advanced > 2);
    report.hiddenWindowAlive = (await page.evaluate(() => window.desktopWindow.getState())).isVisible === false;
    assert.equal(report.hiddenWindowAlive, true);
    await page.evaluate(() => window.desktopWindow.restore());
    assert.equal((await page.evaluate(() => window.desktopWindow.getState())).isVisible, true);
    await application.close(); application = null;
    ({ page, readyMs } = await launch(['--start-in-tray']));
    await page.waitForTimeout(1000);
    report.bootToTray = await page.evaluate(async () => ({ preferences: await window.desktopWindow.getDesktopPreferences(),
      visible: (await window.desktopWindow.getState()).isVisible }));
    assert.equal(report.bootToTray.visible, false);
    assert.equal(report.bootToTray.preferences.trayAvailable, true);
    assert.equal(report.bootToTray.preferences.startInTray, true);
    await page.evaluate(() => window.desktopWindow.restore());
    assert.equal((await page.evaluate(() => window.desktopWindow.getState())).isVisible, true);
    report.ok = true;
  } catch (error) { report.failure = error.message; process.exitCode = 1; }
  finally {
    if (application) {
      await application.evaluate(({ app }) => app.setLoginItemSettings({ name: app.getName(), path: process.execPath,
        args: ['--start-in-tray'], openAtLogin: false, enabled: false })).catch(() => {});
      await application.close().catch(() => {});
    }
    const cleanup = `$testEntryName = '${qaName}'; foreach ($testRegistryPath in @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run')) { Remove-ItemProperty -LiteralPath $testRegistryPath -Name $testEntryName -ErrorAction SilentlyContinue }`;
    try { execFileSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-Command', cleanup], { windowsHide: true, stdio: 'ignore' }); } catch (_) {}
    fs.writeFileSync(path.join(output, 'installed-app-acceptance.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  }
})();

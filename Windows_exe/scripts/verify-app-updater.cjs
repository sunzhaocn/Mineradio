'use strict';
const { _electron } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'verification', 'app-updater');
fs.mkdirSync(out, { recursive: true });
const profile = path.join(out, `profile-${process.pid}`);
fs.mkdirSync(profile, { recursive: true });
const report = { checks: {}, errors: [] };
const install = process.argv.includes('--install');
(async () => {
  const env = { ...process.env, MINERADIO_STARTUP_QA_HIDDEN: '1', MINERADIO_STARTUP_QA_USER_DATA: profile,
    MINERADIO_NO_DESKTOP_SHORTCUT: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const application = await _electron.launch({ executablePath: process.env.MINERADIO_VERIFY_EXECUTABLE || path.join(root, 'dist/win-unpacked/Mineradio.exe'), env, timeout: 60000 });
  try {
    const page = await application.firstWindow({ timeout: 60000 });
    page.on('pageerror', error => report.errors.push(error.message));
    await page.waitForFunction(() => window.MINERADIO_MODULE_STATUS?.ready && window.mineradioNativeUpdater, { timeout: 60000 });
    report.checks.modules = await page.evaluate(() => MINERADIO_MODULE_STATUS);
    if (await page.locator('#splash').isVisible()) {
      await page.waitForFunction(() => typeof splashReadyToEnter !== 'undefined' && splashReadyToEnter, { timeout: 20000 });
      await page.locator('#splash').click();
      await page.locator('#splash').waitFor({ state: 'hidden', timeout: 20000 });
    }
    // The entry has a continuous breathing transform; its center remains hit-testable.
    const entry = await page.locator('#update-entry').boundingBox();
    assert(entry && entry.width > 0);
    await page.mouse.click(entry.x + entry.width / 2, entry.y + entry.height / 2);
    await page.waitForFunction(() => document.querySelector('#update-modal').classList.contains('active') || getComputedStyle(document.querySelector('#update-modal')).visibility !== 'hidden');
    await page.waitForFunction(() => document.querySelector('#update-btn-label').textContent !== '正在检查…', { timeout: 60000 });
    report.checks.state = await page.evaluate(() => desktopWindow.getUpdateState());
    report.checks.button = await page.locator('#update-btn-label').textContent();
    report.checks.hero = await page.locator('#update-hero-main').textContent();
    await page.locator('#update-primary-btn').waitFor({ state: 'visible', timeout: 10000 });
    report.checks.visible = await page.locator('#update-primary-btn').isVisible();
    assert(report.checks.visible);
    assert.equal(report.checks.state.currentVersion, '2.3.11');
    assert(!report.errors.length, report.errors.join('\n'));
    await page.screenshot({ path: path.join(out, 'update-panel.png') });
    const exited = new Promise(resolve => application.process().once('exit', resolve));
    if (install) {
      // Exercise the real public release, download, checksum and NSIS installer
      // while simulating only the comparison version of the client.
      report.checks.comparisonVersionSimulated = '2.3.10';
      report.checks.transitions = [];
      await page.exposeFunction('recordUpdateState', state => report.checks.transitions.push(state));
      await page.evaluate(() => desktopWindow.onUpdateState(state => window.recordUpdateState(state)));
      await application.evaluate(({ app }) => {
        const root = app.getAppPath();
        const load = process.getBuiltinModule('module').createRequire(root + '/package.json');
        const updater = load('electron-updater').autoUpdater;
        updater.currentVersion = new (load('semver').SemVer)('2.3.10');
      });
      await page.locator('#update-primary-btn').click();
      await page.waitForFunction(() => document.querySelector('#update-btn-label').textContent === '立即更新', { timeout: 60000 });
      assert.equal((await page.evaluate(() => desktopWindow.getUpdateState())).version, '2.3.11');
      await page.locator('#update-primary-btn').click();
      await page.waitForFunction(() => document.querySelector('#update-btn-label').textContent.startsWith('正在下载'), { timeout: 15000 });
      await page.screenshot({ path: path.join(out, 'downloading.png') });
      await Promise.race([exited, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Update did not exit within 5 minutes')), 300000); timer.unref(); })]);
      assert(report.checks.transitions.some(s => s.status === 'downloading' && s.progress > 0));
      assert(report.checks.transitions.some(s => s.status === 'installing' && s.progress === 100));
    } else {
      await application.evaluate(({ app }) => app.quit());
      await exited;
    }
    report.checks.cleanExit = true;
  } finally {
    try { await application.close(); } catch (_) {}
    fs.writeFileSync(path.join(out, install ? 'report-online-install.json' : 'report.json'), JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify(report));
})().catch(error => { console.error(error); process.exitCode = 1; });

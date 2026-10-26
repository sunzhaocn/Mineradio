'use strict';
const { _electron } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'verification');
const profile = path.join(output, `qishui-login-profile-${process.pid}`);
const smokeFile = path.join(output, `qishui-login-startup-${process.pid}.json`);
const env = { ...process.env, MINERADIO_STARTUP_QA_HIDDEN: '1',
  MINERADIO_STARTUP_QA_USER_DATA: profile, MINERADIO_NO_DESKTOP_SHORTCUT: '1',
  MINERADIO_SMOKE_REPORT: smokeFile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.MINERADIO_STARTUP_QA_EXIT_MS;
fs.mkdirSync(output, { recursive: true });
let app;
const report = { ok: false, authenticated: false, scanned: false };
(async () => {
  try {
    app = await _electron.launch({ executablePath: process.argv[2] || path.join(root, 'dist/win-unpacked/Mineradio.exe'),
      env, timeout: 90000 });
    const page = await app.firstWindow({ timeout: 60000 });
    await page.waitForFunction(() => window.MINERADIO_MODULE_STATUS?.ready, { timeout: 60000 });
    if (await page.locator('#splash').isVisible()) {
      await page.waitForFunction(() => typeof splashReadyToEnter !== 'undefined' && splashReadyToEnter);
      await page.locator('#splash').click();
      await page.locator('#splash').waitFor({ state: 'hidden' });
    }
    const responsePromise = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/local/auth/session' && response.request().method() === 'POST', { timeout: 90000 });
    await page.evaluate(() => showLoginModal({ provider: 'qishui' }));
    const response = await responsePromise;
    const data = await response.json();
    report.httpStatus = response.status();
    report.provider = data.provider;
    report.status = data.status;
    report.error = data.error;
    report.message = data.message;
    report.hasQrImage = typeof data.qr_image === 'string' && data.qr_image.startsWith('data:image/png;base64,');
    report.hasOfficialQrUrl = typeof data.qr_url === 'string' && new URL(data.qr_url).hostname === 'bff-pc.qishui.com';
    report.expiresIn = data.expires_in;
    if (response.ok() && report.hasQrImage && report.hasOfficialQrUrl) {
      await page.waitForFunction(() => [...document.querySelectorAll('.local-auth img')].some(img => img.src.startsWith('data:image/png;base64,') && img.naturalWidth > 100));
      report.qrVisible = true;
      report.ok = true;
    }
    await page.screenshot({ path: path.join(output, 'qishui-login.png') });
    await page.evaluate(() => closeLoginModal());
    if (!report.ok) process.exitCode = 1;
  } catch (error) { report.failure = error.message; process.exitCode = 1; }
  finally {
    if (app) await app.close();
    fs.writeFileSync(path.join(output, 'qishui-login-acceptance.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  }
})();

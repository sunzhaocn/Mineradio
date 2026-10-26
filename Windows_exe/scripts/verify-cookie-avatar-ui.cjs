'use strict';
const { _electron, chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const project = path.dirname(root);
const output = path.join(root, 'verification');
const executable = path.resolve(process.argv[2] || path.join(root, 'dist-avatar/win-unpacked/Mineradio.exe'));
const entries = {};
const labels = { '网易云音乐': 'netease', '网易云': 'netease', netease: 'netease',
  'QQ音乐': 'qq', qq: 'qq', qqmusic: 'qq', '酷狗音乐': 'kugou', '酷狗': 'kugou', kugou: 'kugou' };
let pending = '';
for (const raw of fs.readFileSync(path.join(project, 'config/cookies.txt'), 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;
  if (line.length <= 32 && !/[=;{]/.test(line)) pending = labels[line] || '';
  else if (pending) { entries[pending] ||= { cookie: line, source: 'manual', account: {} }; pending = ''; }
}
const qishui = JSON.parse(fs.readFileSync(path.join(project, 'config/qishui_session.json'), 'utf8').replace(/^\uFEFF/, ''));
if (qishui.headers?.cookie) entries.qishui = { cookie: qishui.headers.cookie, source: 'manual', account: {} };
fs.mkdirSync(output, { recursive: true });
const report = { ok: false, web: [], exe: [], credentialsSavedInReport: false };
let application, browser, service, currentPage, stage = 'starting';
async function ready(url) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1500) })).ok) return; } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Isolated source web server did not become ready');
}
async function verify(page, kind) {
  currentPage = page;
  stage = `${kind}:ready`;
  await page.waitForLoadState('load');
  await page.waitForFunction(() => window.MINERADIO_MODULE_STATUS?.ready, null, { timeout: 60000 });
  await page.evaluate(data => localStorage.setItem('mineradio-local-accounts-v1', JSON.stringify(data)), entries);
  await page.reload();
  await page.waitForFunction(() => window.MINERADIO_MODULE_STATUS?.ready, null, { timeout: 60000 });
  stage = `${kind}:profile`;
  await page.waitForFunction(() => ['netease', 'qq', 'kugou', 'qishui'].every(provider => {
    const entry = window.localMusicCredentials?.read(provider);
    return entry?.account?.name && entry?.account?.avatar && entry.profileFetchedAt;
  }), null, { timeout: 60000 });
  if (await page.locator('#splash').isVisible()) {
    await page.waitForFunction(() => typeof splashReadyToEnter !== 'undefined' && splashReadyToEnter);
    await page.locator('#splash').click();
    await page.locator('#splash').waitFor({ state: 'hidden' });
  }
  for (const provider of ['netease', 'qq', 'kugou', 'qishui']) {
    stage = `${kind}:${provider}:image`;
    await page.evaluate(provider => showLoginModal({ provider }), provider);
    await page.waitForFunction(() => {
      const image = document.querySelector('.local-auth-account > img');
      return image && image.complete && image.naturalWidth > 0 && !image.src.startsWith('data:image/svg');
    }, null, { timeout: 30000 });
    const state = await page.evaluate(provider => {
      const entry = window.localMusicCredentials.read(provider);
      const image = document.querySelector('.local-auth-account > img');
      return { provider, namePresent: !!entry.account.name, avatarPresent: !!entry.account.avatar,
        imageLoaded: image.complete && image.naturalWidth > 0, hasSavedCookie: !!entry.cookie };
    }, provider);
    report[kind].push(state);
  }
  await page.screenshot({ path: path.join(output, `cookie-avatar-${kind}.png`), mask: [page.locator('textarea')] });
  await page.evaluate(() => closeLoginModal());
}
(async () => {
  try {
    service = spawn('python', ['-B', '-X', 'utf8', 'main.py', '--api-port', '18700', '--web-port', '18780'], {
      cwd: project, windowsHide: true, stdio: 'ignore', env: { ...process.env, PYTHONIOENCODING: 'utf-8',
        QISHUI_SDK_DIR: path.join(root, 'sdk') } });
    await ready('http://127.0.0.1:18780/__health');
    browser = await chromium.launch({ executablePath: path.join(root, 'build/avatar-backend/MineradioBackend/_internal/browser/chrome-win64/chrome.exe'), headless: true });
    const web = await browser.newPage();
    await web.goto('http://127.0.0.1:18780/');
    await verify(web, 'web');
    await browser.close(); browser = null;
    const profile = path.join(output, `cookie-avatar-exe-profile-${process.pid}`);
    application = await _electron.launch({ executablePath: executable, timeout: 90000, env: { ...process.env,
      MINERADIO_STARTUP_QA_HIDDEN: '1', MINERADIO_STARTUP_QA_USER_DATA: profile,
      MINERADIO_NO_DESKTOP_SHORTCUT: '1' } });
    await verify(await application.firstWindow(), 'exe');
    report.ok = report.web.length === 4 && report.exe.length === 4;
  } catch (error) {
    report.failure = error.message;
    report.stage = stage;
    if (currentPage && !currentPage.isClosed()) {
      report.diagnostic = await currentPage.evaluate(() => {
        const image = document.querySelector('.local-auth-account > img');
        return { profiles: ['netease', 'qq', 'kugou', 'qishui'].map(provider => {
          const entry = window.localMusicCredentials?.read(provider);
          let host = ''; try { host = new URL(entry?.account?.avatar).hostname; } catch (_) {}
          return { provider, namePresent: !!entry?.account?.name, avatarPresent: !!entry?.account?.avatar,
            avatarHost: host, schema: entry?.profileSchema };
        }), image: image ? { complete: image.complete, naturalWidth: image.naturalWidth,
          fallback: image.src.startsWith('data:') } : null };
      }).catch(() => null);
      await currentPage.screenshot({ path: path.join(output, 'cookie-avatar-failure.png'),
        mask: [currentPage.locator('textarea')] }).catch(() => {});
    }
    process.exitCode = 1;
  }
  finally {
    if (browser) await browser.close().catch(() => {});
    if (application) await application.close().catch(() => {});
    if (service?.pid) {
      try { execFileSync('taskkill.exe', ['/PID', String(service.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch (_) {}
    }
    fs.writeFileSync(path.join(output, 'cookie-avatar-ui-acceptance.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  }
})();

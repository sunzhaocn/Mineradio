'use strict';
// Real DOM + intercepted, credential-free HTTP. No account or cloud writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const desktop = path.resolve(__dirname, '..'), root = path.dirname(desktop);
const { chromium, _electron } = require(path.join(desktop, 'node_modules/playwright'));
const executable = process.argv[2] && process.argv[2] !== '--source' ? path.resolve(process.argv[2]) : '';
const webPort = 19880, apiPort = 19800, origin = `http://127.0.0.1:${webPort}`;
const kind = executable ? 'packaged' : 'source';
const reportPath = path.join(desktop, 'verification', `metadata-loading-${kind}.json`);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-metadata-qa-'));
const report = { ok: false, mode: kind, finished: false, credentialsUsed: false, cloudWrites: 0,
  apiRequests: [], interceptedMutations: [], checks: [], pageErrors: [], nativeDialogs: [], externalRequestsBlocked: 0,
  boundaries: ['Synthetic platform replies and generated WAV, real production DOM/request helpers',
    'Timeouts use the real production 10000ms deadline', 'No platform availability, account privileges, SMS, scanning or cloud write validation'] };
let application, browser, child, page, scenario = 'startup';
const pending = new Set(), policies = new Map(), requestRecords = new Map(), names = new Map();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function save() { fs.writeFileSync(reportPath, JSON.stringify(report, null, 2)); }
async function until(test, timeout = 5000) {
  const end = Date.now() + timeout;
  while (!await test()) { if (Date.now() > end) return false; await pause(20); }
  return true;
}
function wave() {
  const n = 44100 * 3, data = Buffer.alloc(44 + n * 2);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(44100, 24); data.writeUInt32LE(88200, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin(i * Math.PI * 880 / 44100) * 100), 44 + i * 2);
  return data;
}
const wav = wave();
function song(name, album = true) {
  const hash = crypto.createHash('md5').update('metadata-qa-' + name).digest('hex').toUpperCase();
  names.set(hash, name);
  return { provider: 'kugou', id: hash, hash, name: '歌曲 ' + name, artist: 'QA歌手', album: '专辑 ' + name,
    albumAudioId: '9876543210', duration: 3, cover: '', ...(album ? { albumId: 'qa-album-' + hash } : {}) };
}
function requestKind(url) {
  if (/\/album\/detail$/.test(url.pathname)) return 'album';
  if (/\/song\/comments$/.test(url.pathname)) return 'comments';
  if (/\/song\/url$/.test(url.pathname)) return 'source';
  if (/\/lyric$/.test(url.pathname)) return 'lyric';
  if (url.pathname === '/api/audio') return 'audio';
  return 'other';
}
function requestKey(url) {
  let key = url.searchParams.get('hash') || url.searchParams.get('songId') || url.searchParams.get('id') || '';
  if (key.startsWith('qa-album-')) key = key.slice('qa-album-'.length);
  return names.get(key) || key;
}
function records(type, name) { return report.apiRequests.filter(row => row.kind === type && (!name || row.key === name)); }
function hold(type, name) { policies.set(type + '|' + name, 'hold'); }
function release(type, name) {
  policies.delete(type + '|' + name);
  for (const row of pending) if (row.record.kind === type && row.record.key === name) row.release();
}
async function routeRequest(route) {
  const request = route.request(), url = new URL(request.url());
  if (url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
  if (url.origin !== origin) { report.externalRequestsBlocked++; return route.abort(); }
  if (!url.pathname.startsWith('/api/')) return route.continue();
  if (!['GET', 'HEAD'].includes(request.method())) {
    report.interceptedMutations.push({ method: request.method(), pathname: url.pathname });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"saved":true,"success":true,"code":200}' });
  }
  const type = requestKind(url), key = requestKey(url);
  const row = { scenario, kind: type, key, at: Date.now(), pathname: url.pathname };
  if (type === 'album') { row.songId = !!url.searchParams.get('songId'); row.limit = url.searchParams.get('limit'); }
  if (type === 'comments') row.albumAudioId = url.searchParams.get('albumAudioId');
  report.apiRequests.push(row); requestRecords.set(request, row);
  if (policies.get(type + '|' + key) === 'hold') {
    await new Promise(resolve => {
      const item = { record: row, release() { pending.delete(item); resolve(); } };
      pending.add(item);
    });
  }
  if (row.aborted) return;
  let data;
  if (type === 'source') data = { provider: 'kugou', url: 'https://metadata.invalid/audio.wav', level: '128', nativeQuality: '128', trial: false };
  else if (type === 'album') {
    const native = song(key);
    data = { provider: 'kugou', album: { id: native.albumId, name: '已加载专辑 ' + key, artist: 'QA歌手', description: '隔离专辑介绍' },
      songs: [{ ...native, name: '专辑曲目 ' + key }], total: 1, nextOffset: 1, hasMore: false };
  } else if (type === 'comments') {
    const marker = '<c0m_cvt j="' + encodeURIComponent(JSON.stringify({ text: '[爱心]', emoji: { pid: 'synthetic-emoji' } })) + '"/>';
    data = { ok: true, provider: 'kugou', comments: [{ id: 'qa-comment-' + key, content: '评论正文 ' + key + '\n' + marker + '\n保留后文',
      user: { nickname: '隔离评论用户' }, liked: false, likedCount: 0, time: 1700000000000 }], total: 1, hasMore: false,
      nextCursor: '', sort: 'hot', capabilities: { read: true, write: false, like: false, sorts: ['hot', 'new'] } };
  } else if (type === 'lyric') data = { nolyric: true, lyric: '', yrc: '' };
  else if (type === 'audio') {
    row.respondedAt = Date.now();
    try { return await route.fulfill({ status: 200, contentType: 'audio/wav', body: wav }); } catch (_) { return; }
  } else data = { code: 200, ok: true, loggedIn: false, songs: [], tracks: [], playlists: [], dailySongs: [], items: [],
    accounts: {}, platforms: {}, providers: {}, data: [], total: 0 };
  row.respondedAt = Date.now();
  try { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) }); } catch (_) { row.fulfillAfterAbort = true; }
}
async function closeDetail() {
  if (await page.locator('#track-detail-modal').isVisible()) {
    await page.locator('#track-detail-modal button[onclick="closeTrackDetailModal()"]', { exact: true }).click();
    await page.locator('#track-detail-modal').waitFor({ state: 'hidden', timeout: 5000 });
  }
}
async function seed(track) {
  await closeDetail();
  await page.evaluate(track => {
    if (audio) audio.pause(); cancelPendingTrackDetailRequests(true);
    const owner = playbackResolutionRuntime().active;
    if (owner?.cancel) owner.cancel(); playbackResolutionRuntime().active = null;
    if (typeof cancelPendingLyricRequests === 'function') cancelPendingLyricRequests();
    playQueue = [track]; currentIdx = 0; ++trackSwitchToken;
    resetLyricsForTrackSwitch();
    if (loadTrackDetailLyrics.state) { loadTrackDetailLyrics.state.cache.clear(); loadTrackDetailLyrics.state.pending.clear(); }
    updateControlTrackInfo(track); forcePlaybackControlsInteractive();
  }, track);
}
async function open(type) {
  await page.locator(type === 'album' ? '#control-cover' : '#control-title-text').click();
  await page.locator('#track-detail-modal').waitFor({ state: 'visible' });
}
async function check(name, action) {
  scenario = name; report.currentCheck = name; save();
  const started = Date.now();
  try { report.checks.push({ name, ok: true, ...(await action() || {}), elapsedMs: Date.now() - started }); }
  catch (error) { report.checks.push({ name, ok: false, error: String(error.stack || error), elapsedMs: Date.now() - started }); throw error; }
  finally { save(); }
}
(async () => {
  try {
    for (const port of [webPort, apiPort]) {
      await new Promise((resolve, reject) => {
        const probe = http.createServer(); probe.once('error', reject); probe.listen(port, '127.0.0.1', () => probe.close(resolve));
      });
    }
    if (executable) {
      fs.writeFileSync(path.join(profile, 'backend-ports.json'), JSON.stringify({ web: webPort, api: apiPort }));
      const env = { ...process.env, MINERADIO_STARTUP_QA_HIDDEN: '1', MINERADIO_STARTUP_QA_USER_DATA: profile,
        MINERADIO_STARTUP_QA_EXIT_MS: '0', MINERADIO_NO_DESKTOP_SHORTCUT: '1', MINERADIO_RUNTIME_NAME: 'Mineradio-Metadata-QA-' + process.pid };
      delete env.ELECTRON_RUN_AS_NODE;
      application = await _electron.launch({ executablePath: executable, env, args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'], timeout: 90000 });
      await application.context().route('**/*', routeRequest);
      page = await application.firstWindow();
    } else {
      // Override writable paths before importing the source web server. Never
      // load the user's config or account files just to serve static assets.
      const code = `from pathlib import Path\nimport music_app.paths as p\np.ROOT=Path(${JSON.stringify(profile)})\np.CONFIG_DIR=p.ROOT/'config'\np.RUNTIME_DIR=p.ROOT/'runtime'\np.CACHE_DIR=p.RUNTIME_DIR/'cache'\np.LOG_DIR=p.RUNTIME_DIR/'logs'\np.EXPORT_DIR=p.ROOT/'exports'\nfrom music_app.launcher import main\nraise SystemExit(main(['--mode','web','--web-port','${webPort}','--api-port','${apiPort}']))`;
      child = spawn('python', ['-B', '-X', 'utf8', '-c', code], { cwd: root, windowsHide: true, stdio: 'ignore', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
      const ready = () => new Promise(resolve => { const r = http.get(origin, res => { res.resume(); resolve(true); }); r.on('error', () => resolve(false)); r.setTimeout(500, () => r.destroy()); });
      assert.ok(await until(ready, 20000), 'Isolated source web server did not start');
      // Never lock PyInstaller's mutable build/backend tree during source QA.
      const cacheRoot = path.join(process.env.LOCALAPPDATA, 'ms-playwright');
      const cachedBrowsers = fs.readdirSync(cacheRoot).filter(name => /^chromium-\d+$/.test(name))
        .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
        .map(name => path.join(cacheRoot, name, 'chrome-win64/chrome.exe'));
      const externalBrowser = [chromium.executablePath(), ...cachedBrowsers].find(file => fs.existsSync(file));
      assert.ok(externalBrowser, 'An external Playwright Chromium is required; do not use build/backend');
      browser = await chromium.launch({ executablePath: externalBrowser, headless: true, args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
      const context = await browser.newContext({ viewport: { width: 1440, height: 980 }, reducedMotion: 'reduce' });
      await context.route('**/*', routeRequest); page = await context.newPage();
    }
    page.on('pageerror', error => report.pageErrors.push(error.message));
    page.on('dialog', async dialog => { report.nativeDialogs.push(dialog.type()); await dialog.dismiss(); });
    page.on('requestfailed', request => {
      const record = requestRecords.get(request); if (!record) return;
      record.aborted = true; record.abortedAt = Date.now();
      for (const item of pending) if (item.record === record) item.release();
    });
    await page.addInitScript(() => { localStorage.setItem('mineradio-visual-guide-seen-v2', '1'); });
    if (!executable) await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.MINERADIO_MODULE_STATUS?.ready && typeof requestTrackDetailJson === 'function', null, { timeout: 45000 });
    const splash = page.locator('#splash.ready'); if (await splash.isVisible()) await splash.click();
    await page.evaluate(() => { if (typeof closeVisualGuide === 'function') closeVisualGuide(true); });
    await page.locator('#splash').waitFor({ state: 'hidden', timeout: 10000 });
    await check('source_priority_then_album_cache', async () => {
      const track = song('priority-album'); await seed(track); hold('source', 'priority-album');
      await page.evaluate(() => { window.__metadataPlayback = playQueueAt(0, { manual: false, suppressPlayFailureNotice: true }); });
      assert.ok(await until(() => records('source', 'priority-album').length === 1));
      await open('album'); await pause(300);
      assert.equal(records('album', 'priority-album').length, 0, 'Album must wait behind unresolved source');
      const released = Date.now(); release('source', 'priority-album');
      await page.locator('#album-song-list').getByText('专辑曲目 priority-album', { exact: true }).waitFor({ timeout: 10000 });
      const count = records('album', 'priority-album').length; assert.equal(count, 1);
      await closeDetail(); await open('album');
      await page.locator('#album-song-list').getByText('专辑曲目 priority-album', { exact: true }).waitFor();
      assert.equal(records('album', 'priority-album').length, count);
      return { pendingSourceMs: 300, albumCalls: count, reopenUsedCache: true, releasedToAlbumMs: Date.now() - released };
    });
    await check('source_priority_comments_native_id_rich_body_and_instrumental', async () => {
      const track = song('priority-comments'); await seed(track); hold('source', 'priority-comments');
      await page.evaluate(() => { window.__metadataPlayback = playQueueAt(0, { manual: false, suppressPlayFailureNotice: true }); });
      assert.ok(await until(() => records('source', 'priority-comments').length === 1));
      await open('song'); await pause(300); assert.equal(records('comments', 'priority-comments').length, 0);
      release('source', 'priority-comments');
      await page.locator('#song-comments .comment-text').waitFor({ timeout: 10000 });
      const text = await page.locator('#song-comments').innerText();
      assert.ok(text.includes('评论正文 priority-comments') && text.includes('保留后文') && text.includes('❤️'));
      assert.doesNotMatch(text, /c0m_cvt|%7B|synthetic-emoji/);
      assert.ok(records('comments', 'priority-comments').every(row => row.albumAudioId === '9876543210'));
      const count = records('comments', 'priority-comments').length;
      await closeDetail(); await open('song'); await page.locator('#song-comments .comment-text').waitFor();
      assert.equal(records('comments', 'priority-comments').length, count);
      return { pendingSourceMs: 300, albumAudioIdPreserved: true, decodedEmojiAndTextVisible: true, reopenUsedCache: true };
    });
    await check('album_real_10s_timeout_and_dom_retry', async () => {
      await seed(song('album-timeout')); hold('album', 'album-timeout'); const started = Date.now(); await open('album');
      const retry = page.locator('#album-song-list').getByRole('button', { name: '重新加载', exact: true });
      await retry.waitFor({ timeout: 12000 }); const elapsed = Date.now() - started;
      assert.ok(elapsed >= 9700 && elapsed < 12000); assert.equal(await page.locator('#album-song-list .detail-loading').count(), 0);
      assert.equal(await retry.isEnabled(), true); release('album', 'album-timeout'); await retry.click();
      await page.locator('#album-song-list').getByText('专辑曲目 album-timeout', { exact: true }).waitFor();
      assert.equal(records('album', 'album-timeout').length, 2);
      return { timeoutMs: elapsed, retrySucceeded: true };
    });
    await check('comments_real_10s_timeout_and_dom_retry', async () => {
      await seed(song('comments-timeout')); hold('comments', 'comments-timeout'); const started = Date.now(); await open('song');
      const retry = page.locator('#song-comments').getByRole('button', { name: '重试加载', exact: true });
      await retry.waitFor({ timeout: 12000 }); const elapsed = Date.now() - started;
      assert.ok(elapsed >= 9700 && elapsed < 12000); assert.equal(await page.locator('#song-comments .detail-loading').count(), 0);
      release('comments', 'comments-timeout'); await retry.click();
      await page.locator('#song-comments .comment-text').waitFor(); assert.equal(records('comments', 'comments-timeout').length, 2);
      return { timeoutMs: elapsed, retrySucceeded: true };
    });
    await check('old_album_result_cannot_replace_new_target', async () => {
      await seed(song('old-album')); hold('album', 'old-album'); await open('album');
      assert.ok(await until(() => records('album', 'old-album').length === 1));
      await seed(song('new-album')); await open('album');
      await page.locator('#album-song-list').getByText('专辑曲目 new-album', { exact: true }).waitFor();
      release('album', 'old-album'); await pause(150);
      assert.match(await page.locator('#album-detail-title').innerText(), /new-album/);
      assert.doesNotMatch(await page.locator('#album-song-list').innerText(), /old-album/);
      return { latestTargetPreserved: true, oldRequestAborted: !!records('album', 'old-album')[0].aborted };
    });
    await check('old_comment_result_cannot_replace_new_target', async () => {
      await seed(song('old-comments')); hold('comments', 'old-comments'); await open('song');
      assert.ok(await until(() => records('comments', 'old-comments').length === 1));
      await page.evaluate(track => {
        playQueue = [track]; currentIdx = 0; ++trackSwitchToken;
        resetLyricsForTrackSwitch();
        window.dispatchEvent(new CustomEvent('mineradio:playback-intent', { detail: { token: trackSwitchToken, index: 0 } }));
        updateControlTrackInfo(track);
      }, song('new-comments'));
      await page.locator('#song-comments .comment-text').waitFor();
      release('comments', 'old-comments'); await pause(150);
      const text = await page.locator('#song-comments').innerText(); assert.match(text, /new-comments/); assert.doesNotMatch(text, /old-comments/);
      return { latestTargetPreserved: true, followedActualPlaybackIntentWhileDialogOpen: true,
        oldRequestAborted: !!records('comments', 'old-comments')[0].aborted };
    });
    await check('missing_album_id_resolves_from_song_id_with_limit20', async () => {
      await seed(song('album-lookup', false)); await open('album');
      await page.locator('#album-song-list').getByText('专辑曲目 album-lookup', { exact: true }).waitFor();
      const row = records('album', 'album-lookup')[0]; assert.equal(row.songId, true); assert.equal(row.limit, '20');
      assert.ok(await page.evaluate(() => !!playQueue[0].albumId));
      return { usedNativeSongLookup: true, limit: 20, resolvedIdSavedInCurrentSong: true };
    });
    await check('instrumental_source_without_explanatory_paragraph', async () => {
      await seed(song('instrumental')); await open('song');
      await page.waitForFunction(() => document.getElementById('song-detail-lyric-source')?.textContent.includes('纯音乐'));
      assert.equal(await page.locator('#song-detail-lyrics .song-detail-lyric-message').count(), 0);
      assert.equal((await page.locator('#song-detail-lyrics').innerText()).trim(), '');
      return { instrumentalLabelVisible: true, extraParagraphs: 0 };
    });
    await check('account_event_invalidates_metadata_cache', async () => {
      const track = song('account-cache'); await seed(track); await open('album');
      await page.locator('#album-song-list').getByText('专辑曲目 account-cache', { exact: true }).waitFor();
      await closeDetail(); const before = records('album', 'account-cache').length;
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('mineradio:accounts-changed')));
      await open('album'); await page.locator('#album-song-list').getByText('专辑曲目 account-cache', { exact: true }).waitFor();
      assert.equal(records('album', 'account-cache').length, before + 1);
      return { reopenedWithFreshRequest: true };
    });
    await check('closing_dialog_cancels_pending_metadata', async () => {
      await seed(song('close-pending')); hold('album', 'close-pending'); await open('album');
      assert.ok(await until(() => records('album', 'close-pending').length === 1));
      await closeDetail();
      await page.waitForFunction(() => trackDetailRequestRuntime().requests.size === 0);
      release('album', 'close-pending'); await pause(100);
      assert.equal(await page.locator('#track-detail-modal').isVisible(), false);
      assert.equal(records('album', 'close-pending')[0].aborted, true);
      return { browserRequestAborted: true, loadingRequestsRemaining: 0, closedModalRemainsClosed: true };
    });
    assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.nativeDialogs, []);
    assert.ok(report.interceptedMutations.every(row => row.method === 'POST' && ['/api/listen/report', '/api/library/membership'].includes(row.pathname)),
      'Unexpected mutation route; audit the recorded paths before allowing it');
    report.ok = true;
    report.version = application ? await application.evaluate(({ app }) => app.getVersion()) : require(path.join(desktop, 'package.json')).version;
  } catch (error) {
    report.error = String(error.stack || error); process.exitCode = 1;
    try { if (page) await page.screenshot({ path: path.join(desktop, 'verification', `metadata-loading-${kind}-failure.png`) }); } catch (_) {}
  } finally {
    policies.clear(); for (const item of pending) item.release();
    try { await application?.close(); } catch (_) {}
    try { await browser?.close(); } catch (_) {}
    if (child?.pid && child.exitCode === null) { try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch (_) {} }
    report.finished = true; report.qaProfileOnly = profile; save();
    console.log(JSON.stringify({ ok: report.ok, checks: report.checks.length, pageErrors: report.pageErrors.length, reportPath }));
  }
})();

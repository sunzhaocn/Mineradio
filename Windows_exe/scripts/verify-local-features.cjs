'use strict';
// Real Electron renderer acceptance using only generated local media and an isolated profile.
const { _electron } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const executable = path.resolve(process.argv[2] || path.join(root, 'dist/win-unpacked/Mineradio.exe'));
const runId = `${Date.now()}-${process.pid}`;
const workspace = path.join(root, 'verification', `local-features-${runId}`);
const profile = path.join(workspace, 'profile');
const mediaDirectory = path.join(workspace, 'media');
const reportPath = path.join(root, 'verification', `local-features-${runId}.json`);
const latestPath = path.join(root, 'verification', 'local-features-latest.json');
const runtimeName = `Mineradio-Local-Features-${runId}`;
fs.mkdirSync(profile, { recursive: true });
fs.mkdirSync(mediaDirectory, { recursive: true });
fs.writeFileSync(path.join(profile, 'cache-settings.json'), JSON.stringify({ version: 1, rootPath: path.join(workspace, 'cache') }));
const env = { ...process.env, MINERADIO_STARTUP_QA_HIDDEN: '1', MINERADIO_STARTUP_QA_USER_DATA: profile,
  MINERADIO_RUNTIME_NAME: runtimeName, MINERADIO_NO_DESKTOP_SHORTCUT: '1' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.MINERADIO_STARTUP_QA_EXIT_MS;
const report = { ok: false, finished: false, executable: path.basename(executable), profile,
  credentialsUsed: false, platformWrites: [], formats: [], checks: {}, rendererErrors: [], nativeDialogEvents: [], ownedApplicationPids: [], ownedBackendPids: [] };
let application;
let page;
let playlistId;
let likedFileId;
let expectedFavoriteCount;
let persistedPlaylistName;
let sidebarPlaylistId;

function safeMessage(error) {
  return String(error?.message || error).replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/https?:\/\/[^\s]+/g, '[URL]').replace(/([?&](?:cap|token|key)=)[^&\s]+/g, '$1[redacted]');
}
function save() {
  const json = JSON.stringify(report, null, 2);
  fs.writeFileSync(reportPath, json);
  fs.writeFileSync(latestPath, json);
}
async function check(name, action) {
  report.currentCheck = name; save();
  try { report.checks[name] = { ok: true, ...(await action() || {}) }; }
  catch (error) {
    const state = await page?.evaluate(() => ({ index: currentIdx, queueKey: queueItemKey(currentCoverSong()),
      mediaKey: audio?.__mineradioQueueItemKey, mediaTime: audio?.currentTime, paused: audio?.paused,
      beatSongKey: localBeatAnalysis?.song?.localKey, beatActive: localBeatAnalysis?.active,
      beatModalVisible: document.getElementById('local-beat-modal')?.classList.contains('show'),
      beatModalOpacity: getComputedStyle(document.getElementById('local-beat-modal')).opacity,
      visibility: document.visibilityState })).catch(() => null);
    report.checks[name] = { ok: false, error: safeMessage(error), state };
  }
  save();
}
async function skipBeatPrompt() {
  const button = page.getByRole('button', { name: '暂不分析', exact: true });
  try { await button.waitFor({ state: 'visible', timeout: 800 }); }
  catch (_) { return; }
  await page.waitForFunction(() => !document.getElementById('local-beat-modal').classList.contains('show') ||
    localBeatAnalysis.song?.localKey === currentCoverSong()?.localKey, null, { timeout: 5000 });
  if (!await button.isVisible()) return;
  await button.click();
  await page.locator('#local-beat-modal').waitFor({ state: 'hidden', timeout: 8000 });
}
async function controls() {
  await skipBeatPrompt();
  await page.evaluate(() => forcePlaybackControlsInteractive());
  await page.mouse.move(720, 820);
}
async function launch() {
  application = await _electron.launch({ executablePath: executable, env, timeout: 90000 });
  report.ownedApplicationPids.push(application.process().pid);
  page = await application.firstWindow({ timeout: 60000 });
  page.setDefaultTimeout(15000);
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.webContents.setAudioMuted(true)));
  page.on('pageerror', error => {
    report.rendererErrors.push(safeMessage(error));
    (report.rendererErrorStacks ||= []).push(String(error.stack || error)
      .replace(/http:\/\/127\.0\.0\.1:\d+/g, '[APP]').replace(/https?:\/\/[^\s)]+/g, '[URL]'));
  });
  page.on('dialog', dialog => {
    report.nativeDialogEvents.push({ type: dialog.type(), message: safeMessage(dialog.message()) });
    dialog.dismiss().catch(() => {});
  });
  page.on('request', request => {
    if (request.method() === 'POST' && /\/api\/(?:library\/actions|(?:qq\/|kugou\/|qishui\/)?playlist\/(?:create|add|remove)|song\/like)/.test(new URL(request.url()).pathname)) {
      report.platformWrites.push(new URL(request.url()).pathname);
    }
  });
  await page.waitForFunction(() => window.MINERADIO_MODULE_STATUS?.ready, null, { timeout: 60000 });
  report.version = await application.evaluate(({ app }) => app.getVersion());
  const startup = JSON.parse(fs.readFileSync(path.join(profile, 'startup-state.json'), 'utf8'));
  if (startup.backendPid) report.ownedBackendPids.push(startup.backendPid);
  if (await page.locator('#splash').isVisible()) {
    await page.waitForFunction(() => typeof splashReadyToEnter !== 'undefined' && splashReadyToEnter, null, { timeout: 20000 });
    await page.locator('#splash').click();
    await page.locator('#splash').waitFor({ state: 'hidden', timeout: 20000 });
  }
  await controls();
}
async function pause() {
  if (await page.evaluate(() => !!(audio && !audio.paused))) {
    await controls();
    await page.locator('#play-btn').click();
    await page.waitForFunction(() => audio && audio.paused);
  }
}
async function playAt(index) {
  await page.evaluate(index => playQueueAt(index, { manual: true }), index);
  await page.waitForFunction(index => currentIdx === index && audio && !audio.paused && audio.currentTime > 0.2 &&
    !audio.error && playbackMediaMatchesCurrentQueueItem(audio), index, { timeout: 20000 });
  await skipBeatPrompt();
}
async function showPlaylist(id) {
  await page.evaluate(async id => {
    openPlaylistPanelTab('playlists', true);
    setPlaylistPanelPinned(true, true);
    if (playlistPanelDetailState.key !== 'mineradio:' + id) await openPlaylistPanelDetail('mineradio', id, '本机测试歌单');
  }, id);
  await page.waitForFunction(id => playlistPanelDetailState.key === 'mineradio:' + id && !playlistPanelDetailState.loading, id);
}
(async () => {
  try {
    const formats = [
      ['mp3', ['-c:a', 'libmp3lame', '-b:a', '128k']], ['wav', ['-c:a', 'pcm_s16le']],
      ['flac', ['-c:a', 'flac']], ['m4a', ['-c:a', 'aac', '-b:a', '128k']],
      ['ogg', ['-c:a', 'libvorbis', '-q:a', '3']], ['opus', ['-c:a', 'libopus', '-b:a', '96k', '-ar', '48000']],
    ];
    const ffmpeg = path.join(root, 'build/tools/ffmpeg.exe');
    for (const [index, [extension, codec]] of formats.entries()) {
      const file = path.join(mediaDirectory, `${index + 1}-Local-QA-${extension}.${extension}`);
      execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
        '-i', `sine=frequency=${330 + index * 55}:duration=18`, '-ar', '44100', '-ac', '2',
        '-metadata', `title=Local QA ${extension.toUpperCase()}`, '-metadata', 'artist=Generated Test Tone', ...codec, file],
        { windowsHide: true, stdio: 'pipe' });
    }
    await launch();
    report.startup = { modules: await page.evaluate(() => window.MINERADIO_MODULE_STATUS.loaded),
      muted: await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(window => window.webContents.isAudioMuted())) };
    for (const [index, [extension]] of formats.entries()) {
      report.currentCheck = `format-${extension}`; save();
      try {
        const file = path.join(mediaDirectory, `${index + 1}-Local-QA-${extension}.${extension}`);
        await page.locator('#file-input').setInputFiles(file);
        await page.waitForFunction(extension => playQueue.some(song => song.localFileId &&
          String(song.localPath).endsWith('.' + extension)), extension, { timeout: 15000 });
        const importedIndex = await page.evaluate(extension => playQueue.findIndex(song =>
          String(song.localPath).endsWith('.' + extension)), extension);
        await page.waitForFunction(() => audio && !audio.paused && audio.currentTime > 0.2 &&
          playbackMediaMatchesCurrentQueueItem(audio), null, { timeout: 15000 });
        await playAt(importedIndex);
        await skipBeatPrompt();
        const media = await page.evaluate(() => ({ duration: audio.duration, currentTime: audio.currentTime,
          readyState: audio.readyState, paused: audio.paused, error: audio.error?.code || null,
          persistent: !!playQueue[currentIdx].localFileId, protocol: new URL(audio.currentSrc || audio.src).protocol }));
        assert.ok(media.duration > 17 && media.duration < 20);
        assert.equal(media.protocol, 'mineradio-local:');
        await pause();
        report.formats.push({ format: extension, ok: true, ...media });
      } catch (error) {
        const state = await page.evaluate(() => ({ queueCount: playQueue.length, currentIndex: currentIdx,
          paths: playQueue.map(song => song.localPath), paused: audio?.paused, readyState: audio?.readyState,
          mediaError: audio?.error?.code || null })).catch(() => null);
        report.formats.push({ format: extension, ok: false, error: safeMessage(error), state });
      }
      save();
    }
    await check('folderImportAndPersistentLibrary', async () => {
      await page.locator('#folder-input').setInputFiles(mediaDirectory);
      await page.waitForFunction(() => playQueue.length === 6 && persistentLocalLibraryTracks.length === 6, null, { timeout: 25000 });
      await page.waitForFunction(() => audio && !audio.paused && audio.currentTime > 0.2 && playbackMediaMatchesCurrentQueueItem(audio));
      await skipBeatPrompt();
      const native = await page.evaluate(() => window.desktopWindow.listLocalMusicLibrary());
      assert.equal(native.count, 6);
      await pause();
      return { imported: native.count, queue: await page.evaluate(() => playQueue.length), actualInput: 'folder-input' };
    });
    await check('playPauseSeekAndTrackButtons', async () => {
      await playAt(0);
      await controls();
      await page.locator('#play-btn').click();
      await page.waitForFunction(() => audio.paused);
      const pausedAt = await page.evaluate(() => audio.currentTime);
      await page.waitForTimeout(350);
      assert.ok(Math.abs((await page.evaluate(() => audio.currentTime)) - pausedAt) < 0.1);
      await controls();
      const bar = await page.locator('#progress-bar').boundingBox();
      assert.ok(bar?.width > 100);
      await page.mouse.click(bar.x + bar.width * 0.55, bar.y + bar.height / 2);
      await page.waitForFunction(() => audio.currentTime > 8 && audio.currentTime < 12);
      const seekAt = await page.evaluate(() => audio.currentTime);
      await page.locator('#play-btn').click();
      await page.waitForFunction(() => audio && !audio.paused);
      await controls(); await page.locator('#next-btn').click();
      await page.waitForFunction(() => currentIdx === 1 && audio && !audio.paused && audio.currentTime > 0.15 && playbackMediaMatchesCurrentQueueItem(audio));
      await controls(); await page.locator('#prev-btn').click();
      await page.waitForFunction(() => currentIdx === 0 && audio && !audio.paused && audio.currentTime > 0.15 && playbackMediaMatchesCurrentQueueItem(audio));
      await pause();
      return { pauseStable: true, seekSeconds: seekAt, nextIndex: 1, previousIndex: 0, viaDomButtons: true };
    });
    await check('loopShuffleSingleModes', async () => {
      await controls();
      const observed = [];
      for (let count = 0; count < 3; count++) {
        await page.locator('#play-mode-btn').click();
        const state = await page.evaluate(() => ({ mode: playMode, mediaLoop: audio.loop,
          label: document.getElementById('play-mode-btn').getAttribute('aria-label') }));
        observed.push(state);
        if (state.mode === 'single') {
          const previous = await page.evaluate(() => currentIdx);
          await page.locator('#play-btn').click();
          await page.waitForFunction(() => audio && !audio.paused);
          const bar = await page.locator('#progress-bar').boundingBox();
          await page.mouse.click(bar.x + bar.width * 0.92, bar.y + bar.height / 2);
          await page.waitForFunction(() => audio.currentTime > audio.duration * 0.85);
          await page.waitForFunction(index => currentIdx === index && audio && !audio.paused && audio.currentTime < 4,
            previous, { timeout: 8000 });
          state.actualNativeRepeatObserved = true;
          await pause();
        }
      }
      assert.deepEqual(observed.map(item => item.mode), ['shuffle', 'single', 'loop']);
      assert.deepEqual(observed.map(item => item.mediaLoop), [false, true, false]);
      return { observed };
    });
    await check('queueOrderingAndRemoval', async () => {
      const before = await page.evaluate(() => playQueue.map(queueItemKey));
      const moved = await page.evaluate(() => moveQueueIndex(5, 1));
      assert.equal(moved, true);
      assert.equal(await page.evaluate(() => queueItemKey(playQueue[1])), before[5]);
      await page.evaluate(() => queueIndexNext(4));
      const nextKey = await page.evaluate(() => queueItemKey(playQueue[currentIdx + 1]));
      assert.ok(nextKey);
      await page.evaluate(() => removeFromQueue(playQueue.length - 1));
      assert.equal(await page.evaluate(() => playQueue.length), 5);
      await controls(); await page.locator('#mini-queue-btn').click();
      await page.locator('#mini-queue-popover').waitFor({ state: 'visible' });
      const text = await page.locator('#mini-queue-count').textContent();
      assert.ok(text.includes('5'));
      await page.evaluate(() => closeMiniQueue());
      return { reordered: true, queueNext: true, removed: true, count: 5, domCount: text };
    });
    await check('queueClearAndRestoreLocalLibrary', async () => {
      await pause();
      await page.evaluate(() => clearQueue());
      assert.equal(await page.evaluate(() => playQueue.length), 0);
      const restored = await page.evaluate(() => loadPersistedLocalLibraryIntoQueue());
      assert.equal(restored, true);
      await page.waitForFunction(() => playQueue.length === 6 && audio && !audio.paused && audio.currentTime > 0.2);
      await pause();
      return { cleared: true, restoredFromPersistentLibrary: 6 };
    });
    await check('favoritesAndRecentHistory', async () => {
      await playAt(0); await pause();
      likedFileId = await page.evaluate(() => currentCoverSong().localFileId);
      await controls(); await page.locator('#heart-btn').click();
      await page.waitForFunction(() => isSongLiked(currentCoverSong()));
      expectedFavoriteCount = await page.evaluate(() => window.webLocalLibrary.favorites().length);
      assert.equal(expectedFavoriteCount, 1);
      await controls(); await page.locator('#heart-btn').click();
      await page.waitForFunction(() => !isSongLiked(currentCoverSong()));
      await controls(); await page.locator('#heart-btn').click();
      await page.waitForFunction(() => isSongLiked(currentCoverSong()));
      await page.evaluate(() => openHomeRecentHistory());
      await page.locator('#home-recent-history-modal').waitFor({ state: 'visible' });
      const rows = await page.locator('.home-recent-row').count();
      assert.ok(rows >= 6);
      await page.locator('[data-recent-close]').click();
      return { likeUnlikeLike: true, favorites: 1, actualRecentRows: rows };
    });
    await check('playlistCreateAndAdd', async () => {
      await controls(); await page.locator('#collect-btn').click();
      await page.locator('#collect-new-name').fill('本机验收歌单');
      await page.getByRole('button', { name: '创建内置', exact: true }).click();
      await page.waitForFunction(() => builtInPlaylists.some(item => item.name === '本机验收歌单'));
      playlistId = await page.evaluate(() => builtInPlaylists.find(item => item.name === '本机验收歌单').id);
      await page.locator('#collect-modal').waitFor({ state: 'hidden' });
      await page.evaluate(() => openCollectModal(playQueue[1]));
      await page.locator(`.collect-item[data-built-in-pid="${playlistId}"]`).click();
      await page.waitForFunction(id => builtInPlaylists.find(item => item.id === id)?.trackCount === 2, playlistId);
      await showPlaylist(playlistId);
      assert.equal(await page.locator('[data-pl-detail-row]').count(), 2);
      persistedPlaylistName = '本机验收歌单';
      return { playlistId, tracks: 2, createdAndAddedViaDom: true };
    });
    await check('playlistRename', async () => {
      assert.ok(playlistId, 'Create a local playlist first');
      await showPlaylist(playlistId);
      await page.locator('[data-pl-detail-rename]').click();
      const mask = page.locator('#web-local-playlist-name-mask');
      const input = mask.getByRole('textbox', { name: '歌单名称' });
      await input.waitFor({ state: 'visible' });
      await input.fill(''); await input.press('Enter');
      await mask.getByRole('alert').waitFor({ state: 'visible' });
      await input.fill('取消的名称'); await input.press('Escape');
      await mask.waitFor({ state: 'detached' });
      assert.equal(await page.evaluate(id => builtInPlaylists.find(item => item.id === id).name, playlistId), '本机验收歌单');
      await page.locator('[data-pl-detail-rename]').click();
      await mask.getByRole('button', { name: '取消', exact: true }).click();
      await mask.waitFor({ state: 'detached' });
      await page.locator('[data-pl-detail-rename]').click();
      await input.fill('本机验收歌单改名');
      await input.press('Shift+Tab');
      assert.equal(await mask.getByRole('button', { name: '保存', exact: true }).evaluate(element => document.activeElement === element), true);
      await page.keyboard.press('Tab');
      assert.equal(await input.evaluate(element => document.activeElement === element), true);
      await input.press('Enter');
      await page.waitForFunction(id => builtInPlaylists.find(item => item.id === id)?.name === '本机验收歌单改名', playlistId, { timeout: 4000 });
      await mask.waitFor({ state: 'detached' });
      await page.waitForFunction(() => document.activeElement?.matches('[data-pl-detail-rename]'));
      persistedPlaylistName = '本机验收歌单改名';
      return { renamed: true, nativePromptUsed: false, emptyNameRejected: true, escapeCancels: true,
        cancelButton: true, tabFocusTrapped: true, focusRestored: true };
    });
    await check('playlistRemoveAndVisibleRows', async () => {
      assert.ok(playlistId, 'Create a local playlist first');
      await showPlaylist(playlistId);
      await page.locator('[data-pl-detail-remove]').first().click();
      await page.waitForFunction(id => builtInPlaylists.find(item => item.id === id)?.trackCount === 1, playlistId);
      const stored = await page.evaluate(id => builtInPlaylistTracksPage(id, { offset: 0, limit: 100 }), playlistId);
      const visibleRows = await page.locator('[data-pl-detail-row]').count();
      assert.equal(stored.total, 1);
      assert.equal(visibleRows, 1, 'Visible playlist detail must immediately reflect removal');
      return { storedTracks: stored.total, visibleRows };
    });
    await check('sidebarCreateAndRename', async () => {
      await showPlaylist(playlistId);
      await page.locator('[onclick="promptCreateBuiltInPlaylist()"]').click();
      const mask = page.locator('#web-local-playlist-name-mask');
      const input = mask.getByRole('textbox', { name: '歌单名称' });
      await input.fill('侧栏新建验收'); await input.press('Enter');
      await page.waitForFunction(() => builtInPlaylists.some(item => item.name === '侧栏新建验收'));
      const created = await page.evaluate(() => builtInPlaylists.find(item => item.name === '侧栏新建验收'));
      sidebarPlaylistId = created.id;
      assert.equal(created.trackCount, 0);
      await showPlaylist(sidebarPlaylistId);
      await page.locator('[data-pl-detail-rename]').click();
      await input.fill('侧栏重命名验收'); await input.press('Enter');
      await page.waitForFunction(id => builtInPlaylists.find(item => item.id === id)?.name === '侧栏重命名验收', sidebarPlaylistId);
      return { createdViaActualSidebarButton: true, emptyPlaylist: true, renamedViaActualDetailButton: true, nativePromptUsed: false };
    });
    await check('localPlaylistImport', async () => {
      const imported = await page.evaluate(() => window.webLocalLibrary.importPlaylist('本机导入验收',
        persistentLocalLibraryTracks.slice(0, 2), 'local-qa-import'));
      assert.equal(imported.duplicate, false);
      const again = await page.evaluate(() => window.webLocalLibrary.importPlaylist('本机导入验收',
        persistentLocalLibraryTracks.slice(0, 2), 'local-qa-import'));
      assert.equal(again.duplicate, true);
      await showPlaylist(imported.playlist.id);
      assert.equal(await page.locator('[data-pl-detail-row]').count(), 2);
      return { publicProductImportApi: true, tracks: 2, duplicatePrevented: true, platformRequests: false };
    });
    await check('localRecentActualReplay', async () => {
      await pause();
      const target = await page.evaluate(() => {
        const index = listenStatsState.history.findIndex(record => record.localFileId && record.localFileId !== currentCoverSong().localFileId);
        return { index, fileId: listenStatsState.history[index]?.localFileId };
      });
      assert.ok(target.index >= 0);
      await page.evaluate(() => openHomeRecentHistory());
      await page.locator('.home-recent-row').nth(target.index).click();
      await page.waitForFunction(fileId => currentCoverSong()?.localFileId === fileId && audio && !audio.paused &&
        audio.currentTime > 0.2 && !audio.error && playbackMediaMatchesCurrentQueueItem(audio), target.fileId, { timeout: 15000 });
      const state = await page.evaluate(() => ({ time: audio.currentTime, duration: audio.duration,
        resolvedAuthorizedSource: !!currentCoverSong().localUrl, error: audio.error?.code || null }));
      await pause();
      return { actualHistoryRowClicked: true, ...state };
    });
    report.checks.playlistFileExport = { skipped: true, reason: 'No playlist file-export action is exposed by the current product UI; generic JSON export belongs to FX presets.' };
    await check('rendererReloadPersistence', async () => {
      await pause();
      await page.evaluate(() => saveLastPlaybackSnapshot(true, 'qa-reload'));
      let mode = 'hold', catalogRequests = 0;
      const held = [];
      const intercept = async route => {
        catalogRequests++;
        if (mode === 'hold') held.push(route);
        else await route.abort('internetdisconnected');
      };
      await page.route('**/api/local/catalog', intercept);
      try {
        const reloadAt = Date.now();
        await page.reload();
        await page.waitForFunction(id => window.MINERADIO_MODULE_STATUS?.ready && persistentLocalLibraryTracks?.length === 6 &&
          builtInPlaylists.some(item => item.id === id), playlistId, { timeout: 10000 });
        const visibleBeforeRemote = Date.now() - reloadAt;
        const persisted = await page.evaluate(id => ({ favoriteCount: webLocalLibrary.favorites().length,
          playlist: builtInPlaylists.find(item => item.id === id), recent: listenStatsState.history.length,
          library: persistentLocalLibraryTracks.length,
          storedPlaylist: JSON.parse(localStorage.getItem('mineradio-web-library-v1')).playlists.find(item => item.id === id) }), playlistId);
        assert.equal(persisted.favoriteCount, expectedFavoriteCount);
        assert.equal(persisted.playlist.name, persistedPlaylistName);
        assert.equal(persisted.storedPlaylist.name, persistedPlaylistName);
        assert.ok(persisted.recent >= 6);
        assert.ok(held.length > 0, 'Catalog response must still be deliberately held');
        const timeoutAt = Date.now();
        const timedOut = await page.evaluate(() => refreshBuiltInPlaylists());
        assert.equal(timedOut, false, 'A held catalog request must release its refresh promise');
        const timeoutMs = Date.now() - timeoutAt;
        assert.ok(timeoutMs < 10000);
        assert.equal(catalogRequests, 1);
        mode = 'fail';
        for (const route of held) await route.abort('internetdisconnected').catch(() => {});
        const failedRetry = await page.evaluate(() => refreshBuiltInPlaylists());
        assert.equal(failedRetry, false);
        const retained = await page.evaluate(ids => ids.every(id => builtInPlaylists.some(item => item.id === id)),
          ['local:favorites', playlistId, sidebarPlaylistId]);
        assert.equal(retained, true);
        return { favorites: persisted.favoriteCount, playlistName: persisted.playlist.name,
          localLibrary: persisted.library, history: persisted.recent, catalogHeld: true,
          visibleBeforeCatalogMs: visibleBeforeRemote, catalogTimeoutReleased: true, timeoutMs,
          failedCatalogRetryPreservesAllLocalRows: true };
      } finally {
        for (const route of held) await route.abort().catch(() => {});
        await page.unroute('**/api/local/catalog', intercept);
      }
    });
    await check('applicationRestartAndSavedLocalFavoritePlayback', async () => {
      await application.close(); application = null;
      await launch();
      await page.waitForFunction(() => persistentLocalLibraryTracks?.length === 6, null, { timeout: 20000 });
      const favorite = await page.evaluate(fileId => webLocalLibrary.favorites().find(item => item.localFileId === fileId), likedFileId);
      assert.ok(favorite, 'Saved local favorite must survive application restart');
      await showPlaylist('local:favorites');
      await page.locator('[data-pl-detail-row]').first().click();
      await page.waitForFunction(fileId => currentCoverSong()?.localFileId === fileId && audio && !audio.paused &&
        audio.currentTime > 0.2 && !audio.error && playbackMediaMatchesCurrentQueueItem(audio), likedFileId, { timeout: 15000 });
      const state = await page.evaluate(() => ({ time: audio.currentTime, duration: audio.duration, error: audio.error?.code || null }));
      await pause();
      return { favorites: true, actualSavedFavoritePlayback: true, ...state };
    });
    await check('playlistDeletion', async () => {
      assert.ok(playlistId);
      await showPlaylist(playlistId);
      const mask = page.locator('#mineradio-action-mask');
      const dialog = mask.getByRole('alertdialog', { name: '删除歌单', exact: true });
      await page.locator('[data-pl-detail-delete]').click();
      await dialog.waitFor({ state: 'visible' });
      await page.waitForFunction(() => document.activeElement?.textContent === '取消' &&
        !!document.activeElement?.closest('#mineradio-action-mask'));
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
      await mask.waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(id => builtInPlaylists.some(item => item.id === id), playlistId), true,
        'Cancelling a themed deletion must retain the playlist');
      await page.locator('[data-pl-detail-delete]').click();
      await dialog.waitFor({ state: 'visible' });
      await page.keyboard.press('Escape');
      await mask.waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(id => builtInPlaylists.some(item => item.id === id), playlistId), true,
        'Escape must cancel playlist deletion');
      await page.locator('[data-pl-detail-delete]').click();
      await dialog.waitFor({ state: 'visible' });
      await dialog.getByRole('button', { name: '删除歌单', exact: true }).click();
      await mask.waitFor({ state: 'hidden' });
      await page.waitForFunction(id => !builtInPlaylists.some(item => item.id === id), playlistId);
      return { deleted: true, themedAlertDialog: true, cancelPreserves: true, escapePreserves: true, initialFocusCancel: true };
    });
    assert.equal(report.platformWrites.length, 0, 'Local acceptance must never write to a music platform');
    await check('rendererRuntimeErrors', async () => {
      assert.equal(report.rendererErrors.length, 0, 'The real renderer must not throw runtime errors: ' + report.rendererErrors.join('; '));
      return { pageErrors: 0 };
    });
    await check('nativeDialogs', async () => {
      assert.equal(report.nativeDialogEvents.length, 0, 'All local actions must use themed dialogs');
      return { nativeDialogEvents: 0 };
    });
    report.finished = true;
    report.ok = report.formats.length === 6 && report.formats.every(item => item.ok) &&
      Object.values(report.checks).every(item => item.ok || item.skipped);
    if (!report.ok) process.exitCode = 1;
  } catch (error) { report.failure = safeMessage(error); process.exitCode = 1; }
  finally {
    if (application) await application.close().catch(error => { report.cleanupError = safeMessage(error); });
    if (report.finished && report.rendererErrors.length) {
      report.checks.rendererRuntimeErrors = { ok: false, pageErrors: report.rendererErrors.length,
        error: 'Real renderer exceptions were captured; inspect rendererErrorStacks.' };
      report.ok = false; process.exitCode = 1;
    }
    if (report.nativeDialogEvents.length) {
      report.checks.nativeDialogs = { ok: false, nativeDialogEvents: report.nativeDialogEvents.length,
        error: 'Native browser dialogs were captured; themed dialogs are required.' };
      report.ok = false; process.exitCode = 1;
    }
    save();
    console.log(JSON.stringify(report, null, 2));
  }
})();

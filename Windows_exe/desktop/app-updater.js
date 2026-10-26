'use strict';

const RELEASES = 'https://github.com/sunzhaocn/Mineradio/releases';

// Only the main process owns the feed, download paths and installer. No token
// or renderer-provided URL is used for public GitHub releases.
function createAppUpdater({ updater, app, ipcMain, trusted, broadcast, schedule = setTimeout }) {
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.autoRunAppAfterInstall = false;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;
  updater.disableDifferentialDownload = true;
  updater.setFeedURL({ provider: 'github', owner: 'sunzhaocn', repo: 'Mineradio' });
  let checking = null;
  let downloading = null;
  let installScheduled = false;
  let state = { status: 'idle', currentVersion: app.getVersion(), version: app.getVersion(),
    progress: 0, transferred: 0, total: 0, updateAvailable: false, releaseUrl: RELEASES, error: '' };
  const snapshot = () => ({ ...state });
  const change = (patch) => { state = { ...state, ...patch }; broadcast(snapshot()); };
  updater.on('checking-for-update', () => change({ status: 'checking', error: '' }));
  updater.on('update-available', info => change({ status: 'available', updateAvailable: true,
    version: info.version, progress: 0, error: '' }));
  updater.on('update-not-available', () => change({ status: 'current', updateAvailable: false,
    version: app.getVersion(), progress: 0, error: '' }));
  updater.on('download-progress', p => change({ status: 'downloading', progress: Math.min(100, Math.max(0, p.percent || 0)),
    transferred: p.transferred || 0, total: p.total || 0 }));
  updater.on('error', error => change({ status: 'error', error: String(error.message || error).slice(0, 500) }));
  updater.on('update-downloaded', () => {
    if (installScheduled) return;
    installScheduled = true;
    // electron-updater emits this only after SHA-512 verification. Its on-quit
    // installer runs after our existing before-quit backend/Explorer cleanup.
    updater.autoInstallOnAppQuit = true;
    change({ status: 'installing', progress: 100, error: '' });
    schedule(() => app.quit(), 900);
  });
  async function check() {
    if (downloading || installScheduled) return snapshot();
    if (!checking) checking = (async () => {
      try { await updater.checkForUpdates(); }
      catch (error) { change({ status: 'error', error: String(error.message || error).slice(0, 500) }); }
      finally { checking = null; }
      return snapshot();
    })();
    return checking;
  }
  async function download() {
    if (checking) await checking;
    if (installScheduled) return snapshot();
    if (downloading) return downloading;
    if (!state.updateAvailable) return { ...snapshot(), ok: false, error: '请先检查更新' };
    change({ status: 'downloading', progress: 0, error: '' });
    downloading = (async () => {
      try { await updater.downloadUpdate(); }
      catch (error) { change({ status: 'error', progress: 0, error: String(error.message || error).slice(0, 500) }); }
      finally { downloading = null; }
      return snapshot();
    })();
    return downloading;
  }
  for (const [channel, action] of [['state', snapshot], ['check', check], ['download', download]]) {
    ipcMain.handle('mineradio-update-' + channel, (event) => {
      if (!trusted(event)) return { ok: false, error: 'UNTRUSTED_SENDER' };
      return action();
    });
  }
  return { check, download, snapshot };
}
module.exports = { createAppUpdater };

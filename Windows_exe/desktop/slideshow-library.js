'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const SCHEME = 'mineradio-slides';
const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.avif': 'image/avif' };

function registerSlideshowScheme(protocol) {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
}

class SlideshowLibrary {
  constructor({ userDataPath, onChange = () => {} }) {
    this.directory = path.join(userDataPath, 'slideshow-images');
    this.onChange = onChange;
    this.files = new Map();
  }
  async list() {
    await fs.promises.mkdir(this.directory, { recursive: true });
    if (!this.watcher) {
      this.watcher = fs.watch(this.directory, () => {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.onChange(), 250);
      });
      this.watcher.unref();
    }
    const files = new Map(), result = [];
    for (const entry of await fs.promises.readdir(this.directory, { withFileTypes: true })) {
      if (!entry.isFile() || !TYPES[path.extname(entry.name).toLowerCase()]) continue;
      const file = path.join(this.directory, entry.name);
      try {
        const stat = await fs.promises.stat(file);
        if (!stat.size) continue;
        const id = crypto.createHash('sha256').update(entry.name).digest('hex');
        files.set(id, file);
        result.push({ id, name: entry.name, url: `${SCHEME}://library/${id}?v=${stat.mtimeMs}-${stat.size}` });
      } catch (_) { /* Explorer may delete or move a file while scanning. */ }
    }
    this.files = files;
    return { ok: true, images: result.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true })) };
  }
  async add({ name, bytes }) {
    const extension = path.extname(String(name || '')).toLowerCase();
    if (!TYPES[extension] || !bytes || !bytes.byteLength || bytes.byteLength > 64 * 1024 * 1024) return { ok: false };
    const data = Buffer.from(bytes);
    const stem = path.basename(String(name), extension).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80) || '图片';
    const digest = crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
    await fs.promises.mkdir(this.directory, { recursive: true });
    const destination = path.join(this.directory, `${stem}-${digest}${extension}`);
    // wx also refuses to follow an existing symbolic link.
    try { await fs.promises.writeFile(destination, data, { flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    return { ok: true };
  }
  installProtocol(protocol, net) {
    protocol.handle(SCHEME, async request => {
      const url = new URL(request.url);
      const file = url.hostname === 'library' && this.files.get(url.pathname.slice(1));
      if (!file) return new Response('', { status: 404 });
      try {
        const stat = await fs.promises.lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink()) return new Response('', { status: 404 });
        return await net.fetch(pathToFileURL(file).href);
      } catch (_) { return new Response('', { status: 404 }); }
    });
  }
  close() { clearTimeout(this.timer); if (this.watcher) this.watcher.close(); }
}

function installSlideshowIpc({ ipcMain, library, shell, trusted }) {
  for (const [channel, action] of Object.entries({
    'mineradio-slides-list': () => library.list(),
    'mineradio-slides-add': payload => library.add(payload || {}),
    'mineradio-slides-open': async () => {
      await library.list();
      const error = await shell.openPath(library.directory);
      return { ok: !error };
    },
  })) {
    ipcMain.handle(channel, async (event, payload) => {
      if (!trusted(event)) return { ok: false, error: 'UNTRUSTED_SENDER' };
      try { return await action(payload); } catch (_) { return { ok: false, error: 'SLIDESHOW_STORAGE_UNAVAILABLE' }; }
    });
  }
}
module.exports = { SlideshowLibrary, registerSlideshowScheme, installSlideshowIpc };

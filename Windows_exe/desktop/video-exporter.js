'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const os = require('os');
const {spawn} = require('child_process');
const {once} = require('events');

function validate(payload) {
  if (!payload || !(payload.audio instanceof Uint8Array) || !payload.audio.byteLength || payload.audio.byteLength > 512 * 1024 * 1024)
    throw new Error('音频文件为空或过大');
  const preset = payload.preset;
  if (!preset || preset.schema !== 1 || !['mineradio-track-preset','mineradio-user-fx-archive'].includes(preset.type) || !preset.snapshot
      || !Number.isInteger(preset.snapshot.preset) || preset.snapshot.preset < 0 || preset.snapshot.preset > 14
      || JSON.stringify(preset).length > 128 * 1024 * 1024) throw new Error('预设数据无效');
  if (preset.resources && preset.resources.externalProject && preset.resources.externalProject.active)
    throw new Error('外部 Wallpaper Engine 项目暂不支持离线视频导出');
  const width = Number(payload.width), height = Number(payload.height), fps = Number(payload.fps);
  if (![[1280,720],[1920,1080]].some(([w,h]) => width === w && height === h) || ![30,60].includes(fps))
    throw new Error('视频尺寸或帧率无效');
  if (payload.video && (!(payload.video instanceof Uint8Array) || payload.video.byteLength > 512 * 1024 * 1024))
    throw new Error('MV 素材无效或过大');
  return {width, height, fps};
}

function createVideoExporter({app, BrowserWindow, dialog, ipcMain, getOwner, getBaseUrl, getFfmpeg, isTrusted}) {
  let job, latest = {status:'idle', progress:0};
  function state(status, extra = {}) {
    latest = {...latest, ...extra, status};
    if (job && job.sender && !job.sender.isDestroyed()) job.sender.send('mineradio-video-export-state', latest);
    return latest;
  }
  function cancel() {
    if (!job) return latest;
    job.canceled = true;
    if (job.child) job.child.kill();
    if (job.window && !job.window.isDestroyed()) job.window.destroy();
    return state('canceling');
  }
  function check(owner) { if (owner.canceled) throw new Error('EXPORT_CANCELED'); }
  async function ffmpeg(owner, args) {
    check(owner);
    const child = spawn(getFfmpeg(), args, {windowsHide:true, stdio:['ignore','ignore','pipe']});
    owner.child = child;
    child.stderr.on('data', () => {});
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    owner.child = null; check(owner);
    if (code !== 0) throw new Error('音频解码失败，请使用可正常播放的本地音频');
  }
  async function assets(owner, payload) {
    const token = crypto.randomUUID(), origin = new URL(getBaseUrl()).origin;
    const files = new Map();
    if (payload.cover && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(payload.cover)) {
      const bytes = Buffer.from(payload.cover.slice(payload.cover.indexOf(',') + 1), 'base64');
      if (bytes.length > 8 * 1024 * 1024) throw new Error('封面图片过大');
      const name = path.join(owner.directory, 'cover'); await fs.promises.writeFile(name, bytes);
      files.set('cover', {path:name, mime:payload.cover.slice(5, payload.cover.indexOf(';'))});
    }
    if (payload.video && payload.video.byteLength) {
      const name = path.join(owner.directory, 'mv'); await fs.promises.writeFile(name, payload.video);
      files.set('mv', {path:name, mime:'video/mp4'});
    }
    const server = http.createServer((request, response) => {
      const parsed = new URL(request.url, 'http://127.0.0.1');
      const file = files.get(parsed.pathname.replace('/' + token + '/', ''));
      if (!parsed.pathname.startsWith('/' + token + '/') || !file || !['GET','HEAD'].includes(request.method)) {
        response.writeHead(404); response.end(); return;
      }
      const total = fs.statSync(file.path).size;
      let start = 0, end = total - 1, partial = false;
      if (request.headers.range) {
        const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range);
        if (!match || Number(match[1]) >= total || match[2] && Number(match[2]) < Number(match[1])) {
          response.writeHead(416, {'Content-Range':'bytes */' + total}); response.end(); return;
        }
        start = Number(match[1]); end = Math.min(total - 1, match[2] ? Number(match[2]) : total - 1); partial = true;
      }
      const headers = {'Content-Type':file.mime, 'Content-Length':end-start+1, 'Accept-Ranges':'bytes',
        'Cache-Control':'no-store', 'Access-Control-Allow-Origin':origin};
      if (partial) headers['Content-Range'] = `bytes ${start}-${end}/${total}`;
      response.writeHead(partial ? 206 : 200, headers);
      if (request.method === 'HEAD') return response.end();
      const stream = fs.createReadStream(file.path, {start, end});
      stream.on('error', () => response.destroy()); response.on('close', () => stream.destroy()); stream.pipe(response);
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    owner.server = server;
    const prefix = 'http://127.0.0.1:' + server.address().port + '/' + token + '/';
    return {coverUrl:files.has('cover') ? prefix + 'cover' : '', videoUrl:files.has('mv') ? prefix + 'mv' : ''};
  }
  async function run(owner, payload, settings) {
    let pcm;
    try {
      const prefix = path.join(app.getPath('temp'), 'mineradio-video-');
      owner.directory = await fs.promises.mkdtemp(prefix);
      const input = path.join(owner.directory, 'audio.input'), analysis = path.join(owner.directory, 'analysis.f32');
      await fs.promises.writeFile(input, payload.audio);
      payload.audio = null;
      await ffmpeg(owner, ['-v','error','-nostdin','-y','-i',input,'-t','7201','-vn','-ac','1','-ar','48000','-f','f32le',analysis]);
      const duration = (await fs.promises.stat(analysis)).size / 4 / 48000;
      if (!Number.isFinite(duration) || duration <= 0 || duration > 7200) throw new Error('音频时长无效或超过两小时');
      const media = await assets(owner, payload); payload.video = null;
      owner.config = {preset:payload.preset, song:{name:String(payload.song && payload.song.name || '本地音乐').slice(0,200),
        artist:String(payload.song && payload.song.artist || '').slice(0,200)}, lyric:String(payload.lyric || '').slice(0,512*1024),
        duration, fps:settings.fps, ...media};
      const win = new BrowserWindow({show:false, frame:false, useContentSize:true, width:settings.width, height:settings.height,
        backgroundColor:'#000000', webPreferences:{preload:path.join(__dirname,'video-preload.js'),
          partition:'mineradio-video-export', contextIsolation:true, nodeIntegration:false, sandbox:true,
          backgroundThrottling:false, offscreen:{useSharedTexture:false, deviceScaleFactor:1}}});
      owner.window = win;
      win.setMinimumSize(settings.width, settings.height);
      win.setContentSize(settings.width, settings.height);
      owner.renderSession = win.webContents.session;
      await owner.renderSession.clearStorageData();
      await owner.renderSession.clearCache();
      win.webContents.setWindowOpenHandler(() => ({action:'deny'}));
      win.webContents.on('will-navigate', event => event.preventDefault());
      win.webContents.session.setPermissionRequestHandler((_web, _permission, callback) => callback(false));
      const base = new URL(getBaseUrl()).origin;
      win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
        const url = new URL(details.url);
        const allowed = (url.origin === base && !url.pathname.startsWith('/api/'))
          || details.url.startsWith(media.coverUrl || 'no-cover:') || details.url.startsWith(media.videoUrl || 'no-video:')
          || ['data:','blob:'].includes(url.protocol);
        callback({cancel:!allowed});
      });
      await win.loadURL(base + '/?video_export=' + owner.id);
      const deadline = Date.now() + 90000;
      while (true) {
        check(owner);
        const ready = await win.webContents.executeJavaScript('({ready:!!window.MINERADIO_VIDEO_READY,error:window.MINERADIO_VIDEO_ERROR||window.MINERADIO_MODULE_STATUS?.error||""})');
        if (ready.error) throw new Error(ready.error);
        if (ready.ready) break;
        if (Date.now() > deadline) throw new Error('视频预设初始化超时');
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      // Embedded web presets have their own animation loop. Step it on the
      // same export clock after parent audio/properties messages are delivered.
      const childFrames = win.webContents.mainFrame.framesInSubtree.filter(frame => frame !== win.webContents.mainFrame);
      for (const frame of childFrames) await frame.executeJavaScript(`(() => {
        const clock={now:performance.now()}, pending=new Map();let sequence=0;
        Object.defineProperty(performance,'now',{configurable:true,value:()=>clock.now});
        window.requestAnimationFrame=callback=>{const id=++sequence;pending.set(id,callback);return id};
        window.cancelAnimationFrame=id=>pending.delete(id);
        const base=clock.now;window.mineradioExportStep=time=>{clock.now=base+time*1000;
          const callbacks=[...pending.values()];pending.clear();for(const callback of callbacks)callback(clock.now)};
      })()`);
      pcm = await fs.promises.open(analysis, 'r');
      owner.outputTemporary = owner.destination + '.' + owner.id + '.part.mp4';
      const encoder = spawn(getFfmpeg(), ['-v','error','-nostdin','-y','-f','rawvideo','-pixel_format','bgra',
        '-video_size',settings.width+'x'+settings.height,'-framerate',String(settings.fps),'-i','pipe:0','-i',input,
        '-map','0:v:0','-map','1:a:0','-c:v','libx264','-threads:v',String(Math.max(1,Math.min(8,Math.floor(os.availableParallelism()/2)))),'-preset','fast','-crf','18','-pix_fmt','yuv420p',
        '-c:a','aac','-b:a','320k','-t',String(duration),'-shortest','-movflags','+faststart',owner.outputTemporary],
        {windowsHide:true, stdio:['pipe','ignore','pipe']});
      owner.child = encoder;
      let encoderError;
      encoder.stdin.on('error', error => { encoderError = error; });
      const exited = new Promise((resolve, reject) => { encoder.once('error', reject); encoder.once('close', resolve); });
      owner.childExit = exited;
      exited.catch(() => {});
      encoder.stderr.on('data', () => {});
      const count = Math.ceil(duration * settings.fps), bytes = Buffer.alloc(2048 * 4);
      state('rendering', {totalFrames:count, renderedFrames:0, progress:0, duration});
      for (let frame = 0; frame < count; frame++) {
        check(owner); if (encoderError || encoder.exitCode !== null) throw new Error('视频编码提前结束，请检查磁盘空间');
        const time = frame / settings.fps, end = Math.round(time * 48000), start = Math.max(0, end - 2048);
        bytes.fill(0);
        const padding = Math.max(0, 2048 - end) * 4;
        await pcm.read(bytes, padding, bytes.length - padding, start * 4);
        const rendered = await win.webContents.executeJavaScript('mineradioRenderVideoFrame(' + time + ',' + JSON.stringify(bytes.toString('base64')) + ')');
        const requested = payload.preset.snapshot.preset;
        const expected = requested === 13 ? Math.max(0,Math.min(12,Number(payload.preset.resources && payload.preset.resources.mvFallback)||0)) : requested === 14 ? 3 : requested;
        if (!rendered || rendered.preset !== expected) throw new Error('预设状态发生变化，已停止导出以避免生成错误画面');
        for (const frame of childFrames) await frame.executeJavaScript('window.mineradioExportStep&&mineradioExportStep(' + time + ')');
        const image = await win.webContents.capturePage(undefined, {stayHidden:true, stayAwake:true});
        const bitmap = image.toBitmap({scaleFactor:1});
        if (bitmap.length !== settings.width * settings.height * 4) throw new Error('视频画面尺寸不匹配（' + image.getSize().width + '×' + image.getSize().height + '）');
        if (!encoder.stdin.write(bitmap)) await once(encoder.stdin, 'drain');
        if (frame % 10 === 0 || frame === count - 1) state('rendering', {renderedFrames:frame+1, progress:Math.min(99,(frame+1)/count*100)});
      }
      state('encoding', {progress:99}); encoder.stdin.end();
      const code = await exited; owner.child = null; check(owner);
      if (code !== 0) throw new Error('视频编码失败，请检查保存位置和磁盘空间');
      await fs.promises.rename(owner.outputTemporary, owner.destination);
      state('completed', {progress:100, fileName:path.basename(owner.destination)});
    } catch (error) {
      if (owner.child) {
        owner.child.kill();
        if (owner.childExit) await Promise.race([owner.childExit.catch(() => {}), new Promise(resolve => setTimeout(resolve,3000))]);
      }
      state(owner.canceled ? 'canceled' : 'error', {error:owner.canceled ? '' : error.message || '视频导出失败'});
    } finally {
      if (pcm) await pcm.close().catch(() => {});
      if (owner.window && !owner.window.isDestroyed()) owner.window.destroy();
      if (owner.renderSession) {
        await owner.renderSession.clearStorageData().catch(() => {});
        await owner.renderSession.clearCache().catch(() => {});
      }
      if (owner.server) { owner.server.closeAllConnections(); owner.server.close(); }
      if (owner.outputTemporary) await fs.promises.unlink(owner.outputTemporary).catch(() => {});
      if (owner.directory && path.dirname(owner.directory) === path.resolve(app.getPath('temp'))
          && path.basename(owner.directory).startsWith('mineradio-video-'))
        await fs.promises.rm(owner.directory, {recursive:true, force:true}).catch(() => {});
      if (job === owner) job = null;
    }
  }
  async function start(event, payload) {
    if (!isTrusted(event)) return {ok:false, error:'UNTRUSTED_SENDER'};
    if (job) return {ok:false, error:'已有视频正在导出，请等待完成或取消'};
    let settings;
    try { settings = validate(payload); } catch (error) { return {ok:false, error:error.message}; }
    // Reserve before the dialog so two requests cannot open competing exports.
    const owner = {id:crypto.randomUUID(), sender:event.sender, canceled:false}; job = owner;
    try {
      const selected = await dialog.showSaveDialog(getOwner(), {title:'导出当前预设视频',
        defaultPath:String(payload.name || 'Mineradio.mp4').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,140), filters:[{name:'MP4 视频',extensions:['mp4']}]});
      if (selected.canceled || !selected.filePath || owner.canceled) { job = null; return {ok:false, canceled:true}; }
      owner.destination = selected.filePath.toLowerCase().endsWith('.mp4') ? selected.filePath : selected.filePath + '.mp4';
      latest = {status:'preparing', progress:0, jobId:owner.id}; state('preparing');
      owner.promise = run(owner, payload, settings);
      return {ok:true, jobId:owner.id};
    } catch (_) { job = null; return {ok:false, error:'无法选择视频保存位置'}; }
  }
  ipcMain.handle('mineradio-video-export-start', start);
  ipcMain.handle('mineradio-video-export-state', event => isTrusted(event) ? latest : {status:'error'});
  ipcMain.handle('mineradio-video-export-cancel', event => isTrusted(event) ? cancel() : {status:'error'});
  ipcMain.handle('mineradio-video-render-config', event => {
    if (!job || !job.window || event.sender !== job.window.webContents || event.senderFrame !== job.window.webContents.mainFrame)
      throw new Error('UNTRUSTED_RENDERER');
    return job.config;
  });
  return {start, cancel, getState:() => latest, wait:() => job ? job.promise : Promise.resolve()};
}

module.exports = {createVideoExporter, validate};

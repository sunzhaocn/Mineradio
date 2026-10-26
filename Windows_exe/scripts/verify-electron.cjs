'use strict';
// Acceptance checks run against the built executable and a separate disposable profile.
const { _electron } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'verification');
const executable = path.resolve(process.argv[2] || path.join(root, 'dist/win-unpacked/Mineradio.exe'));
fs.mkdirSync(output, { recursive: true });
const report = { executable: path.basename(executable), checks: {}, errors: [], finished: false };
const profile = path.join(output, `electron-profile-${process.pid}`);
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(path.join(profile, 'backend-ports.json'), JSON.stringify({ web:19380, api:19300 }));
const smokeFile = path.join(output, `startup-smoke-${process.pid}.json`);
const env = { ...process.env, MINERADIO_STARTUP_QA_HIDDEN: '1',
  MINERADIO_STARTUP_QA_USER_DATA: profile, MINERADIO_NO_DESKTOP_SHORTCUT: '1',
  MINERADIO_SMOKE_REPORT: smokeFile };
const systemRoot = process.env.SystemRoot || 'C:\\Windows';
env.PATH = [path.join(systemRoot, 'System32'), systemRoot,
  path.join(systemRoot, 'System32/WindowsPowerShell/v1.0')].join(path.delimiter);
delete env.ELECTRON_RUN_AS_NODE;
delete env.MINERADIO_STARTUP_QA_EXIT_MS;
let application;
let backendPid;

(async () => {
  try {
    application = await _electron.launch({ executablePath: executable, env, timeout: 90000 });
    const page = await application.firstWindow({ timeout: 60000 });
    page.on('pageerror', error => report.errors.push(error.message));
    await page.waitForURL(/http:\/\/127\.0\.0\.1:\d+\//, { timeout: 60000 });
    await page.waitForFunction(() => window.MINERADIO_MODULE_STATUS?.ready, { timeout: 60000 });
    if (await page.locator('#splash').isVisible()) {
      await page.waitForFunction(() => typeof splashReadyToEnter !== 'undefined' && splashReadyToEnter, { timeout: 20000 });
      await page.locator('#splash').click();
      await page.locator('#splash').waitFor({ state: 'hidden', timeout: 20000 });
    }
    report.checks.renderer = await page.evaluate(() => ({
      title: document.title, modules: window.MINERADIO_MODULE_STATUS.loaded,
      moduleError: window.MINERADIO_MODULE_STATUS.error,
      desktopBridge: typeof window.desktopWindow?.getState === 'function',
      localAuth: !!window.localMusicCredentials,
      nodeUnavailable: typeof window.require === 'undefined' && typeof window.process === 'undefined',
    }));
    assert.ok(report.checks.renderer.desktopBridge && report.checks.renderer.localAuth);
    assert.ok(report.checks.renderer.nodeUnavailable && !report.checks.renderer.moduleError);
    const savedBounds = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('http://127.0.0.1:')).getBounds());
    report.checks.headerResize = [];
    for (const width of [760, 900, 1100, 1440]) {
      await application.evaluate(({ BrowserWindow }, width) => {
        const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('http://127.0.0.1:'));
        win.setMinimumSize(760,560);win.setSize(width,720);
      }, width);
      await page.evaluate(() => document.getElementById('search-area').classList.add('peek'));
      await page.waitForTimeout(500);
      const bounds = await page.evaluate(() => {
        const a=document.getElementById('search-area').getBoundingClientRect(),b=document.getElementById('top-right').getBoundingClientRect();
        return {width:innerWidth,searchWidth:a.width,searchRight:a.right,actionsLeft:b.left,noOverlap:a.width>100&&a.right+8<=b.left};
      });
      assert(bounds.noOverlap);report.checks.headerResize.push(bounds);
    }
    await application.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('http://127.0.0.1:')).setBounds(bounds), savedBounds);
    const ports = JSON.parse(fs.readFileSync(path.join(profile, 'backend-ports.json'), 'utf8'));
    const smokeDeadline = Date.now() + 10000;
    while (!fs.existsSync(smokeFile) && Date.now() < smokeDeadline) await new Promise(resolve => setTimeout(resolve, 100));
    const smoke = JSON.parse(fs.readFileSync(smokeFile, 'utf8'));
    backendPid = smoke.backendPid;
    const health = await fetch(`http://127.0.0.1:${ports.api}/health`).then(response => response.json());
    report.checks.backend = { ok: health.ok, qishui: health.platforms.qishui,
      neteaseCrypto: health.platforms.netease.crypto };
    assert.equal(health.ok, true);
    assert.equal(health.platforms.qishui.sdk_available, true);
    assert.equal(health.platforms.qishui.node_available, true);
    assert.equal(health.platforms.qishui.ffmpeg_available, true);
    report.checks.search = await Promise.all(['', '/qq', '/kugou'].map(async provider => {
      const response = await fetch(`http://127.0.0.1:${ports.web}/api${provider}/search?keywords=test&limit=1`,
        { signal: AbortSignal.timeout(25000) });
      const data = await response.json();
      return { provider: provider.slice(1) || 'netease', status: response.status, songs: data.songs?.length || 0 };
    }));
    for (const result of report.checks.search) { assert.equal(result.status, 200); assert.ok(result.songs > 0); }
    report.checks.windowState = await page.evaluate(() => window.desktopWindow.getState());
    report.checks.security = await application.evaluate(({ BrowserWindow, app }) => {
      const win = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('http://127.0.0.1:'));
      const preferences = win.webContents.getLastWebPreferences();
      return { packaged: app.isPackaged,
        contextIsolation: preferences.contextIsolation, nodeIntegration: preferences.nodeIntegration };
    });
    assert.equal(report.checks.security.packaged, true);
    assert.equal(report.checks.security.contextIsolation, true);
    assert.equal(report.checks.security.nodeIntegration, false);
    // A real public MV must decode, follow the independent test audio clock,
    // and suspend the covered WebGL renderer. No account/playlist is changed.
    await page.evaluate(async () => {
      window.__mvVerification = { audio, playQueue, currentIdx, currentLocalSong, preset:fx.preset, render:renderer.render };
      const rate=16000, samples=rate*20, bytes=new Uint8Array(44+samples*2), view=new DataView(bytes.buffer);
      const text=(offset,value)=>{for(let i=0;i<value.length;i++)bytes[offset+i]=value.charCodeAt(i);};
      text(0,'RIFF');view.setUint32(4,bytes.length-8,true);text(8,'WAVEfmt ');view.setUint32(16,16,true);
      view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);
      view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,samples*2,true);
      audio=new Audio(URL.createObjectURL(new Blob([bytes],{type:'audio/wav'})));audio.muted=true;
      currentLocalSong=null;playQueue=[{provider:'qq',source:'qq',mid:'0039MnYb0qxYhV',id:'0039MnYb0qxYhV',name:'晴天',artist:'周杰伦'}];currentIdx=0;
      homeForcedOpen=false;homeSuppressed=true;startupRestoreHomePending=false;setHomeControlsLocked(false);
      updateEmptyHomeVisibility();openHomePlayerConsole();
      await audio.play();setPreset(13,{silent:true,noSave:true});
    });
    await page.waitForFunction(() => {
      const video=document.querySelector('#song-mv-layer video');return video&&video.readyState>=2&&video.videoWidth>0&&!video.paused&&video.currentTime>.2;
    },null,{timeout:65000});
    await page.evaluate(() => {window.__mvDraws=0;renderer.render=function(){window.__mvDraws++;return window.__mvVerification.render.apply(this,arguments);};});
    await page.waitForTimeout(1300);
    report.checks.mv = await page.evaluate(() => {
      const video=document.querySelector('#song-mv-layer video');
      return {decoded:true,width:video.videoWidth,height:video.videoHeight,clockDrift:Math.abs(video.currentTime-audio.currentTime),hiddenWebglDraws:window.__mvDraws};
    });
    assert(report.checks.mv.clockDrift<1.2);assert.equal(report.checks.mv.hiddenWebglDraws,0);
    await page.evaluate(() => {
      const saved=window.__mvVerification;audio.pause();URL.revokeObjectURL(audio.src);
      setPreset(saved.preset,{silent:true,noSave:true});renderer.render=saved.render;
      audio=saved.audio;playQueue=saved.playQueue;currentIdx=saved.currentIdx;currentLocalSong=saved.currentLocalSong;
      delete window.__mvVerification;
    });
    await page.evaluate(() => showLoginModal({ provider: 'netease' }));
    await page.locator('.local-auth-tabs').waitFor({ state: 'visible' });
    report.checks.loginUi = await page.locator('[data-local-provider]').evaluateAll(elements => elements.map(element => element.dataset.localProvider));
    assert.deepEqual(report.checks.loginUi, ['netease', 'qq', 'kugou', 'qishui']);
    await page.evaluate(() => closeLoginModal());

    // Real local audio goes through the same file input as the user imports.
    const audioFile = path.join(output, 'acceptance-tone.wav');
    execFileSync(path.join(root, 'build/tools/ffmpeg.exe'), ['-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=120', '-ar', '44100', audioFile], { windowsHide: true });
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().forEach(window => window.webContents.setAudioMuted(true));
    });
    await page.evaluate(() => { if (typeof audio !== 'undefined' && audio) audio.muted = true; });
    await page.locator('#file-input').setInputFiles(audioFile);
    await page.waitForFunction(() => typeof playQueue !== 'undefined' && playQueue.length > 0, { timeout: 30000 });
    const skipAnalysis = page.getByRole('button', { name: '暂不分析', exact: true });
    if (await skipAnalysis.isVisible()) await skipAnalysis.click();
    await page.evaluate(async () => {
      if (typeof audio !== 'undefined' && audio && audio.paused && audio.src) await audio.play();
    });
    await page.waitForFunction(() => typeof audio !== 'undefined' && audio && !audio.paused && audio.currentTime > 0.2, { timeout: 20000 });
    report.checks.localPlayback = await page.evaluate(() => ({
      paused: audio.paused, currentTime: audio.currentTime, readyState: audio.readyState,
      error: audio.error?.code || null, queueSize: playQueue.length,
    }));
    assert.equal(report.checks.localPlayback.error, null);
    await page.evaluate(() => { audio.pause(); });

    await page.evaluate(() => window.desktopWindow.setDesktopLyricsEnabled(true, { enabled: true,
      text: 'Mineradio 桌面歌词验证', currentLine: 'Mineradio 桌面歌词验证', title: '本地播放验证', playing: false }));
    await page.waitForTimeout(1000);
    report.checks.desktopLyrics = await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some(window => window.webContents.getURL().includes('desktop-lyrics.html')));
    assert.equal(report.checks.desktopLyrics, true);
    await page.evaluate(() => window.desktopWindow.setDesktopLyricsEnabled(false, { enabled: false }));
    await page.screenshot({ path: path.join(output, 'packaged-player.png') });
    report.checks.persistence = { origin: new URL(page.url()).origin, stablePorts: ports };
    // The actual packaged preset must reframe its 3D scene, including fog,
    // when its desktop window changes aspect ratio.
    if (await skipAnalysis.isVisible()) await skipAnalysis.click();
    await page.evaluate(async () => { audio.currentTime=0; await audio.play(); applyDiyMode(true,{save:false}); setPreset(8,{silent:true,noSave:true}); });
    await page.waitForFunction(() => document.querySelector('#sonic-workshop-layer iframe')?.contentWindow?.MineradioWorkshopViewport, null, {timeout:20000});
    await page.waitForTimeout(1200);
    const workshop = page.frames().find(frame => frame.url().includes('mineradio-bridge'));
    assert(workshop,'Workshop iframe remains mounted after the audio switch');
    await workshop.evaluate(() => {
      const api=MineradioWorkshopViewport, original=api.applyFog;
      api.applyFog=function(fog,distance){original(fog,distance); if(fog)window.__qaWorkshop={distance,near:fog.near,far:fog.far};};
      __mineradioApplyProperties({cameraDistance:80});
    });
    await workshop.waitForFunction(() => window.__qaWorkshop?.distance>80);
    const landscape=await workshop.evaluate(() => ({width:innerWidth,height:innerHeight,...__qaWorkshop}));
    await application.evaluate(({BrowserWindow}) => {
      const win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('http://127.0.0.1:'));
      win.setContentSize(700,900);
    });
    await workshop.waitForFunction(previous => window.__qaWorkshop?.distance>previous,landscape.distance);
    const narrower=await workshop.evaluate(() => ({width:innerWidth,height:innerHeight,...__qaWorkshop}));
    assert(narrower.width/narrower.height<landscape.width/landscape.height);
    assert.equal(Math.round(narrower.far-narrower.near),65);
    report.checks.workshopViewport={landscape,narrower};
    await page.waitForTimeout(1300);
    await page.screenshot({path:path.join(output,'packaged-workshop-narrower.png')});
    // Verify the shipped account UI with controlled expiry, after real media checks.
    const emptyHealth={};
    for(const provider of ['netease','qq','kugou','qishui']){
      const state=await page.evaluate(async provider=>await (await fetch('/api/local/account-status?provider='+provider)).json(),provider);
      assert.equal(state.authState,'logged_out');emptyHealth[provider]=state.authState;
    }
    const legacyDiagnostics=await page.evaluate(async()=>await (await fetch('/api/diagnostics/kugou')).json());
    assert.equal(legacyDiagnostics.events,undefined);
    let unintendedQr=0;
    await page.route('**/api/**',async route=>{
      const u=new URL(route.request().url());
      if(u.pathname==='/api/local/auth/session')unintendedQr++;
      return route.fulfill({json:u.pathname==='/api/local/account-status'
        ?{authState:'expired',reauthRequired:true,configured:true,checkFailed:false}
        :{ok:true,platforms:{},providers:{},playlists:[],songs:[],tracks:[]}});
    });
    await page.evaluate(()=>{
      localStorage.setItem('mineradio-local-accounts-v1',JSON.stringify(Object.fromEntries(['netease','qq','kugou','qishui'].map(provider=>[provider,{cookie:provider+'=synthetic-test',source:'authorized',account:{id:'42',name:'测试账号'}}]))));
      showLoginModal({provider:'kugou'});
    });
    const expiredPlatforms=[];
    for(const provider of ['netease','qq','kugou','qishui']){
      await page.evaluate(provider=>showLoginModal({provider}),provider);
      await page.locator(`[data-local-provider="${provider}"] small.expired`).waitFor();
      assert.equal(await page.locator(`[data-local-provider="${provider}"] small`).textContent(),'已失效');
      expiredPlatforms.push(provider);
    }
    assert.equal(unintendedQr,0);
    report.checks.accountHealth={noCookie:emptyHealth,expiredPlatforms,automaticQrRequests:unintendedQr,oldDiagnosticsRemoved:true};
    await page.screenshot({path:path.join(output,'packaged-account-expired.png')});
    report.finished = true;
  } catch (error) {
    report.failure = error.stack || String(error);
    try { report.failureState=await application.firstWindow().then(p=>p.evaluate(()=>({preset:fx.preset,paused:audio.paused,ended:audio.ended,time:audio.currentTime,frames:document.querySelectorAll('iframe').length}))); } catch (_) {}
    process.exitCode = 1;
  } finally {
    if (application) await application.close().catch(error => { report.closeError = String(error); });
    if (backendPid) {
      try { process.kill(backendPid, 0); report.checks.backendExited = false; }
      catch (_) { report.checks.backendExited = true; }
    }
    fs.writeFileSync(path.join(output, 'electron-acceptance.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
})();

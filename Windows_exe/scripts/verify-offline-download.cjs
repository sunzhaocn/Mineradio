'use strict';
// Runs the installed EXE with a disposable profile, without real account data.
const {_electron}=require('playwright');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),output=path.join(root,'verification');
const profile=path.join(output,`download-profile-${process.pid}`);
fs.mkdirSync(profile,{recursive:true});
fs.writeFileSync(path.join(profile,'backend-ports.json'),JSON.stringify({web:19480,api:19400}));
const executable=path.join(process.env.LOCALAPPDATA,'Programs/Mineradio/Mineradio.exe');
const report={ok:false,installedExecutable:true,disposableProfile:true,errors:[]};
let app,context;
(async()=>{
 try{
  const env={...process.env,MINERADIO_STARTUP_QA_HIDDEN:'1',MINERADIO_STARTUP_QA_USER_DATA:profile,MINERADIO_NO_DESKTOP_SHORTCUT:'1'};
  delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({executablePath:executable,env,timeout:90000});
  const page=await app.firstWindow({timeout:60000});context=page.context();
  page.on('pageerror',e=>report.errors.push(e.message));
  await page.waitForURL(/http:\/\/127\.0\.0\.1:19480\//,{timeout:60000});
  await page.waitForFunction(()=>window.MINERADIO_MODULE_STATUS?.ready,null,{timeout:60000});
  if(await page.locator('#splash').isVisible()){
   await page.waitForFunction(()=>typeof splashReadyToEnter!=='undefined'&&splashReadyToEnter);
   await page.locator('#splash').click();await page.locator('#splash').waitFor({state:'hidden'});
  }
  report.accountsAbsent=await page.evaluate(()=>['netease','qq','kugou','qishui'].every(p=>!localMusicCredentials.status(p)?.loggedIn));
  assert(report.accountsAbsent);
  const selection=await page.evaluate(async()=>{
   if(audio)audio.muted=true;
   const data=await apiJson('/api/search?keywords='+encodeURIComponent('普通人生 海洋Bo')+'&limit=3',{timeoutMs:40000});
   for(const song of data.songs||[]){
    const id=song.mid||song.hash||song.id;
    const response=await apiJson('/api/download/qualities?provider=netease&id='+encodeURIComponent(id),{timeoutMs:95000});
    const quality=response.qualities?.filter(q=>q.downloadable).at(-1);if(!quality)continue;
    playlist=[song];await openWebSongDownload(0,{currentTarget:document.getElementById('controls'),stopPropagation(){}});
    const menu=document.getElementById('web-download-menu');
    const button=Array.from(menu.querySelectorAll('[data-quality]')).find(b=>b.dataset.quality===quality.key);
    if(!button)throw Error('Missing download quality button');
    const lyricOption=Array.from(menu.querySelectorAll('button')).some(b=>/歌词/.test(b.textContent));
    button.click();return{originId:String(id),quality:quality.key,lyricOption};
   }
   throw Error('No downloadable public source');
  });
  report.selection=selection;
  assert(selection.lyricOption);
  const deadline=Date.now()+120000;
  while(!await page.evaluate(async id=>{const lib=await browserLocalMusic.listLocalMusicLibrary();return lib.tracks.some(s=>s.originId===id&&s.hasLyric&&s.cover?.startsWith('data:image/'));},selection.originId)){
   if(Date.now()>deadline)throw Error('Download did not enter persistent local music library');
   await page.waitForTimeout(500);
  }
  report.saved=await page.evaluate(async id=>{const lib=await browserLocalMusic.listLocalMusicLibrary(),s=lib.tracks.find(s=>s.originId===id);return{id:s.localFileId,hasLyric:s.hasLyric,coverSaved:s.cover.startsWith('data:image/')}} ,selection.originId);
  report.selection=selection;
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.MINERADIO_MODULE_STATUS?.ready);
  await context.setOffline(true);
  await page.evaluate(async id=>{
   const song=await browserLocalMusic.getLocalMusicTrack(id);if(audio)audio.muted=true;playQueue=[song];currentIdx=0;
   await playQueueAt(0,{manual:true,startPaused:false});
  },report.saved.id);
  await page.waitForFunction(()=>audio&&!audio.paused&&audio.currentTime>.3&&lyricsLines.length>0,null,{timeout:20000});
  report.offline=await page.evaluate(()=>({paused:audio.paused,time:audio.currentTime,lyricLines:lyricsLines.length,blob:audio.src.startsWith('blob:'),error:audio.error?.code||null}));
  assert(report.offline.blob&&!report.offline.paused&&!report.offline.error&&report.offline.lyricLines>0);
  report.ok=true;
 }catch(e){report.failure=e.stack||String(e);process.exitCode=1;}
 finally{
  if(context)await context.setOffline(false).catch(()=>{});
  if(app)await app.close().catch(()=>{});
  fs.writeFileSync(path.join(output,'offline-download.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }
})();

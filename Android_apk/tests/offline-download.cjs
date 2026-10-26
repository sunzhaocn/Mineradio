'use strict';
const {chromium}=require('../../Windows_exe/node_modules/playwright');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
let browser,context;
(async()=>{
 browser=await chromium.connectOverCDP('http://127.0.0.1:9223');context=browser.contexts()[0];
 const page=context.pages().find(p=>p.url().startsWith('http://127.0.0.1:18080'));
 await page.waitForFunction(()=>window.MINERADIO_MODULE_STATUS?.ready);
 const saved=await page.evaluate(async()=>{
  const data=await apiJson('/api/search?keywords='+encodeURIComponent('普通人生 海洋Bo')+'&limit=3',{timeoutMs:40000});
  for(const song of data.songs||[]){
   const id=song.mid||song.hash||song.id;
   const qualities=await apiJson('/api/download/qualities?provider=netease&id='+encodeURIComponent(id),{timeoutMs:95000});
   const quality=qualities.qualities?.filter(x=>x.downloadable).at(-1);if(!quality)continue;
   const before=await browserLocalMusic.listLocalMusicLibrary();window.__downloadBefore=new Set(before.tracks.map(s=>s.localFileId));
   webMobileNavigation.go('player');await new Promise(r=>setTimeout(r,200));
   const more=document.getElementById('web-player-more-btn');if(more.getAttribute('aria-expanded')!=='true')more.click();
   playlist=[song];await openWebSongDownload(0,{currentTarget:document.getElementById('web-download-btn'),stopPropagation(){}});
   const button=Array.from(document.querySelectorAll('#web-download-menu [data-quality]')).find(b=>b.dataset.quality===quality.key);
   if(!button)throw new Error('download quality button missing');button.click();
   return{originId:String(id),quality:quality.key,trial:String(quality.kind||'').includes('试听')};
  }
  throw new Error('No native downloadable source for the selected search');
 });
 const deadline=Date.now()+180000;
 while(!await page.evaluate(async id=>{
  const library=await browserLocalMusic.listLocalMusicLibrary();return library.tracks.some(s=>s.originId===id&&s.hasLyric&&s.cover?.startsWith('data:image/'));
 },saved.originId)){
  if(Date.now()>deadline)throw new Error('download did not enter the persistent library');
  await page.waitForTimeout(500);
 }
 const local=await page.evaluate(async id=>{
  const lib=await browserLocalMusic.listLocalMusicLibrary();const song=lib.tracks.find(s=>s.originId===id);
  return{id:song.localFileId,hasLyric:song.hasLyric,coverSaved:song.cover.startsWith('data:image/'),inLocalLibrary:true};
 },saved.originId);
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.MINERADIO_MODULE_STATUS?.ready);
 await context.setOffline(true);
 await page.evaluate(()=>{
  window.__offlineCredentialRestore=window.localMusicCredentials;
  window.localMusicCredentials=Object.assign({},window.localMusicCredentials,{status:()=>({loggedIn:false}),headers:()=>({}),url:url=>url});
 });
 const offlineRequests=[];page.on('request',req=>{if(req.url().includes('/api/'))offlineRequests.push(new URL(req.url()).pathname);});
 await page.evaluate(async id=>{
  if(window.audio)audio.pause();
  const song=await browserLocalMusic.getLocalMusicTrack(id);playQueue=[song];currentIdx=0;
  await playQueueAt(0,{manual:true,startPaused:false});webMobileNavigation.go('player');
 },local.id);
 await page.waitForFunction(()=>window.audio&&!audio.paused&&audio.currentTime>.3,null,{timeout:20000});
 await page.waitForFunction(()=>window.MineradioAndroid.hasArtwork(),null,{timeout:12000});
 const samples=await page.evaluate(()=>new Promise(resolve=>{
  const values=[],start=performance.now();function frame(){values.push({t:audio.currentTime,fill:parseFloat(document.getElementById('progress-fill').style.width)||0});
   if(performance.now()-start<1200)requestAnimationFrame(frame);else resolve(values);}requestAnimationFrame(frame);
 }));
 const after=await page.evaluate(()=>({time:audio.currentTime,paused:audio.paused,lyricLines:lyricsLines.length,nativeArtwork:MineradioAndroid.hasArtwork()}));
 assert(local.hasLyric&&local.coverSaved&&after.nativeArtwork&&!after.paused&&after.lyricLines>0);
 assert(samples.length>15);assert(samples.filter((s,i)=>i&&s.fill>samples[i-1].fill).length>10);
 assert.equal(offlineRequests.filter(p=>/song\/url|\/lyric|\/download|\/qualities/.test(p)).length,0,'offline local playback does not ask a platform for media or lyrics');
 await page.evaluate(()=>{window.localMusicCredentials=window.__offlineCredentialRestore;delete window.__offlineCredentialRestore;});
 await context.setOffline(false);
 const result={ok:true,...saved,...local,after,credentialsMaskedDuringOffline:true,accountStorageCleared:false,smoothSamples:samples.length,advancingSamples:samples.filter((s,i)=>i&&s.fill>samples[i-1].fill).length,offlinePlatformReads:offlineRequests};
 fs.writeFileSync(path.resolve('runtime/android-build/offline-download.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 await page.screenshot({path:path.resolve('runtime/android-build/offline-phone.png')});await browser.close();
})().catch(async error=>{console.error(error);if(context){for(const page of context.pages())await page.evaluate(()=>{if(window.__offlineCredentialRestore){window.localMusicCredentials=window.__offlineCredentialRestore;delete window.__offlineCredentialRestore;}}).catch(()=>{});await context.setOffline(false).catch(()=>{});}if(browser)await browser.close();process.exitCode=1;});

'use strict';
const{chromium}=require('../../Windows_exe/node_modules/playwright'),{execFileSync}=require('child_process'),fs=require('fs'),assert=require('node:assert/strict');
const adb='C:/Users/Administrator/AppData/Local/Android/Sdk/platform-tools/adb.exe';
function device(...args){return execFileSync(adb,['-s','3B15BJ0011500000',...args],{encoding:'utf8',windowsHide:true});}
let browser;
(async()=>{
 browser=await chromium.connectOverCDP('http://127.0.0.1:9223');const page=browser.contexts()[0].pages().find(p=>p.url().startsWith('http://127.0.0.1:18080'));
 await page.evaluate(async()=>{
  const library=await browserLocalMusic.listLocalMusicLibrary(),song=library.tracks.find(s=>s.originId==='2041799838');
  if(!song)throw new Error('Downloaded local record missing');playQueue=[song];currentIdx=0;
  await playQueueAt(0,{manual:true,startPaused:false});webMobileNavigation.go('player');
 });
 await page.waitForFunction(()=>audio&&!audio.paused&&audio.currentTime>.1);const before=await page.evaluate(()=>audio.currentTime);
 device('shell','input','keyevent','KEYCODE_HOME');await page.waitForTimeout(6500);
 const background=await page.evaluate(()=>({time:audio.currentTime,paused:audio.paused,hidden:document.hidden,artwork:MineradioAndroid.hasArtwork()}));
 assert(background.hidden&&!background.paused&&background.time>before+4&&background.artwork);
 device('shell','cmd','media_session','dispatch','pause');await page.waitForFunction(()=>audio.paused);
 device('shell','cmd','media_session','dispatch','play');await page.waitForFunction(()=>!audio.paused);
 const result={ok:true,downloadedLocal:true,background,systemPauseResume:true};fs.writeFileSync('runtime/android-build/background-downloaded.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{device('shell','am','start','-n','dev.mineradio.android/.MainActivity');if(browser)await browser.close();});

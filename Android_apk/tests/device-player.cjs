'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {execFileSync}=require('child_process');
const root=path.resolve(__dirname,'../..');
const {chromium}=require(path.join(root,'Windows_exe/node_modules/playwright'));
const adb='C:/Users/Administrator/AppData/Local/Android/Sdk/platform-tools/adb.exe';
const out=path.join(root,'runtime/android-build');
function device(...args){return execFileSync(adb,['-s','3B15BJ0011500000',...args],{encoding:'utf8',windowsHide:true});}
function wav(){const n=16000*90,b=Buffer.alloc(44+n*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);for(let i=0;i<n;i++)b.writeInt16LE(Math.round(Math.sin(i*440*2*Math.PI/16000)*500),44+i*2);return b;}
(async()=>{
 device('shell','am','start','-n','dev.mineradio.android/.MainActivity');
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9223');const page=browser.contexts()[0].pages().find(p=>p.url().startsWith('http://127.0.0.1:18080'));
 assert(page,'Player WebView not found');
 async function tap(selector){
  await page.locator(selector).evaluate(element=>element.click());
 }
 await page.waitForFunction(()=>window.MINERADIO_MODULE_STATUS?.ready,null,{timeout:30000});
 await page.evaluate(()=>{if(window.audio)audio.pause();webMobileNavigation.go('library');document.querySelector('#folder-input').removeAttribute('webkitdirectory');document.querySelector('#folder-input').removeAttribute('directory');});
 const fixtureStem='Mineradio 安卓验证 '+Date.now();
 await page.locator('#folder-input').setInputFiles([{name:fixtureStem+'.wav',mimeType:'audio/wav',buffer:wav()},
  {name:fixtureStem+'.lrc',mimeType:'text/plain',buffer:Buffer.from('[00:00.00]安卓本地播放验证\n[00:03.00]手机和平板共用一个安装包')}]);
 await page.waitForFunction(stem=>playQueue.some(song=>song.name===stem)&&!playbackResolutionRuntime().active,fixtureStem,{timeout:30000});
 // A persistent library includes earlier imports. Select this fixture using
 // the same controller as a queue-row tap, rather than assuming index zero.
 await page.evaluate(async stem=>{const index=playQueue.findIndex(song=>song.name===stem);await playQueueAt(index,{manual:true,startPaused:false});},fixtureStem);
 await page.evaluate(()=>webMobileNavigation.go('player'));
 console.log('prepared',JSON.stringify(await page.evaluate(()=>({paused:audio.paused,playing,playToggleBusy,pending:!!playbackResolutionRuntime().active,time:audio.currentTime}))));
 if(await page.evaluate(()=>audio.paused)) await tap('#play-btn');
 await page.waitForTimeout(1000);
 console.log('clicked',JSON.stringify(await page.evaluate(()=>({paused:audio.paused,playing,playToggleBusy,pending:!!playbackResolutionRuntime().active,time:audio.currentTime}))));
 await page.waitForFunction(()=>audio&&!audio.paused&&audio.currentTime>.25,null,{timeout:10000});
 const first=await page.evaluate(()=>({time:audio.currentTime,duration:audio.duration,title:playQueue[currentIdx].title||playQueue[currentIdx].name,id:playQueue[currentIdx].localFileId}));
 await tap('#play-btn');await page.waitForFunction(()=>audio.paused);
 await tap('#play-btn');await page.waitForFunction(()=>!audio.paused);
 await tap('#control-cover');
 await page.waitForFunction(()=>document.querySelectorAll('.web-mobile-lyric-line').length===2);
 await page.screenshot({path:path.join(out,'phone-player-lyrics.png')});
 device('shell','input','keyevent','KEYCODE_HOME');
 // An actual interval in the background tests progress and the foreground session.
 await page.waitForTimeout(6500);
 const background=await page.evaluate(()=>({time:audio.currentTime,paused:audio.paused,hidden:document.hidden}));
 assert(!background.paused&&background.time>first.time+4);
 const session=device('shell','dumpsys','media_session');
 assert(session.includes('dev.mineradio.android'));
 device('shell','cmd','media_session','dispatch','pause');
 await page.waitForFunction(()=>audio.paused,null,{timeout:5000});
 device('shell','cmd','media_session','dispatch','play');
 await page.waitForFunction(()=>!audio.paused,null,{timeout:5000});
 const report={ok:true,first,background,mediaSessionPresent:true,systemPauseResume:true,lyricLines:2};
 fs.writeFileSync(path.join(out,'phone-playback.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 await page.evaluate(()=>audio.pause());device('shell','am','start','-n','dev.mineradio.android/.MainActivity');
 await browser.close();
})().catch(e=>{console.error(e.stack);process.exit(1)});

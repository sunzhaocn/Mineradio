'use strict';
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {chromium}=require('../../Windows_exe/node_modules/playwright');
const out=path.resolve('runtime/android-build');
let connection;
(async()=>{
 const browser=connection=await chromium.connectOverCDP('http://127.0.0.1:9223');
 const page=browser.contexts()[0].pages().find(p=>p.url().startsWith('http://127.0.0.1:18080'));
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.waitForFunction(()=>window.MINERADIO_MODULE_STATUS?.ready,null,{timeout:60000});
 const accounts=await page.evaluate(()=>['netease','qq','kugou','qishui'].map(provider=>({provider,loggedIn:!!window.localMusicCredentials?.status(provider)?.loggedIn})));
 const layout=await page.evaluate(async()=>{
  webMobileNavigation.go('player');await new Promise(r=>setTimeout(r,200));
  if(document.body.classList.contains('web-mobile-lyrics-open')){document.getElementById('lyrics-toggle-btn').click();await new Promise(r=>setTimeout(r,550));}
  const cover=document.getElementById('control-cover'),more=document.getElementById('web-player-more-btn');
  more.click();await new Promise(r=>setTimeout(r,200));
  const stage=document.getElementById('web-player-stage'),panel=document.getElementById('web-player-more');
  const opened={stageHidden:getComputedStyle(stage).visibility==='hidden',inert:stage.inert,
    expanded:more.getAttribute('aria-expanded')==='true',panelTop:panel.getBoundingClientRect().top,
    fullscreenVisible:Array.from(document.querySelectorAll('.fullscreen-toggle-btn')).some(e=>e.getBoundingClientRect().width>0),
    volumeVisible:document.getElementById('volume-slider').getBoundingClientRect().width>0,
    fadePresent:!!document.getElementById('fade-in-slider'),volume:targetVolume};
  more.click();cover.click();await new Promise(r=>setTimeout(r,100));
  const before={cover:Number(getComputedStyle(cover).opacity),lyrics:Number(getComputedStyle(document.getElementById('web-mobile-lyrics')).opacity)};
  await new Promise(r=>setTimeout(r,450));
  const after={cover:Number(getComputedStyle(cover).opacity),lyrics:Number(getComputedStyle(document.getElementById('web-mobile-lyrics')).opacity),hint:!!document.querySelector('.web-mobile-lyric-hint')};
  more.click();const fromLyrics={hidden:getComputedStyle(stage).visibility==='hidden',lyricsStillSelected:document.body.classList.contains('web-mobile-lyrics-open')};
  more.click();document.querySelector('.web-mobile-lyric-list').click();await new Promise(r=>setTimeout(r,100));
  const reverse={cover:Number(getComputedStyle(cover).opacity),lyrics:Number(getComputedStyle(document.getElementById('web-mobile-lyrics')).opacity)};
  await new Promise(r=>setTimeout(r,450));
  const reversed={cover:Number(getComputedStyle(cover).opacity),lyrics:Number(getComputedStyle(document.getElementById('web-mobile-lyrics')).opacity)};
  return{opened,before,after,fromLyrics,reverse,reversed};
 });
 assert(layout.opened.stageHidden&&layout.opened.inert&&layout.opened.expanded);
 assert(layout.opened.panelTop>=0);assert(!layout.opened.fullscreenVisible&&!layout.opened.volumeVisible);
 assert.equal(layout.opened.volume,1);assert(layout.opened.fadePresent);
 if(!layout.before.cover || layout.before.cover>=1 || layout.before.lyrics>=.02)console.log(JSON.stringify({layout,accounts}));
 assert(layout.before.cover>0&&layout.before.cover<1&&layout.before.lyrics<.02,'cover fades before lyrics begin');
 assert(layout.after.cover<.02&&layout.after.lyrics>.98&&!layout.after.hint);
 assert(layout.fromLyrics.hidden&&layout.fromLyrics.lyricsStillSelected);
 assert(layout.reverse.cover<.02&&layout.reverse.lyrics>0&&layout.reverse.lyrics<1);
 assert(layout.reversed.cover>.98&&layout.reversed.lyrics<.02);
 const result={ok:true,accounts,layout,errors};
 fs.writeFileSync(path.join(out,'update-device.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 await page.screenshot({path:path.join(out,'update-phone-lyrics.png')});await browser.close();
})().catch(async e=>{console.error(e);if(connection)await connection.close();process.exitCode=1;});

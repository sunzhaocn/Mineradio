'use strict';
const{chromium}=require('../../Windows_exe/node_modules/playwright'),fs=require('fs'),assert=require('node:assert/strict');
let browser,page;
(async()=>{
 browser=await chromium.connectOverCDP('http://127.0.0.1:9223');page=browser.contexts()[0].pages().find(p=>p.url().startsWith('http://127.0.0.1:18080'));
 await page.waitForFunction(()=>window.MINERADIO_MODULE_STATUS?.ready,null,{timeout:60000});
 assert.equal(await page.evaluate(()=>mineradioAndroidProfile),'tablet');
 if(await page.evaluate(()=>document.body.classList.contains('splash-active'))){await page.waitForTimeout(1800);await page.locator('#splash').evaluate(e=>e.click());}
 await page.waitForFunction(()=>!document.body.classList.contains('splash-active'));
 await page.evaluate(async()=>{
  window.__mvTest={audio,playQueue,currentIdx,currentLocalSong,preset:fx.preset,render:renderer.render};
  const rate=8000,samples=rate*90,bytes=new Uint8Array(44+samples*2),v=new DataView(bytes.buffer);
  const text=(o,s)=>{for(let i=0;i<s.length;i++)bytes[o+i]=s.charCodeAt(i);};
  text(0,'RIFF');v.setUint32(4,bytes.length-8,true);text(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);
  v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,samples*2,true);
  audio=new Audio(URL.createObjectURL(new Blob([bytes],{type:'audio/wav'})));audio.muted=true;currentLocalSong=null;
  playQueue=[{provider:'netease',source:'netease',id:'347230',name:'海阔天空',artist:'Beyond'}];currentIdx=0;
  await audio.play();setPreset(13,{silent:true,noSave:true});
 });
 await page.waitForFunction(()=>{const v=document.querySelector('#song-mv-layer video');return v?.readyState>=2&&v.videoWidth>0&&!v.paused&&v.currentTime>.1;},null,{timeout:65000});
 await page.evaluate(()=>{window.__mvTestDraws=0;renderer.render=function(){window.__mvTestDraws++;return window.__mvTest.render.apply(this,arguments);};});
 await page.waitForTimeout(1300);
 const result=await page.evaluate(()=>{const v=document.querySelector('#song-mv-layer video');return{ok:true,profile:mineradioAndroidProfile,decoded:true,width:v.videoWidth,height:v.videoHeight,clockDrift:Math.abs(v.currentTime-audio.currentTime),webglDrawsWhileVideoActive:window.__mvTestDraws};});
 assert(result.clockDrift<1.3);assert.equal(result.webglDrawsWhileVideoActive,0);
 fs.writeFileSync('runtime/android-build/tablet-mv.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
 if(page)await page.evaluate(()=>{const s=window.__mvTest;if(!s)return;audio.pause();URL.revokeObjectURL(audio.src);setPreset(s.preset,{silent:true,noSave:true});renderer.render=s.render;audio=s.audio;playQueue=s.playQueue;currentIdx=s.currentIdx;currentLocalSong=s.currentLocalSong;delete window.__mvTest;}).catch(()=>{});
 if(browser)await browser.close();
});

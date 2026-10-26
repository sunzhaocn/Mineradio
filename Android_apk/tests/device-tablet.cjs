'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{execFileSync}=require('child_process');
const root=path.resolve(__dirname,'../..'),{chromium}=require(path.join(root,'Windows_exe/node_modules/playwright'));
const adb='C:/Users/Administrator/AppData/Local/Android/Sdk/platform-tools/adb.exe';
const out=path.join(root,'runtime/android-build');
function device(...args){return execFileSync(adb,['-s','3B15BJ0011500000',...args],{encoding:'utf8',windowsHide:true});}
(async()=>{
 device('shell','am','start','-n','dev.mineradio.android/.MainActivity');
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9223');
 const page=browser.contexts()[0].pages().find(p=>p.url().startsWith('http://127.0.0.1:18080'));
 assert(page);const errors=[];page.on('pageerror',e=>errors.push(e.stack||e.message));
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.MINERADIO_MODULE_STATUS?.ready,null,{timeout:60000});
 if(await page.evaluate(()=>document.body.classList.contains('splash-active'))){
  await page.waitForTimeout(1800);
  const screen=execFileSync(adb,['-s','3B15BJ0011500000','exec-out','screencap','-p'],{maxBuffer:16*1024*1024});
  device('shell','input','tap',String(Math.round(screen.readUInt32BE(16)/2)),String(Math.round(screen.readUInt32BE(20)/2)));
 }
 await page.waitForFunction(()=>!document.body.classList.contains('splash-active'),null,{timeout:30000});
 await page.evaluate(()=>{window.__androidRenderCalls=0;const original=renderer.render;renderer.render=function(){window.__androidRenderCalls++;return original.apply(this,arguments)};});
 const before=await page.evaluate(()=>({profile:mineradioAndroidProfile,simple:mineradioSimplePlayer.active(),rendererSimple:!!renderer.isSimplePlayerRenderer,
  mobileNav:webMobileNavigation.active(),width:innerWidth,height:innerHeight,frames:renderPerfState.frames,
  drawingBuffer:[renderer.getContext().drawingBufferWidth,renderer.getContext().drawingBufferHeight],moduleError:MINERADIO_MODULE_STATUS.error}));
 assert.equal(before.profile,'tablet');assert(!before.simple&&!before.rendererSimple&&!before.mobileNav);assert(before.width>900);assert(before.drawingBuffer[0]>0);
 await page.waitForFunction(()=>window.__androidRenderCalls>5,null,{timeout:10000});
 fs.writeFileSync(path.join(out,'tablet-desktop-effects.png'),execFileSync(adb,['-s','3B15BJ0011500000','exec-out','screencap','-p'],{maxBuffer:16*1024*1024}));
 device('shell','input','keyevent','KEYCODE_HOME');
 await page.waitForFunction(()=>!MineradioAndroid.isForeground()&&document.hidden,null,{timeout:5000});
 const frames=await page.evaluate(()=>window.__androidRenderCalls);
 await page.waitForTimeout(1500);
 const background=await page.evaluate(()=>({nativeForeground:MineradioAndroid.isForeground(),hidden:document.hidden,frames:window.__androidRenderCalls}));
 assert(!background.nativeForeground&&background.hidden);
 assert(background.frames-frames<3,'Background WebGL kept drawing');
 device('shell','am','start','-n','dev.mineradio.android/.MainActivity');
 await page.waitForFunction(n=>!document.hidden&&window.__androidRenderCalls>n+5,background.frames,{timeout:10000});
 const result={ok:true,scope:'Real phone configured temporarily with Android wm 1600x1000/160dpi; automatic tablet detection. Not a physical tablet test.',before,background,backgroundDrawingDelta:background.frames-frames,resumed:true,errors};
 fs.writeFileSync(path.join(out,'tablet-layout.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));await browser.close();
})().catch(e=>{console.error(e.stack);process.exit(1)});

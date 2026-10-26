const fs=require('fs'),{chromium}=require('../../Windows_exe/node_modules/playwright');
(async()=>{
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9223');const page=browser.contexts()[0].pages()[0];
 await page.evaluate(()=>{
  window.__pauseCalls=[];window.__audioDebug=[];
  if(!HTMLMediaElement.prototype.__originalPause){HTMLMediaElement.prototype.__originalPause=HTMLMediaElement.prototype.pause;HTMLMediaElement.prototype.pause=function(){window.__pauseCalls.push(new Error().stack.split('\n').slice(1,7));return this.__originalPause()};}
  ['play','playing','pause','ended','error','emptied','waiting'].forEach(name=>audio?.addEventListener(name,()=>window.__audioDebug.push({name,time:audio?.currentTime,date:Date.now()})));
  webMobileNavigation.go('player');
 });
 const before=await page.evaluate(()=>({paused:audio?.paused,ready:audio?.readyState,playing,playToggleBusy,local:!!playQueue[currentIdx]?.localFileId}));
 if(before.paused) await page.locator('#play-btn').click();
 await page.waitForTimeout(3500);
 const after=await page.evaluate(()=>({paused:audio?.paused,ready:audio?.readyState,playing,playToggleBusy,time:audio?.currentTime,error:audio?.error?.code,playError:audio?.__mineradioLastPlayError||'',calls:window.__pauseCalls,events:window.__audioDebug}));
 console.log(JSON.stringify({before,after},null,2));fs.writeFileSync('runtime/android-build/playback-debug.json',JSON.stringify({before,after},null,2));await browser.close();
})().catch(e=>{console.error(e.message);process.exit(1)});

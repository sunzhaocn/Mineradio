'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const root = path.resolve(__dirname, '../..');
const {chromium} = require(path.join(root, 'Windows_exe/node_modules/playwright'));
const output = path.join(root,'runtime/android-build');
fs.mkdirSync(output,{recursive:true});
(async()=>{
 const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
 const page = browser.contexts()[0].pages().find(p=>p.url().startsWith('http://127.0.0.1:18080'));
 assert(page,'Player WebView not found');
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.waitForFunction(()=>window.MINERADIO_MODULE_STATUS?.ready,null,{timeout:60000});
 const observed = await page.evaluate(()=>({profile:window.mineradioAndroidProfile,android:window.__mineradioAndroid,
   href:location.origin,width:innerWidth,height:innerHeight,ready:MINERADIO_MODULE_STATUS,
   simple:mineradioSimplePlayer.active(),rendererSimple:!!renderer.isSimplePlayerRenderer,
   mobileNav:webMobileNavigation.active(),frames:renderPerfState.frames,
   nav:Array.from(document.querySelectorAll('#web-mobile-nav button')).map(e=>e.dataset.mobileDestination),
   localInput:!!document.querySelector('#folder-input')}));
 assert(observed.android);assert.equal(observed.profile,'phone');assert(observed.simple && observed.rendererSimple && observed.mobileNav);
 const health = await page.evaluate(async()=>{const r=await fetch('/__health');return await r.json()});assert(health.ok);
 await page.screenshot({path:path.join(output,'phone-home.png')});
 fs.writeFileSync(path.join(output,'phone-startup.json'),JSON.stringify({observed,health,errors},null,2));
 console.log(JSON.stringify({ok:true,observed,errors}));
 await browser.close();
})().catch(e=>{console.error(e.stack);process.exit(1)});

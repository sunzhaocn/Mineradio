/* Real Chromium scene/profile integration with synthetic APIs. This is host
 * validation, not evidence that UIKit/WKWebView or real iPad audio passed. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const http=require('node:http'),net=require('node:net'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
const {chromium}=require(path.join(root,'Windows_exe/node_modules/playwright'));
const layout=fs.readFileSync(path.join(root,'iOS_ipa/assets/ios-layout.js'),'utf8');
const mode=fs.readFileSync(path.join(root,'web/player/js/features/mobile/mobile-simple-mode.js'),'utf8');
const output=path.join(root,'runtime/ios-layout-host');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const report={passed:false,environment:'Windows Chromium (not WKWebView)',cases:[]};
let server,browser;
async function port(){return new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});}
async function ready(origin){return new Promise(resolve=>{const r=http.get(origin+'/__health',res=>{res.resume();resolve(res.statusCode===200);});r.on('error',()=>resolve(false));r.setTimeout(500,()=>r.destroy());});}
async function scenario(origin,deviceFamily,width,height){
  const errors=[],context=await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true});
  await context.addInitScript(config=>{
    window.mineradioIOSLayout=config;window.__layoutWebGL=[];
    const original=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(kind,...args){
      if(/^(webgl2?|experimental-webgl)$/.test(kind))window.__layoutWebGL.push(kind);
      return original.call(this,kind,...args);
    };
  },{deviceFamily,windowWidth:width,windowHeight:height,contentWidth:width});
  await context.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(!url.href.startsWith(origin)&&!['blob:','data:'].includes(url.protocol))return route.abort();
    if(url.pathname==='/js/features/mobile/mobile-simple-mode.js')
      return route.fulfill({status:200,contentType:'text/javascript',body:layout+'\n'+mode});
    if(url.pathname.startsWith('/api/'))return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,code:200,playlists:[],tracks:[],songs:[],dailySongs:[],items:[],platforms:{},data:[]})});
    return route.continue();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.MINERADIO_MODULE_STATUS?.ready,null,{timeout:60000});
  await page.waitForTimeout(700);
  const first=await page.evaluate(()=>({simple:mineradioSimplePlayer.active(),atStartup:mineradioSimplePlayer.atStartup,
    stub:!!renderer.isSimplePlayerRenderer,webgl:__layoutWebGL.length,shelf:!!shelfManager,
    scheduled:mainLoopAnimationRequested,modules:{...MINERADIO_MODULE_STATUS},viewport:innerWidth,
    splash:document.body.classList.contains('splash-active')}));
  assert.equal(first.simple,true);assert.equal(first.atStartup,deviceFamily==='iphone');
  assert.equal(first.stub,deviceFamily==='iphone');
  assert.equal(first.scheduled,false);assert.equal(first.modules.loaded,first.modules.total);
  if(deviceFamily==='iphone')assert.equal(first.webgl,0);
  else {assert(first.webgl>0);assert(first.shelf);}
  await page.evaluate(()=>{
    window.__layoutRefs={renderer,audio,playQueue,playlist};
    const canvas=document.createElement('canvas');canvas.width=canvas.height=32;
    const drawing=canvas.getContext('2d');drawing.fillStyle='#ff8833';drawing.fillRect(0,0,32,32);
    applyCoverCanvas(canvas,canvas.toDataURL('image/png'));
  });
  let expanded=null;
  if(deviceFamily==='ipad'){
    await page.setViewportSize({width:1024,height:768});
    await page.evaluate(()=>mineradioIOSApplyLayout({deviceFamily:'ipad',windowWidth:1024,windowHeight:768,contentWidth:1024}));
    await page.waitForTimeout(700);
    expanded=await page.evaluate(()=>({simple:mineradioSimplePlayer.active(),stub:!!renderer.isSimplePlayerRenderer,
      sameRenderer:renderer===__layoutRefs.renderer,sameAudio:audio===__layoutRefs.audio,
      sameQueue:playQueue===__layoutRefs.playQueue,samePlaylist:playlist===__layoutRefs.playlist,
      scheduled:mainLoopAnimationRequested,webgl:__layoutWebGL.length,viewport:innerWidth,
      hasCover:uniforms.uHasCover.value}));
    assert.equal(expanded.simple,false);assert.equal(expanded.stub,false);
    for(const name of ['sameRenderer','sameAudio','sameQueue','samePlaylist'])assert.equal(expanded[name],true);
    assert.equal(expanded.webgl,first.webgl,'expansion cannot replace real renderer');
    assert.equal(expanded.scheduled,true);
    assert.equal(expanded.hasCover,1,'compact artwork is restored into the full visual scene');
  }
  assert.deepEqual(errors,[]);
  const login=[];
  for(const provider of ['netease','qq','kugou']){
    await page.evaluate(provider=>{window.__mineradioIOS=true;showLoginModal({provider});},provider);
    const button=page.locator('#local-auth-open-official');
    await button.waitFor({state:'visible'});
    await page.waitForTimeout(500);
    await button.scrollIntoViewIfNeeded();
    const rect=await button.boundingBox();
    assert(rect&&rect.width>0&&rect.x>=0&&rect.x+rect.width<=await page.evaluate(()=>innerWidth)+1);
    if(provider!=='netease')assert.match(await button.textContent(),/账号密码/);
    login.push({provider,officialButtonVisible:true,button:await button.textContent()});
  }
  fs.mkdirSync(output,{recursive:true});
  await page.screenshot({path:path.join(output,deviceFamily+'-official-login.png')});
  report.cases.push({deviceFamily,first,expanded,errors,login,loginEnvironment:'Synthetic API responses; no real native login or account authorization'});
  await context.close();
}
(async()=>{
  try{
    const web=await port(),api=await port(),origin='http://127.0.0.1:'+web;
    server=spawn('python',['-B','-X','utf8','main.py','--mode','web','--web-port',String(web),'--api-port',String(api)],
      {cwd:root,windowsHide:true,stdio:'ignore',env:{...process.env,MINERADIO_CLIENT_ASSET_INIT:'0'}});
    const deadline=Date.now()+20000;
    while(!await ready(origin)){if(Date.now()>deadline||server.exitCode!==null)throw Error('Isolated server did not start');await sleep(100);}
    const cache=path.join(process.env.LOCALAPPDATA,'ms-playwright');
    const executable=fs.readdirSync(cache).filter(n=>/^chromium-\d+$/.test(n)).sort((a,b)=>Number(b.split('-')[1])-Number(a.split('-')[1]))
      .map(n=>path.join(cache,n,'chrome-win64/chrome.exe')).find(f=>fs.existsSync(f));
    browser=await chromium.launch({executablePath:executable,headless:true,args:['--autoplay-policy=no-user-gesture-required','--mute-audio']});
    await scenario(origin,'iphone',932,430);
    await scenario(origin,'ipad',375,1024);
    report.passed=true;
  }catch(error){report.error=error.stack;process.exitCode=1;}
  finally{
    if(browser)await browser.close();if(server)server.kill();
    fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
  }
})();

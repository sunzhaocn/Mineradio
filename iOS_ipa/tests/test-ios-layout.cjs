/* Execute the shipped optional controller and shared mode. UIKit/WebKit remain
 * simulator/device verification; this proves state and bootstrap contracts. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'../..');
const layout=fs.readFileSync(path.join(root,'iOS_ipa/assets/ios-layout.js'),'utf8');
const mode=fs.readFileSync(path.join(root,'web/player/js/features/mobile/mobile-simple-mode.js'),'utf8');
function context(config,{mobile=true,desktop=false}={}){
  const events=new Map(),frames=[],classes=new Set();
  const meta={content:'',setAttribute(name,value){this[name]=value;}};
  let wake=0,reload=0,pauses=0,canvasContexts=0;
  const media={matches:mobile,addEventListener(_,fn){this.change=fn;}};
  const ctx={console,Event:class{constructor(type){this.type=type;}},
    location:{search:'',reload(){reload++;}},
    document:{documentElement:{dataset:{},classList:{toggle(name,on){on?classes.add(name):classes.delete(name);}}},
      querySelector(){return meta;},getElementById(){return null;},createElement(){return {setAttribute(){},getContext(){canvasContexts++;}};}},
    screen:{width:390,height:844},innerWidth:390,innerHeight:844,
    desktopWindow:desktop?{isDesktop:true}:null,
    addEventListener(type,fn){if(!events.has(type))events.set(type,[]);events.get(type).push(fn);},
    dispatchEvent(event){for(const fn of events.get(event.type)||[])fn(event);},
    matchMedia(){return media;},requestAnimationFrame(fn){frames.push(fn);},
    wakeMainLoopFromBackground(){wake++;},setTimeout(fn){frames.push(fn);},
    audio:{pause(){pauses++;}},playQueue:[{id:'keep'}],playlist:[{id:'keep'}]};
  ctx.window=ctx;
  vm.createContext(ctx);
  if(config){ctx.mineradioIOSLayout=config;vm.runInContext(layout,ctx);}
  vm.runInContext(mode,ctx);
  return {ctx,media,meta,classes,flush(){while(frames.length)frames.shift()();},
    counts(){return {wake,reload,pauses,canvasContexts};}};
}
function config(deviceFamily,windowWidth,windowHeight){return {deviceFamily,windowWidth,windowHeight,contentWidth:windowWidth};}
{
  const f=context(config('iphone',932,430),{mobile:false}),w=f.ctx;
  assert.equal(w.mineradioSimplePlayer.atStartup,true);
  assert.equal(w.mineradioSimplePlayer.active(),true);
  assert.match(f.meta.content,/width=880,/);
  const renderer=w.mineradioSimplePlayer.atStartup?w.mineradioSimplePlayer.createRenderer():null;
  assert.equal(renderer.isSimplePlayerRenderer,true);
  const audio=w.audio,queue=w.playQueue,playlist=w.playlist;
  assert.equal(w.mineradioIOSApplyLayout(config('iphone',430,932)),true);
  f.flush();
  assert.equal(w.mineradioSimplePlayer.active(),true);
  assert.equal(w.audio,audio);assert.equal(w.playQueue,queue);assert.equal(w.playlist,playlist);
  assert.deepEqual(f.counts(),{wake:0,reload:0,pauses:0,canvasContexts:0});
}
{
  const f=context(config('ipad',375,1024)),w=f.ctx;
  assert.equal(w.mineradioSimplePlayer.atStartup,false,'iPad always builds real scene resources');
  assert.equal(w.mineradioSimplePlayer.active(),false,'bootstrap cannot select simple stub');
  const renderer=w.mineradioSimplePlayer.atStartup?w.mineradioSimplePlayer.createRenderer():{real:true};
  w.renderer=renderer;
  w.dispatchEvent(new w.Event('mineradio:ready'));
  assert.equal(w.mineradioSimplePlayer.active(),true,'compact stops drawing after startup');
  assert(f.classes.has('mobile-simple-player'));
  const audio=w.audio,queue=w.playQueue,playlist=w.playlist;
  for(let n=0;n<3;n++){
    assert.equal(w.mineradioIOSApplyLayout(config('ipad',1024,768)),true);f.flush();
    assert.equal(w.mineradioSimplePlayer.active(),false);assert.equal(w.renderer,renderer);
    assert.equal(w.mineradioIOSApplyLayout(config('ipad',375,1024)),true);f.flush();
    assert.equal(w.mineradioSimplePlayer.active(),true);assert.equal(w.renderer,renderer);
  }
  assert.equal(w.audio,audio);assert.equal(w.playQueue,queue);assert.equal(w.playlist,playlist);
  assert(f.counts().wake>=3);
  assert.equal(f.counts().reload,0);assert.equal(f.counts().pauses,0);
  assert.equal(w.mineradioIOSApplyLayout(config('iphone',390,844)),false,'cannot change resource bootstrap family');
  assert.equal(w.mineradioIOSApplyLayout(config('ipad',10001,800)),false);
  assert.equal(w.mineradioIOSApplyLayout(config('ipad',NaN,800)),false);
}
{
  const f=context(null),w=f.ctx;
  assert.equal(w.mineradioSimplePlayer.atStartup,true);
  f.media.matches=false;f.media.change();
  assert.equal(w.mineradioSimplePlayer.active(),true,'legacy phone remains sticky');
  const expanded=context(null,{mobile:false});
  assert.equal(expanded.ctx.mineradioSimplePlayer.active(),false);
  expanded.media.matches=true;expanded.media.change();
  assert.equal(expanded.ctx.mineradioSimplePlayer.active(),true);
  const desktop=context(config('iphone',390,844),{desktop:true});
  assert.equal(desktop.ctx.mineradioSimplePlayer.atStartup,false);
  assert.equal(desktop.ctx.mineradioSimplePlayer.active(),false);
}
console.log('PASS iOS layout: phone landscape zero canvas contexts, iPad compact bootstrap/expand, no reload/audio/queue changes, legacy profile preserved');
